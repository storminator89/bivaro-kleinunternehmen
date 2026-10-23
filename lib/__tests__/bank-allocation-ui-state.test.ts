import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import type { BankAllocationPreflight, BankAllocationRowEnvelope, BankCurrentAssignment } from '@/lib/bank-allocation-contract';

// A small render/commit harness: no browser, no server and no persistent bank data.
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], effects: [] as (() => void)[] }));
type EffectSlot = { dependencies: unknown[]; cleanup?: () => void };
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useId: () => 'allocation-test',
  useState(initial: unknown) { const index = hooks.cursor++; if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? initial() : initial; return [hooks.slots[index], (value: unknown) => { hooks.slots[index] = typeof value === 'function' ? value(hooks.slots[index]) : value; }]; },
  useRef(initial: unknown) { const index = hooks.cursor++; if (!(index in hooks.slots)) hooks.slots[index] = { current: initial }; return hooks.slots[index]; },
  useEffect(effect: () => (() => void) | void, dependencies: unknown[]) { const index = hooks.cursor++, previous = hooks.slots[index] as EffectSlot | undefined; if (!previous || dependencies.some((value, position) => !Object.is(value, previous.dependencies[position]))) { const slot: EffectSlot = { dependencies }; hooks.slots[index] = slot; hooks.effects.push(() => { previous?.cleanup?.(); slot.cleanup = effect() || undefined; }); } },
}));
const client = vi.hoisted(() => ({ preflight: vi.fn(), movePreflight: vi.fn(), record: vi.fn(), move: vi.fn(), recover: vi.fn(), recoverMove: vi.fn(), notify: vi.fn() }));
vi.mock('@/lib/bank-allocation-client', () => ({ loadBankAllocationPreflight: client.preflight, loadBankReallocationPreflight: client.movePreflight, resolveBankPayment: client.record, resolveBankReallocation: client.move, recoverBankPayment: client.recover, recoverBankReallocation: client.recoverMove }));
vi.mock('@/lib/payment-dashboard-refresh', () => ({ notifyPaymentDashboardRefresh: client.notify }));
import { BankAllocationRow } from '@/components/bank-csv/bank-allocation-row';

