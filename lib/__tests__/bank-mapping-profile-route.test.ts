import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BankImportError } from '@/lib/bank-import-contract';
const state = vi.hoisted(() => ({ userId: 'owner', authenticated: true, list: vi.fn(), read: vi.fn(), save: vi.fn(), remove: vi.fn() }));
vi.mock('@/lib/get-user-id', () => {
  class UnauthorizedError extends Error {}
  return { UnauthorizedError, requireUserId: async () => { if (!state.authenticated) throw new UnauthorizedError(); return state.userId; } };
});
vi.mock('@/lib/bank-mapping-profile-service', () => ({ listBankMappingProfiles: state.list, readBankMappingProfile: state.read, saveBankMappingProfile: state.save, deleteBankMappingProfile: state.remove }));
import { DELETE, GET, POST } from '@/app/api/bank-mapping-profiles/route';
function request(method: string, body = '{}', headers: Record<string, string> = {}) {
  return new Request('https://bivaro.example.invalid/api/bank-mapping-profiles', { method, headers: { origin: 'https://bivaro.example.invalid', 'Content-Type': 'application/json', ...headers }, body });
}
beforeEach(() => { state.authenticated = true; state.userId = 'owner'; vi.clearAllMocks(); vi.stubEnv('NEXTAUTH_URL', 'https://bivaro.example.invalid'); state.list.mockResolvedValue([]); state.save.mockResolvedValue({ id: 'synthetic profile' }); state.remove.mockResolvedValue({ deleted: true }); });
describe('profile route boundary with actual mutation protection and mocked service (no database)', () => {
  it('requires authentication on every method and marks authenticated responses private/no-store', async () => {
    const response = await GET(new Request('https://bivaro.example.invalid/api/bank-mapping-profiles'));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(state.list).toHaveBeenCalledWith('owner');
    state.authenticated = false;
    for (const response of [await GET(new Request('https://bivaro.example.invalid/api/bank-mapping-profiles')), await POST(request('POST')), await DELETE(request('DELETE'))]) {
      expect(response.status).toBe(401); expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
    expect(state.save).not.toHaveBeenCalled(); expect(state.remove).not.toHaveBeenCalled();
  });
  it('blocks cross-origin and sibling-site mutations before the service', async () => {
    expect((await POST(request('POST', '{}', { origin: 'https://other.example.invalid' }))).status).toBe(403);
    expect((await DELETE(request('DELETE', '{}', { 'sec-fetch-site': 'same-site' }))).status).toBe(403);
    expect(state.save).not.toHaveBeenCalled(); expect(state.remove).not.toHaveBeenCalled();
  });
  it('enforces separate bounded create/delete bodies and malformed JSON without writes', async () => {
    expect((await POST(request('POST', ' '.repeat(16 * 1024 + 1)))).status).toBe(413);
    expect((await DELETE(request('DELETE', ' '.repeat(1025)))).status).toBe(413);
    expect((await POST(request('POST', '{'))).status).toBe(400);
    expect(state.save).not.toHaveBeenCalled(); expect(state.remove).not.toHaveBeenCalled();
  });
  it('passes only authenticated owner and explicit revision; returns safe conflicts with no write fallback', async () => {
    const id = randomUUID(); state.read.mockResolvedValue({ id, revision: 1 });
    expect((await GET(new Request(`https://bivaro.example.invalid/api/bank-mapping-profiles?id=${id}&revision=1`))).status).toBe(200);
    expect(state.read).toHaveBeenCalledWith('owner', id, 1);
    expect((await GET(new Request(`https://bivaro.example.invalid/api/bank-mapping-profiles?id=${id}&revision=201`))).status).toBe(400);
    expect((await GET(new Request('https://bivaro.example.invalid/api/bank-mapping-profiles?revision=1'))).status).toBe(400);
    const payload = { id, expectedRevision: 1, mutationId: randomUUID() };
    state.save.mockRejectedValue(new BankImportError('Parallel geändert', 409));
    const response = await POST(request('POST', JSON.stringify(payload)));
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'Parallel geändert' });
    expect(state.save).toHaveBeenCalledWith('owner', payload); expect(state.remove).not.toHaveBeenCalled();
  });
});
