/** Build trusted synthetic fixtures and compile the EXACT production parent
 * launcher for image-only native checks. No untrusted PDF or syscall probe runs.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

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
