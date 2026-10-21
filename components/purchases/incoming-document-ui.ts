import { MAX_INVOICE_UPLOAD_BYTES, MAX_XML_INPUT_BYTES, MAX_RECEIPT_UPLOAD_BYTES } from '@/lib/resource-limits';
import type { IncomingDocument } from '@/lib/purchase-documents/types';

export const INCOMING_PAGE_SIZE = 25;
export type IncomingFilter = 'REVIEW' | 'BOOKED' | 'DISMISSED' | 'ALL';
export type ReviewAction = 'dismiss' | 'reopen' | 'retry-parse';
/** Defense in depth: an already-open action must not discard or race draft work. */
export function isReviewMutationBlocked(state: { busy: boolean; draftDirty: boolean; draftBusy: boolean; hasPending: boolean }): boolean {
  return state.busy || state.draftDirty || state.draftBusy || state.hasPending;
}

/** Display source decimals exactly: no Number conversion, FX conversion or rounding. */
export function formatSourceAmount(amount: string | null, currency: string | null): string {
  if (amount === null) return 'Nicht ausgelesen';
  if (!/^-?\d{1,30}(?:\.\d{1,12})?$/.test(amount)) return 'Nicht sicher darstellbar';
  const [integer, fraction = ''] = amount.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const code = currency && /^[A-Z]{3}$/.test(currency) ? currency : 'Währung unbekannt';
  return `${grouped},${fraction.padEnd(2, '0')} ${code}`;
}
export function formatSourceDate(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return 'Nicht ausgelesen';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value.slice(0, 10) ? 'Nicht ausgelesen' : new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC' }).format(date);
}
export function formatFileSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}
export function documentIdFromQuery(value: string | null): number | null {
  return value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
}
export function documentHref(id: number): string { return `/purchases?document=${id}`; }
export function reviewLabel(document: Pick<IncomingDocument, 'reviewState' | 'linkedExpenseId'>): string {
  if (document.reviewState === 'DISMISSED') return 'Verworfen · nicht gebucht';
  if (document.reviewState === 'BOOKED') return document.linkedExpenseId !== null ? 'Als Ausgabe erfasst' : 'Verknüpfung prüfen';
  return 'Zu prüfen · nicht gebucht';
}
export function extractionLabel(status: IncomingDocument['parseStatus']): string {
  return status === 'PARSED' ? 'Daten ausgelesen' : status === 'PENDING' ? 'Auslesen ausstehend' : 'Nicht ausgelesen';
}
export function validateIncomingFile(file: Pick<File, 'name' | 'size'>): string | null {
  const extension = file.name.toLowerCase().match(/\.(pdf|xml|jpg|jpeg|png)$/)?.[1];
  if (!extension) return 'Bitte ein JPG-, PNG-, PDF- oder XML-Original auswählen. ZIP und HEIC werden nicht unterstützt.';
  if (file.size === 0) return 'Die Datei ist leer. Bitte ein anderes Original auswählen.';
  if (file.size > (extension === 'xml' ? MAX_XML_INPUT_BYTES : extension === 'pdf' ? MAX_INVOICE_UPLOAD_BYTES : MAX_RECEIPT_UPLOAD_BYTES)) return extension === 'xml' ? 'XML-Dateien dürfen höchstens 8 MB groß sein.' : extension === 'pdf' ? 'PDF-Dateien dürfen höchstens 25 MB groß sein.' : 'Fotos dürfen höchstens 10 MB groß sein.';
  return null;
}