type Node = ReactElement<Record<string, unknown>>;
const rowKey = '11111111-1111-4111-8111-111111111111', bindingKey = '22222222-2222-4222-8222-222222222222';
const invoice = { invoiceId: 7, invoiceNumber: 'RE-120', customerName: 'Werkstatt', ledgerVersion: 'a'.repeat(64), totalCents: '12000', paidCents: '0', openCents: '12000' };
const assignment: BankCurrentAssignment = { bindingStableKey: bindingKey, originalPaymentId: 31, originInvoiceId: 7, originInvoiceNumber: 'RE-120', allocatedInvoice: { ...invoice, paidCents: '4000', openCents: '8000' }, allocationRevision: 0, allocationChangeStableKey: null, amountCents: '4000', currency: 'EUR', paidAt: '2026-10-21T00:00:00.000Z', canReallocate: true, reallocationReviewReason: null };
function bankRow(): BankAllocationRowEnvelope { return { rowStableKey: rowKey, rowEvidenceHash: 'b'.repeat(64), assignmentState: 'UNASSIGNED', bindingStableKey: null, assignmentReviewReason: null, assignment: null, evidence: { rowNumber: 2, date: '2026-10-21', amountCents: '4000', currency: 'EUR', reference: 'RE-120', counterparty: 'Werkstatt', externalId: '', errors: [], warnings: [], duplicateWarnings: [], duplicate: false, priorMatches: { external: 0, content: 0, dayAmount: 0 } } }; }
function preview(row: BankAllocationRowEnvelope, selected = false): BankAllocationPreflight { return { version: 1, row, invoices: [invoice], nextCursor: null, selection: selected ? invoice : null, canConfirm: selected, reviewReasons: [], afterOpenCents: selected ? '8000' : null, sourceAfterOpenCents: null }; }
let tree: ReactNode, row: BankAllocationRowEnvelope;
const pending = vi.fn(), changed = vi.fn();
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== 'object' || !('props' in value)) return []; const node = value as Node; return [node, ...nodes(node.props.children as ReactNode)]; }
function text(value: ReactNode): string { if (Array.isArray(value)) return value.map(text).join(''); if (typeof value === 'string' || typeof value === 'number') return String(value); return value && typeof value === 'object' && 'props' in value ? text((value as Node).props.children as ReactNode) : ''; }
function commit() { hooks.cursor = 0; tree = BankAllocationRow({ initialRow: row, accountScope: 'synthetic', onPendingChange: pending, onChanged: changed }); hooks.effects.splice(0).forEach(effect => effect()); }
function button(label: string) { const node = nodes(tree).find(node => typeof node.props.onClick === 'function' && text(node) === label); expect(node).toBeDefined(); return node!; }
function click(label: string) { return (button(label).props.onClick as () => unknown)(); }
function change(type: string, value: string | boolean) { const node = nodes(tree).find(node => type === 'select' ? node.type === 'select' : node.props.type === type && typeof node.props.onChange === 'function'); expect(node).toBeDefined(); (node!.props.onChange as (event: unknown) => void)({ target: { value, checked: value } }); }
async function settle() { await new Promise(resolve => setImmediate(resolve)); commit(); }
async function choose() { click('Rechnung wählen'); commit(); await settle(); change('select', '7'); commit(); await settle(); change('checkbox', true); commit(); }
function submit() { const form = nodes(tree).find(node => node.type === 'form')!; return (form.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} }); }
beforeEach(() => { const values = new Map<string, string>(); vi.stubGlobal('sessionStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }); hooks.cursor = 0; hooks.slots = []; hooks.effects = []; row = bankRow(); vi.clearAllMocks(); client.preflight.mockImplementation(async (_row, input) => preview(row, Boolean(input.invoiceId))); client.movePreflight.mockImplementation(async () => preview(row)); commit(); });
afterEach(() => { for (const slot of hooks.slots) (slot as EffectSlot | undefined)?.cleanup?.(); vi.unstubAllGlobals(); });

describe('reviewed saved-row allocation interaction', () => {
  it('opening, selecting and cancelling are read-only; only explicit receipt confirmation can write', async () => {
    click('Rechnung wählen'); commit(); await settle();
    change('select', '7'); commit(); await settle();
    expect(nodes(tree).find(node => node.props.type === 'submit')?.props.disabled).toBe(true);
    click('Abbrechen'); commit();
    expect(client.record).not.toHaveBeenCalled(); expect(client.move).not.toHaveBeenCalled(); expect(pending).not.toHaveBeenCalled();
  });
  it('freezes unknown command and key, locks input, preserves a closed request and explicitly retries through the recovery resolver', async () => {
    await choose(); client.record.mockRejectedValueOnce(new Error('lost response'));
    await submit(); commit();
    const original = client.record.mock.calls[0][1];
    expect(original).toMatchObject({ invoiceId: 7, expectedLedgerVersion: invoice.ledgerVersion, reviewed: true, receiptConfirmed: true });
    expect(Object.keys(original)).not.toContain('amount'); expect(Object.keys(original)).not.toContain('paidAt');
    expect(nodes(tree).find(node => node.type === 'fieldset')?.props.disabled).toBe(true);
    click('Schließen · Anfrage bleibt offen'); commit(); click('Ergebnis prüfen'); commit();
    expect(client.preflight).toHaveBeenCalledTimes(2);
    client.record.mockRejectedValueOnce(new Error('still unavailable'));
    await submit(); commit();
    expect(client.record.mock.calls[1][1]).toBe(original); expect(client.record.mock.calls[1][2]).toBe(true);
    expect(pending).not.toHaveBeenCalledWith(rowKey, false);
  });
  it('keeps immutable operation target distinct from current assignment after an old success is replayed', async () => {
    await choose();
    client.record.mockResolvedValueOnce({ operation: { kind: 'BANK_PAYMENT_RECORDED', originInvoiceId: 7, originInvoiceNumber: 'RE-120', originalPaymentId: 31 }, row: { ...row, assignmentState: 'ASSIGNED', bindingStableKey: bindingKey, assignment: { ...assignment, allocatedInvoice: { ...invoice, invoiceId: 8, invoiceNumber: 'RE-OTHER' }, allocationRevision: 1 } }, replayed: true });
    await submit(); commit();
    expect(text(tree)).toContain('Ursprünglich bestätigt für RE-120'); expect(text(tree)).toContain('Aktuelle Zuordnung: RE-OTHER');
    expect(pending).toHaveBeenCalledWith(rowKey, false); expect(client.notify).toHaveBeenCalledTimes(1);
  });
  it('recovers a lost success across an actual component remount using only opaque session identity and GET', async () => {
    await choose(); client.record.mockRejectedValueOnce(new Error('lost response')); await submit(); commit();
    const key = client.record.mock.calls[0][1].idempotencyKey;
    const serialized = sessionStorage.getItem('bivaro:bank-allocation-pending:v1')!;
    expect(serialized).toContain(key); for (const content of ['RE-120', 'Werkstatt', '4000', '2026-10-21', 'reason', 'reference', 'amount']) expect(serialized).not.toContain(content);
    for (const slot of hooks.slots) (slot as EffectSlot | undefined)?.cleanup?.(); hooks.cursor = 0; hooks.slots = []; hooks.effects = [];
    client.recover.mockResolvedValueOnce({ operation: { kind: 'BANK_PAYMENT_RECORDED', originInvoiceNumber: 'RE-120', originalPaymentId: 31 }, row: { ...row, assignmentState: 'ASSIGNED', bindingStableKey: bindingKey, assignment } });
    commit(); await settle();
    expect(client.recover).toHaveBeenCalledWith(rowKey, key, expect.any(AbortSignal));
    expect(client.record).toHaveBeenCalledTimes(1); expect(sessionStorage.getItem('bivaro:bank-allocation-pending:v1')).toBeNull();
    click('Gespeicherten Vorgang ansehen'); commit(); expect(text(tree)).toContain('Ursprünglich bestätigt für RE-120');
  });
  it('allows explicitly reviewed fresh state after a never-committed reload without autoPOST or silently cancelling the old intent', async () => {
    await choose(); client.record.mockRejectedValueOnce(new Error('never reached server')); await submit(); commit();
    const firstKey = client.record.mock.calls[0][1].idempotencyKey;
    for (const slot of hooks.slots) (slot as EffectSlot | undefined)?.cleanup?.(); hooks.cursor = 0; hooks.slots = []; hooks.effects = [];
    client.recover.mockResolvedValue({ operation: null, row });
    commit(); await settle();
    expect(client.record).toHaveBeenCalledTimes(1);
    click('Ergebnis prüfen'); commit(); expect(text(tree)).toContain('Die frühere Anfrage bleibt');
    click('Aktuellen Stand neu prüfen'); commit(); await settle();
    expect(text(tree)).toContain('Frühere Anfrage weiter ungeklärt');
    change('select', '7'); commit(); await settle(); change('checkbox', true); commit();
    client.record.mockRejectedValueOnce(new Error('second response lost')); await submit(); commit();
    expect(client.record).toHaveBeenCalledTimes(2); expect(client.record.mock.calls[1][1].idempotencyKey).not.toBe(firstKey);
    expect(sessionStorage.getItem('bivaro:bank-allocation-pending:v1')).toContain(firstKey);
  });
  it('releases a restored move only when current immutable head proves its old basis superseded', async () => {
    const key = '33333333-3333-4333-8333-333333333333';
    sessionStorage.setItem('bivaro:bank-allocation-pending:v1', JSON.stringify([{ accountScope: 'synthetic', rowStableKey: rowKey, bindingStableKey: bindingKey, operationKey: key, kind: 'move', expectedAllocationRevision: 0, expectedSourceLedgerVersion: assignment.allocatedInvoice.ledgerVersion }]));
    for (const slot of hooks.slots) (slot as EffectSlot | undefined)?.cleanup?.(); hooks.cursor = 0; hooks.slots = []; hooks.effects = [];
    row = { ...row, assignmentState: 'ASSIGNED', bindingStableKey: bindingKey, assignment: { ...assignment, allocatedInvoice: { ...invoice, invoiceId: 8, invoiceNumber: 'RE-B' }, allocationRevision: 1 } };
    client.recoverMove.mockResolvedValueOnce({ operation: null, row });
    commit(); await settle();
    expect(client.recoverMove).toHaveBeenCalledWith(bindingKey, key, expect.any(AbortSignal));
    expect(sessionStorage.getItem('bivaro:bank-allocation-pending:v1')).toBeNull(); expect(text(tree)).toContain('diese frühere Anfrage überholt');
    expect(client.record).not.toHaveBeenCalled(); expect(client.move).not.toHaveBeenCalled();
  });
  it('keeps memory-only confirmation usable when tab storage is unavailable and warns about reload', async () => {
    vi.stubGlobal('sessionStorage', { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } });
    hooks.cursor = 0; hooks.slots = []; hooks.effects = []; commit(); commit();
    expect(text(tree)).toContain('Sitzungsspeicher nicht verfügbar');
    await choose(); client.record.mockRejectedValueOnce(new Error('lost response')); await submit(); commit();
    expect(client.record).toHaveBeenCalledTimes(1); const frozen = client.record.mock.calls[0][1];
    client.record.mockRejectedValueOnce(new Error('still lost')); await submit(); commit(); expect(client.record.mock.calls[1][1]).toBe(frozen); expect(client.record.mock.calls[1][2]).toBe(true);
  });
  it('previews the whole cash-neutral move and sends the exact fresh source/target basis once', async () => {
    row = { ...bankRow(), assignmentState: 'ASSIGNED', bindingStableKey: bindingKey, assignment }; commit(); commit();
    const target = { ...invoice, invoiceId: 8, invoiceNumber: 'RE-B' };
    client.movePreflight.mockImplementation(async (_binding, input) => ({ ...preview(row), invoices: [target], selection: input.invoiceId ? target : null, canConfirm: Boolean(input.invoiceId), afterOpenCents: input.invoiceId ? '8000' : null, sourceAfterOpenCents: input.invoiceId ? '12000' : null }));
    click('Andere Rechnung'); commit(); await settle(); change('select', '8'); commit(); await settle();
    expect(text(tree)).toContain('Bisher · RE-120'); expect(text(tree)).toContain('Offen 80,00 € → 120,00 €'); expect(text(tree)).toContain('Künftig · RE-B'); expect(text(tree)).toContain('Kein zusätzlicher Geldeingang und keine Rückzahlung');
    change('date', '2026-10-22');
    const reason = nodes(tree).find(node => node.props.id === 'allocation-test-reason')!;
    (reason.props.onChange as (event: unknown) => void)({ target: { value: 'Falsche Rechnung erkannt' } });
    change('checkbox', true); commit();
    let resolve!: (value: unknown) => void;
    client.move.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const first = submit(); commit(); await submit();
    expect(client.move).toHaveBeenCalledTimes(1); expect(client.record).not.toHaveBeenCalled();
    expect(client.move.mock.calls[0][1]).toMatchObject({ invoiceId: 8, expectedAllocationRevision: 0, expectedSourceLedgerVersion: assignment.allocatedInvoice.ledgerVersion, expectedTargetLedgerVersion: target.ledgerVersion, actionDate: '2026-10-22', reason: 'Falsche Rechnung erkannt', cashNeutralReviewed: true });
    resolve({ operation: { kind: 'PAYMENT_ALLOCATION_CHANGED', fromInvoiceNumber: 'RE-120', toInvoiceNumber: 'RE-B', revision: 1 }, row: { ...row, assignment: { ...assignment, allocatedInvoice: target, allocationRevision: 1 } }, replayed: false }); await first; commit();
  });
  it('invalidates a selected review when another tab changes the assignment', async () => {
    await choose();
    row = { ...row, assignmentState: 'ASSIGNED', bindingStableKey: bindingKey, assignment }; commit(); commit();
    expect(text(tree)).toContain('zwischenzeitlich geändert');
    expect(nodes(tree).find(node => node.props.type === 'submit')?.props.disabled).toBe(true);
    await submit(); expect(client.record).not.toHaveBeenCalled();
  });
  it('never offers a fresh receipt when an existing binding requires review', () => {
    row = { ...bankRow(), assignmentState: 'REVIEW_REQUIRED', bindingStableKey: bindingKey, assignmentReviewReason: 'Historie prüfen' }; commit(); commit();
    expect(text(tree)).toContain('Zuordnung prüfen'); expect(text(tree)).not.toContain('Rechnung wählen');
    expect(client.record).not.toHaveBeenCalled();
  });
  it('does not enable a review-only manual-history result even after the declaration is checked', async () => {
    client.preflight.mockImplementation(async (_row, input) => ({ ...preview(row, Boolean(input.invoiceId)), canConfirm: false, reviewReasons: ['Vorhandene manuelle Zahlung prüfen.'] }));
    await choose(); expect(text(tree)).toContain('Vorhandene manuelle Zahlung prüfen.');
    expect(nodes(tree).find(node => node.props.type === 'submit')?.props.disabled).toBe(true);
    await submit(); expect(client.record).not.toHaveBeenCalled();
  });
});
