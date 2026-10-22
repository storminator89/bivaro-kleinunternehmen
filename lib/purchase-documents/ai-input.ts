import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readdir, rm, chmod, mkdir, realpath, lstat, open } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PurchaseDocumentError } from './errors';

export const AI_MAX_PDF_PAGES = 4;
export const AI_MAX_INPUT_BYTES = 6 * 1024 * 1024;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const WALL_TIME_MS = 20_000;
const MAX_DIAGNOSTIC_BYTES = 64 * 1024;
const MAX_MANIFEST_BYTES = 4096;
const RENDER_ROOT = path.join(process.cwd(), 'scripts', 'ai-pdf');
export type AiReceiptImage = { type: 'image_url'; image_url: { url: string; detail: 'high' } };
function inputError(code: string, message: string): never { throw new PurchaseDocumentError(message, 422, code); }

async function regularFile(file: string, maxBytes: number): Promise<Buffer> {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size <= 0 || info.size > maxBytes) throw new Error('Invalid renderer output');
  // The child has completely exited before output is read. O_NOFOLLOW is an
  // additional guard against accepting a replacement symlink as a page.
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const data = await handle.readFile();
    if (data.length !== info.size || data.length > maxBytes) throw new Error('Invalid renderer output size');
    return data;
  } finally { await handle.close(); }
}

async function rendererArguments(input: string, output: string): Promise<string[]> {
  if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch) || !process.getuid || !process.geteuid || process.getuid() === 0 || process.geteuid() === 0) throw new Error('Unsupported renderer platform');
  const require = createRequire(path.join(process.cwd(), 'package.json'));
  const packageRoot = async (name: string) => realpath(path.dirname(require.resolve(`${name}/package.json`)));
  const [node, script, filter, pdfjs, canvas, native] = await Promise.all([
    realpath(process.execPath), realpath(path.join(RENDER_ROOT, 'render.mjs')),
    realpath(path.join(RENDER_ROOT, `sandbox-${process.arch}.bpf`)),
    packageRoot('pdfjs-dist'), packageRoot('@napi-rs/canvas'), packageRoot(`@napi-rs/canvas-linux-${process.arch}-gnu`),
  ]);
  const rules = ['--no-new-privs', '--inh-caps=-all', '--ambient-caps=-all', '--pdeathsig=KILL', '--landlock-access', 'fs', '--seccomp-filter', filter];
  const allow = (access: string, file: string) => rules.push('--landlock-rule', `path-beneath:${access}:${file}`);
  // Do not grant the app tree, /proc, /home, /tmp or the parent's database,
  // uploads, environment, credentials or network configuration. Landlock and
  // seccomp apply to native canvas too; Node permissions alone do not.
  for (const directory of ['/usr/lib', '/lib', pdfjs, canvas, native]) allow('read-file,read-dir', await realpath(directory));
  // OS/request paths are not app assets. Runtime JS/native assets are listed
  // explicitly in next.config.ts and copied by Docker, never the whole app.
  for (const file of ['/etc/ld.so.cache', '/usr/bin/ldd', '/dev/urandom', '/dev/null', input, script]) allow('read-file', await realpath(/* turbopackIgnore: true */ file));
  allow('read-file,execute', node);
  // Linux's ELF loader is opened with execute permission independently of the
  // Node executable. Grant only the reviewed GNU loader, not executable rights
  // over a library tree. Missing/non-GNU layouts fail closed.
  allow('read-file,execute', await realpath(process.arch === 'x64' ? '/lib64/ld-linux-x86-64.so.2' : '/lib/ld-linux-aarch64.so.1'));
  // Only these five pre-created regular files are writable: no directory or
  // file creation, deletion, rename, symlink, hardlink or arbitrary output.
  for (const name of ['complete.json', ...Array.from({ length: AI_MAX_PDF_PAGES }, (_, index) => `page-${index + 1}.jpg`)]) allow('read-file,write-file', path.join(output, name));
  return [
    '--as=1073741824:1073741824', '--cpu=15:15', `--fsize=${MAX_PAGE_BYTES}:${MAX_PAGE_BYTES}`, '--nofile=64:64', '--core=0:0', '--',
    '/usr/bin/setpriv', ...rules, '--', node,
    '--max-old-space-size=128', '--disable-wasm-trap-handler', '--disallow-code-generation-from-strings', '--permission', '--allow-addons',
    `--allow-fs-read=${script}`, `--allow-fs-read=${input}`, `--allow-fs-read=${pdfjs}`,
    `--allow-fs-read=${canvas}`, `--allow-fs-read=${native}`, '--allow-fs-read=/usr/bin/ldd',
    `--allow-fs-read=${output}`, `--allow-fs-write=${output}`, script, input, output,
  ];
}

/** The only executor is Linux prlimit -> setpriv (Landlock + seccomp) -> Node.
 * There is no unconfined fallback. A detached process group is killed on every
 * outcome and reaped before any output is inspected or temporary data removed.
 */
