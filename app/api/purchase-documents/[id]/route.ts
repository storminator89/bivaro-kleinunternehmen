import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/get-user-id';
import { purchaseDocumentDetail, parseDocumentId } from '@/lib/purchase-documents/service';
import { purchaseErrorResponse } from '@/lib/purchase-documents/http';
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try { return NextResponse.json({ document: await purchaseDocumentDetail(await requireUserId(), parseDocumentId((await context.params).id)) }); }
  catch (error) { return purchaseErrorResponse(error); }
}
