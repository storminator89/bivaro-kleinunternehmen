import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getToken = vi.hoisted(() => vi.fn());
vi.mock('next-auth/jwt', () => ({ getToken }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
import { config, proxy } from '@/proxy';

describe('legacy public upload boundary', () => {
  it('blocks static legacy files before authentication, including filenames with dots', async () => {
    expect(config.matcher).toContain('/uploads/:path*');
    for (const path of ['/uploads', '/uploads/known-invoice.pdf', '/uploads/logo.png']) {
      expect((await proxy(new NextRequest(`http://localhost${path}`))).status).toBe(404);
    }
    expect(getToken).not.toHaveBeenCalled();
  });
});
