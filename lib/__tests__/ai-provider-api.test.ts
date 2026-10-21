import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ userId: 'tenant-a' as string | null }));
vi.mock('@/lib/get-user-id', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return { UnauthorizedError, ForbiddenError,
    requireUserId: async () => { if (!state.userId) throw new UnauthorizedError(); return state.userId; },
    unauthorizedResponse: () => new Response('{}', { status: 401 }), forbiddenResponse: () => new Response('{}', { status: 403 }),
  };
});
vi.mock('@/lib/ai-provider/settings', () => ({
  getAiProviderSettings: vi.fn(async () => ({ enabled: false, autoAnalyzeNewUploads: false, hasKey: true, version: 1 })),
  validateAiProviderSettingsInput: vi.fn(value => value),
  saveAiProviderSettings: vi.fn(async () => ({ enabled: true, autoAnalyzeNewUploads: false, hasKey: true, version: 2 })),
  resolveAiProviderConfiguration: vi.fn(async () => ({ version: 1, apiKey: 'synthetic-never-return-this-key' })),
}));
vi.mock('@/lib/ai-provider/transport', () => ({ requestAiCompletion: vi.fn(async () => 'synthetic-never-return-this-key') }));
vi.mock('@/lib/audit-log', () => ({ auditSecurityEvent: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ consumeRateLimit: vi.fn(async () => ({ allowed: true })) }));
import { GET, PUT } from '@/app/api/settings/ai-provider/route';
import { POST } from '@/app/api/settings/ai-provider/test/route';
import { getAiProviderSettings, saveAiProviderSettings, resolveAiProviderConfiguration } from '@/lib/ai-provider/settings';
import { requestAiCompletion } from '@/lib/ai-provider/transport';
import { auditSecurityEvent } from '@/lib/audit-log';
import { AiProviderError } from '@/lib/ai-provider/errors';
function request(path: string, body: unknown, method = 'POST', origin = 'http://localhost') {
  return new Request(`http://localhost/api/settings/ai-provider${path}`, { method, headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });
}
beforeEach(() => { state.userId = 'tenant-a'; vi.clearAllMocks(); });
describe('authenticated per-user provider routes', () => {
  it('rejects unauthenticated reads and writes', async () => {
    state.userId = null;
    expect((await GET()).status).toBe(401);
    expect((await PUT(request('', {}, 'PUT'))).status).toBe(401);
    expect((await POST(request('/test', { expectedVersion: 1, expectedConfigRevision: 'synthetic-revision', acknowledgeCost: true }))).status).toBe(401);
    expect(getAiProviderSettings).not.toHaveBeenCalled();
    expect(requestAiCompletion).not.toHaveBeenCalled();
  });
  it('uses authenticated tenant identity and prevents client caching', async () => {
    const response = await GET();
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(getAiProviderSettings).toHaveBeenCalledWith('tenant-a');
  });
  it('rejects cross-origin settings and tests before any mutation/paid request', async () => {
    expect((await PUT(request('', {}, 'PUT', 'https://evil.invalid'))).status).toBe(403);
    expect((await POST(request('/test', {}, 'POST', 'https://evil.invalid'))).status).toBe(403);
    expect(saveAiProviderSettings).not.toHaveBeenCalled(); expect(requestAiCompletion).not.toHaveBeenCalled();
  });
  it('requires separately explicit cost acknowledgement', async () => {
    expect((await POST(request('/test', { expectedVersion: 1 }))).status).toBe(400);
    expect(requestAiCompletion).not.toHaveBeenCalled();
  });
  it('discards echoed key/provider content from test response and audit', async () => {
    const response = await POST(request('/test', { expectedVersion: 1, expectedConfigRevision: 'synthetic-revision', acknowledgeCost: true }));
    expect(await response.json()).toEqual({ ok: true });
    expect(JSON.stringify(vi.mocked(auditSecurityEvent).mock.calls)).not.toContain('synthetic-never-return-this-key');
    expect(requestAiCompletion).toHaveBeenCalledTimes(1);
  });
  it('rejects missing and stale opaque revision before provider dispatch', async () => {
    const missing = await POST(request('/test', { expectedVersion: 1, acknowledgeCost: true }));
    expect(missing.status).toBe(400);
    vi.mocked(resolveAiProviderConfiguration).mockRejectedValueOnce(new AiProviderError('CONFIG_CONFLICT', 'Changed', 409));
    const stale = await POST(request('/test', { expectedVersion: 1, expectedConfigRevision: 'old-revision', acknowledgeCost: true }));
    expect(stale.status).toBe(409);
    expect(resolveAiProviderConfiguration).toHaveBeenCalledWith('tenant-a', 1, 'old-revision');
    expect(requestAiCompletion).not.toHaveBeenCalled();
  });
  it('does not reflect arbitrary thrown provider secrets', async () => {
    vi.mocked(requestAiCompletion).mockRejectedValueOnce(new Error('synthetic-never-return-this-key'));
    const response = await POST(request('/test', { expectedVersion: 1, expectedConfigRevision: 'synthetic-revision', acknowledgeCost: true }));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('synthetic-never-return-this-key');
  });
  it('returns static typed transport error status without automatic retry', async () => {
    vi.mocked(requestAiCompletion).mockRejectedValueOnce(new AiProviderError('TIMEOUT', 'Safe timeout', 504, true));
    const response = await POST(request('/test', { expectedVersion: 1, expectedConfigRevision: 'synthetic-revision', acknowledgeCost: true }));
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({ code: 'TIMEOUT', requestMayHaveBeenSent: true });
    expect(requestAiCompletion).toHaveBeenCalledTimes(1);
  });
});
