import { PDF_A_VERAPDF_VERSION, validatePdfA3 } from './pdfa-validator';

export const OWN_INVOICE_VERAPDF_VERSION = PDF_A_VERAPDF_VERSION;
export class OwnInvoicePdfAValidationError extends Error {
  readonly status = 500;
  constructor() {
    super('Die abschließende PDF/A-3b-Prüfung ist fehlgeschlagen. Es wurde keine Rechnungsdatei erstellt.');
    this.name = 'OwnInvoicePdfAValidationError';
  }
}
/** Preserve the established own-invoice failure contract; no caller sees reports. */
export async function validateOwnInvoicePdfA3(bytes: Uint8Array): Promise<void> {
  try { await validatePdfA3(bytes); }
  catch { throw new OwnInvoicePdfAValidationError(); }
}
