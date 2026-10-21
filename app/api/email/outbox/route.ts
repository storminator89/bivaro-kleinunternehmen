import { NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { listEmailOutboxPage } from '@/lib/email-outbox';

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const id = Number(url.searchParams.get('id'));
    const documentType = url.searchParams.get('documentType');
    if (!Number.isSafeInteger(id) || id <= 0 || !['invoice', 'quote'].includes(documentType || '')) return NextResponse.json({ error: 'Ungültiges Dokument.' }, { status: 400 });
    return NextResponse.json(await listEmailOutboxPage(userId, id, documentType!), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    return NextResponse.json({ error: 'Versandverlauf konnte nicht geladen werden.' }, { status: 400 });
  }
}
