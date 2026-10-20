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
type EffectSlot = { dependencies: unknown[]; cleanup?: () => void };
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
        const slot: EffectSlot = { dependencies };
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
  vi.stubGlobal('alert', vi.fn());
  vi.stubGlobal('fetch', vi.fn(async (resource: string, options?: RequestInit) => {
    const url = new URL(resource, 'http://unit.test');
    const method = options?.method ?? 'GET';
    const body = options?.body ? JSON.parse(String(options.body)) : {};
    if (url.pathname === '/api/cashbook') {
      if (method === 'POST') { const created = { ...body, id: 3 }; books.unshift(created); return json(created); }
      if (method === 'DELETE') { books = books.filter(book => book.id !== Number(url.searchParams.get('id'))); return json({ success: true }); }
      return json(books.map(book => ({ ...book, currentBalance: journal(book).at(-1)?.runningBalance ?? book.initialBalance, transactionCount: journal(book).length })));
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

afterEach(() => { vi.unstubAllGlobals(); });

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
