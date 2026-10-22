import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdtemp, open, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { withProcessingSlot } from '@/lib/processing-limit';
import { MAX_PDF_INPUT_BYTES, MAX_XML_INPUT_BYTES, MAX_PDF_XML_COMBINED_BYTES, RequestBodyLimitError } from '@/lib/resource-limits';
import { PdfA3ValidationError, validatePdfA3 } from './pdfa-validator';
const MAX_OUTPUT_BYTES = MAX_PDF_INPUT_BYTES * 2;
const WORKER_DIRECTORY = path.join(process.cwd(), 'scripts', 'foreign-pdf');
const WORKER_TIMEOUT_MS = 30000;
const MAX_PROTOCOL_BYTES = 4096;
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const unsupportedCodes = new Set([
  'PDF_UNSUPPORTED_STRUCTURE', 'PDF_UNSUPPORTED_METADATA', 'PDF_SIGNED', 'PDF_FORMS_UNSUPPORTED',
  'PDF_ATTACHMENTS_UNSUPPORTED', 'PDF_ACTIVE_CONTENT_UNSUPPORTED', 'PDF_ENCRYPTED',
  'PDF_INVALID_OR_ENCRYPTED', 'PDF_INVALID_STRUCTURE', 'PDF_REQUIRES_NORMALIZATION',
  'PDF_INPUT_INVALID', 'PDF_XML_INVALID', 'PDF_OUTPUT_LIMIT',
]);
export class ForeignPdfError extends Error {
  readonly status: 422 | 503;
  constructor(readonly code: string = 'PDF_PROCESSING_UNAVAILABLE') {
    const unsupported = unsupportedCodes.has(code);
    super(code === 'PDF_XML_INVALID'
      ? 'Die Rechnungs-XML muss wohlgeformtes UTF-8-CII-XML mit EN16931-Profilkennung sein. Die übergebenen Dateien wurden nicht archiviert.'
      : unsupported
      ? 'Dieses Fremd-PDF kann nicht unverändert ergänzt werden. Erforderlich ist ein gültiges, unsigniertes und unverschlüsseltes PDF/A-3b ohne Formulare oder vorhandene Anhänge. Original und vorhandene Anhänge werden nicht verändert. Die übergebenen Dateien wurden nicht archiviert.'
      : 'Die sichere PDF-Verarbeitung ist derzeit nicht verfügbar. Bitte später erneut versuchen. Es wurde kein Ergebnis ausgegeben oder archiviert.');
    this.name = 'ForeignPdfError';
    this.status = unsupported ? 422 : 503;
  }
}
export type CreatePdfA3InvoiceInput = {
  basePdfBytes: Uint8Array;
  xmlContent: string;
  invoiceNumber: string;
  userId?: string;
};
async function workerArguments(input: string, xml: string, output: string): Promise<string[]> {
  if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch) || !process.getuid || !process.geteuid || process.getuid() === 0 || process.geteuid() === 0)
    throw new ForeignPdfError();
  const require = createRequire(path.join(process.cwd(), 'package.json'));
  const node = await realpath(process.execPath), directory = await realpath(WORKER_DIRECTORY);
  const script = path.join(directory, 'worker.mjs');
  const packages: string[] = [];
  // Resolve from the actual consumer, including npm's possible nested copies.
  const pdfRequire = createRequire(require.resolve('pdf-lib/package.json'));
  for (const [name, resolver] of [['pdf-lib', require], ['sax', require], ['@pdf-lib/standard-fonts', pdfRequire], ['@pdf-lib/upng', pdfRequire], ['pako', pdfRequire], ['tslib', pdfRequire]] as const) {
    const manifest = name === 'tslib' ? resolver.resolve(name) : resolver.resolve(`${name}/package.json`);
    packages.push(await realpath(path.dirname(manifest)));
  }
  for (const owner of ['@pdf-lib/standard-fonts', '@pdf-lib/upng']) {
    const nested = createRequire(pdfRequire.resolve(`${owner}/package.json`));
    for (const name of ['pako', 'tslib'])
      packages.push(await realpath(path.dirname(name === 'tslib' ? nested.resolve(name) : nested.resolve(`${name}/package.json`))));
  }
  const filter = await realpath(path.join(directory, `sandbox-${process.arch}.bpf`));
  const rules = ['--no-new-privs', '--inh-caps=-all', '--ambient-caps=-all', '--pdeathsig=KILL', '--landlock-access', 'fs', '--seccomp-filter', filter];
  const allow = (access: string, file: string) => rules.push('--landlock-rule', `path-beneath:${access}:${file}`);
  for (const name of ['/usr/lib', '/lib', directory, ...new Set(packages)])
    allow('read-file,read-dir', await realpath(name));
  for (const file of ['/etc/ld.so.cache', '/dev/urandom', '/dev/null', input, xml])
    allow('read-file', await realpath(file));
  allow('read-file,execute', node);
  allow('read-file,execute', await realpath(process.arch === 'x64' ? '/lib64/ld-linux-x86-64.so.2' : '/lib/ld-linux-aarch64.so.1'));
  allow('read-file,write-file', output);
  return [
    '--as=1073741824:1073741824', '--cpu=25:25', `--fsize=${MAX_OUTPUT_BYTES}:${MAX_OUTPUT_BYTES}`, '--nofile=64:64', '--core=0:0', '--',
    '/usr/bin/setpriv', ...rules, '--', node, '--openssl-config=/dev/null', '--v8-pool-size=1', '--max-old-space-size=192',
    '--disable-wasm-trap-handler', '--disallow-code-generation-from-strings', '--permission',
    `--allow-fs-read=${directory}`, ...[...new Set(packages)].map(name => `--allow-fs-read=${name}`),
    `--allow-fs-read=${input}`, `--allow-fs-read=${xml}`, `--allow-fs-read=${output}`, `--allow-fs-write=${output}`,
    script, input, xml, output,
  ];
}
type CandidateManifest = {
  status: 'candidate';
  sourceSha256: string;
  xmlSha256: string;
  sha256: string;
  bytes: number;
};
async function runWorker(input: string, xml: string, output: string, directory: string): Promise<CandidateManifest> {
  let args: string[];
  try {
    args = await workerArguments(input, xml, output);
  }
  catch {
    throw new ForeignPdfError();
  }
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    let failed = false, bytes = 0;
    const stdout: Buffer[] = [];
    const kill = () => { try {
      if (child?.pid)
        process.kill(-child.pid, 'SIGKILL');
    }
    catch { /* Already reaped. */ } };
    const fail = () => { failed = true; kill(); };
    try {
      child = spawn('/usr/bin/prlimit', args, {
        cwd: directory, detached: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
        env: { LANG: 'C', HOME: directory, TMPDIR: directory, NODE_ENV: 'production', UV_THREADPOOL_SIZE: '1', MALLOC_ARENA_MAX: '2' },
      });
    }
    catch {
      reject(new ForeignPdfError());
      return;
    }
    const timer = setTimeout(fail, WORKER_TIMEOUT_MS);
    const consume = (chunk: Buffer, keep: boolean) => { bytes += chunk.length; if (bytes > MAX_PROTOCOL_BYTES) {
      fail();
      return;
    } if (keep && !failed)
      stdout.push(chunk); };
    child.stdout!.on('data', (chunk: Buffer) => consume(chunk, true));
    child.stderr!.on('data', (chunk: Buffer) => consume(chunk, false));
    child.stdout!.on('error', fail);
    child.stderr!.on('error', fail);
    child.once('error', fail);
    child.once('exit', () => kill());
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      kill();
      if (failed || signal) {
        reject(new ForeignPdfError());
        return;
      }
      try {
        const result: unknown = JSON.parse(Buffer.concat(stdout).toString('utf8'));
        if (!result || typeof result !== 'object' || Array.isArray(result))
          throw new Error();
        const record = result as Record<string, unknown>;
        if (code === 22 && record.status === 'unsupported' && typeof record.code === 'string' && unsupportedCodes.has(record.code) && Object.keys(record).length === 2) {
          reject(new ForeignPdfError(record.code));
          return;
        }
        if (code !== 0 || record.status !== 'candidate' || Object.keys(record).length !== 5 || !['sourceSha256', 'xmlSha256', 'sha256'].every(key => typeof record[key] === 'string' && /^[a-f0-9]{64}$/.test(record[key] as string)) || !Number.isSafeInteger(record.bytes) || (record.bytes as number) < 1 || (record.bytes as number) > MAX_OUTPUT_BYTES)
          throw new Error();
        resolve(record as CandidateManifest);
      }
      catch {
        reject(new ForeignPdfError());
      }
    });
  });
}
async function readCandidate(file: string, manifest: CandidateManifest): Promise<Uint8Array> {
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size !== manifest.bytes || before.size > MAX_OUTPUT_BYTES)
    throw new ForeignPdfError();
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const current = await handle.stat();
    if (!current.isFile() || current.dev !== before.dev || current.ino !== before.ino || current.nlink !== 1 || current.size !== before.size)
      throw new ForeignPdfError();
    const bytes = await handle.readFile();
    if (bytes.length !== manifest.bytes || digest(bytes) !== manifest.sha256 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-')
      throw new ForeignPdfError();
    return new Uint8Array(bytes);
  }
  finally {
    await handle.close();
  }
}
/** Stateless, attachment-only derivation. No archive writes, repair, rasterization
 * or claim that a user's submitted files were already archived. */
