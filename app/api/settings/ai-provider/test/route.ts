import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/get-user-id';
import { protectMutation } from '@/lib/request-security';
import { consumeRateLimit } from '@/lib/rate-limit';
import { auditSecurityEvent } from '@/lib/audit-log';
import { resolveAiProviderConfiguration } from '@/lib/ai-provider/settings';
import { requestAiCompletion } from '@/lib/ai-provider/transport';
import { aiProviderErrorResponse } from '@/lib/ai-provider/http';
import { AiProviderError } from '@/lib/ai-provider/errors';

export const runtime = 'nodejs';
async function postHandler(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await request.json();
    if (!body || body.acknowledgeCost !== true || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1 || typeof body.expectedConfigRevision !== 'string' || !body.expectedConfigRevision || body.expectedConfigRevision.length > 100 || Object.keys(body).some(key => !['expectedVersion', 'expectedConfigRevision', 'acknowledgeCost'].includes(key))) {
      throw new AiProviderError('COST_ACK_REQUIRED', 'Verbindungstest benötigt die ausdrückliche Bestätigung möglicher Anbieter-Kosten und die aktuelle Konfigurationsversion.');
    }
    const limit = await consumeRateLimit(`ai-provider-test:${userId}`, { limit: 3, windowMs: 60_000, blockMs: 60_000 });
    if (!limit.allowed) return NextResponse.json({ error: 'Zu viele Verbindungstests. Bitte später erneut versuchen.' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } });
    const config = await resolveAiProviderConfiguration(userId, body.expectedVersion, body.expectedConfigRevision);
    await requestAiCompletion(config, { messages: [{ role: 'user', content: 'Reply with exactly OK. This is a synthetic connection test without receipt data.' }], maxTokens: 8 }, request.signal);
    await auditSecurityEvent(userId, { event: 'AI_PROVIDER_CONNECTION_TEST', outcome: 'success', severity: 'info', metadata: { operation: 'synthetic-test', version: config.version } });
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return aiProviderErrorResponse(error); }
}
export const POST = protectMutation(postHandler, { maxBodyBytes: 1024 });
