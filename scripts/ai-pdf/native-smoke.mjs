/** Run only in an ephemeral non-root runtime with networking disabled.
 * Calls the compiled exact production parent, including kernel confinement,
 * output validation and cleanup. It never calls a provider or skips failures.
 */
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createNativeMemoryObserver } from './native-memory-observer.mjs';

const require = createRequire(import.meta.url);
const { prepareAiReceiptImages } = require('./smoke-runtime/ai-input.js');
const fixture = name => readFile(new URL(`./smoke-runtime/${name}.pdf`, import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const prepareObserved = async original => {
  const observer = createNativeMemoryObserver();
  try { return await prepareAiReceiptImages('application/pdf', original); }
  finally {
    const metrics = await observer.close();
    process.stdout.write(`BIVARO_AI_NATIVE_MEMORY ${JSON.stringify(metrics)}\n`);
  }
};
for (const [name, pages] of [['one', 1], ['two', 2], ['four', 4], ['raster', 1]]) {
  const original = await fixture(name), before = hash(original);
  const images = await prepareObserved(original);
  assert.equal(images.length, pages);
  assert.equal(new Set(images.map(image => image.image_url.url)).size, pages);
  for (const image of images) {
    assert.match(image.image_url.url, /^data:image\/jpeg;base64,/);
    const bytes = Buffer.from(image.image_url.url.split(',')[1], 'base64');
    assert(bytes.length > 500 && bytes.length <= 2 * 1024 * 1024);
    assert(bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])));
    assert(bytes.subarray(-2).equals(Buffer.from([255, 217])));
  }
  assert.equal(hash(original), before);
}
for (const [name, code] of [['five', 'AI_PDF_LIMIT'], ['blank', 'AI_RENDER_FAILED'], ['geometry', 'AI_RENDER_FAILED']]) {
  await assert.rejects(prepareObserved(await fixture(name)), error => error.code === code);
}
for (const name of ['embedded-mismatch', 'embedded-claimed-internal', 'standard-then-embedded', 'embedded-then-standard']) {
  await assert.rejects(prepareObserved(await fixture(name)), error => error.code === 'AI_RENDER_FAILED' && error.cause?.reason === 'pdf-diagnostic' && error.cause?.pdfDiagnosticCodes.includes('font-type1-truetype'));
}
const valid = await fixture('one');
for (const original of [Buffer.from('%PDF-1.7\nnot a valid document'), valid.subarray(0, Math.floor(valid.length / 2))]) {
  await assert.rejects(prepareObserved(original), error => error.code === 'AI_RENDER_FAILED');
}
await assert.rejects(prepareObserved(Buffer.alloc(6 * 1024 * 1024 + 1)), error => error.code === 'AI_PDF_LIMIT');
process.stdout.write(`Genuine isolated receipt PDF.js checks passed (${process.arch}).\n`);
