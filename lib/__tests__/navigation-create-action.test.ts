import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ effect: undefined as undefined | (() => void | (() => void)) }));
vi.mock('react', () => ({ useEffect: (effect: () => void | (() => void)) => { state.effect = effect; } }));
import { useDashboardCreateAction } from '@/hooks/use-dashboard-create-action';

function options(tab: string) {
  return {
    searchParams: new URLSearchParams(`tab=${tab}&new=1&filter=unpaid&tag=a&tag=b`),
    requestedTab: tab, activeTab: tab,
    router: { replace: vi.fn() },
    expenseEntryOpen: false, incomeEntryOpen: false,
    setExpenseEntryOpen: vi.fn(), setIncomeEntryOpen: vi.fn(),
  };
}

let input: { scrollIntoView: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn> };
let documentFixture: { activeElement: unknown; getElementById: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.useFakeTimers();
  documentFixture = { activeElement: null, getElementById: vi.fn() };
  input = { scrollIntoView: vi.fn(), focus: vi.fn(() => { documentFixture.activeElement = input; }) };
  documentFixture.getElementById.mockReturnValue(input);
  vi.stubGlobal('document', documentFixture);
  vi.stubGlobal('window', { setTimeout, clearTimeout, location: { hash: '#entry' } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('palette entry deep links (#28)', () => {
  it.each(['expenses', 'incomes'])('opens %s before focusing, then consumes only the action parameter', tab => {
    const opts = options(tab);
    useDashboardCreateAction(opts);
    state.effect!();
    expect(tab === 'expenses' ? opts.setExpenseEntryOpen : opts.setIncomeEntryOpen).toHaveBeenCalledWith(true);
    expect(input.focus).not.toHaveBeenCalled();
    expect(opts.router.replace).not.toHaveBeenCalled();

    useDashboardCreateAction({ ...opts, expenseEntryOpen: tab === 'expenses', incomeEntryOpen: tab === 'incomes' });
    state.effect!();
    expect(input.focus).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(documentFixture.getElementById).toHaveBeenCalledWith(tab === 'incomes' ? 'incomeDescription' : 'description');
    expect(input.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(opts.router.replace).toHaveBeenCalledWith(`/dashboard?tab=${tab}&filter=unpaid&tag=a&tag=b#entry`, { scroll: false });
  });

  it('waits until the requested tab is active', () => {
    const opts = { ...options('incomes'), activeTab: 'expenses' };
    useDashboardCreateAction(opts);
    state.effect!();
    vi.runAllTimers();
    expect(opts.setIncomeEntryOpen).not.toHaveBeenCalled();
    expect(input.focus).not.toHaveBeenCalled();
    expect(opts.router.replace).not.toHaveBeenCalled();
  });

  it('cancels queued focus and URL changes when navigation changes or the component unmounts', () => {
    const opts = { ...options('expenses'), expenseEntryOpen: true };
    useDashboardCreateAction(opts);
    const cleanup = state.effect!();
    expect(cleanup).toBeTypeOf('function');
    if (typeof cleanup === 'function') cleanup();
    vi.runAllTimers();
    expect(input.focus).not.toHaveBeenCalled();
    expect(opts.router.replace).not.toHaveBeenCalled();
  });

  it.each(['missing', 'unfocusable'])('does not consume the action when the input is %s', condition => {
    const opts = { ...options('incomes'), incomeEntryOpen: true };
    if (condition === 'missing') documentFixture.getElementById.mockReturnValue(null);
    else input.focus.mockImplementation(() => {});
    useDashboardCreateAction(opts);
    state.effect!();
    vi.runAllTimers();
    expect(opts.router.replace).not.toHaveBeenCalled();
  });

  it.each(['invoices', 'quotes'])('keeps %s editor deep links and unrelated parameters', tab => {
    const opts = options(tab);
    useDashboardCreateAction(opts);
    state.effect!();
    expect(opts.router.replace).toHaveBeenCalledWith(`/dashboard/${tab}/new?filter=unpaid&tag=a&tag=b#entry`);
    expect(input.focus).not.toHaveBeenCalled();
  });

  it.each(['eur', 'gwg'])('does not focus a hidden expense form for unsupported %s actions', tab => {
    const opts = options(tab);
    useDashboardCreateAction(opts);
    state.effect!();
    vi.runAllTimers();
    expect(input.focus).not.toHaveBeenCalled();
    expect(opts.router.replace).not.toHaveBeenCalled();
  });

  it('does not replay an already consumed action', () => {
    const opts = { ...options('expenses'), expenseEntryOpen: true };
    opts.searchParams.delete('new');
    useDashboardCreateAction(opts);
    state.effect!();
    vi.runAllTimers();
    expect(input.focus).not.toHaveBeenCalled();
  });
});