async function renderPdf(input: string, output: string, signal?: AbortSignal): Promise<void> {
  let args: string[];
  try { args = await rendererArguments(input, output); }
  catch { return inputError('AI_RENDER_UNAVAILABLE', 'Isolierter PDF-Renderer ist nicht verfügbar. Original manuell prüfen oder später erneut versuchen; keine KI-Anfrage wurde gesendet.'); }
  if (signal?.aborted) return inputError('AI_REQUEST_INTERRUPTED', 'KI-Eingabeaufbereitung wurde abgebrochen.');
  await new Promise<void>((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    type RenderFailure = 'unavailable' | 'failed' | 'interrupted';
    let failure: RenderFailure | undefined;
    let diagnostics = 0;
    let diagnosticText = '';
    let stage = 'launcher', reason = 'unknown';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const killGroup = () => {
      if (!child?.pid) return;
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') failure ??= 'failed';
      }
    };
    const stop = (reason: RenderFailure) => { failure ??= reason; killGroup(); };
    const abort = () => stop('interrupted');
    try {
      child = spawn('/usr/bin/prlimit', args, {
        detached: true, cwd: output, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
        // No inherited PATH, NODE_OPTIONS, provider/API keys, database URL,
        // proxy, shell, locale configuration or app secrets.
        env: { LANG: 'C', HOME: output, TMPDIR: output, NODE_ENV: 'production', UV_THREADPOOL_SIZE: '1', RAYON_NUM_THREADS: '1', DISABLE_SYSTEM_FONTS_LOAD: '1' },
      });
    } catch { reject(new PurchaseDocumentError('Isolierter PDF-Renderer ist nicht verfügbar; keine KI-Anfrage wurde gesendet.', 422, 'AI_RENDER_UNAVAILABLE')); return; }
    const count = (chunk: Buffer) => {
      diagnostics += chunk.length;
      if (diagnostics > MAX_DIAGNOSTIC_BYTES) { stop('failed'); return; }
      // Retain bounded data in memory only. Accept fixed protocol tokens, never
      // surface raw PDF/library/native output or paths in logs/API errors.
      diagnosticText += chunk.toString('ascii');
      for (const match of diagnosticText.matchAll(/BIVARO_AI_RENDER_STAGE (read-input|canvas-import|pdfjs-import|document-load|metadata|operators|render|pixels|encode|write-page|page-cleanup|document-cleanup|manifest)\n/g)) stage = match[1];
      for (const match of diagnosticText.matchAll(/BIVARO_AI_RENDER_REASON (pdf-diagnostic|permission|module-load|memory|page-limit|type|range|runtime)\n/g)) reason = match[1];
      if (/OpenSSL configuration error/.test(diagnosticText)) reason = 'openssl-config';
      else if (/uv_pipe_open/.test(diagnosticText)) reason = 'stdio-setup';
      else if (/ERR_ACCESS_DENIED/.test(diagnosticText)) reason = 'node-permission';
      else if (/Detected unsettled top-level await/.test(diagnosticText)) reason = 'unsettled-await';
      if (reason === 'unknown') {
        if (/ERR_ACCESS_DENIED|Permission denied|Operation not permitted/.test(diagnosticText)) reason = 'permission';
        else if (/Cannot allocate memory|Allocation failed|heap out of memory|Failed to reserve|Reservation failed/.test(diagnosticText)) reason = 'memory';
        else if (/pthread_create|uv_thread_create/.test(diagnosticText)) reason = 'thread-create';
      }
    };
    child.stdout?.on('data', count); child.stderr?.on('data', count);
    child.once('error', error => { failure ??= (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'unavailable' : 'failed'; killGroup(); });
    child.once('close', (code, exitSignal) => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      killGroup();
      if (signal?.aborted || failure === 'interrupted') reject(new PurchaseDocumentError('KI-Eingabeaufbereitung wurde durch Gesamtzeitlimit oder Abbruch beendet.', 422, 'AI_REQUEST_INTERRUPTED'));
      else if (failure === 'unavailable' || code === 127) reject(new PurchaseDocumentError('Sichere PDF-Isolation ist nicht verfügbar. Später erneut versuchen oder Original manuell prüfen; keine KI-Anfrage wurde gesendet.', 422, 'AI_RENDER_UNAVAILABLE'));
      else if (!failure && code === 65) reject(new PurchaseDocumentError('Nur PDFs mit ein bis vier vollständigen Seiten werden an KI gesendet. Dieses PDF wird nicht teilweise analysiert; Original manuell prüfen.', 422, 'AI_PDF_LIMIT'));
      else if (failure || code !== 0) {
        const error = new PurchaseDocumentError('PDF konnte nicht vollständig innerhalb der sicheren Ressourcenlimits gerendert werden. Erneut versuchen oder Original manuell prüfen; keine KI-Anfrage wurde gesendet.', 422, 'AI_RENDER_FAILED');
        // Error.cause is diagnostic-only. Routes continue returning the fixed
        // public code/message, and synthetic native smoke shows these tokens.
        const signals = ['SIGABRT', 'SIGBUS', 'SIGFPE', 'SIGILL', 'SIGKILL', 'SIGSEGV', 'SIGSYS', 'SIGTERM', 'SIGXCPU', 'SIGXFSZ'];
        Object.defineProperty(error, 'cause', { value: { stage, reason, exitCode: Number.isInteger(code) ? code : null, signal: signals.includes(exitSignal ?? '') ? exitSignal : null, failure: failure ?? null } });
        reject(error);
      }
      else resolve();
    });
    timer = setTimeout(() => stop('failed'), WALL_TIME_MS); timer.unref?.();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export async function prepareAiReceiptImages(mediaType: string, bytes: Buffer, signal?: AbortSignal): Promise<AiReceiptImage[]> {
  if (signal?.aborted) return inputError('AI_REQUEST_INTERRUPTED', 'KI-Gesamtzeitlimit oder Abbruch vor Eingabeaufbereitung.');
  if (mediaType === 'image/jpeg' || mediaType === 'image/png') {
    if (!bytes.length || bytes.length > AI_MAX_INPUT_BYTES) return inputError('AI_UNSUPPORTED_FILE', 'Foto überschreitet das KI-Limit von 6 MiB oder ist leer. Das archivierte Original bleibt unverändert.');
    return [{ type: 'image_url', image_url: { url: `data:${mediaType};base64,${bytes.toString('base64')}`, detail: 'high' } }];
  }
  if (mediaType !== 'application/pdf') return inputError('AI_UNSUPPORTED_FILE', 'Für strukturierte XML-Belege wird die deterministische Extraktion verwendet.');
  if (!bytes.length || bytes.length > AI_MAX_INPUT_BYTES || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') return inputError('AI_PDF_LIMIT', 'KI-PDFs sind auf 6 MiB und vier vollständig gerenderte Seiten begrenzt.');
  const directory = await mkdtemp(path.join(tmpdir(), 'bivaro-ai-pdf-'));
  try {
    await chmod(directory, 0o700);
    const input = path.join(directory, 'original.pdf'), output = path.join(directory, 'pages');
    await mkdir(output, { mode: 0o700 });
    await writeFile(input, bytes, { mode: 0o400, flag: 'wx' });
    for (const name of ['complete.json', ...Array.from({ length: AI_MAX_PDF_PAGES }, (_, index) => `page-${index + 1}.jpg`)]) await writeFile(path.join(output, name), Buffer.alloc(0), { mode: 0o600, flag: 'wx' });
    await renderPdf(input, output, signal);
    if (signal?.aborted) return inputError('AI_REQUEST_INTERRUPTED', 'KI-Eingabeaufbereitung wurde abgebrochen.');
    try {
      const manifest = JSON.parse((await regularFile(path.join(output, 'complete.json'), MAX_MANIFEST_BYTES)).toString('utf8')) as { version?: unknown; pages?: unknown };
      if (manifest.version !== 1 || !Number.isInteger(manifest.pages) || Number(manifest.pages) < 1 || Number(manifest.pages) > AI_MAX_PDF_PAGES) throw new Error('Invalid completion manifest');
      const names = Array.from({ length: Number(manifest.pages) }, (_, index) => `page-${index + 1}.jpg`);
      const entries = (await readdir(output)).sort();
      const allPages = Array.from({ length: AI_MAX_PDF_PAGES }, (_, index) => `page-${index + 1}.jpg`);
      if (entries.join('|') !== ['complete.json', ...allPages].sort().join('|')) throw new Error('Incomplete or unexpected rendering output');
      for (const name of allPages.slice(names.length)) {
        const info = await lstat(path.join(output, name));
        if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size !== 0) throw new Error('Unexpected extra page');
      }
      const buffers: Buffer[] = [];
      let totalBytes = 0;
      for (const name of names) {
        const image = await regularFile(path.join(output, name), MAX_PAGE_BYTES);
        totalBytes += image.length;
        if (image.length < 5 || totalBytes > AI_MAX_INPUT_BYTES || image[0] !== 255 || image[1] !== 216 || image[2] !== 255 || image.at(-2) !== 255 || image.at(-1) !== 217) throw new Error('Invalid page image');
        buffers.push(image);
      }
      return buffers.map(image => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image.toString('base64')}`, detail: 'high' } }));
    } catch {
      if (signal?.aborted) return inputError('AI_REQUEST_INTERRUPTED', 'KI-Eingabeaufbereitung wurde abgebrochen.');
      return inputError('AI_RENDER_FAILED', 'PDF-Seiten wurden nicht vollständig bestätigt. Original manuell prüfen oder erneut versuchen; keine KI-Anfrage wurde gesendet.');
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
}
