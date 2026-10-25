import { describe, expect, it } from 'vitest';
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, StandardFonts } from 'pdf-lib';
import { generateReminderPdf, REMINDER_PDF_NOTICE } from '@/lib/reminder-pdf';
import type { previewReminder } from '@/lib/reminder-workbench';

const snapshot = (): Awaited<ReturnType<typeof previewReminder>> => ({
  version: 1, invoiceId: 47, invoiceNumber: 'SYNTHETIC-47', balanceVersion: 'a'.repeat(64),
  totalCents: '12000', paidCents: '4000', openCents: '8000', feeCents: '0', reminderLevel: 1,
  dueDate: '2026-11-08T15:00:00.000Z', previewAsOf: '2026-10-25T15:00:00.000Z', documentVersion: 'b'.repeat(64),
  recipient: 'synthetic@example.invalid', subject: 'Zahlungserinnerung zu Rechnung SYNTHETIC-47',
  text: 'Sehr geehrte Damen und Herren,\n\nRechnungsbetrag: 120,00 €\nBereits eingegangen: 40,00 €\nOffener Restbetrag: 80,00 €\nZahlbetrag: 80,00 €\n\nDie ursprüngliche Rechnung bleibt unverändert.',
  paymentHistory: [{ amountCents: '4000', paidAt: '2026-10-01T00:00:00.000Z', reference: 'Synthetischer Zahlungsnachweis' }],
  automaticDelivery: false, partialEmailDeliveryAvailable: false,
});

async function drawnLines(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes);
  const regular = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const lines: { page: number; text: string; x: number; y: number; width: number }[] = [];
  for (const [pageIndex, page] of pdf.getPages().entries()) {
    const fonts = page.node.Resources()!.lookup(PDFName.of('Font'), PDFDict);
    const contents = page.node.Contents();
    for (const reference of contents instanceof PDFArray ? contents.asArray() : [contents!]) {
      const stream = pdf.context.lookup(reference);
      if (!(stream instanceof PDFRawStream)) throw new Error('Expected a PDF content stream');
      const operators = Buffer.from(decodePDFRawStream(stream).decode()).toString('ascii');
      for (const block of operators.matchAll(/BT\s([\s\S]*?)\sET/g)) {
        const fontOp = /\/([^\s]+) ([\d.]+) Tf/.exec(block[1])!;
        const position = /1 0 0 1 ([\d.]+) ([\d.]+) Tm/.exec(block[1])!;
        const textOp = /<([0-9A-F]+)> Tj/.exec(block[1])!;
        const base = fonts.lookup(PDFName.of(fontOp[1]), PDFDict).lookup(PDFName.of('BaseFont'), PDFName).decodeText();
        const font = base === StandardFonts.HelveticaBold ? bold : regular;
        const text = new TextDecoder('windows-1252').decode(Buffer.from(textOp[1], 'hex'));
        const width = [...text].reduce((sum, char) => sum + font.widthOfTextAtSize(char, Number(fontOp[2])), 0);
        lines.push({ page: pageIndex + 1, text, x: Number(position[1]), y: Number(position[2]), width });
      }
    }
  }
  return { pdf, lines };
}

describe('download-only reminder PDF snapshot rendering (authored acceptance)', () => {
  it('renders the reviewed 120/40/80 amounts, exact revision and date without changing its input or claiming an invoice', async () => {
    const input = snapshot(), before = structuredClone(input);
    const { pdf, lines } = await drawnLines(await generateReminderPdf(input));
    const text = lines.map(line => line.text).join('\n');
    for (const value of ['Rechnungsbetrag: 120,00 €', 'Bereits eingegangen: 40,00 €', 'Offener Restbetrag: 80,00 €', 'Zahlbetrag: 80,00 €', input.previewAsOf, input.documentVersion, REMINDER_PDF_NOTICE]) expect(text).toContain(value);
    expect(pdf.getSubject()).toBe(REMINDER_PDF_NOTICE);
    expect(pdf.getCreationDate()?.toISOString()).toBe(input.previewAsOf);
    expect(text).toContain('keine neue Rechnung');
    expect(input).toEqual(before);
  });

  it('wraps long regular/bold identifiers, notes and history across pages without losing reviewed text or crossing the margins', async () => {
    const input = snapshot();
    input.subject = `Zahlungserinnerung ${'AVATARText'.repeat(50)}`;
    input.text += `\n${'Text AVATAR '.repeat(400)}\nEnde des freigegebenen Hinweises.`;
    input.paymentHistory = Array.from({ length: 50 }, (_, index) => ({ ...input.paymentHistory[0], reference: `Nachweis-${index}-${'AVATARText'.repeat(30)}` }));
    const { pdf, lines } = await drawnLines(await generateReminderPdf(input));
    expect(pdf.getPageCount()).toBeGreaterThan(2);
    const text = lines.map(line => line.text).join('');
    expect(text).toContain(input.subject);
    for (const paragraph of input.text.split('\n').filter(Boolean)) expect(text).toContain(paragraph);
    for (const payment of input.paymentHistory) expect(text).toContain(payment.reference);
    for (const line of lines) {
      expect(line.x).toBe(44); expect(line.width).toBeLessThanOrEqual(505 + 1e-8);
      expect(line.y).toBeGreaterThanOrEqual(34); expect(line.y).toBeLessThanOrEqual(790);
    }
    for (let page = 1; page <= pdf.getPageCount(); page++) expect(lines.filter(line => line.page === page).map(line => line.text)).toContain(`Mahnungsentwurf | Kein Versandnachweis | ${page} / ${pdf.getPageCount()}`);
  });

  it('rejects unsupported glyphs instead of silently replacing them, leaving TXT as the explicit fallback', async () => {
    const input = snapshot(); input.text += '\nUnveränderter Hinweis 🧾';
    await expect(generateReminderPdf(input)).rejects.toMatchObject({ status: 422, code: 'REMINDER_PDF_CHARSET' });
  });

  it('rejects excessive text/history before producing an incomplete PDF', async () => {
    const input = snapshot(); input.text = 'x'.repeat(100_001);
    await expect(generateReminderPdf(input)).rejects.toMatchObject({ status: 422, code: 'REMINDER_PDF_LIMIT' });
    input.text = 'Restbetrag 80 EUR'; input.paymentHistory = Array.from({ length: 1001 }, () => ({ amountCents: '1', paidAt: input.previewAsOf, reference: 'synthetic' }));
    await expect(generateReminderPdf(input)).rejects.toMatchObject({ status: 422, code: 'REMINDER_PDF_LIMIT' });
  });
});
