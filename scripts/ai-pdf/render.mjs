/** Receipt rasterizer. Invoke ONLY through ai-input.ts's kernel confinement.
 * PDF.js performs every PDF parsing/rendering operation; this is not a PDF
 * interpreter. No viewer, scripting manager, HTML or external provider is used.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { writeSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const MAX_INPUT_BYTES = 6 * 1024 * 1024;
const MAX_PAGES = 4;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_PAGE_POINTS = 2000;
const MAX_CANVAS_EDGE = 4096;
const MAX_CANVAS_PIXELS = 16_000_000;
const MAX_LIVE_CANVAS_PIXELS = 24_000_000;
const MAX_ALLOCATED_CANVAS_PIXELS = 64_000_000;
const MAX_PAGE_PIXELS = 4_000_000;
const MAX_OPERATIONS = 100_000;
let diagnostic = false;
// Fixed protocol tokens only: no document strings, paths, error messages or
// library diagnostics leave the child. Useful even when native startup fails.
// A direct write to the inherited pipe avoids initializing a new libuv handle
// merely to report a failure of that very stdio initialization.
const progress = stage => writeSync(1, `BIVARO_AI_RENDER_STAGE ${stage}\n`);
// PDF.js recovery can return successful promises after skipping damaged data.
// Its warnings use console.log; never suppress them into an apparent success.
// Keep no original content in diagnostics and reject any diagnostic, even a
// warning that a different renderer might consider harmless.
for (const method of ['log', 'info', 'warn', 'error', 'debug']) console[method] = () => { diagnostic = true; };
function assertClean() { if (diagnostic) throw new Error('Renderer reported recovery or unsupported content'); }
function geometry(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > MAX_CANVAS_EDGE || height > MAX_CANVAS_EDGE || width * height > MAX_CANVAS_PIXELS) throw new Error('Canvas geometry limit');
}

class PdfLimitError extends Error {}
let loadingTask;
try {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || process.argv.length !== 4) throw new Error('Invalid renderer invocation');
  progress('read-input');
  const bytes = await readFile(input);
  if (!bytes.length || bytes.length > MAX_INPUT_BYTES || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('Input limit');
  const require = createRequire(import.meta.url);
  const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
  progress('canvas-import');
  const canvas = require('@napi-rs/canvas');
  if (require('@napi-rs/canvas/package.json').version !== '1.0.13') throw new Error('Unreviewed canvas version');
  progress('pdfjs-import');
  const { getDocument, version, AnnotationMode, VerbosityLevel } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (version !== '6.4.299') throw new Error('Unreviewed PDF.js version');
  let livePixels = 0, allocatedPixels = 0;
  const sizes = new WeakMap();
  class BoundedCanvasFactory {
    create(width, height) {
      width = Math.ceil(width); height = Math.ceil(height); geometry(width, height);
      const pixels = width * height;
      if (livePixels + pixels > MAX_LIVE_CANVAS_PIXELS || allocatedPixels + pixels > MAX_ALLOCATED_CANVAS_PIXELS) throw new Error('Canvas allocation limit');
      const surface = canvas.createCanvas(width, height);
      livePixels += pixels; allocatedPixels += pixels; sizes.set(surface, pixels);
      return { canvas: surface, context: surface.getContext('2d', { willReadFrequently: true }) };
    }
    reset(target, width, height) {
      width = Math.ceil(width); height = Math.ceil(height); geometry(width, height);
      if (!target.canvas || !sizes.has(target.canvas)) throw new Error('Unknown canvas');
      const pixels = width * height, previous = sizes.get(target.canvas);
      if (livePixels - previous + pixels > MAX_LIVE_CANVAS_PIXELS || allocatedPixels + pixels > MAX_ALLOCATED_CANVAS_PIXELS) throw new Error('Canvas allocation limit');
      // Avoid a transient new-width * old-height backing bitmap that was not
      // included in the live/cumulative pixel accounting. Pinned canvas and
      // PDF.js both support the same zero-sized reset used by destroy below.
      target.canvas.width = 0; target.canvas.height = 0;
      target.canvas.width = width; target.canvas.height = height;
      livePixels += pixels - previous; allocatedPixels += pixels; sizes.set(target.canvas, pixels);
    }
    destroy(target) {
      if (!target.canvas) return;
      livePixels -= sizes.get(target.canvas) ?? 0; sizes.delete(target.canvas);
      target.canvas.width = 0; target.canvas.height = 0; target.canvas = null; target.context = null;
    }
  }
  progress('document-load');
  loadingTask = getDocument({
    data: new Uint8Array(bytes), stopAtErrors: true, verbosity: VerbosityLevel.INFOS,
    // PDF.js documents that maxImageSize skips oversize images. Its resulting
    // warning is fatal here, so an otherwise successful partial page is rejected.
    maxImageSize: MAX_CANVAS_PIXELS, canvasMaxAreaInBytes: MAX_CANVAS_PIXELS * 4,
    CanvasFactory: BoundedCanvasFactory,
    useSystemFonts: false, disableFontFace: true, enableXfa: false,
    useWorkerFetch: false, isOffscreenCanvasSupported: false, isImageDecoderSupported: false,
    disableRange: true, disableStream: true, disableAutoFetch: true,
    cMapUrl: path.join(pdfjsRoot, 'cmaps') + path.sep, cMapPacked: true,
    standardFontDataUrl: path.join(pdfjsRoot, 'standard_fonts') + path.sep,
    wasmUrl: path.join(pdfjsRoot, 'wasm') + path.sep,
  });
  const pdf = await loadingTask.promise;
  assertClean();
  if (!Number.isInteger(pdf.numPages) || pdf.numPages < 1 || pdf.numPages > MAX_PAGES) throw new PdfLimitError('Page limit');
  progress('metadata');
  const { info } = await pdf.getMetadata();
  if (pdf.isPureXfa || info.IsXFAPresent || await pdf.hasJSActions() || await pdf.getJSActions()) throw new Error('Dynamic document content requires manual review');
  assertClean();
  const mainFactory = new BoundedCanvasFactory();
  let totalBytes = 0;
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    const natural = page.getViewport({ scale: 1 });
    if (!Number.isFinite(natural.width) || !Number.isFinite(natural.height) || natural.width < 20 || natural.height < 20 || natural.width > MAX_PAGE_POINTS || natural.height > MAX_PAGE_POINTS || Math.max(natural.width / natural.height, natural.height / natural.width) > 25) throw new Error('Page geometry limit');
    const scale = Math.min(100 / 72, 2200 / Math.max(natural.width, natural.height), Math.sqrt(MAX_PAGE_PIXELS / (natural.width * natural.height)));
    const viewport = page.getViewport({ scale });
    const width = Math.ceil(viewport.width), height = Math.ceil(viewport.height);
    if (width * height > MAX_PAGE_PIXELS + width + height) throw new Error('Page pixel limit');
    // Parse every page's complete operator list before accepting its rendering.
    // No operation is interpreted or filtered by application code.
    progress('operators');
    const operators = await page.getOperatorList({ intent: 'display', annotationMode: AnnotationMode.ENABLE });
    if (!operators.lastChunk || !operators.fnArray.length || operators.fnArray.length > MAX_OPERATIONS) throw new Error('Incomplete or overly complex page');
    assertClean();
    const target = mainFactory.create(width, height);
    try {
      progress('render');
      const task = page.render({ canvas: target.canvas, viewport, intent: 'display', annotationMode: AnnotationMode.ENABLE, background: 'rgb(255,255,255)' });
      await task.promise;
      if (task.separateAnnots) throw new Error('Annotations were not included on the page');
      assertClean();
      progress('pixels');
      const rgba = target.context.getImageData(0, 0, width, height).data;
      let visible = 0, min = 255, max = 0;
      for (let pixel = 0; pixel < rgba.length; pixel += 4) {
        const intensity = (rgba[pixel] + rgba[pixel + 1] + rgba[pixel + 2]) / 3;
        min = Math.min(min, intensity); max = Math.max(max, intensity);
        if (rgba[pixel + 3] > 0 && intensity < 248) visible++;
      }
      // Blank/uniform/near-empty recovered pages are not successful extraction
      // inputs, even if the original intentionally contained a blank page.
      if (visible < 16 || max - min < 4) throw new Error('Blank or unverifiable rendered page');
      progress('encode');
      const image = target.canvas.toBuffer('image/jpeg', 80);
      if (image.length < 5 || image.length > MAX_PAGE_BYTES || totalBytes + image.length > MAX_INPUT_BYTES) throw new Error('Output limit');
      totalBytes += image.length;
      progress('write-page');
      await writeFile(path.join(output, `page-${number}.jpg`), image, { flag: 'r+' });
    } finally { mainFactory.destroy(target); }
    progress('page-cleanup');
    if (!page.cleanup()) throw new Error('Page cleanup incomplete');
    assertClean();
  }
  const pages = pdf.numPages;
  progress('document-cleanup');
  await loadingTask.destroy(); loadingTask = undefined;
  assertClean();
  // This final completion record exists only after ALL pages and all cleanup
  // succeeded without any parser/rendering diagnostic. Parent requires it.
  progress('manifest');
  await writeFile(path.join(output, 'complete.json'), JSON.stringify({ version: 1, pages }), { flag: 'r+' });
} catch (error) {
  const code = error?.code;
  const reason = diagnostic ? 'pdf-diagnostic'
    : code === 'ERR_ACCESS_DENIED' || code === 'EACCES' || code === 'EPERM' ? 'permission'
    : code === 'ERR_DLOPEN_FAILED' || code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND' ? 'module-load'
    : code === 'ENOMEM' ? 'memory'
    : error instanceof PdfLimitError ? 'page-limit'
    : error instanceof TypeError ? 'type'
    : error instanceof RangeError ? 'range' : 'runtime';
  writeSync(1, `BIVARO_AI_RENDER_REASON ${reason}\n`);
  try { await loadingTask?.destroy(); } catch { /* Parent still kills/reaps the entire process group. */ }
  process.exitCode = error instanceof PdfLimitError ? 65 : 1;
}
