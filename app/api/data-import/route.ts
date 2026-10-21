import { NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { protectMutation } from '@/lib/request-security';
import { ImportInputError } from '@/lib/data-import-contract';
import { confirmDataImport, findImportResult, parseImportRequest, parseImportRequestId, previewDataImport } from '@/lib/data-import-service';

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const result = await findImportResult(userId, parseImportRequestId(new URL(request.url).searchParams.get('requestId')));
    return NextResponse.json({ result }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return handleError(error); }
}
async function postHandler(request: Request) {
  try {
    const userId = await requireUserId();
    let value: Record<string, unknown>;
    try { value = await request.json(); } catch { throw new ImportInputError('Die Importanfrage enthält ungültiges JSON.'); }
    const input = parseImportRequest(value);
    if (value.action === 'preview') return NextResponse.json(await previewDataImport(userId, input), { headers: { 'Cache-Control': 'private, no-store' } });
    if (value.action !== 'confirm' || value.reviewed !== true || typeof value.fingerprint !== 'string') throw new ImportInputError('Bitte die Vorschau ausdrücklich bestätigen.');
    return NextResponse.json(await confirmDataImport(userId, input, parseImportRequestId(value.requestId), value.fingerprint), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return handleError(error); }
}
function handleError(error: unknown) {
  if (error instanceof UnauthorizedError) return unauthorizedResponse();
  if (error instanceof ImportInputError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error('CSV import failed'); // Never log uploaded content or customer PII.
  return NextResponse.json({ error: 'Der Import konnte nicht abgeschlossen werden. Die Importkennung bleibt erhalten; bitte das Ergebnis erneut prüfen.' }, { status: 500 });
}
// JSON quoting can expand source bytes; the parser independently caps raw CSV.
export const POST = protectMutation(postHandler, { maxBodyBytes: 768 * 1024 });
