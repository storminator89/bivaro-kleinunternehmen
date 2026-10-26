import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

// Exercise the actual page's event handlers/effects without a browser or DB.
// Child UI primitives remain opaque; this harness only owns the page's hooks.
const hooks = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as unknown[],
  effects: [] as (() => void)[],
  dirty: true,
}));
type EffectSlot = { dependencies: unknown[]; cleanup?: () => void; effect?: () => (() => void) | void };
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const changed = (previous: unknown[] | undefined, next: unknown[]) =>
    !previous || previous.length !== next.length || next.some((value, index) => !Object.is(value, previous[index]));
  return {
    ...actual,
    useState(initial: unknown) {
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [hooks.slots[index], (value: unknown) => {
        const next = typeof value === 'function' ? value(hooks.slots[index]) : value;
        if (!Object.is(next, hooks.slots[index])) { hooks.slots[index] = next; hooks.dirty = true; }
      }];
    },
    useRef(initial: unknown) {
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
      return hooks.slots[index];
    },
    useCallback(callback: unknown, dependencies: unknown[]) {
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as { dependencies: unknown[]; callback: unknown } | undefined;
      if (changed(previous?.dependencies, dependencies)) hooks.slots[index] = { dependencies, callback };
      return (hooks.slots[index] as { callback: unknown }).callback;
    },
    useEffect(effect: () => (() => void) | void, dependencies: unknown[]) {
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as EffectSlot | undefined;
      if (changed(previous?.dependencies, dependencies)) {
        const slot: EffectSlot = { dependencies, effect };
        hooks.slots[index] = slot;
        hooks.effects.push(() => { previous?.cleanup?.(); slot.cleanup = effect() || undefined; });
      }
    },
  };
});

vi.mock('@/components/public-accounting/accounting-workspaces.module.css', () => ({ default: {} }));

import CashBookPage from '@/app/cashbook/page';

type Node = ReactElement<Record<string, unknown>>;
type Book = { id: number; name: string; initialBalance: number };
type Transaction = { id: number; cashBookId: number; amount: number; type: string; description: string; date: string; runningBalance?: number; taxRelevant: boolean };
let tree: ReactNode;
let books: Book[];
let transactions: Transaction[];
let pendingOldTransactions: ((value: Response) => void) | undefined;
let pendingOldDailyBalance: ((value: Response) => void) | undefined;
let deferOldReads = false;

function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(item => nodes(item));
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children as ReactNode), ...nodes(node.props.actions as ReactNode)];
}
function text(value: ReactNode): string {
  if (Array.isArray(value)) return value.map(text).join('');
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (value && typeof value === 'object' && 'props' in value) return text((value as Node).props.children as ReactNode);
  return '';
}
function find(predicate: (node: Node) => boolean): Node {
  const node = nodes(tree).find(predicate);
  expect(node).toBeDefined();
  return node!;
}
function invoke(node: Node, event: string, ...args: unknown[]) {
  return (node.props[event] as (...parameters: unknown[]) => unknown)(...args);
}
function input(id: string, value: string) {
  invoke(find(node => node.props.id === id), 'onChange', { target: { value } });
}
function click(label: string) {
  return invoke(find(node => typeof node.props.onClick === 'function' && text(node) === label), 'onClick');
}
async function flush() {
  for (let iteration = 0; iteration < 40; iteration++) {
    if (hooks.dirty) {
      hooks.dirty = false;
      hooks.cursor = 0;
      tree = CashBookPage();
      hooks.effects.splice(0).forEach(effect => effect());
    }
    await new Promise(resolve => setImmediate(resolve));
    if (!hooks.dirty && !hooks.effects.length) return;
  }
  throw new Error('Page did not settle');
}
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const validBook = { id: 1, name: 'Hauptkasse', initialBalance: 100, currentBalance: 100, transactionCount: 0, currency: 'EUR', isActive: true };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function journal(book: Book) {
  let balance = book.initialBalance;
  return transactions.filter(transaction => transaction.cashBookId === book.id).map(transaction => {
    balance += transaction.type === 'EINNAHME' ? transaction.amount : -transaction.amount;
    return { ...transaction, runningBalance: balance };
  });
}
function summary() {
  return text(find(node => node.props['aria-label'] === 'Kassenübersicht'));
}
function headlineBalance() {
  return text(find(node => node.type === 'div' && text(node).startsWith('Kassenbestand')));
}
async function bookTransaction(type: 'EINNAHME' | 'AUSGABE', amount: string, description: string) {
  if (type === 'AUSGABE') { click('Ausgabe'); await flush(); }
  input('tx-amount', amount); await flush();
  input('tx-description', description); await flush();
  await click('Buchung erfassen'); await flush();
}

