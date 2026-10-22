import { BillingNoteInputError, parsePositiveId } from '@/lib/billing-notes';
import { BusinessDateError, parseBusinessDate } from '@/lib/business-date';

export const MAX_STATEMENT_NOTES = 100;
export const MAX_STATEMENT_REQUEST_BYTES = 256 * 1024;
export const STATEMENT_NOTICE = 'Keine Rechnung / keine Abnahmebestätigung';

export type StatementFilters = { project: string; from: string; to: string; status: 'all' | 'open' | 'linked' };
export type StatementRow = {
  id: number;
  serviceDate: string;
  description: string;
  quantity: number;
  unit: string;
  durationMinutes: number | null;
  projectName: string | null;
  projectArchived: boolean;
  status: 'open' | 'linked';
};
export type ServiceStatementSnapshot = {
  version: 1;
  generatedAt: string;
  customer: { id: number; name: string };
  filters: StatementFilters & { projectName: string | null; projectArchived: boolean };
  rows: StatementRow[];
  totals: { durationMinutes: number; quantityOnlyCount: number };
};
export type ServiceStatementResult = { snapshot: ServiceStatementSnapshot; pdfBase64: string; filename: string };

export function parseStatementRequest(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BillingNoteInputError('Ungültige Auswahl.');
  const input = value as Record<string, unknown>;
  if (input.descriptionsApproved !== true) throw new BillingNoteInputError('Beschreibungen vor der Ausgabe ausdrücklich freigeben.');
  const customerId = parsePositiveId(input.customerId, 'Kunden-ID');
  if (!Array.isArray(input.notes) || input.notes.length < 1 || input.notes.length > MAX_STATEMENT_NOTES) {
    throw new BillingNoteInputError(`Bitte 1 bis ${MAX_STATEMENT_NOTES} Leistungen auswählen.`);
  }
  const descriptions = new Map<number, string>();
  const noteIds = input.notes.map((note: unknown) => {
    if (!note || typeof note !== 'object' || Array.isArray(note)) throw new BillingNoteInputError('Ungültige Leistungsauswahl.');
    const row = note as Record<string, unknown>;
    const id = parsePositiveId(row.id, 'Leistungsnotiz-ID');
    if (typeof row.description !== 'string' || !row.description.trim() || row.description.length > 500) throw new BillingNoteInputError('Ungültige freigegebene Beschreibung.');
    descriptions.set(id, row.description);
    return id;
  });
  if (new Set(noteIds).size !== noteIds.length) throw new BillingNoteInputError('Leistungen nicht doppelt auswählen.');
  let from: Date;
  let to: Date;
  try { from = parseBusinessDate(input.from); to = parseBusinessDate(input.to); }
  catch (error) {
    if (error instanceof BusinessDateError) throw new BillingNoteInputError('Bitte einen gültigen Zeitraum mit Beginn und Ende wählen.');
    throw error;
  }
  if (from > to) throw new BillingNoteInputError('Beginn darf nicht nach Ende liegen.');
  const project = input.project === 'all' || input.project === 'none' ? input.project : String(parsePositiveId(input.project, 'Projekt-ID'));
  if (!['all', 'open', 'linked'].includes(input.status as string)) throw new BillingNoteInputError('Ungültiger Leistungsstatus.');
  return { customerId, noteIds, descriptions, from, to, project, status: input.status as StatementFilters['status'] };
}
