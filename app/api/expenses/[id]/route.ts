import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/get-user-id';
import { prisma } from '@/lib/prisma';
import { parseDocumentId } from '@/lib/purchase-documents/service';
import { PurchaseDocumentError } from '@/lib/purchase-documents/errors';
import { purchaseErrorResponse } from '@/lib/purchase-documents/http';
import type { SupplierDto } from '@/lib/suppliers';
import type { ExpenseDetailResponse } from '@/lib/expense-detail';
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId(), id = parseDocumentId((await context.params).id);
    const row = await prisma.expense.findFirst({ where: { id, userId }, select: { id: true, description: true, amount: true, date: true, category: true, taxRelevant: true, taxDeductiblePercentage: true, depreciationYears: true, receiptFileName: true, storedReceiptFileName: true, purchaseDocument: { select: { id: true, userId: true, reviewStatus: true, originalFileName: true, originalSha256: true, storedFileName: true, mediaType: true, supplierId: true, selectedSupplierSnapshot: true, invoiceNumber: true, invoiceDate: true, approvedAt: true } } } });
    if (!row) throw new PurchaseDocumentError('Ausgabe nicht gefunden.', 404, 'NOT_FOUND');
    const { purchaseDocument: source, storedReceiptFileName, ...expense } = row;
    if (source && (source.userId !== userId || source.reviewStatus !== 'BOOKED' || source.storedFileName !== storedReceiptFileName)) throw new PurchaseDocumentError('Quellenverknüpfung ist inkonsistent.', 409, 'SOURCE_STATE');
    const result: ExpenseDetailResponse = { expense: { ...expense, date: expense.date.toISOString() }, source: source ? { id: source.id, originalFileName: source.originalFileName, originalSha256: source.originalSha256, mediaType: source.mediaType, originalUrl: `/api/purchase-documents/${source.id}/original`, supplierId: source.supplierId, selectedSupplierSnapshot: source.selectedSupplierSnapshot as SupplierDto | null, invoiceNumber: source.invoiceNumber, invoiceDate: source.invoiceDate?.toISOString() ?? null, approvedAt: source.approvedAt?.toISOString() ?? null } : null };
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return purchaseErrorResponse(error); }
}
