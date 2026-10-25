import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import { ReminderWorkbenchError, type previewReminder } from '@/lib/reminder-workbench';

export const REMINDER_PDF_NOTICE = 'Mahnungsentwurf - keine neue Rechnung, kein Versandnachweis';
type ReminderDocumentPreview = Awaited<ReturnType<typeof previewReminder>>;

/** Read-only rendering. Never embeds/replaces an invoice or claims PDF/A conformity. */
export async function generateReminderPdf(snapshot: ReminderDocumentPreview): Promise<Uint8Array> {
  const history = snapshot.paymentHistory.map(payment =>
    `${new Date(payment.paidAt).toLocaleDateString('de-DE', { timeZone: 'UTC' })} | ${euro(payment.amountCents)} | ${payment.reference}`);
  const content = [snapshot.subject, snapshot.text, snapshot.recipient ?? '', ...history];
  if (history.length > 1000 || content.reduce((sum, value) => sum + value.length, 0) > 100_000) {
    throw new ReminderWorkbenchError('Der Entwurf ist für den PDF-Download zu umfangreich. Bitte den Textentwurf verwenden.', 422, 'REMINDER_PDF_LIMIT');
  }
  const pdf = await PDFDocument.create();
  pdf.setTitle(snapshot.subject);
  pdf.setSubject(REMINDER_PDF_NOTICE);
  pdf.setCreationDate(new Date(snapshot.previewAsOf));
  pdf.setModificationDate(new Date(snapshot.previewAsOf));
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const supported = new Set(regular.getCharacterSet());
  // No replacement glyphs: unsupported customer text remains available in TXT.
  for (const value of content) {
    if ([...value].some(char => char !== '\n' && !supported.has(char.codePointAt(0)!))) {
      throw new ReminderWorkbenchError('Ein Zeichen im Entwurf wird vom PDF-Zeichensatz nicht unterstützt. Bitte den unveränderten Textentwurf verwenden.', 422, 'REMINDER_PDF_CHARSET');
    }
  }
  const ink = rgb(.13, .17, .19), muted = rgb(.4, .45, .47), accent = rgb(.13, .36, .33);
  let page = pdf.addPage([595.28, 841.89]);
  let y = 790;
  const newPage = () => {
    if (pdf.getPageCount() >= 100) throw new ReminderWorkbenchError('Der Entwurf umfasst zu viele PDF-Seiten. Bitte den Textentwurf verwenden.', 422, 'REMINDER_PDF_LIMIT');
    page = pdf.addPage([595.28, 841.89]); y = 790;
  };
  const line = (value: string, size = 10, font: PDFFont = regular, color = ink) => {
    if (y < 75) newPage();
    page.drawText(value || ' ', { x: 44, y, size, font, color }); y -= size + 6;
  };
  const wrap = (value: string, size = 10, font: PDFFont = regular, color = ink) => {
    for (const paragraph of value.split('\n')) {
      let current = '', width = 0;
      // Sum actual unkerned Tj glyph advances; also wrap unbroken identifiers.
      for (const char of paragraph) {
        const advance = font.widthOfTextAtSize(char, size);
        if (current && width + advance > 505) { line(current, size, font, color); current = ''; width = 0; }
        current += char; width += advance;
      }
      line(current, size, font, color);
    }
  };
  line('MAHNUNGSENTWURF', 19, bold, accent);
  wrap(REMINDER_PDF_NOTICE, 9, regular, muted);
  y -= 10;
  wrap(snapshot.subject, 13, bold);
  wrap(`Datenstand (UTC): ${snapshot.previewAsOf}`, 9, regular, muted);
  wrap(`Dokumentrevision: ${snapshot.documentVersion}`, 8, regular, muted);
  if (snapshot.recipient) wrap(`Empfänger für den manuellen Versand: ${snapshot.recipient}`, 9);
  y -= 12;
  wrap(snapshot.text);
  y -= 12;
  if (y < 130) newPage();
  line('Belegte Zahlungseingänge laut geprüftem Journal', 11, bold);
  if (!history.length) line('Keine Zahlung im Journal erfasst.', 9, regular, muted);
  for (const payment of history) { wrap(payment, 9); y -= 4; }
  y -= 8;
  wrap('Momentaufnahme: Spätere Zahlungen sind hier nicht enthalten. Vor dem manuellen Versand erneut prüfen. Der Download erfasst keine Mahnung und sendet keine Nachricht.', 9, regular, muted);
  pdf.getPages().forEach((sheet, index, pages) => {
    sheet.drawLine({ start: { x: 44, y: 50 }, end: { x: 550, y: 50 }, thickness: .5, color: muted });
    sheet.drawText(`Mahnungsentwurf | Kein Versandnachweis | ${index + 1} / ${pages.length}`, { x: 44, y: 34, size: 8, font: regular, color: muted });
  });
  return pdf.save();
}

function euro(value: string) {
  const cents = BigInt(value);
  return `${cents / BigInt(100)},${(cents % BigInt(100)).toString().padStart(2, '0')} EUR`;
}