export async function createPdfA3Invoice({ basePdfBytes, xmlContent, invoiceNumber, userId }: CreatePdfA3InvoiceInput): Promise<Uint8Array> {
  const xmlBytes = Buffer.from(xmlContent, 'utf8');
  if (basePdfBytes.byteLength > MAX_PDF_INPUT_BYTES || xmlBytes.length > MAX_XML_INPUT_BYTES || basePdfBytes.byteLength + xmlBytes.length > MAX_PDF_XML_COMBINED_BYTES)
    throw new RequestBodyLimitError('PDF oder XML ist zu groß');
  if (!basePdfBytes.length || !xmlBytes.length || typeof invoiceNumber !== 'string' || !invoiceNumber.trim() || invoiceNumber.length > 200 || Buffer.from(basePdfBytes.subarray(0, 5)).toString('ascii') !== '%PDF-')
    throw new ForeignPdfError('PDF_INPUT_INVALID');
  // Snapshot before the first await; caller mutation cannot change the derivation.
  const original = Uint8Array.from(basePdfBytes), originalHash = digest(original), xmlHash = digest(xmlBytes);
  return withProcessingSlot(userId, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'bivaro-foreign-pdf-'));
    try {
      await chmod(directory, 0o700);
      const input = path.join(directory, 'original.pdf'), xml = path.join(directory, 'invoice.xml'), output = path.join(directory, 'candidate.pdf');
      await writeFile(input, original, { mode: 0o600, flag: 'wx' });
      await writeFile(xml, xmlBytes, { mode: 0o600, flag: 'wx' });
      await writeFile(output, new Uint8Array(), { mode: 0o600, flag: 'wx' });
      const manifest = await runWorker(input, xml, output, directory);
      if (manifest.sourceSha256 !== originalHash || manifest.xmlSha256 !== xmlHash)
        throw new ForeignPdfError();
      // Preexisting conformance is mandatory; no opportunistic conversion of an
      // ordinary PDF, even when attachment-only output might happen to validate.
      try {
        await validatePdfA3(original, { confined: true });
      } catch (error) {
        if (error instanceof PdfA3ValidationError && error.kind === 'unsupported')
          throw new ForeignPdfError('PDF_REQUIRES_NORMALIZATION');
        throw error;
      }
      const candidate = await readCandidate(output, manifest);
      await validatePdfA3(candidate, { maxBytes: MAX_OUTPUT_BYTES, confined: true });
      return candidate;
    }
    catch (error) {
      if (error instanceof ForeignPdfError || error instanceof RequestBodyLimitError)
        throw error;
      // A candidate that fails after an independently valid source is not proof
      // of bad source input. Treat it as an unavailable safe derivation, never
      // blame the user or downgrade the final gate.
      throw new ForeignPdfError();
    }
    finally {
      try {
        await rm(directory, { recursive: true, force: true });
      }
      catch {
        throw new ForeignPdfError();
      }
    }
  });
}
