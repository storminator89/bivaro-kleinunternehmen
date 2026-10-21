import { NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { AccountantExportError, parseAccountantExportPeriod } from '@/lib/accountant-export';
import { readHandoffReadiness } from '@/lib/handoff-readiness';

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const period = parseAccountantExportPeriod(new URL(request.url).searchParams);
    return NextResponse.json(await readHandoffReadiness(userId, period), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    if (error instanceof AccountantExportError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: 'Offene Prüfaufgaben konnten nicht geladen werden. Bitte erneut versuchen.' }, { status: 500 });
  }
}
