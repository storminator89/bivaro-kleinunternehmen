import { BillingNoteInputError, parsePositiveId } from '@/lib/billing-notes';

export const MAX_SERVICE_PROJECT_NAME_LENGTH = 120;

export function parseServiceProjectName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > MAX_SERVICE_PROJECT_NAME_LENGTH) {
    throw new BillingNoteInputError('Projektname muss 1 bis 120 Zeichen lang sein.');
  }
  return value.trim();
}

export function parseServiceProjectCreate(input: Record<string, unknown>) {
  if (Object.keys(input).some(key => !['customerId', 'name'].includes(key))) {
    throw new BillingNoteInputError('Unbekannte Projektangabe.');
  }
  return { customerId: parsePositiveId(input.customerId, 'Kunden-ID'), name: parseServiceProjectName(input.name) };
}

export function parseServiceProjectUpdate(input: Record<string, unknown>) {
  if (Object.keys(input).some(key => !['id', 'name', 'archived'].includes(key))) {
    throw new BillingNoteInputError('Projektkunde und Projektidentität können nicht geändert werden.');
  }
  const id = parsePositiveId(input.id, 'Projekt-ID');
  const name = input.name === undefined ? undefined : parseServiceProjectName(input.name);
  if (input.archived !== undefined && typeof input.archived !== 'boolean') throw new BillingNoteInputError('Ungültiger Archivstatus.');
  if (name === undefined && input.archived === undefined) throw new BillingNoteInputError('Keine Projektänderung angegeben.');
  return { id, name, archived: input.archived as boolean | undefined };
}
