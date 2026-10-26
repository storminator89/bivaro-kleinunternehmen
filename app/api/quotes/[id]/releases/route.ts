import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, UnauthorizedError } from '@/lib/get-user-id';
import { protectMutation } from '@/lib/request-security';
import { consumeRateLimit } from '@/lib/rate-limit';
import { withProcessingSlot, ProcessingCapacityError } from '@/lib/processing-limit';
import { ownerQuoteReleaseCaptureEnabled } from '@/lib/quote-release-owner-access';
import { readOwnerQuoteReleaseState, OwnerQuoteReleaseStateError } from '@/lib/quote-release-owner-state';
import { captureOwnerQuoteRelease, QuoteOwnerCaptureError } from '@/lib/quote-release-owner-capture';
import { parseOwnerQuoteReleaseCaptureBody, OwnerQuoteReleaseInputError } from '@/lib/quote-release-owner-contract';

export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
function reply(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie', ...extra } });
}
async function quoteId(context: Context): Promise<number | null> {
  const { id } = await context.params;
  return /^[1-9]\d{0,9}$/u.test(id) && Number(id) <= 2147483647 ? Number(id) : null;
}
/** Explicit owner-only state read: no preflight authority/audit/limiter writes. */
export async function GET(_request: Request, context: Context) {
  try {
    const userId = await requireUserId();
    if (!ownerQuoteReleaseCaptureEnabled()) return reply({ error: 'Interne Angebotsversionen sind nicht aktiviert.' }, 404);
    const id = await quoteId(context);
    if (id === null) return reply({ error: 'Ungültige Angebots-ID.' }, 400);
    const state = await readOwnerQuoteReleaseState(prisma, userId, id);
    return state ? reply(state) : reply({ error: 'Angebot nicht gefunden.' }, 404);
  } catch (error) {
    if (error instanceof UnauthorizedError) return reply({ error: 'Nicht angemeldet.' }, 401);
    if (error instanceof OwnerQuoteReleaseStateError) return reply({ error: error.message, code: 'REVIEW_REQUIRED' }, 409);
    // Do not log private source JSON, stored paths, request bodies or SQL arguments.
    console.error('Internal quote version read failed.');
    return reply({ error: 'Der interne Versionsstand konnte nicht gelesen werden.' }, 500);
  }
}
async function postHandler(request: Request, context: Context) {
  try {
    const userId = await requireUserId();
    if (!ownerQuoteReleaseCaptureEnabled()) return reply({ error: 'Interne Angebotsversionen sind nicht aktiviert.' }, 404);
    const id = await quoteId(context);
    if (id === null) return reply({ error: 'Ungültige Angebots-ID.' }, 400);
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return reply({ error: 'JSON-Anfrage erforderlich.' }, 400);
    const body = parseOwnerQuoteReleaseCaptureBody(await request.json());
    const limit = await consumeRateLimit(`quote-release-owner-capture:${userId}`, { limit: 6, windowMs: 60_000, blockMs: 60_000 });
    if (!limit.allowed) return reply({ error: 'Zu viele Versionsanfragen. Bitte später den Stand erneut prüfen.' }, 429, { 'Retry-After': String(limit.retryAfterSeconds) });
    // No idempotency key: the existing limiter must reject, never queue/replay
    // a capture whose outcome is unknown. Each intentional attempt needs fresh CAS.
    const receipt = await withProcessingSlot(userId, () => captureOwnerQuoteRelease(prisma, { userId, quoteId: id, ...body }));
    return reply({ authorityId: receipt.authorityId, releaseId: receipt.releaseId, revision: receipt.revision,
      snapshotSha256: receipt.snapshotSha256, createdAt: receipt.createdAt, expiresAt: receipt.expiresAt });
  } catch (error) {
    if (error instanceof UnauthorizedError) return reply({ error: 'Nicht angemeldet.' }, 401);
    if (error instanceof SyntaxError || error instanceof OwnerQuoteReleaseInputError) return reply({ error: 'Ungültige Versionsanfrage.' }, 400);
    if (error instanceof ProcessingCapacityError) return reply({ error: error.message }, 429, { 'Retry-After': '1' });
    if (error instanceof QuoteOwnerCaptureError) return reply({ error: error.message, code: error.code }, error.code === 'INVALID_COMMAND' ? 400 : 409);
    console.error('Internal quote capture failed; outcome requires owner review.');
    return reply({ error: 'Der Ausgang ist unklar. Nicht erneut speichern: zuerst den Versionsstand neu laden und bewusst prüfen.', code: 'OUTCOME_UNKNOWN' }, 500);
  }
}
export const POST = protectMutation(postHandler, { maxBodyBytes: 4096 });
