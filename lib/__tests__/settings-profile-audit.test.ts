import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  actor: 'settings-user' as string | null,
  findUnique: vi.fn(), upsert: vi.fn(), auditCreate: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: {
  settings: { findUnique: state.findUnique, upsert: state.upsert },
  auditLog: { create: state.auditCreate },
} }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/get-user-id', () => {
  class UnauthorizedError extends Error {}
  return {
    UnauthorizedError,
    requireUserId: async () => { if (!state.actor) throw new UnauthorizedError(); return state.actor; },
    unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
  };
});
vi.mock('@/lib/upload-ownership', () => ({ isLegacyFileOwnedByUser: async () => false }));
vi.mock('@/lib/upload-path', () => ({
  findTenantUploadedFile: () => null, isSafeLegacyFileName: () => false,
  isSafeStoredFileName: () => false, privateLogoUrl: (url: string) => url,
}));
import { POST } from '@/app/api/settings/route';

const emptyProfile = {
  id: 11, userId: 'settings-user', companyName: null, companyAddress: null,
  email: null, telephone: null, taxNumber: null, bankName: null, iban: null,
  bic: null, footerText: null, logoUrl: null,
};
function request(body: Record<string, unknown>, origin?: string) {
  return new Request('http://localhost/api/settings', {
    method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXTAUTH_URL', 'http://localhost');
  state.actor = 'settings-user';
  state.findUnique.mockResolvedValue(emptyProfile);
  state.upsert.mockImplementation(async ({ update }) => ({
    ...emptyProfile, ...Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined)),
  }));
  state.auditCreate.mockResolvedValue({ id: 1 });
});
afterEach(() => vi.unstubAllEnvs());

describe('company profile audit regression #24', () => {
  it('records tenant, settings identity and actual changed field names, never profile values', async () => {
    const profile = {
      companyName: 'PRIVATE-COMPANY', companyAddress: 'PRIVATE-ADDRESS',
      email: 'private@example.invalid', telephone: 'PRIVATE-PHONE', taxNumber: 'PRIVATE-TAX',
      bankName: 'PRIVATE-BANK', iban: 'PRIVATE-IBAN', bic: 'PRIVATE-BIC', footerText: 'PRIVATE-FOOTER',
      password: 'UNEXPECTED-SECRET', allowedOrigins: ['https://untrusted.invalid'],
    };
    expect((await POST(request(profile))).status).toBe(200);
    expect(state.findUnique).toHaveBeenCalledWith({ where: { userId: 'settings-user' } });
    expect(state.upsert.mock.calls[0][0].where).toEqual({ userId: 'settings-user' });
    const event = state.auditCreate.mock.calls[0][0].data;
    expect(event).toMatchObject({ userId: 'settings-user', action: 'SETTINGS_CHANGED', entityType: 'Settings', entityId: '11', entityName: 'Firmenprofil', oldValues: null, newValues: null });
    expect(JSON.parse(event.metadata)).toEqual({
      operation: 'settings.company-profile.save', created: false,
      changedFields: ['companyName', 'companyAddress', 'email', 'telephone', 'taxNumber', 'bankName', 'iban', 'bic', 'footerText'],
    });
    for (const value of Object.values(profile).flat()) expect(JSON.stringify(event)).not.toContain(value);
  });

  it('records the first profile save, while unchanged saves create no duplicate audit entry', async () => {
    state.findUnique.mockResolvedValueOnce(null);
    expect((await POST(request({ companyName: 'First profile' }))).status).toBe(200);
    expect(JSON.parse(state.auditCreate.mock.calls[0][0].data.metadata)).toMatchObject({ created: true, changedFields: ['companyName'] });
    state.auditCreate.mockClear();
    expect((await POST(request({}))).status).toBe(200);
    expect(state.auditCreate).not.toHaveBeenCalled();
  });

  it('preserves successful saves when best-effort audit persistence fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      state.auditCreate.mockRejectedValueOnce(new Error('simulated audit failure'));
      const result = await POST(request({ taxNumber: 'PRIVATE-TAX' }));
      expect(result.status).toBe(200);
      expect((await result.json()).taxNumber).toBe('PRIVATE-TAX');
      expect(consoleError).toHaveBeenCalledWith('Failed to create audit log');
    } finally { consoleError.mockRestore(); }
  });

  it('does not audit or save unauthenticated or cross-origin requests', async () => {
    state.actor = null;
    expect((await POST(request({ companyName: 'No authorization' }))).status).toBe(401);
    state.actor = 'settings-user';
    expect((await POST(request({ companyName: 'Wrong origin' }, 'https://untrusted.invalid'))).status).toBe(403);
    expect(state.findUnique).not.toHaveBeenCalled();
    expect(state.upsert).not.toHaveBeenCalled();
    expect(state.auditCreate).not.toHaveBeenCalled();
  });

  it('does not record success for rejected logos or failed settings persistence', async () => {
    expect((await POST(request({ logoUrl: '/uploads/unowned.png' }))).status).toBe(404);
    state.upsert.mockRejectedValueOnce(new Error('simulated save failure'));
    expect((await POST(request({ companyName: 'Failed save' }))).status).toBe(500);
    expect(state.auditCreate).not.toHaveBeenCalled();
  });
});
