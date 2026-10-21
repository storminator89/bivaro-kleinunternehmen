import type { SupplierDto } from '@/lib/suppliers';
export type ExpenseDetailResponse = {
  expense: { id: number; description: string; amount: number; date: string; category: string | null; taxRelevant: boolean; taxDeductiblePercentage: number | null; depreciationYears: number | null; receiptFileName: string | null };
  source: { id: number; originalFileName: string; originalSha256: string; mediaType: string; originalUrl: string; supplierId: number | null; selectedSupplierSnapshot: SupplierDto | null; invoiceNumber: string | null; invoiceDate: string | null; approvedAt: string | null } | null;
};