beforeEach(() => {
  for (const slot of hooks.slots) (slot as EffectSlot | undefined)?.cleanup?.();
  hooks.cursor = 0; hooks.slots = []; hooks.effects = []; hooks.dirty = true;
  books = [{ id: 1, name: 'Hauptkasse', initialBalance: 100 }, { id: 2, name: 'Zweitkasse', initialBalance: 5 }];
  transactions = [];
  pendingOldTransactions = undefined; pendingOldDailyBalance = undefined; deferOldReads = false;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('alert', vi.fn());
  vi.stubGlobal('fetch', vi.fn(async (resource: string, options?: RequestInit) => {
    const url = new URL(resource, 'http://unit.test');
    const method = options?.method ?? 'GET';
    const body = options?.body ? JSON.parse(String(options.body)) : {};
    if (url.pathname === '/api/cashbook') {
      if (method === 'POST') { const created = { ...body, id: 3 }; books.unshift(created); return json(created); }
      if (method === 'DELETE') { books = books.filter(book => book.id !== Number(url.searchParams.get('id'))); return json({ success: true }); }
      return json(books.map(book => ({ currency: 'EUR', isActive: true, ...book, currentBalance: journal(book).at(-1)?.runningBalance ?? book.initialBalance, transactionCount: journal(book).length })));
    }
    const book = books.find(item => item.id === Number(url.searchParams.get('cashBookId'))) ?? books[0];
    if (url.pathname.endsWith('/transactions')) {
      if (method === 'POST') transactions.push({ ...body, id: transactions.length + 1 });
      if (method === 'PUT') transactions = transactions.map(transaction => transaction.id === body.id ? body : transaction);
      if (method === 'DELETE') transactions = transactions.filter(transaction => transaction.id !== Number(url.searchParams.get('id')));
      if (method !== 'GET') return json({ success: true });
      if (deferOldReads && book.id === 1) return new Promise<Response>(resolve => { pendingOldTransactions = resolve; });
      const rows = journal(book);
      const page = Number(url.searchParams.get('page') ?? 1);
      const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
      return json({ items: rows.slice((page - 1) * pageSize, page * pageSize), totalPages: Math.ceil(rows.length / pageSize) });
    }
    if (url.pathname.endsWith('/daily-balance')) {
      const rows = journal(book);
      const currentSystemBalance = rows.at(-1)?.runningBalance ?? book.initialBalance;
      if (method === 'POST') return json({ status: 'OK', systemBalance: currentSystemBalance, countedAmount: body.countedAmount, difference: 0 });
      if (deferOldReads && book.id === 1) return new Promise<Response>(resolve => { pendingOldDailyBalance = resolve; });
      return json({ date: '2026-10-20', openingBalance: book.initialBalance, closingBalance: currentSystemBalance, currentSystemBalance, totalIncome: rows.filter(row => row.type === 'EINNAHME').reduce((sum, row) => sum + row.amount, 0), totalExpense: rows.filter(row => row.type === 'AUSGABE').reduce((sum, row) => sum + row.amount, 0), transactionCount: rows.length, transactions: rows });
    }
    throw new Error(`Unexpected request ${resource}`);
  }));
});