export class IncomingRequestError extends Error {
  constructor(message: string, readonly status = 0, readonly existingDocumentId: number | null = null) { super(message); }
}
/** Do not show arbitrary response bodies, paths or parser exception details. */
export function incomingResponseError(status: number, body: unknown): IncomingRequestError {
  const data = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const duplicate = status === 409 && data.code === 'EXACT_FILE_DUPLICATE' && typeof data.existingDocumentId === 'number'
    ? documentIdFromQuery(String(data.existingDocumentId)) : null;
  if (duplicate) return new IncomingRequestError('Dieses Original ist bereits im Belegeingang. Es wurde kein zweiter Beleg angelegt.', status, duplicate);
  const codes: Record<string, string> = {
    INVALID_IMAGE: 'Foto ist beschädigt oder zu groß: höchstens 10 MB, 24 Megapixel und 12.000 Pixel je Kante. Einseitiges JPG/PNG wählen.',
    ORIGINAL_INTEGRITY: 'Das Original fehlt oder seine Integrität ist nicht bestätigt. Bitte nicht auf Grundlage dieser Vorschau weiterarbeiten.',
    REVISION_CONFLICT: 'Der Beleg wurde inzwischen geändert. Bitte neu laden, bevor du fortfährst.',
    STATE_CONFLICT: 'Der Belegstatus hat sich geändert. Bitte neu laden.',
    SUPPLIER_REQUIRED: 'Bitte einen Lieferantenkontakt ausdrücklich auswählen, danach die Buchung erneut prüfen.',
    SUPPLIER_REFERENCED: 'Dieser Kontakt ist bereits einem Beleg zugeordnet und kann nicht gelöscht werden.',
    UNSUPPORTED_APPROVAL: 'Dieses Original wird für die Ausgabenerfassung nicht unterstützt. Prüfhinweise kontrollieren; keine Teilzahlung, Gutschrift oder Währungsumrechnung buchen.',
    AMOUNT_MISMATCH: 'Der Betrag stimmt nicht mit dem Original-Bruttobetrag überein. Bitte den Beleg neu laden und das Original prüfen.',
    DUPLICATE_REVIEW_REQUIRED: 'Die ähnlichen Belege haben sich geändert. Bitte den Beleg neu laden und die aktuellen Dubletten einzeln prüfen.',
    APPROVAL_CONFLICT: 'Dieser Beleg wurde bereits erfasst oder die Anfrage wurde geändert. Bitte den gespeicherten Belegstatus prüfen; keine neue Ausgabe anlegen.',
    CONFIRMATION_REQUIRED: 'Original, betriebliche Zugehörigkeit des Käufers und tatsächliche Zahlung samt Datum müssen ausdrücklich bestätigt werden.',
    SOURCE_STATE: 'Die Originalverknüpfung ist nicht eindeutig. Bitte nicht erneut buchen; Zuordnung prüfen lassen.',
    CONCURRENT_CONFLICT: 'Der Datensatz wurde gleichzeitig geändert. Bitte neu laden und den gespeicherten Status prüfen.',
    SOURCE_LINKED: 'Dieser Beleg ist bereits mit einer Ausgabe verknüpft und kann hier nicht geändert werden.',
    UPLOAD_REQUEST_CONFLICT: 'Die Upload-Anfrage gehört zu einem anderen Original. Bitte die Datei erneut auswählen.',
    UNSUPPORTED_FILE: 'Dieses Dateiformat wird nicht unterstützt. Bitte JPG, PNG, PDF oder UTF-8-XML auswählen.',
    PROCESSING_BUSY: 'Die Verarbeitung ist gerade ausgelastet. Bitte gleich noch einmal versuchen.',
    FILE_SIZE: 'Die Datei ist leer oder zu groß. Foto: bis 10 MB, PDF: bis 25 MB, XML: bis 8 MB.',
  };
  const message = typeof data.code === 'string' ? codes[data.code] : undefined;
  return new IncomingRequestError(message ?? (status === 401 ? 'Deine Sitzung ist abgelaufen. Bitte erneut anmelden und danach wiederholen.' : status === 403 ? 'Die Anfrage wurde nicht freigegeben. Bitte die Seite neu laden und erneut versuchen.' : status === 404 ? 'Dieser Beleg wurde nicht gefunden oder ist nicht zugänglich.' : status === 413 ? 'Die Datei ist zu groß. Foto: bis 10 MB, PDF: bis 25 MB, XML: bis 8 MB.' : status === 429 ? 'Zu viele Anfragen. Bitte kurz warten und erneut versuchen.' : 'Die Anfrage konnte nicht abgeschlossen werden. Bitte erneut versuchen.'), status);
}
export async function incomingJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: 'no-store', credentials: 'same-origin' });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw incomingResponseError(response.status, body);
  if (!body || typeof body !== 'object') throw new IncomingRequestError('Die Antwort konnte nicht gelesen werden. Bitte neu laden.');
  return body as T;
}
export function errorMessage(error: unknown): string {
  return error instanceof IncomingRequestError ? error.message : 'Die Verbindung ist unterbrochen. Bitte erneut versuchen.';
}
