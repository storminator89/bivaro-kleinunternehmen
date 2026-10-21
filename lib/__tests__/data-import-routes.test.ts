import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const control = vi.hoisted(() => ({ authenticated: true }));
vi.mock('@/lib/get-user-id', () => {
  class UnauthorizedError extends Error {}
  return { UnauthorizedError, requireUserId: async () => { if (!control.authenticated) throw new UnauthorizedError(); return 'verified-owner'; }, unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }) };
});
const service = vi.hoisted(() => ({ previewDataImport: vi.fn(async () => ({ counts: { ready: 1 } })), confirmDataImport: vi.fn(async () => ({ imported: 1 })), findImportResult: vi.fn(async () => null) }));
vi.mock('@/lib/data-import-service', async original => ({ ...await original<typeof import('@/lib/data-import-service')>(), ...service }));
import { GET, POST } from '@/app/api/data-import/route';
function request(value: unknown, headers: Record<string, string> = {}) { return new NextRequest('https://csv.example.test/api/data-import', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(value) }); }
const input = { kind: 'customers', csv: 'Name\nSynthetic Customer', mapping: { name: 0 } };
afterEach(() => { control.authenticated = true; vi.clearAllMocks(); vi.unstubAllEnvs(); });
describe('CSV HTTP boundaries', () => {
  it('requires a validated current session before reading tenant state or creating previews', async () => {
    control.authenticated = false;
    expect((await GET(new Request('https://csv.example.test/api/data-import?requestId=synthetic-request-123'))).status).toBe(401);
    expect((await POST(request({ ...input, action: 'preview' }))).status).toBe(401);
    expect(service.previewDataImport).not.toHaveBeenCalled(); expect(service.findImportResult).not.toHaveBeenCalled();
  });
  it('requires explicit review and confirm action, never treats preview as import', async () => {
    expect((await POST(request({ ...input, action: 'preview' }))).status).toBe(200);
    expect(service.previewDataImport).toHaveBeenCalledWith('verified-owner', input);
    expect(service.confirmDataImport).not.toHaveBeenCalled();
    expect((await POST(request({ ...input, action: 'confirm', requestId: 'synthetic-request-123', fingerprint: 'a'.repeat(64) }))).status).toBe(400);
    expect(service.confirmDataImport).not.toHaveBeenCalled();
  });
  it('forwards only verified ownership and validated request ID to confirmation', async () => {
    expect((await POST(request({ ...input, action: 'confirm', reviewed: true, userId: 'attacker-choice', requestId: 'synthetic-request-123', fingerprint: 'a'.repeat(64) }))).status).toBe(200);
    expect(service.confirmDataImport).toHaveBeenCalledWith('verified-owner', input, 'synthetic-request-123', 'a'.repeat(64));
  });
  it('rejects hostile origin and oversized JSON before mutation', async () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://csv.example.test');
    expect((await POST(request(input, { origin: 'https://hostile.example.test' }))).status).toBe(403);
    expect((await POST(request({ csv: 'x'.repeat(768 * 1024) }))).status).toBe(413);
    expect(service.confirmDataImport).not.toHaveBeenCalled();
  });
  it('receipt reads are tenant-scoped and private/no-store', async () => {
    const response = await GET(new Request('https://csv.example.test/api/data-import?requestId=synthetic-request-123&userId=attacker-choice'));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(service.findImportResult).toHaveBeenCalledWith('verified-owner', 'synthetic-request-123');
  });
});
