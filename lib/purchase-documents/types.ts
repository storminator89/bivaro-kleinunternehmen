import type { SupplierDto } from '@/lib/suppliers';
import type { ParsedEInvoiceParty } from '@/lib/e-invoice-parser';

export const PURCHASE_PARSE_STATUSES = ['PENDING', 'PARSED', 'FAILED'] as const;
export const PURCHASE_REVIEW_STATUSES = ['REVIEW', 'BOOKED', 'DISMISSED'] as const;
export type PurchaseParseStatus = typeof PURCHASE_PARSE_STATUSES[number];
export type PurchaseReviewStatus = typeof PURCHASE_REVIEW_STATUSES[number];
export type PurchaseParserWarning = { code: string; message: string };
/** Source-derived suggestions only. Amounts cross the API as decimal strings. */
export type PurchaseParsePreview = {
  extractionStatus: 'PARSED';
  validationStatus: 'NOT_VALIDATED';
  format: 'CII' | 'UBL';
  documentType: 'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'UNKNOWN';
  documentTypeCode: string | null;
  currency: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  grossAmount: string | null;
  dueAmount: string | null;
  prepaidAmount: string | null;
  roundingAmount: string | null;
  netAmount: string | null;
  taxAmount: string | null;
  sellerInfo: ParsedEInvoiceParty;
  buyerInfo: ParsedEInvoiceParty;
  lineItems: Array<{
    description: string | null;
    quantity: string | null;
    unit: string | null;
    unitPrice: string | null;
    amount: string | null;
    taxRate: string | null;
  }>;
  parserWarnings: PurchaseParserWarning[];
  /** Future approval must recheck the original and the supported-source rules. */
  approvalSupported: boolean;
};
export type PurchaseBusinessDuplicate = {
  id: number;
  supplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  currency: string | null;
  totalAmount: string | null;
  reviewState: PurchaseReviewStatus;
  revision: number;
  linkedExpenseId: number | null;
};
export type IncomingDocument = {
  id: number;
  direction: 'INCOMING';
  reviewState: PurchaseReviewStatus;
  reviewStatus: PurchaseReviewStatus;
  parseStatus: PurchaseParseStatus;
  validationStatus: 'NOT_VALIDATED';
  revision: number;
  originalRef: {
    id: number;
    fileName: string;
    sha256: string;
    bytes: number;
    mediaType: 'application/pdf' | 'application/xml';
    uploadedAt: string;
    downloadUrl: string;
  };
  supplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  currency: string | null;
  totalAmount: string | null;
  supplierId: number | null;
  selectedSupplierSnapshot: SupplierDto | null;
  supplierCandidate: ParsedEInvoiceParty | null;
  buyerCandidate: ParsedEInvoiceParty | null;
  parserWarnings: PurchaseParserWarning[];
  parserVersion: string | null;
  parseErrorCode: string | null;
  preview: PurchaseParsePreview | null;
  businessDuplicates: PurchaseBusinessDuplicate[];
  linkedExpenseId: number | null;
  dismissedAt: string | null;
  dismissalReason: string | null;
  approvalSupported: boolean;
};
export type IncomingDocumentList = { documents: IncomingDocument[]; total: number; page: number; limit: number };
export type IncomingDocumentResponse = { document: IncomingDocument; replayed?: boolean };

/** Every field is deliberate user input; expenseDate is the actual payment date. */
export type PurchaseExpenseApprovalInput = {
  approvalRequestId: string;
  expectedRevision: number;
  description: string;
  amount: string;
  expenseDate: string;
  category: string;
  taxRelevant: boolean;
  taxDeductiblePercentage: string;
  depreciationYears: number | null;
  confirmPaymentDate: true;
  confirmReviewedOriginal: true;
  confirmBuyerBelongsToBusiness: true;
  acknowledgedDuplicates: Array<{ id: number; revision: number }>;
};
export type PurchaseExpenseApprovalResponse = {
  document: IncomingDocument;
  expense: { id: number; description: string; amount: number; date: string | Date; category: string | null; taxRelevant: boolean; taxDeductiblePercentage: number | null; depreciationYears: number | null };
  replayed: boolean;
};
