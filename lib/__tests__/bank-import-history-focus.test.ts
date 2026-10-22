import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import type { BankImportDetail } from '@/lib/bank-import-contract';

// Model React's render/commit phases separately from animation frames. A frame
// is allowed to run before the async receipt state commits to the DOM.
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], effects: [] as (() => void)[] }));
type EffectSlot = { dependencies: unknown[]; cleanup?: () => void };
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (value: unknown) => { hooks.slots[index] = typeof value === 'function' ? value(hooks.slots[index]) : value; }];
  },
  useRef(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
  useEffect(effect: () => (() => void) | void, dependencies: unknown[]) {
    const index = hooks.cursor++, previous = hooks.slots[index] as EffectSlot | undefined;
    if (!previous || dependencies.some((value, position) => !Object.is(value, previous.dependencies[position]))) {
      const slot: EffectSlot = { dependencies }; hooks.slots[index] = slot;
      hooks.effects.push(() => { previous?.cleanup?.(); slot.cleanup = effect() || undefined; });
    }
  },
}));
const client = vi.hoisted(() => ({ history: vi.fn(), receipt: vi.fn() }));
vi.mock('@/lib/bank-import-client', () => ({ loadBankImportHistory: client.history, loadBankImportReceipt: client.receipt }));
import { BankImportHistory } from '@/components/bank-csv/bank-import-panel';

type Node = ReactElement<Record<string, unknown>>;
type Target = { focus: Mock<() => void>; isConnected: boolean };
let tree: ReactNode, active: Target, body: Target, targets: Map<string, Target>, frames: FrameRequestCallback[];
let refs: { current: Target | null }[], mounted: Target[];
const detail = { receipt: { id: 'synthetic-receipt', accountAlias: 'Synthetisches Konto', counts: { total: 0 }, savedAt: '2026-10-22T00:00:00Z' }, rows: [], page: 0, pages: 2 } as unknown as BankImportDetail;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children as ReactNode)];
}
function text(value: ReactNode): string {
  if (Array.isArray(value)) return value.map(text).join('');
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return value && typeof value === 'object' && 'props' in value ? text((value as Node).props.children as ReactNode) : '';
}
function target(key: string) {
  let value = targets.get(key);
  if (!value) { value = { isConnected: true, focus: vi.fn(() => { if (value!.isConnected) active = value!; }) }; targets.set(key, value); }
  return value;
}
function button(label: string) {
  const node = nodes(tree).find(node => typeof node.props.onClick === 'function' && text(node) === label);
  expect(node).toBeDefined(); return node!;
}
function click(label: string) {
  const node = button(label), owner = target(label); owner.focus();
  return (node.props.onClick as (event: unknown) => unknown)({ currentTarget: owner });
}
function commit() {
  refs.forEach(ref => { ref.current = null; }); refs = [];
  mounted.forEach(value => { value.isConnected = false; }); mounted = [];
  hooks.cursor = 0; tree = BankImportHistory({ refresh: 0 });
  for (const node of nodes(tree)) {
    if (typeof node.props.onClick !== 'function' && !node.props.ref) continue;
    const value = target(text(node)); value.isConnected = true; mounted.push(value);
    if (node.props.ref) { const ref = node.props.ref as { current: Target | null }; ref.current = value; refs.push(ref); }
  }
  if (!active.isConnected) active = body;
  hooks.effects.splice(0).forEach(effect => effect());
}
async function settleRequests() { await new Promise(resolve => setImmediate(resolve)); }
function runFrames() { frames.splice(0).forEach(callback => callback(0)); }
async function openReceipt() {
  click('Quittung öffnen'); commit(); await settleRequests(); runFrames(); commit();
}
function unmount() {
  for (const slot of hooks.slots) (slot as EffectSlot | undefined)?.cleanup?.();
}
beforeEach(async () => {
  hooks.cursor = 0; hooks.slots = []; hooks.effects = []; targets = new Map(); frames = []; refs = []; mounted = [];
  body = target('body'); active = body;
  vi.stubGlobal('document', { body, get activeElement() { return active; }, querySelector: vi.fn(() => targets.get('Quittung öffnen')?.isConnected ? targets.get('Quittung öffnen') : null) });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  client.history.mockReset().mockResolvedValue({ receipts: [detail.receipt], hasMore: false });
  client.receipt.mockReset().mockResolvedValue(detail);
  commit(); await settleRequests(); commit();
});
afterEach(() => { unmount(); vi.unstubAllGlobals(); });

describe('bank receipt focus follows committed UI, not the next frame', () => {
  it('focuses a receipt whose heading commits after the next animation frame', async () => {
    click('Quittung öffnen'); commit(); await settleRequests();
    runFrames(); // The response is ready, but the receipt heading does not exist yet.
    expect(targets.has('Importquittung')).toBe(false);
    commit();
    expect(active).toBe(target('Importquittung'));
    expect(target('Importquittung').focus).toHaveBeenCalledTimes(1);
  });
  it('returns focus only after the history opener has remounted, including repeated openings', async () => {
    for (let cycle = 0; cycle < 2; cycle++) {
      await openReceipt(); expect(active).toBe(target('Importquittung'));
      click('Zurück zum Importverlauf'); runFrames();
      expect(target('Quittung öffnen').isConnected).toBe(false);
      commit(); expect(active).toBe(target('Quittung öffnen'));
    }
  });
  it('focuses row navigation only after the new receipt page commits', async () => {
    await openReceipt();
    const heading = target('Importquittung');
    client.receipt.mockResolvedValueOnce({ ...detail, page: 1 });
    click('Nächste Zeilen'); commit(); await settleRequests(); runFrames();
    expect(heading.focus).toHaveBeenCalledTimes(1);
    commit();
    expect(heading.focus).toHaveBeenCalledTimes(2);
    expect(active).toBe(heading);
    commit(); expect(heading.focus).toHaveBeenCalledTimes(2);
  });
  it('does not steal focus from another control while the receipt response is pending', async () => {
    click('Quittung öffnen'); commit();
    const elsewhere = target('Bank-CSV auswählen'); elsewhere.focus();
    await settleRequests(); runFrames(); commit();
    // This external control remains mounted outside BankImportHistory.
    expect(active).toBe(elsewhere);
    expect(target('Importquittung').focus).not.toHaveBeenCalled();
  });
  it('does not steal focus when the user moves on before the close render commits', async () => {
    await openReceipt(); click('Zurück zum Importverlauf');
    const elsewhere = target('Bank-CSV auswählen'); elsewhere.focus();
    runFrames(); commit();
    expect(active).toBe(elsewhere);
  });
  it('cancels pending row navigation when closing and ignores its late response', async () => {
    await openReceipt();
    let resolve!: (value: BankImportDetail) => void;
    client.receipt.mockImplementationOnce(() => new Promise<BankImportDetail>(done => { resolve = done; }));
    click('Nächste Zeilen'); commit();
    const signal = client.receipt.mock.calls.at(-1)![2] as AbortSignal;
    click('Zurück zum Importverlauf'); runFrames(); commit();
    expect(signal.aborted).toBe(true);
    resolve({ ...detail, page: 1 }); await settleRequests(); runFrames(); commit();
    expect(nodes(tree).some(node => node.type === 'h3')).toBe(false);
    expect(active).toBe(target('Quittung öffnen'));
  });
  it('ignores a receipt response after the history unmounts', async () => {
    click('Quittung öffnen'); commit(); unmount();
    await settleRequests(); runFrames();
    expect(target('Importquittung').focus).not.toHaveBeenCalled();
  });
});
