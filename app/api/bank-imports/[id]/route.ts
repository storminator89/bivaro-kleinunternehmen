import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/get-user-id';
import { bankImportPage } from '@/lib/bank-import-contract';
import { readBankImport } from '@/lib/bank-import-service';
import { bankImportResponseError } from '@/lib/bank-import-response';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await context.params;
    return NextResponse.json(await readBankImport(userId, id, bankImportPage(new URL(request.url).searchParams.get('page'))), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return bankImportResponseError(error); }
}
