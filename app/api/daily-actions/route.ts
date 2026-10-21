import { NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { readDailyActions } from '@/lib/daily-actions/service';

export async function GET() {
  try {
    return NextResponse.json(await readDailyActions(await requireUserId()), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    console.error('Could not read daily actions');
    return NextResponse.json({ error: 'Die nächsten Schritte konnten nicht geladen werden.' }, { status: 500, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
