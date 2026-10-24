import { NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError } from '@/lib/get-user-id';
import { protectMutation } from '@/lib/request-security';
import { BankImportError } from '@/lib/bank-import-contract';
import { bankMappingProfileRevision } from '@/lib/bank-mapping-profile-contract';
import { deleteBankMappingProfile, listBankMappingProfiles, readBankMappingProfile, saveBankMappingProfile } from '@/lib/bank-mapping-profile-service';
const headers = { 'Cache-Control': 'private, no-store' };
function failure(error: unknown) {
  if (error instanceof UnauthorizedError) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  if (error instanceof BankImportError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  console.error('Bank mapping profile operation failed'); // No names, mapping, source or error object.
  return NextResponse.json({ error: 'Ergebnis unklar. Dieselbe Profilaktion erneut prüfen; keine neue Aktion beginnen.' }, { status: 500, headers });
}
export async function GET(request: Request) {
  try {
    const userId = await requireUserId(), query = new URL(request.url).searchParams;
    const id = query.get('id');
    if (!id && query.has('revision')) throw new BankImportError('Bitte ein Profil wählen.');
    if (query.has('revision') && !/^[1-9]\d{0,2}$/u.test(query.get('revision')!)) throw new BankImportError('Ungültige Profilrevision.');
    return NextResponse.json(id ? { profile: await readBankMappingProfile(userId, id, query.has('revision') ? bankMappingProfileRevision(Number(query.get('revision'))) : undefined) } : { profiles: await listBankMappingProfiles(userId) }, { headers });
  } catch (error) { return failure(error); }
}
async function mutate(request: Request, remove: boolean) {
  try {
    const userId = await requireUserId();
    let value: unknown;
    try { value = await request.json(); } catch { throw new BankImportError('Ungültiges JSON.'); }
    return NextResponse.json(remove ? await deleteBankMappingProfile(userId, value) : { profile: await saveBankMappingProfile(userId, value) }, { headers });
  } catch (error) { return failure(error); }
}
export const POST = protectMutation(request => mutate(request, false), { maxBodyBytes: 16 * 1024 });
export const DELETE = protectMutation(request => mutate(request, true), { maxBodyBytes: 1024 });
