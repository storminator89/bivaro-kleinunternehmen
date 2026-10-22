import { constants, readFileSync } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, mkdtemp, open, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { adaptWorkerBytes, adaptedCondition, ADAPTED_WORKER_NAME, ADAPTED_WORKER_SHA256, OFFICIAL_WORKER_SHA256, preparePdfWorkerAtRoot } from '../ai-pdf/prepare-worker.mjs';

const officialFile = path.join(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
const original = readFileSync(officialFile);
const renderer = readFileSync('scripts/ai-pdf/render.mjs', 'utf8');
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const originalCondition = '    if (type !== this.type || subtype !== this.subtype) {';
// Execute only the actual condition expression from the generated source. This
// does not import PDF.js or execute a PDF parser, native library or syscall probe.
const diagnoses = (flag: unknown, declared = 'Type1', declaredSubtype: unknown = undefined, actual = 'TrueType', actualSubtype: unknown = undefined) => {
  const context = createContext({ properties: { isInternalFont: flag }, type: actual, subtype: actualSubtype, declared, declaredSubtype }, { codeGeneration: { strings: false, wasm: false } });
  return runInContext(`(function () { let diagnosed = false; ${adaptedCondition} diagnosed = true; } return diagnosed; }).call({type:declared, subtype:declaredSubtype})`, context, { timeout: 50 });
};
async function temporaryPackage(run: (root: string, directory: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), 'bivaro-worker-adapter-'));
  const directory = path.join(root, 'legacy', 'build');
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '6.4.299' }));
    await copyFile(officialFile, path.join(directory, 'pdf.worker.mjs'));
    await run(root, directory);
  } finally { await rm(root, { recursive: true, force: true }); }
}
async function attest(root: string) {
  const begin = renderer.indexOf('async function attestedWorkerUrl('), end = renderer.indexOf('function selectAttestedWorker(');
  const context = createContext({ root, realpath, lstat, open, path, constants, createHash, pathToFileURL, OFFICIAL_WORKER_SHA256, ADAPTED_WORKER_SHA256, ADAPTED_WORKER_NAME }, { codeGeneration: { strings: false, wasm: false } });
  return await runInContext(renderer.slice(begin, end) + '\nattestedWorkerUrl(root)', context, { timeout: 50 });
}