afterEach(() => {
  for (const slot of hooks.slots) (slot as EffectSlot | undefined)?.cleanup?.();
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe('cashbook initial list read states (#83)', () => {
  function expectHeader() {
    expect(find(node => node.props.title === 'Kassenbuch')).toBeDefined();
  }
  function expectUnavailable() {
    expectHeader();
    expect(text(find(node => node.props.role === 'alert'))).toBe('Die Kassenbücher konnten nicht geladen werden.');
    expect(text(tree)).not.toContain('Kein Kassenbuch vorhanden');
    expect(nodes(tree).some(node => text(node) === 'Kassenbuch erstellen' && typeof node.props.onClick === 'function')).toBe(false);
    expect(nodes(tree).some(node => node.props.id === 'cashbook-selector')).toBe(false);
    expect(find(node => text(node) === 'Neue Kasse' && typeof node.props.onClick === 'function').props.disabled).toBe(true);
  }

  it('keeps the shared header and announces pending reads; only a confirmed empty list offers creation', async () => {
    const pending = deferred<Response>(); vi.mocked(fetch).mockReturnValueOnce(pending.promise);
    await flush();
    expectHeader();
    expect(text(find(node => node.props.role === 'status'))).toBe('Kassenbuch wird geladen…');
    expect(find(node => node.props['aria-label'] === 'Kassenbuch laden').props['aria-busy']).toBe(true);
    expect(text(tree)).not.toContain('Kein Kassenbuch vorhanden');
    expect(nodes(tree).some(node => text(node) === 'Kassenbuch erstellen' && typeof node.props.onClick === 'function')).toBe(false);
    expect(find(node => text(node) === 'Neue Kasse' && typeof node.props.onClick === 'function').props.disabled).toBe(true);
    pending.resolve(json([])); await flush();
    expectHeader();
    expect(text(tree)).toContain('Kein Kassenbuch vorhanden');
    expect(nodes(tree).some(node => text(node) === 'Kassenbuch erstellen' && typeof node.props.onClick === 'function')).toBe(true);
    expect(find(node => text(node) === 'Neue Kasse' && typeof node.props.onClick === 'function').props.disabled).toBe(false);
    expect(nodes(tree).some(node => node.props.role === 'alert' || node.props.role === 'status')).toBe(false);
    expect(vi.mocked(fetch).mock.calls).toEqual([['/api/cashbook']]);
  });

  it.each([
    ['401', () => Promise.resolve(new Response('{}', { status: 401 }))],
    ['403', () => Promise.resolve(new Response('{}', { status: 403 }))],
    ['503', () => Promise.resolve(new Response('{}', { status: 503 }))],
    ['network failure', () => Promise.reject(new Error('Synthetic read failure'))],
    ['invalid JSON', () => Promise.resolve(new Response('{'))],
    ['null JSON', () => Promise.resolve(json(null))],
    ['non-array JSON', () => Promise.resolve(json({ cashBooks: [] }))],
    ['null entry', () => Promise.resolve(json([null]))],
    ['bad ID', () => Promise.resolve(json([{ ...validBook, id: '1' }]))],
    ['bad name', () => Promise.resolve(json([{ ...validBook, name: {} }]))],
    ['bad balance', () => Promise.resolve(json([{ ...validBook, currentBalance: '100' }]))],
    ['bad count', () => Promise.resolve(json([{ ...validBook, transactionCount: -1 }]))],
    ['duplicate IDs', () => Promise.resolve(json([validBook, validBook]))],
  ])('never treats %s as empty and recovers only with an explicit GET', async (_label, failure) => {
    vi.mocked(fetch).mockImplementationOnce(failure); await flush(); expectUnavailable();
    expect(vi.mocked(fetch).mock.calls).toEqual([['/api/cashbook']]);
    const pending = deferred<Response>(); vi.mocked(fetch).mockReturnValueOnce(pending.promise);
    const retry = find(node => text(node) === 'Erneut versuchen' && typeof node.props.onClick === 'function');
    invoke(retry, 'onClick'); invoke(retry, 'onClick'); await flush();
    expectHeader();
    expect(nodes(tree).some(node => node.props.role === 'status')).toBe(true);
    expect(nodes(tree).some(node => text(node) === 'Kassenbuch erstellen' && typeof node.props.onClick === 'function')).toBe(false);
    expect(text(tree)).not.toContain('Erneut versuchen');
    expect(vi.mocked(fetch).mock.calls).toEqual([['/api/cashbook'], ['/api/cashbook']]);
    pending.resolve(json([validBook])); await flush();
    expect(summary()).toContain('100,00');
    expect(nodes(tree).some(node => node.props.role === 'alert' || node.props.role === 'status')).toBe(false);
    expect(vi.mocked(fetch).mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
    expect(alert).not.toHaveBeenCalled();
  });

  it('allows legitimate nullable descriptions and extra API metadata without changing summaries', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json([{ ...validBook, description: null, extraMetadata: { retained: true } }]));
    await flush();
    expect(summary()).toContain('100,00');
    expect(nodes(tree).some(node => node.props.role === 'alert')).toBe(false);
  });

  it('ignores an older initial response and its finally after a Strict Mode effect replay', async () => {
    const oldRead = deferred<Response>(), latestRead = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(latestRead.promise);
    await flush();
    // Replay mounted effects with their cleanup, as React Strict Mode does.
    for (const slot of hooks.slots as EffectSlot[]) {
      if (slot?.effect) { slot.cleanup?.(); slot.cleanup = slot.effect() || undefined; }
    }
    oldRead.resolve(json([])); await flush();
    expectHeader();
    expect(nodes(tree).some(node => node.props.role === 'status')).toBe(true);
    expect(text(tree)).not.toContain('Kein Kassenbuch vorhanden');
    latestRead.resolve(json([validBook])); await flush();
    expect(summary()).toContain('100,00');
  });

  it('preserves a valid selected book after failed mutation-summary refresh and GET-only recovery', async () => {
    await flush();
    invoke(find(node => typeof node.props.onValueChange === 'function' && node.props.value === '1'), 'onValueChange', '2'); await flush();
    const originalFetch = vi.mocked(fetch).getMockImplementation()!;
    let failNextListRead = true;
    vi.mocked(fetch).mockImplementation((resource, options) => {
      if (resource === '/api/cashbook' && !options?.method && failNextListRead) {
        failNextListRead = false;
        return Promise.resolve(new Response('{}', { status: 503 }));
      }
      return originalFetch(resource, options);
    });
    await bookTransaction('EINNAHME', '2', 'Synthetic selected-book income');
    expectUnavailable();
    const writesBeforeRetry = vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method && options.method !== 'GET');
    click('Erneut versuchen'); await flush();
    expect(find(node => typeof node.props.onValueChange === 'function' && node.props.value === '2')).toBeDefined();
    expect(summary()).toContain('7,00');
    expect(summary()).toContain('1 Buchungen insgesamt');
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method && options.method !== 'GET')).toEqual(writesBeforeRetry);
  });
});

