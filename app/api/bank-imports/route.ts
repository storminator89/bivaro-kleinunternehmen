import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/get-user-id';
import { protectMutation } from '@/lib/request-security';
import { BankImportError, bankImportPage } from '@/lib/bank-import-contract';
import { bankImportResponseError } from '@/lib/bank-import-response';
import { confirmBankImport, listBankImports, recoverBankImport } from '@/lib/bank-import-service';

const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(request: Request) {
  try {
    const userId = await requireUserId(), query = new URL(request.url).searchParams;
    if (query.has('requestId')) return NextResponse.json({ receipt: await recoverBankImport(userId, query.get('requestId')!) }, { headers });
    return NextResponse.json(await listBankImports(userId, bankImportPage(query.get('page'))), { headers });
  } catch (error) { return bankImportResponseError(error); }
}
async function postHandler(request: Request) {
  try {
    const userId = await requireUserId();
    let value: unknown;
    try { value = await request.json(); } catch { throw new BankImportError('Die Importanfrage enthält ungültiges JSON.'); }
    return NextResponse.json(await confirmBankImport(userId, value), { headers });
  } catch (error) { return bankImportResponseError(error); }
}
// Base64 expands the bounded 2MiB original by 4/3; mapping overhead remains bounded.
export const POST = protectMutation(postHandler, { maxBodyBytes: 3 * 1024 * 1024 });
