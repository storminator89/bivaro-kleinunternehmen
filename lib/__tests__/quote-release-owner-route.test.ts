/** Mocked route boundary only: never app startup, HTTP server, DB or filesystem. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), enabled: vi.fn(), read: vi.fn(), capture: vi.fn(), rate: vi.fn(), slot: vi.fn(), client: Object.freeze({ syntheticOnly: true }) }));
vi.mock('@/lib/prisma', () => ({ prisma: mocks.client }));
vi.mock('@/lib/get-user-id', () => ({ requireUserId: mocks.auth, UnauthorizedError: class UnauthorizedError extends Error {} }));
vi.mock('@/lib/quote-release-owner-access', () => ({ ownerQuoteReleaseCaptureEnabled: mocks.enabled }));
vi.mock('@/lib/quote-release-owner-state', () => ({ readOwnerQuoteReleaseState: mocks.read, OwnerQuoteReleaseStateError: class OwnerQuoteReleaseStateError extends Error {} }));
vi.mock('@/lib/quote-release-owner-capture', () => ({ captureOwnerQuoteRelease: mocks.capture, QuoteOwnerCaptureError: class QuoteOwnerCaptureError extends Error { constructor(readonly code: string) { super('Synthetic closed capture rejection'); } } }));
vi.mock('@/lib/rate-limit', () => ({ consumeRateLimit: mocks.rate }));
vi.mock('@/lib/processing-limit', () => ({ withProcessingSlot: mocks.slot, ProcessingCapacityError: class ProcessingCapacityError extends Error {} }));
import { GET, POST } from '@/app/api/quotes/[id]/releases/route';
import { UnauthorizedError } from '@/lib/get-user-id';
import { QuoteOwnerCaptureError } from '@/lib/quote-release-owner-capture';
import { OwnerQuoteReleaseStateError } from '@/lib/quote-release-owner-state';
import { ProcessingCapacityError } from '@/lib/processing-limit';

const UUID = '00000001-1111-4111-8111-111111111111';
function body() { return { expected: { authorityId: null, revision: 0, currentReleaseId: null, sourceFingerprint: 'a'.repeat(64) }, expiresAt: '2098-01-01T00:00:00.000Z', reason: 'Eigene interne Prüfung' }; }
const context = (id = '10') => ({ params: Promise.resolve({ id }) });
function request(data: unknown = body(), headers: Record<string, string> = {}) { return new Request('http://localhost/api/quotes/10/releases', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) }); }
beforeEach(() => {
  vi.clearAllMocks(); mocks.auth.mockResolvedValue('synthetic-owner'); mocks.enabled.mockReturnValue(true);
  mocks.read.mockResolvedValue({ quoteId: 10, publicAccessEnabled: false, history: [] });
  mocks.rate.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.slot.mockImplementation(async (_userId: string, work: () => Promise<unknown>) => work());
  mocks.capture.mockResolvedValue({ authorityId: UUID, releaseId: UUID, revision: 1, snapshotSha256: 'b'.repeat(64), createdAt: '2026-10-26T12:00:00.000Z', expiresAt: body().expiresAt, originalArchiveName: 'MUST-NOT-LEAVE-SERVICE', sourcePayload: 'PRIVATE' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('default-disabled owner-only quote version route', () => {
  it('requires validated session for both methods before touching owner state', async () => {
    mocks.auth.mockRejectedValue(new UnauthorizedError());
    expect((await GET(new Request('http://localhost'), context())).status).toBe(401);
    expect((await POST(request(), context())).status).toBe(401);
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.rate).not.toHaveBeenCalled(); expect(mocks.capture).not.toHaveBeenCalled();
  });
  it('disabled surface does not read source/create authorities/consume limiter/capture', async () => {
    mocks.enabled.mockReturnValue(false);
    expect((await GET(new Request('http://localhost'), context())).status).toBe(404);
    expect((await POST(request(), context())).status).toBe(404);
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.rate).not.toHaveBeenCalled(); expect(mocks.slot).not.toHaveBeenCalled();
  });
  it('real server flag accepts only literal 1, never a client/browser flag or truthy string', async () => {
    const actual = await vi.importActual<typeof import('@/lib/quote-release-owner-access')>('@/lib/quote-release-owner-access');
    for (const value of [undefined, '', '0', 'true', 'yes', ' 1', '1 ']) {
      vi.stubEnv('BIVARO_INTERNAL_QUOTE_CAPTURE', value); expect(actual.ownerQuoteReleaseCaptureEnabled()).toBe(false);
    }
    vi.stubEnv('BIVARO_INTERNAL_QUOTE_CAPTURE', '1'); expect(actual.ownerQuoteReleaseCaptureEnabled()).toBe(true);
  });
  it.each(['0', '01', '-1', '1.1', '1e1', '2147483648', '10x'])('rejects noncanonical ID %s without reads or writes', async id => {
    expect((await GET(new Request('http://localhost'), context(id))).status).toBe(400);
    expect((await POST(request(), context(id))).status).toBe(400);
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.rate).not.toHaveBeenCalled();
  });
  it('GET uses derived owner, private no-store response and no write controls', async () => {
    const response = await GET(new Request('http://localhost'), context());
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(response.headers.get('vary')).toBe('Cookie');
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith(mocks.client, 'synthetic-owner', 10);
    expect(mocks.capture).not.toHaveBeenCalled(); expect(mocks.rate).not.toHaveBeenCalled(); expect(mocks.slot).not.toHaveBeenCalled();
  });
  it('GET conceals absent owner quote and rejects inconsistent pointer instead of guessing', async () => {
    mocks.read.mockResolvedValueOnce(null); expect((await GET(new Request('http://localhost'), context())).status).toBe(404);
    mocks.read.mockRejectedValueOnce(new OwnerQuoteReleaseStateError()); expect((await GET(new Request('http://localhost'), context())).status).toBe(409);
  });
  it('actual mutation wrapper rejects cross-origin and oversized body before auth/service', async () => {
    expect((await POST(request(body(), { Origin: 'https://evil.invalid' }), context())).status).toBe(403);
    expect((await POST(request({ ...body(), reason: 'x'.repeat(4096) }), context())).status).toBe(413);
    expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.capture).not.toHaveBeenCalled();
  });
  it.each([{ userId: 'foreign-owner' }, { token: 'forbidden' }, { expected: { ...body().expected, revision: -1 } }, { expected: { ...body().expected, authorityId: null, currentReleaseId: UUID } }])('rejects extra authority or malformed CAS %j before limiter', async change => {
    expect((await POST(request({ ...body(), ...change }), context())).status).toBe(400);
    expect(mocks.rate).not.toHaveBeenCalled(); expect(mocks.capture).not.toHaveBeenCalled();
  });
  it('requires JSON and rejects malformed JSON without writes', async () => {
    expect((await POST(request(body(), { 'Content-Type': 'text/plain' }), context())).status).toBe(400);
    const malformed = new Request('http://localhost/api/quotes/10/releases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    expect((await POST(malformed, context())).status).toBe(400); expect(mocks.rate).not.toHaveBeenCalled();
  });
  it('POST derives owner, does not queue/replay and exposes only six receipt fields', async () => {
    const response = await POST(request(), context());
    expect(response.status).toBe(200); expect(mocks.rate).toHaveBeenCalledExactlyOnceWith('quote-release-owner-capture:synthetic-owner', { limit: 6, windowMs: 60_000, blockMs: 60_000 });
    expect(mocks.slot).toHaveBeenCalledOnce(); expect(mocks.slot.mock.calls[0]).toHaveLength(2);
    expect(mocks.capture).toHaveBeenCalledExactlyOnceWith(mocks.client, { userId: 'synthetic-owner', quoteId: 10, ...body() });
    expect(Object.keys(await response.json()).sort()).toEqual(['authorityId', 'releaseId', 'revision', 'snapshotSha256', 'createdAt', 'expiresAt'].sort());
  });
  it('rate and processing exhaustion never queue a capture', async () => {
    mocks.rate.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 9 });
    const rate = await POST(request(), context()); expect(rate.status).toBe(429); expect(rate.headers.get('retry-after')).toBe('9'); expect(mocks.slot).not.toHaveBeenCalled();
    mocks.slot.mockRejectedValueOnce(new ProcessingCapacityError()); expect((await POST(request(), context())).status).toBe(429); expect(mocks.capture).not.toHaveBeenCalled();
  });
  it('stale CAS is a conflict and an unknown write is a redacted explicit-review error, never retried', async () => {
    mocks.capture.mockRejectedValueOnce(new QuoteOwnerCaptureError('STALE_CAPTURE'));
    expect((await POST(request(), context())).status).toBe(409);
    mocks.capture.mockRejectedValueOnce(new Error('PRIVATE SQL/PATH MUST NOT LEAK'));
    const uncertain = await POST(request(), context()); expect(uncertain.status).toBe(500);
    const data = await uncertain.json(); expect(data.code).toBe('OUTCOME_UNKNOWN'); expect(JSON.stringify(data)).not.toContain('PRIVATE');
    expect(mocks.capture).toHaveBeenCalledTimes(2); expect(console.error).toHaveBeenCalledExactlyOnceWith('Internal quote capture failed; outcome requires owner review.');
  });
});
