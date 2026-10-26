import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import type { IncomingInvoiceDateFilter as Filter } from '@/lib/purchase-documents/invoice-date-filter';

// Controlled React hook calls only. No DOM, browser, network or real navigation.
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], effects: [] as (() => void)[] }));
type EffectSlot = { dependencies: unknown[]; cleanup?: () => void };
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState(initial: unknown) { const index = hooks.cursor++; if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? initial() : initial; return [hooks.slots[index], (value: unknown) => { hooks.slots[index] = typeof value === 'function' ? value(hooks.slots[index]) : value; }]; },
  useRef(initial: unknown) { const index = hooks.cursor++; if (!(index in hooks.slots)) hooks.slots[index] = { current: initial }; return hooks.slots[index]; },
  useEffect(effect: () => (() => void) | void, dependencies: unknown[]) { const index = hooks.cursor++, previous = hooks.slots[index] as EffectSlot | undefined; if (!previous || dependencies.some((value, position) => !Object.is(value, previous.dependencies[position]))) { const slot: EffectSlot = { dependencies }; hooks.slots[index] = slot; hooks.effects.push(() => { previous?.cleanup?.(); slot.cleanup = effect() || undefined; }); } },
}));
import { IncomingInvoiceDateFilter } from '@/components/purchases/incoming-invoice-date-filter';

type Node = ReactElement<Record<string, unknown>>;
const apply = vi.fn(); let tree: ReactNode, value: Filter;
function nodes(input: ReactNode): Node[] { if (Array.isArray(input)) return input.flatMap(nodes); if (!input || typeof input !== 'object' || !('props' in input)) return []; const node = input as Node; return [node, ...nodes(node.props.children as ReactNode)]; }
function text(input: ReactNode): string { if (Array.isArray(input)) return input.map(text).join(''); if (typeof input === 'string' || typeof input === 'number') return String(input); return input && typeof input === 'object' && 'props' in input ? text((input as Node).props.children as ReactNode) : ''; }
function commit() { hooks.cursor = 0; tree = IncomingInvoiceDateFilter({ value, onApply: apply }); hooks.effects.splice(0).forEach(effect => effect()); }
function byId(id: string) { return nodes(tree).find(node => node.props.id === id)!; }
function edit(id: string, next: string) { (byId(id).props.onChange as (event: unknown) => void)({ target: { value: next } }); commit(); }
function toggle(checked: boolean) { const checkbox = nodes(tree).find(node => node.props.type === 'checkbox')!; (checkbox.props.onChange as (event: unknown) => void)({ target: { checked } }); commit(); }
function submit() { const form = nodes(tree).find(node => node.type === 'form')!; (form.props.onSubmit as (event: unknown) => void)({ preventDefault() {} }); commit(); }
beforeEach(() => { hooks.cursor = 0; hooks.slots = []; hooks.effects = []; vi.clearAllMocks(); vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { callback(); return 1; }); value = { invoiceDateFrom: '', invoiceDateTo: '', invoiceDateMissing: 'any' }; commit(); commit(); });
afterEach(() => { for (const slot of hooks.slots) (slot as EffectSlot | undefined)?.cleanup?.(); vi.unstubAllGlobals(); });

describe('explicit read-only invoice-date form (mocked component interactions)', () => {
  it('labels both mobile-sized calendar inputs and explains excluded unknown/draft/upload dates', () => {
    expect(byId('incoming-invoice-date-from').props).toMatchObject({ type: 'date', min: '0001-01-01', max: '9999-12-31', 'aria-describedby': 'incoming-invoice-date-help' });
    expect(byId('incoming-invoice-date-to').props).toMatchObject({ type: 'date', min: '0001-01-01', max: '9999-12-31' });
    const content = text(tree); expect(content).toContain('Foto-/Prüfentwurfsdaten und Uploaddatum ersetzen es nicht'); expect(content).toContain('ohne Datumsfilter bleiben sie enthalten');
    expect(apply).not.toHaveBeenCalled();
  });
  it('keeps editing read-only until explicit apply, supporting one-sided ranges', () => {
    edit('incoming-invoice-date-from', '2026-01-01'); expect(apply).not.toHaveBeenCalled(); submit();
    expect(apply).toHaveBeenCalledExactlyOnceWith({ invoiceDateFrom: '2026-01-01', invoiceDateTo: '', invoiceDateMissing: 'any' });
  });
  it('announces reversed/invalid dates inline and never applies an invalid range', () => {
    edit('incoming-invoice-date-from', '2026-12-31'); edit('incoming-invoice-date-to', '2026-01-01'); submit();
    expect(nodes(tree).find(node => node.props.role === 'alert')?.props.tabIndex).toBe(-1);
    expect(text(tree)).toContain('Von-Datum darf nicht nach'); expect(apply).not.toHaveBeenCalled();
    edit('incoming-invoice-date-from', '2026-02-30'); submit();
    expect(text(tree)).toContain('gültiges Rechnungsdatum'); expect(apply).not.toHaveBeenCalled();
  });
  it('selecting missing source dates disables range inputs and explicitly applies no contradictory endpoints', () => {
    edit('incoming-invoice-date-from', '2026-01-01'); edit('incoming-invoice-date-to', '2026-12-31'); toggle(true);
    expect(byId('incoming-invoice-date-from').props.disabled).toBe(true); expect(byId('incoming-invoice-date-to').props.disabled).toBe(true);
    expect(apply).not.toHaveBeenCalled(); submit();
    expect(apply).toHaveBeenCalledExactlyOnceWith({ invoiceDateFrom: '', invoiceDateTo: '', invoiceDateMissing: 'only' });
  });
  it('restores the accepted URL filter on history/detail changes, not an unapplied draft', () => {
    edit('incoming-invoice-date-from', '2026-01-01');
    value = { invoiceDateFrom: '2024-02-29', invoiceDateTo: '2024-03-31', invoiceDateMissing: 'any' }; commit(); commit();
    expect(byId('incoming-invoice-date-from').props.value).toBe('2024-02-29'); expect(byId('incoming-invoice-date-to').props.value).toBe('2024-03-31');
    expect(text(tree)).toContain('Aktiver Rechnungsdatumbereich: 2024-02-29 bis 2024-03-31'); expect(apply).not.toHaveBeenCalled();
  });
  it('reset only requests empty date selectors and provides a status without mutating other filters', () => {
    value = { invoiceDateFrom: '', invoiceDateTo: '', invoiceDateMissing: 'only' }; commit(); commit();
    expect(text(tree)).toContain('Aktiv: nur ohne ausgelesenes Rechnungsdatum.');
    const reset = nodes(tree).find(node => text(node) === 'Datumsfilter zurücksetzen' && typeof node.props.onClick === 'function')!;
    (reset.props.onClick as () => void)(); commit();
    expect(apply).toHaveBeenCalledExactlyOnceWith({ invoiceDateFrom: '', invoiceDateTo: '', invoiceDateMissing: 'any' });
    expect(byId('incoming-invoice-date-from').props.disabled).toBe(false);
  });
  it('shows malformed direct-link filters honestly and permits explicit clearing', () => {
    value = { invoiceDateFrom: '2026-02-30', invoiceDateTo: '', invoiceDateMissing: 'any' }; commit(); commit();
    expect(nodes(tree).some(node => node.props.role === 'alert')).toBe(true); expect(text(tree)).toContain('gültiges Rechnungsdatum');
    expect(nodes(tree).some(node => text(node) === 'Datumsfilter zurücksetzen')).toBe(true); expect(apply).not.toHaveBeenCalled();
  });
});