describe('cashbook canonical selection and mutation refresh (#22)', () => {
  it('uses opening balance immediately after creation and selects the new canonical summary', async () => {
    await flush();
    input('cb-name', 'Neue Kasse'); await flush();
    input('cb-balance', '100'); await flush();
    await click('Erstellen'); await flush();
    expect(headlineBalance()).toContain('100,00');
    expect(summary()).toContain('0 Buchungen insgesamt');
    expect(find(node => node.props.id === 'cashbook-selector').props.children).toBeDefined();
    const selector = find(node => typeof node.props.onValueChange === 'function' && node.props.value === '3');
    expect(selector.props.value).toBe('3');
  });

  it('refreshes summary, count, daily totals and Soll after create/edit/delete without reload', async () => {
    await flush();
    await bookTransaction('EINNAHME', '25.50', 'Einnahme');
    await bookTransaction('AUSGABE', '10.25', 'Ausgabe');
    expect(headlineBalance()).toContain('115,25');
    expect(summary()).toContain('2 Buchungen insgesamt');
    expect(summary()).toContain('25,50');
    expect(summary()).toContain('10,25');
    input('counted-amount', '115.25'); await flush();
    await click('Kassensturz durchführen'); await flush();
    expect(text(tree)).toContain('Kasse stimmt');
    invoke(find(node => node.props['aria-label'] === 'Ausgabe bearbeiten'), 'onClick'); await flush();
    input('edit-tx-amount', '5'); await flush();
    await click('Speichern'); await flush();
    expect(headlineBalance()).toContain('120,50');
    expect(summary()).toContain('2 Buchungen insgesamt');
    expect(text(tree)).not.toContain('Kasse stimmt');
    const soll = find(node => text(node).startsWith('Aktueller Sollbestand laut System') && text(node).includes('120,50'));
    expect(text(soll)).toContain('120,50');
    invoke(find(node => node.props['aria-label'] === 'Ausgabe löschen'), 'onClick'); await flush();
    await click('Löschen'); await flush();
    expect(headlineBalance()).toContain('125,50');
    expect(summary()).toContain('1 Buchungen insgesamt');
    expect(nodes(tree).some(node => node.props['aria-label'] === 'Ausgabe bearbeiten')).toBe(false);
  });

  it('clamps an emptied last page after deletion and resets pagination when switching cash books', async () => {
    transactions = Array.from({ length: 21 }, (_, index) => ({ id: index + 1, cashBookId: 1, type: 'EINNAHME', amount: 1, description: `Entry ${index + 1}`, date: '2026-10-20', taxRelevant: true }));
    await flush();
    click('Weiter'); await flush();
    expect(text(tree)).toContain('Seite 2 von 2');
    invoke(find(node => node.props['aria-label'] === 'Entry 21 löschen'), 'onClick'); await flush();
    await click('Löschen'); await flush();
    expect(summary()).toContain('20 Buchungen insgesamt');
    expect(nodes(tree).some(node => node.props['aria-label'] === 'Entry 1 bearbeiten')).toBe(true);
    expect(text(tree)).not.toContain('Seite 2');
    invoke(find(node => typeof node.props.onValueChange === 'function' && node.props.value === '1'), 'onValueChange', '2');
    await flush();
    expect(summary()).toContain('5,00');
    expect(summary()).toContain('0 Buchungen insgesamt');
    expect(nodes(tree).some(node => String(node.props['aria-label']).startsWith('Entry '))).toBe(false);
  });

  it('clears old cash-count results and ignores late reads when switching cash books', async () => {
    deferOldReads = true;
    await flush();
    input('counted-amount', '100'); await flush();
    await click('Kassensturz durchführen'); await flush();
    expect(text(tree)).toContain('Kasse stimmt');
    invoke(find(node => typeof node.props.onValueChange === 'function' && node.props.value === '1'), 'onValueChange', '2');
    await flush();
    expect(summary()).toContain('5,00');
    expect(text(tree)).not.toContain('Kasse stimmt');
    expect(find(node => node.props.id === 'counted-amount').props.value).toBe('');
    pendingOldTransactions!(json({ items: [{ id: 90, description: 'STALE ROW', date: '2026-10-20', amount: 999, runningBalance: 999 }], totalPages: 8 }));
    pendingOldDailyBalance!(json({ date: '2026-10-20', totalIncome: 999, totalExpense: 999, transactions: [] }));
    await flush();
    expect(text(tree)).not.toContain('STALE ROW');
    expect(summary()).not.toContain('999,00');
    expect(summary()).toContain('5,00');
  });
});

describe('cashbook edit accessible labels (#30)', () => {
  it('associates every edit label with exactly one control, including category and tax switch', async () => {
    transactions = [{ id: 1, cashBookId: 1, type: 'AUSGABE', amount: 10.25, description: 'Ausgabe', date: '2026-10-20', taxRelevant: true }];
    await flush();
    invoke(find(node => node.props['aria-label'] === 'Ausgabe bearbeiten'), 'onClick'); await flush();
    const labels = ['Datum', 'Betrag (€)', 'Beschreibung', 'Kategorie', 'Belegnummer', 'Steuerrelevant', 'Notizen'];
    for (const label of labels) {
      const editLabel = find(node => text(node) === label && String(node.props.htmlFor).startsWith('edit-tx-'));
      expect(nodes(tree).filter(node => node.props.id === editLabel.props.htmlFor)).toHaveLength(1);
    }
    const ids = nodes(tree).map(node => node.props.id).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
