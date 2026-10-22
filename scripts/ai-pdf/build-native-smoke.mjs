/** Build trusted synthetic fixtures and compile the EXACT production parent
 * launcher for image-only native checks. No untrusted PDF or syscall probe runs.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { PDFDocument, StandardFonts, PDFName, PDFDict, PDFBool, rgb } from 'pdf-lib';
import { createRequire } from 'node:module';
import { preparePdfWorker } from './prepare-worker.mjs';

await preparePdfWorker();

const output = path.join(process.cwd(), 'scripts', 'ai-pdf', 'smoke-runtime');
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'package.json'), JSON.stringify({ type: 'commonjs' }));
for (const name of ['errors', 'ai-input']) {
  const filename = path.join(process.cwd(), 'lib', 'purchase-documents', `${name}.ts`);
  const result = ts.transpileModule(await readFile(filename, 'utf8'), {
    fileName: filename, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  });
  if (result.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error)) throw new Error('Could not compile native smoke launcher');
  await writeFile(path.join(output, `${name}.js`), result.outputText);
}
for (const [name, pages, blank, geometry] of [
  ['one', 1, false, false], ['two', 2, false, false], ['four', 4, false, false], ['raster', 1, false, false],
  ['five', 5, false, false], ['blank', 1, true, false], ['geometry', 1, false, true],
]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const image = name === 'raster' ? await pdf.embedPng(await readFile(path.join(process.cwd(), 'public', 'Bivaro_Logo.png'))) : undefined;
  for (let number = 1; number <= pages; number++) {
    const page = pdf.addPage(geometry ? [3000, 3000] : [595, 842]);
    if (!blank) {
      page.drawText(`SYNTHETIC RECEIPT PAGE ${number} OF ${pages}`, { x: 42, y: 760, size: 20, font });
      page.drawText(`Invoice TEST-${number}; amount EUR 123.45`, { x: 42, y: 700, size: 14, font });
      if (image) page.drawImage(image, { x: 42, y: 400, width: 250, height: 120 });
      page.drawRectangle({ x: 42, y: 600 - number * 40, width: 70 + number * 20, height: 25, color: rgb(number / (pages + 1), 0.2, 0.4) });
    }
  }
  await writeFile(path.join(output, `${name}.pdf`), await pdf.save());
}

// The exact same trusted LiberationSans bytes are deliberately embedded in a
// Type1-declared font. Unlike a built-in substitution, this document-controlled
// FontFile2 must remain a fatal type mismatch, even beside an internal font.
const require = createRequire(import.meta.url);
const standardFont = await readFile(path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts', 'LiberationSans-Regular.ttf'));
for (const name of ['embedded-mismatch', 'embedded-claimed-internal', 'standard-then-embedded', 'embedded-then-standard']) {
  const pdf = await PDFDocument.create(), page = pdf.addPage([595, 842]);
  const embedded = await pdf.embedFont(StandardFonts.Helvetica);
  const standard = await pdf.embedFont(StandardFonts.Helvetica);
  const fonts = name === 'standard-then-embedded' ? [standard, embedded] : name === 'embedded-then-standard' ? [embedded, standard] : [embedded];
  for (const [index, font] of fonts.entries()) page.drawText('SYNTHETIC FONT PROVENANCE', { x: 42, y: 760 - index * 60, size: 16, font });
  await embedded.embed();
  const dict = pdf.context.lookup(embedded.ref, PDFDict);
  const descriptor = pdf.context.obj({ Type: 'FontDescriptor', FontName: 'Helvetica', Flags: 32, FontBBox: [-600, -303, 2048, 1075], ItalicAngle: 0, Ascent: 900, Descent: -300, CapHeight: 700, StemV: 80, FontFile2: pdf.context.register(pdf.context.flateStream(standardFont)) });
  dict.set(PDFName.of('FontDescriptor'), pdf.context.register(descriptor));
  if (name === 'embedded-claimed-internal') {
    dict.set(PDFName.of('isInternalFont'), PDFBool.True);
    descriptor.set(PDFName.of('isInternalFont'), PDFBool.True);
  }
  await writeFile(path.join(output, `${name}.pdf`), await pdf.save());
}
