/** Deterministic build-time diagnostic adapter for one reviewed PDF.js release.
 * No PDF is loaded or interpreted here. Keep the official worker unchanged.
 */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PDFJS_VERSION = '6.4.299';
export const OFFICIAL_WORKER_SHA256 = 'bb422f60804477de4a0b09091d8347a916a387755ed1cbad24ccaec1d09c78bf';
export const ADAPTED_WORKER_SHA256 = '0f463d40ad20db0c24f3f6a4a1b94818dfebea67c06b4a734a66b9fcd21b0135';
export const ADAPTED_WORKER_NAME = 'pdf.worker.bivaro-6.4.299.mjs';
const MAX_WORKER_BYTES = 4 * 1024 * 1024;
const originalCondition = '    if (type !== this.type || subtype !== this.subtype) {';
export const adaptedCondition = `    if ((type !== this.type || subtype !== this.subtype) && !(
      properties.isInternalFont === true && this.type === "Type1" &&
      this.subtype === undefined && type === "TrueType" && subtype === undefined
    )) {`;
const notice = '/* Bivaro modification: diagnostic-only provenance guard for the exact built-in\n * Type1-to-TrueType substitution in PDF.js 6.4.299. Parsing/rendering unchanged.\n * Original worker retained. See scripts/ai-pdf/prepare-worker.mjs and security docs.\n */\n';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function adaptWorkerBytes(original) {
  if (!(original instanceof Uint8Array) || original.length > MAX_WORKER_BYTES || hash(original) !== OFFICIAL_WORKER_SHA256) throw new Error('Unreviewed official PDF worker');
  const source = Buffer.from(original).toString('utf8');
  if (source.split(originalCondition).length !== 2) throw new Error('PDF worker adapter target drift');
  const output = Buffer.from(notice + source.replace(originalCondition, adaptedCondition));
  if (hash(output) !== ADAPTED_WORKER_SHA256) throw new Error('Unreviewed adapted PDF worker');
  return output;
}

async function regularBytes(file, readOnly = false) {
  const expected = await lstat(file);
  if (!expected.isFile() || expected.isSymbolicLink() || expected.nlink !== 1 || expected.size < 1 || expected.size > MAX_WORKER_BYTES || (readOnly && (expected.mode & 0o222))) throw new Error('Invalid PDF worker asset');
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const current = await handle.stat();
    if (!current.isFile() || current.dev !== expected.dev || current.ino !== expected.ino || current.nlink !== 1 || current.size !== expected.size) throw new Error('Changed PDF worker asset');
    const bytes = await handle.readFile();
    if (bytes.length !== expected.size) throw new Error('Changed PDF worker size');
    return bytes;
  } finally { await handle.close(); }
}

export async function preparePdfWorkerAtRoot(packageRoot) {
  const root = await realpath(packageRoot);
  if (JSON.parse((await regularBytes(path.join(root, 'package.json'))).toString('utf8')).version !== PDFJS_VERSION) throw new Error('Unreviewed PDF.js version');
  const directory = path.join(root, 'legacy', 'build');
  const original = await regularBytes(path.join(directory, 'pdf.worker.mjs'));
  const output = adaptWorkerBytes(original), destination = path.join(directory, ADAPTED_WORKER_NAME);
  try { await writeFile(destination, output, { flag: 'wx', mode: 0o444 }); }
  catch (error) { if (error?.code !== 'EEXIST') throw error; }
  if (hash(await regularBytes(destination, true)) !== ADAPTED_WORKER_SHA256) throw new Error('Stale or changed adapted PDF worker');
  if (hash(await regularBytes(path.join(directory, 'pdf.worker.mjs'))) !== OFFICIAL_WORKER_SHA256) throw new Error('Official PDF worker changed');
}

export async function preparePdfWorker() {
  const require = createRequire(import.meta.url);
  await preparePdfWorkerAtRoot(path.dirname(require.resolve('pdfjs-dist/package.json')));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await preparePdfWorker();
