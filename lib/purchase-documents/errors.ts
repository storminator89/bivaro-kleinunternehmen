export class PurchaseDocumentError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = 'INVALID_INPUT',
    readonly existingDocumentId?: number,
  ) { super(message); this.name = 'PurchaseDocumentError'; }
}
