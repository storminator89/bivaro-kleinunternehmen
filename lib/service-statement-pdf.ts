import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import { BillingNoteInputError } from '@/lib/billing-notes';
import { formatBusinessDateDisplay } from '@/lib/business-date';
import { formatManualDuration } from '@/lib/service-duration';
import { STATEMENT_NOTICE, type ServiceStatementSnapshot } from '@/lib/service-statement';

/** No writes, prices, signatures, approvals, invoice numbers or payment effects. */
export async function generateServiceStatementPdf(snapshot: ServiceStatementSnapshot): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Leistungsaufstellung');
  pdf.setSubject(STATEMENT_NOTICE);
  pdf.setCreationDate(new Date(snapshot.generatedAt));
  pdf.setModificationDate(new Date(snapshot.generatedAt));
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const supported = new Set(regular.getCharacterSet());
  const ink = rgb(.13, .17, .19);
  const muted = rgb(.4, .45, .47);
  const accent = rgb(.13, .36, .33);
  let page = pdf.addPage([595.28, 841.89]);
  let y = 790;
  const text = (value: string) => {
    // Reject rather than silently changing an explicitly approved description.
    if ([...value].some(char => char !== '\n' && !supported.has(char.codePointAt(0)!))) {
      throw new BillingNoteInputError('Ein Zeichen der Auswahl wird vom PDF-Zeichensatz nicht unterstützt. Bitte die Auswahl prüfen.', 422);
    }
    return value;
  };
  const line = (value: string, size = 10, font: PDFFont = regular, color = ink) => {
    if (y < 65) { page = pdf.addPage([595.28, 841.89]); y = 790; }
    page.drawText(text(value), { x: 44, y, size, font, color }); y -= size + 6;
  };
  const wrap = (value: string, size = 10, font: PDFFont = regular, width = 505) => {
    for (const paragraph of text(value).split('\n')) {
      let current = '';
      // Character wrapping also bounds unbroken customer/project names.
      for (const char of paragraph) {
        if (current && font.widthOfTextAtSize(current + char, size) > width) {
          line(current, size, font); current = '';
        }
        current += char;
      }
      line(current || ' ', size, font);
    }
  };
  line('LEISTUNGSAUFSTELLUNG', 19, bold, accent);
  line(STATEMENT_NOTICE, 10, bold, muted);
  y -= 12;
  wrap(snapshot.customer.name, 13, bold);
  line(`Zeitraum: ${formatBusinessDateDisplay(snapshot.filters.from)} - ${formatBusinessDateDisplay(snapshot.filters.to)}`);
  wrap(`Projekt: ${snapshot.filters.project === 'all' ? 'Alle Projekte' : snapshot.filters.project === 'none' ? 'Ohne Projekt' : `${snapshot.filters.projectName}${snapshot.filters.projectArchived ? ' (archiviert)' : ''}`}`);
  line(`Statusfilter: ${snapshot.filters.status === 'all' ? 'Alle Leistungen' : snapshot.filters.status === 'open' ? 'Offen' : 'Rechnung zugeordnet'}`);
  line(`Datenstand (UTC): ${snapshot.generatedAt}`, 9, regular, muted);
  line(`${snapshot.rows.length} ausdrücklich ausgewählte Leistungen`, 9, regular, muted);
  y -= 14;
  const groups = [
    { label: `Bekannte Dauer: ${formatManualDuration(snapshot.totals.durationMinutes)} HH:MM (${snapshot.totals.durationMinutes} Minuten)`, rows: snapshot.rows.filter(row => row.durationMinutes !== null) },
    { label: `Ohne Zeitangabe: ${snapshot.totals.quantityOnlyCount} ${snapshot.totals.quantityOnlyCount === 1 ? 'Leistung' : 'Leistungen'} (nicht als 0 Stunden gezählt)`, rows: snapshot.rows.filter(row => row.durationMinutes === null) },
  ];
  for (const group of groups) {
    if (y < 150) { page = pdf.addPage([595.28, 841.89]); y = 790; }
    wrap(group.label, 11, bold);
    y -= 5;
    if (!group.rows.length) line('Keine Leistungen in dieser Gruppe.', 9, regular, muted);
    for (const row of group.rows) {
      if (y < 135) { page = pdf.addPage([595.28, 841.89]); y = 790; }
      line(`${formatBusinessDateDisplay(row.serviceDate)}  /  ${row.status === 'open' ? 'Offen' : 'Rechnung zugeordnet'}`, 9, bold);
      wrap(row.description);
      wrap(`Projekt: ${row.projectName ? `${row.projectName}${row.projectArchived ? ' (archiviert)' : ''}` : 'Ohne Projekt'}`, 9);
      wrap(`Dauer: ${row.durationMinutes === null ? 'nicht erfasst' : `${formatManualDuration(row.durationMinutes)} HH:MM (${row.durationMinutes} Minuten)`}  /  Menge: ${String(row.quantity).replace('.', ',')} ${row.unit}`, 9);
      y -= 12;
    }
    y -= 12;
  }
  pdf.getPages().forEach((sheet, index, pages) => {
    sheet.drawLine({ start: { x: 44, y: 42 }, end: { x: 550, y: 42 }, thickness: .5, color: muted });
    sheet.drawText(`${STATEMENT_NOTICE}  |  ${index + 1} / ${pages.length}`, { x: 44, y: 26, size: 8, font: regular, color: muted });
  });
  return pdf.save();
}
