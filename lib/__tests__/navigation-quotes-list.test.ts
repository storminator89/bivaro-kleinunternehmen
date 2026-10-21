import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ findMany: vi.fn(), count: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { invoice: { findMany: state.findMany, count: state.count } } }));
vi.mock('@/lib/get-user-id', () => ({
  requireUserId: async () => 'owner', UnauthorizedError: class extends Error {},
  unauthorizedResponse: () => new Response(null, { status: 401 }),
}));
import { GET } from '@/app/api/quotes/route';

beforeEach(() => { state.findMany.mockReset(); state.count.mockReset(); });

describe('quote list conversion metadata (#23)', () => {
  it('returns the real linked invoice ID without inferring conversion from accepted status', async () => {
    state.findMany.mockResolvedValue([
      { id: 1, status: 'ACCEPTED', convertedInvoice: null },
      { id: 2, status: 'DRAFT', convertedInvoice: { id: 42 } },
    ]);
    state.count.mockResolvedValue(2);
    const response = await GET(new Request('http://localhost/api/quotes?page=1&pageSize=20'));
    expect(response.status).toBe(200);
    expect(state.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'owner', type: 'QUOTE' },
      include: { customer: { select: { id: true, name: true, userId: true } }, convertedInvoice: { select: { id: true } } },
    }));
    expect(await response.json()).toMatchObject({ items: [
      { id: 1, status: 'ACCEPTED', convertedInvoice: null },
      { id: 2, status: 'DRAFT', convertedInvoice: { id: 42 } },
    ], total: 2 });
  });
});
