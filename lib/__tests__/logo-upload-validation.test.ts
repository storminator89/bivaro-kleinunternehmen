import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const writeTenantFile = vi.hoisted(() => vi.fn(async () => 'stored.png'));
vi.mock('@/lib/get-user-id', () => ({
  requireUserId: async () => 'logo-owner',
  UnauthorizedError: class extends Error {},
  unauthorizedResponse: () => new Response(null, { status: 401 }),
}));
vi.mock('@/lib/upload-path', () => ({ writeTenantFile }));
import { POST } from '@/app/api/settings/upload-logo/route';

afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

it('rejects missing or string multipart file fields without writing files', async () => {
  vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000');
  for (const value of [undefined, '', 'not-a-file']) {
    const form = new FormData();
    if (value !== undefined) form.append('file', value);
    const response = await POST(new NextRequest('http://localhost:3000/api/settings/upload-logo', { method: 'POST', body: form }));
    expect(response.status).toBe(400);
  }
  expect(writeTenantFile).not.toHaveBeenCalled();
});

it('accepts an actual supported logo file', async () => {
  vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000');
  const form = new FormData();
  form.append('file', new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' }));
  const response = await POST(new NextRequest('http://localhost:3000/api/settings/upload-logo', { method: 'POST', body: form }));
  expect(response.status).toBe(200);
  expect(writeTenantFile).toHaveBeenCalledWith('logo-owner', 'logo.png', expect.any(Uint8Array));
});
