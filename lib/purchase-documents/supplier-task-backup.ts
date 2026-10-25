import { parseSupplierTask } from './supplier-task';

const FIELDS = ['supplierTaskKind', 'supplierTaskFollowUpDate', 'supplierTaskConfirmationRequired'] as const;
/** No timestamp inference: old capabilities cannot acquire even null future fields. */
export function validateSupplierTaskBackupFields(document: Record<string, unknown>, label: string, supported: boolean): void {
  if (!supported) {
    if (FIELDS.some(field => Object.hasOwn(document, field))) throw new Error(`${label}: Älteres Backupschema unterstützt keine Lieferanten-Vormerkung.`);
    return;
  }
  if (!FIELDS.every(field => Object.hasOwn(document, field))) throw new Error(`${label}: Lieferanten-Vormerkung benötigt alle drei expliziten Felder.`);
  const kind = document.supplierTaskKind, followUpDate = document.supplierTaskFollowUpDate, confirmationRequired = document.supplierTaskConfirmationRequired;
  if (typeof confirmationRequired !== 'boolean') throw new Error(`${label}: Ungültige Aufgabenbestätigung.`);
  if (kind === null) {
    if (followUpDate !== null || confirmationRequired !== false) throw new Error(`${label}: Vormerkung ohne Aufgabenart ist inkonsistent.`);
    return;
  }
  try { parseSupplierTask({ kind, followUpDate }); }
  catch { throw new Error(`${label}: Lieferanten-Vormerkung enthält keine gültige Aufgabenart oder keinen echten Kalendertag.`); }
}
