import { describe, expect, it } from 'vitest';
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, StandardFonts } from 'pdf-lib';
import { generateServiceStatementPdf } from '@/lib/service-statement-pdf';
import { STATEMENT_NOTICE, type ServiceStatementSnapshot } from '@/lib/service-statement';

const snapshot = (): ServiceStatementSnapshot => ({
  version: 1,
  generatedAt: '2026-10-22T10:00:00.000Z',
  customer: { id: 1, name: 'Synthetischer Kunde' },
  filters: { from: '2026-10-01', to: '2026-10-31', project: 'all', projectName: null, projectArchived: false, status: 'all' },
  rows: [{ id: 1, serviceDate: '2026-10-20', description: `Begrenzte Auswahl ${'Text '.repeat(80)}`, quantity: 1.5, unit: 'Stunde', durationMinutes: null, projectName: null, projectArchived: false, status: 'open' }],
  totals: { durationMinutes: 0, quantityOnlyCount: 1 },
});

async function readDrawnLines(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const lines: { page: number; text: string; x: number; advance: number }[] = [];
  for (const [pageIndex, page] of pdf.getPages().entries()) {
    const fonts = page.node.Resources()!.lookup(PDFName.of('Font'), PDFDict);
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray() : [contents!];
    for (const reference of streams) {
      const stream = pdf.context.lookup(reference);
      if (!(stream instanceof PDFRawStream)) throw new Error('Expected a saved PDF content stream.');
      const operators = Buffer.from(decodePDFRawStream(stream).decode()).toString('ascii');
      // Inspect actual emitted Tj text and its font/size/position, not the
      // generator's kerning-aware whole-string width estimate.
      for (const block of operators.matchAll(/BT\s([\s\S]*?)\sET/g)) {
        const fontOperator = /\/([^\s]+) ([\d.]+) Tf/.exec(block[1])!;
        const position = /1 0 0 1 ([\d.]+) [\d.]+ Tm/.exec(block[1])!;
        const textOperator = /<([0-9A-F]+)> Tj/.exec(block[1])!;
        const baseFont = fonts.lookup(PDFName.of(fontOperator[1]), PDFDict).lookup(PDFName.of('BaseFont'), PDFName).decodeText();
        const font = baseFont === StandardFonts.HelveticaBold ? bold : regular;
        const text = new TextDecoder('windows-1252').decode(Buffer.from(textOperator[1], 'hex'));
        const size = Number(fontOperator[2]);
        // Plain Tj has no pair-kerning adjustments: its advance is the sum of
        // individual glyph widths, even when whole-string measurement is less.
        const advance = [...text].reduce((sum, char) => sum + font.widthOfTextAtSize(char, size), 0);
        lines.push({ page: pageIndex + 1, text, x: Number(position[1]), advance });
      }
    }
  }
  return { pdf, lines };
}

function expectBoundedLines(lines: Awaited<ReturnType<typeof readDrawnLines>>['lines']) {
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    expect(line.x, `page ${line.page}: ${line.text}`).toBe(44);
    expect(line.advance, `page ${line.page}: ${line.text}`).toBeLessThanOrEqual(505 + 1e-8);
  }
}

describe('service statement PDF actual drawing advance', () => {
  it('keeps kerning-heavy repeated Text descriptions inside the right margin without removing content', async () => {
    const input = snapshot();
    const original = structuredClone(input);
    const { lines } = await readDrawnLines(await generateServiceStatementPdf(input));
    expectBoundedLines(lines);
    expect(lines.map(line => line.text).join('')).toContain(input.rows[0].description);
    expect(input).toEqual(original);
  });

  it('bounds regular/bold long names, preserves paragraphs and keeps exact duration and missing-time wording', async () => {
    const input = snapshot();
    input.customer.name = 'SYNTHETISCH ÄÖÜ ' + 'AVATAR Text '.repeat(14);
    input.rows[0].projectName = 'AVATARText'.repeat(10);
    input.rows[0].projectArchived = true;
    input.rows[0].description = `${'Text '.repeat(50)}\n${'AVATAR '.repeat(30)}`;
    input.rows.push({ ...input.rows[0], id: 2, description: 'Konzept mit ÄÖÜ', durationMinutes: 90, quantity: 1.5, status: 'linked' });
    input.totals.durationMinutes = 90;
    const { lines } = await readDrawnLines(await generateServiceStatementPdf(input));
    expectBoundedLines(lines);
    const text = lines.map(line => line.text).join('');
    expect(text).toContain(input.customer.name);
    expect(text).toContain(input.rows[0].projectName);
    expect(text).toContain(input.rows[0].description.replace('\n', ''));
    expect(text).toContain('Bekannte Dauer: 01:30 HH:MM (90 Minuten)');
    expect(text).toContain('Ohne Zeitangabe: 1 Leistung (nicht als 0 Stunden gezählt)');
    expect(text).toContain('Dauer: nicht erfasst  /  Menge: 1,5 Stunde');
    expect(text).toContain('Dauer: 01:30 HH:MM (90 Minuten)  /  Menge: 1,5 Stunde');
  });

  it('bounds all emitted lines across a full 100-row selection and preserves every approved description and footer', async () => {
    const input = snapshot();
    input.rows = Array.from({ length: 100 }, (_, index) => ({ ...input.rows[0], id: index + 1, description: `Begrenzte Auswahl ${index} ${'Text '.repeat(80)}` }));
    input.totals.quantityOnlyCount = 100;
    const { pdf, lines } = await readDrawnLines(await generateServiceStatementPdf(input));
    expect(pdf.getPageCount()).toBeGreaterThan(2);
    expectBoundedLines(lines);
    const text = lines.map(line => line.text).join('');
    for (const row of input.rows) expect(text).toContain(row.description);
    for (let page = 1; page <= pdf.getPageCount(); page++) {
      expect(lines.filter(line => line.page === page).map(line => line.text)).toContain(`${STATEMENT_NOTICE}  |  ${page} / ${pdf.getPageCount()}`);
    }
    expect(text).toContain('Bekannte Dauer: 00:00 HH:MM (0 Minuten)');
    expect(text).toContain('Ohne Zeitangabe: 100 Leistungen (nicht als 0 Stunden gezählt)');
  });
});