describe('pinned provenance-aware PDF worker adapter (build/source only)', () => {
  it('retains official bytes and changes exactly one reviewed condition plus the modification notice', () => {
    const before = Buffer.from(original), output = adaptWorkerBytes(original);
    expect(hash(original)).toBe(OFFICIAL_WORKER_SHA256); expect(original.equals(before)).toBe(true);
    expect(hash(output)).toBe(ADAPTED_WORKER_SHA256);
    expect(adaptWorkerBytes(original).equals(output)).toBe(true);
    const modified = output.toString('utf8');
    expect(modified).toContain('Bivaro modification: diagnostic-only provenance guard');
    expect(modified.slice(modified.indexOf('*/\n') + 3).replace(adaptedCondition, originalCondition)).toBe(original.toString('utf8'));
    expect(modified.split(adaptedCondition)).toHaveLength(2);
  });
  it('fails closed for input/version drift instead of accepting or heuristically patching it', async () => {
    const changed = Buffer.from(original); changed[100] ^= 1;
    for (const input of [changed, Buffer.concat([original, Buffer.from(' ')]), Buffer.from('unreviewed source')]) expect(() => adaptWorkerBytes(input)).toThrow('Unreviewed official PDF worker');
    await temporaryPackage(async root => {
      await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: 'UNREVIEWED' }));
      await expect(preparePdfWorkerAtRoot(root)).rejects.toThrow('Unreviewed PDF.js version');
    });
  });
  it('exempts only strict boolean true with the complete exact built-in substitution tuple', () => {
    expect(diagnoses(true)).toBe(false);
    for (const flag of [false, undefined, null, 'true', 1, {}, []]) expect(diagnoses(flag)).toBe(true);
    for (const tuple of [
      ['Type1', 'Type1C', 'TrueType', undefined], ['Type1', undefined, 'TrueType', 'OpenType'],
      ['Type1', undefined, 'OpenType', undefined], ['CIDFontType0', undefined, 'TrueType', undefined],
      ['TrueType', undefined, 'Type1', undefined], ['Type1', null, 'TrueType', undefined],
      ['Type1', undefined, 'TrueType', null], ['Type1', 'undefined', 'TrueType', undefined],
    ] as const) expect(diagnoses(true, tuple[0], tuple[1], tuple[2], tuple[3])).toBe(true);
    expect(diagnoses(true, 'TrueType', undefined, 'TrueType')).toBe(false); // no mismatch before or after adaptation
  });
  it('writes only a distinct read-only derived worker and leaves the official file unchanged', async () => {
    await temporaryPackage(async (root, directory) => {
      await preparePdfWorkerAtRoot(root); await preparePdfWorkerAtRoot(root);
      expect((await readFile(path.join(directory, 'pdf.worker.mjs'))).equals(original)).toBe(true);
      const generated = path.join(directory, ADAPTED_WORKER_NAME);
      expect(hash(await readFile(generated))).toBe(ADAPTED_WORKER_SHA256);
      expect((await stat(generated)).mode & 0o222).toBe(0);
      await chmod(generated, 0o600); await writeFile(generated, 'stale or unreviewed worker'); await chmod(generated, 0o444);
      await expect(preparePdfWorkerAtRoot(root)).rejects.toThrow('Stale or changed adapted PDF worker');
    });
  });
  it('refuses generated symlinks without writing through them', async () => {
    await temporaryPackage(async (root, directory) => {
      const target = path.join(root, 'private-marker'); await writeFile(target, 'unchanged');
      await symlink(target, path.join(directory, ADAPTED_WORKER_NAME));
      await expect(preparePdfWorkerAtRoot(root)).rejects.toThrow('Invalid PDF worker asset');
      expect(await readFile(target, 'utf8')).toBe('unchanged');
    });
  });
  it('runs the exact child attestation on own temporary assets and rejects stale, writable or missing bytes', async () => {
    await temporaryPackage(async (root, directory) => {
      await preparePdfWorkerAtRoot(root);
      const generated = path.join(directory, ADAPTED_WORKER_NAME);
      expect(await attest(root)).toBe(pathToFileURL(generated).href);
      await chmod(generated, 0o600);
      await expect(attest(root)).rejects.toThrow('Invalid attested worker asset');
      await writeFile(generated, 'stale'); await chmod(generated, 0o444);
      await expect(attest(root)).rejects.toThrow('Unreviewed worker bytes');
      await rm(generated);
      await expect(attest(root)).rejects.toThrow(); // no original-worker fallback
      await writeFile(generated, adaptWorkerBytes(original), { mode: 0o444 });
      const official = path.join(directory, 'pdf.worker.mjs'); await writeFile(official, 'unreviewed original');
      await expect(attest(root)).rejects.toThrow('Unreviewed worker bytes');
    });
  });
  it('refuses a symlink even to matching adapted bytes instead of hashing one path and importing another', async () => {
    await temporaryPackage(async (root, directory) => {
      await preparePdfWorkerAtRoot(root);
      const generated = path.join(directory, ADAPTED_WORKER_NAME), alternate = path.join(root, 'same-bytes.mjs');
      await copyFile(generated, alternate); await rm(generated); await symlink(alternate, generated);
      await expect(attest(root)).rejects.toThrow('Invalid attested worker asset');
    });
  });
  it('attests the same canonical path selected as an absolute file URL without runtime rewriting', () => {
    expect(renderer).toContain(`const OFFICIAL_WORKER_SHA256 = '${OFFICIAL_WORKER_SHA256}'`);
    expect(renderer).toContain(`const ADAPTED_WORKER_SHA256 = '${ADAPTED_WORKER_SHA256}'`);
    expect(renderer).toContain(`const ADAPTED_WORKER_NAME = '${ADAPTED_WORKER_NAME}'`);
    expect(renderer).toContain('file !== requested');
    expect(renderer).toContain('createHash(\'sha256\').update(bytes).digest(\'hex\') !== expectedHash');
    expect(renderer).toContain('worker = pathToFileURL(file).href');
    expect(renderer).not.toContain('adaptWorkerBytes');
    expect(renderer.lastIndexOf('selectAttestedWorker(GlobalWorkerOptions, workerUrl)')).toBeLessThan(renderer.indexOf('loadingTask = getDocument('));
    const next = readFileSync('next.config.ts', 'utf8'), docker = readFileSync('Dockerfile', 'utf8');
    expect(next.match(/serverExternalPackages:/g)).toHaveLength(1);
    expect(next.match(/outputFileTracingIncludes:/g)).toHaveLength(1);
    expect(next).toContain("serverExternalPackages: ['pdfkit', 'fontkit', 'pdfjs-dist', '@napi-rs/canvas']");
    expect(next).toContain("'./node_modules/pdfkit/js/data/**/*'");
    expect(next).toContain("'./public/fonts/invoice/**/*'");
    expect(next).toContain("'./node_modules/pdfjs-dist/**/*'");
    expect(docker).toContain('COPY --from=builder /app/node_modules/pdfjs-dist ./node_modules/pdfjs-dist');
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.scripts.prebuild).toBe('node scripts/ai-pdf/prepare-worker.mjs');
    expect(pkg.scripts.predev).toBe(pkg.scripts.prebuild);
  });
  it('rejects both worker shortcuts rather than trusting workerSrc alone', () => {
    const begin = renderer.indexOf('function selectAttestedWorker('), end = renderer.indexOf('class PdfLimitError');
    const selection = renderer.slice(begin, end);
    const url = 'file:///trusted/attested-worker.mjs';
    for (const [preloaded, port] of [[false, null], [true, null], [false, {}], [false, undefined]] as const) {
      const options = { workerPort: port, workerSrc: 'unreviewed' };
      const context = createContext({ options, url }, { codeGeneration: { strings: false, wasm: false } });
      if (preloaded) runInContext('globalThis.pdfjsWorker = {WorkerMessageHandler:{}}', context);
      const execute = () => runInContext(selection + '\nselectAttestedWorker(options,url)', context, { timeout: 50 });
      if (!preloaded && port === null) { execute(); expect(options.workerSrc).toBe(url); }
      else { expect(execute).toThrow('Unexpected preloaded PDF worker'); expect(options.workerSrc).toBe('unreviewed'); }
    }
    for (const setup of ['globalThis.pdfjsWorker=undefined', 'Object.getPrototypeOf(globalThis).pdfjsWorker={WorkerMessageHandler:{}}']) {
      const context = createContext({ options: { workerPort: null }, url }); runInContext(setup, context);
      expect(() => runInContext(selection + '\nselectAttestedWorker(options,url)', context, { timeout: 50 })).toThrow('Unexpected preloaded PDF worker');
    }
  });
  it('retains embedded, claimed-internal and mixed-order genuine negative gate requirements', () => {
    const build = readFileSync('scripts/ai-pdf/build-native-smoke.mjs', 'utf8'), smoke = readFileSync('scripts/ai-pdf/native-smoke.mjs', 'utf8');
    for (const name of ['embedded-mismatch', 'embedded-claimed-internal', 'standard-then-embedded', 'embedded-then-standard']) { expect(build).toContain(name); expect(smoke).toContain(name); }
    expect(build).toContain("'standard_fonts', 'LiberationSans-Regular.ttf'");
    expect(build).toContain("FontName: 'Helvetica'"); expect(build).toContain('FontFile2:');
    expect(build).toContain("PDFName.of('isInternalFont'), PDFBool.True");
    expect(smoke).toContain("error.cause?.reason === 'pdf-diagnostic' && error.cause?.pdfDiagnosticCodes.includes('font-type1-truetype')");
  });
});
