import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestDatabase } from './helpers/database';

const state = vi.hoisted(() => ({ client: null as PrismaClient | null, userId: 'filter-options-alice', authenticated: true }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => {
  class UnauthorizedError extends Error {}
  return {
    UnauthorizedError,
    requireUserId: vi.fn(async () => {
      if (!state.authenticated) throw new UnauthorizedError();
      return state.userId;
    }),
    unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
  };
});

import { GET } from '@/app/api/dashboard/filter-options/route';

const alice = 'filter-options-alice';
const bob = 'filter-options-bob';
const empty = 'filter-options-empty';
// Preserve exact strings: no trimming, case folding, Unicode normalization or
// locale-aware sorting. The private-use/astral pair also distinguishes SQLite's
// UTF-8 BINARY ordering from JavaScript's default UTF-16 string ordering.
const values = ['', ' ', 'A', 'a', 'Büro', 'büro', 'Ä', 'ä', 'é', 'e\u0301', '\uE000', '😀'];
const binaryOrder = [...values].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
let database: ReturnType<typeof createTestDatabase>;
let statements: string[] = [];

beforeAll(async () => {
  database = createTestDatabase();
  state.client = database.client;
  database.client.$on('query', event => {
    if (/^\s*SELECT\b/i.test(event.query)) statements.push(event.query);
  });
  await database.client.user.createMany({ data: [alice, bob, empty].map(id => ({ id, email: `${id}@example.test`, password: 'unused' })) });
  await database.client.customer.createMany({ data: [
    ...values.flatMap(name => [{ userId: alice, name }, { userId: alice, name }]),
    ...Array.from({ length: 32 }, () => ({ userId: alice, name: 'Büro' })),
    { userId: bob, name: 'Other tenant only' },
  ] });
  await database.client.expense.createMany({ data: [
    ...[null, ...values].flatMap(category => [{ userId: alice, category, description: 'Synthetic option', amount: 1 }, { userId: alice, category, description: 'Synthetic option', amount: 1 }]),
    ...Array.from({ length: 32 }, () => ({ userId: alice, category: 'Büro', description: 'Synthetic duplicate', amount: 1 })),
    { userId: bob, category: 'Other tenant only', description: 'Synthetic other tenant', amount: 1 },
  ] });
}, 40_000);

afterEach(() => { state.userId = alice; state.authenticated = true; });
afterAll(async () => { await database?.cleanup(); });

describe('database-grouped dashboard filter options #156', () => {
  it('matches the previous complete output without loading duplicate rows', async () => {
    // Use the original queries as a compatibility oracle against the same real
    // SQLite fixture, not a mock that assumes grouping/collation semantics.
    const [previousCategories, previousCustomers] = await Promise.all([
      database.client.expense.findMany({ where: { userId: alice }, select: { category: true }, distinct: ['category'], orderBy: { category: 'asc' } }),
      database.client.customer.findMany({ where: { userId: alice }, select: { name: true }, orderBy: { name: 'asc' } }),
    ]);
    const previous = {
      categories: previousCategories.map(item => item.category).filter((value): value is string => Boolean(value)),
      customers: Array.from(new Set(previousCustomers.map(item => item.name))),
    };

    statements = [];
    const response = await GET();
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data).toEqual(previous);
    expect(data.customers).toEqual(binaryOrder);
    expect(data.categories).toEqual(binaryOrder.filter(Boolean));
    expect(data.categories).not.toContain(null);
    expect(data.categories).not.toContain('');
    expect(data.categories).toContain(' ');
    expect(data.categories).not.toContain('Sonstiges');
    expect(statements).toHaveLength(2);
    for (const table of ['Expense', 'Customer']) {
      const query = statements.find(statement => statement.includes(`"${table}"`));
      expect(query, table).toMatch(/\bGROUP BY\b/i);
      expect(query, table).toMatch(/\bORDER BY\b/i);
      expect(query, table).not.toMatch(/SELECT\s+\*/i);
    }
  });

  it('keeps each tenant isolated and retains empty results', async () => {
    state.userId = bob;
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ categories: ['Other tenant only'], customers: ['Other tenant only'] });

    state.userId = empty;
    expect(await (await GET()).json()).toEqual({ categories: [], customers: [] });
  });

  it('requires authentication before either grouping query', async () => {
    state.authenticated = false;
    statements = [];
    expect((await GET()).status).toBe(401);
    expect(statements).toEqual([]);
  });

  it('fails closed without returning partial options or database details', async () => {
    const expenses = vi.spyOn(database.client.expense, 'groupBy').mockRejectedValueOnce(new Error('synthetic private database details'));
    const customers = vi.spyOn(database.client.customer, 'groupBy').mockResolvedValueOnce([]);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await GET();
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'Fehler beim Laden der Filteroptionen' });
    } finally {
      expenses.mockRestore();
      customers.mockRestore();
      log.mockRestore();
    }
  });
});
