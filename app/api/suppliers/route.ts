import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/get-user-id';
import { protectMutation } from '@/lib/request-security';
import { listSuppliers, createSupplier } from '@/lib/suppliers';
import { purchaseErrorResponse, purchaseJsonBody } from '@/lib/purchase-documents/http';
export async function GET(request: NextRequest) {
  try { return NextResponse.json(await listSuppliers(await requireUserId(), request.nextUrl.searchParams)); }
  catch (error) { return purchaseErrorResponse(error); }
}
async function postHandler(request: NextRequest) {
  try { const userId = await requireUserId(); return NextResponse.json({ supplier: await createSupplier(userId, await purchaseJsonBody(request)) }, { status: 201 }); }
  catch (error) { return purchaseErrorResponse(error); }
}
export const POST = protectMutation(postHandler);
