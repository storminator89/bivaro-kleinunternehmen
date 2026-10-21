import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent } from '@/components/ui/tooltip';
import { EditModal } from '@/components/dashboard/modals/edit-modal';
import { RecurringExpensesModal } from '@/components/dashboard/modals/recurring-expenses-modal';
import SteuerSimulationPage from '@/app/steuer-simulation/page';
import { expensePercentageInput, parseExpensePercentage } from '@/components/dashboard/modals/expense-percentage';
import { simulationInputErrors, simulationNumberError, simulationNumberRules, type SimulationNumberField } from '@/app/steuer-simulation/validation';
import { calculateChurchTax, calculateIncomeTax, calculateTradeTaxDetails } from '@/lib/tax-calculator';
import { buildTaxSummary } from '@/lib/tax-summary';

// A shallow hook harness exercises actual component event handlers/render gates
// without a browser, a live server, network, or a repository database.
const hooks = vi.hoisted(() => ({ index: 0, states: [] as unknown[] }));
vi.mock('@/components/public-accounting/accounting-workspaces.module.css', () => ({ default: {} }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = hooks.index++;
      if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? initial() : initial;
      return [hooks.states[index], (value: unknown) => {
        hooks.states[index] = typeof value === 'function' ? value(hooks.states[index]) : value;
      }];
    },
    useEffect: () => {},
    useMemo: (factory: () => unknown) => factory(),
    useCallback: (callback: unknown) => callback,
    useRef: (current: unknown) => ({ current }),
  };
});
vi.mock('@/lib/tax-calculator', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/tax-calculator')>();
  return {
    ...actual,
    calculateIncomeTax: vi.fn(actual.calculateIncomeTax),
    calculateChurchTax: vi.fn(actual.calculateChurchTax),
    calculateTradeTaxDetails: vi.fn(actual.calculateTradeTaxDetails),
  };
});

type Node = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function nodes(root: ReactNode): Node[] {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!isValidElement(root)) return [];
  const element = root as Node;
  return [element, ...nodes(element.props.children)];
}
function text(root: ReactNode): string {
  if (Array.isArray(root)) return root.map(text).join(' ');
  if (isValidElement(root)) return text((root as Node).props.children);
  return typeof root === 'string' || typeof root === 'number' ? String(root) : '';
}
function render<T>(component: () => T): T {
  hooks.index = 0;
  return component();
}
function field(root: ReactNode, id: string): Node {
  const found = nodes(root).find(node => node.props.id === id);
  expect(found, `field ${id}`).toBeDefined();
  return found!;
}
function change(root: ReactNode, id: string, value: string): void {
  const onChange = field(root, id).props.onChange as (event: unknown) => void;
  onChange({ target: { value, valueAsNumber: value === '' ? NaN : Number(value) } });
}
async function submit(root: ReactNode): Promise<void> {
  const form = nodes(root).find(node => node.type === 'form')!;
  await (form.props.onSubmit as (event: unknown) => Promise<void> | void)({ preventDefault: vi.fn() });
}

beforeEach(() => {
  hooks.states = [];
  hooks.index = 0;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('issue #21: preserve zero expense deductibility', () => {
  it.each([0, 1, 50, 100])('round-trips %s rather than using a truthy fallback', value => {
    expect(parseExpensePercentage(expensePercentageInput(value))).toBe(value);
  });
  it.each([null, undefined])('defaults only a missing legacy percentage (%s)', value => {
    expect(expensePercentageInput(value)).toBe('100');
  });
  it.each(['', ' ', 'abc', '50abc', '-1', '101', '0.5', 'Infinity', 'NaN'])('rejects invalid draft %j', value => {
    expect(parseExpensePercentage(value)).toBeNull();
  });

  function editor(percentage: number, onSave = vi.fn()) {
    const data = { description: 'Zero expense', amount: '100', date: '2026-10-20', taxRelevant: true, taxDeductiblePercentage: percentage };
    return { onSave, render: () => render(() => EditModal({ isOpen: true, onClose: vi.fn(), onSave, data, type: 'expense', customers: [] })) };
  }

  it('displays and saves an untouched stored zero in the ordinary editor', async () => {
    const view = editor(0);
    const tree = view.render();
    expect(field(tree, 'edit-taxDeductiblePercentage').props.value).toBe('0');
    await submit(tree);
    expect(view.onSave).toHaveBeenCalledWith(expect.objectContaining({ taxDeductiblePercentage: 0 }));
  });

  it('allows clearing 50 then typing 0; the blank intermediate state cannot save', async () => {
    const view = editor(50);
    let tree = view.render();
    change(tree, 'edit-taxDeductiblePercentage', '');
    tree = view.render();
    expect(field(tree, 'edit-taxDeductiblePercentage').props).toMatchObject({ value: '', required: true, 'aria-invalid': true });
    await submit(tree);
    expect(view.onSave).not.toHaveBeenCalled();
    change(tree, 'edit-taxDeductiblePercentage', '0');
    tree = view.render();
    expect(field(tree, 'edit-taxDeductiblePercentage').props.value).toBe('0');
    await submit(tree);
    expect(view.onSave).toHaveBeenCalledWith(expect.objectContaining({ taxDeductiblePercentage: 0 }));
  });

  const recurring = {
    id: 21, description: 'Recurring zero', amount: 40, category: 'Software', taxRelevant: true,
    taxDeductiblePercentage: 0, interval: 'MONTHLY', dayOfMonth: 20,
    startDate: '2026-10-20', endDate: null, lastExecuted: null,
    nextExecution: '2026-11-20', isActive: false,
  };
  function recurringView() {
    return render(() => RecurringExpensesModal({ isOpen: true, onClose: vi.fn() }));
  }
  function openRecurringEditor() {
    hooks.states[0] = [recurring];
    const tree = recurringView();
    const tooltip = nodes(tree).find(node => node.type === Tooltip && nodes(node).some(child => child.type === TooltipContent && child.props.children === 'Bearbeiten'))!;
    const edit = nodes(tooltip).find(node => node.type === Button)!;
    (edit.props.onClick as () => void)();
    return recurringView();
  }

  it('untouched recurring edit/save sends zero and keeps the EÜR deduction at zero', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const tree = openRecurringEditor();
    expect(field(tree, 'recurring-taxDeductiblePercentage').props.value).toBe('0');
    await submit(tree);
    const request = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const saved = JSON.parse(String(request[1].body));
    expect(request[1].method).toBe('PUT');
    expect(saved.taxDeductiblePercentage).toBe(0);
    const summary = buildTaxSummary({ year: 2026, timeRange: 'thisYear', incomes: [], expenses: [{ ...saved, amount: 40, date: new Date('2026-10-20') }] });
    expect(summary.totalExpenses).toBe(0);
  });

  it.each(['', '-1', '101', 'abc'])('does not send recurring invalid percentage %j', async value => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    let tree = openRecurringEditor();
    change(tree, 'recurring-taxDeductiblePercentage', value);
    tree = recurringView();
    expect(field(tree, 'recurring-taxDeductiblePercentage').props['aria-invalid']).toBe(true);
    await submit(tree);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

const defaults = {
  grossSalary: 50000, employeeExpenses: 1230, healthInsurance: 4000,
  pensionInsurance: 0, careInsurance: 1000, otherDeductions: 0,
  tradeTaxHebesatz: 400, churchTaxRate: 8,
};

describe('issue #29: numeric assumption validation', () => {
  for (const name of Object.keys(simulationNumberRules) as SimulationNumberField[]) {
    it(`${name} rejects negatives, empty/NaN and infinity, and permits zero`, () => {
      for (const value of [-1, NaN, Infinity, -Infinity]) expect(simulationNumberError(name, value)).not.toBeNull();
      expect(simulationNumberError(name, 0)).toBeNull();
    });
  }
  it('enforces both declared upper bounds and steps', () => {
    expect(simulationNumberError('churchTaxRate', 101)).not.toBeNull();
    expect(simulationNumberError('churchTaxRate', 9)).toBeNull();
    expect(simulationNumberError('churchTaxRate', 8.5)).not.toBeNull();
    expect(simulationNumberError('tradeTaxHebesatz', 1001)).not.toBeNull();
    expect(simulationNumberError('tradeTaxHebesatz', 1000)).toBeNull();
    expect(simulationNumberError('tradeTaxHebesatz', 405)).not.toBeNull();
  });
  it('accepts money cents and rounded automatic contributions', () => {
    expect(simulationNumberError('grossSalary', 50123.45)).toBeNull();
    expect(simulationNumberError('healthInsurance', 4075)).toBeNull();
    expect(simulationNumberError('careInsurance', 1.001)).not.toBeNull();
  });
  it('ignores disabled church tax and hidden employment values, but validates them on reactivation', () => {
    const invalid = { ...defaults, churchTaxRate: 101, grossSalary: NaN, employeeExpenses: -1 };
    expect(simulationInputErrors(invalid, { sideBusiness: false, includeChurchTax: false })).toEqual([]);
    expect(simulationInputErrors(invalid, { sideBusiness: true, includeChurchTax: true })).toHaveLength(3);
  });

  function simulation() {
    return render(() => SteuerSimulationPage());
  }
  function readySimulation() {
    hooks.states[0] = buildTaxSummary({ year: 2026, timeRange: 'thisYear', incomes: [{ amount: 50000, date: new Date('2026-10-20'), taxRelevant: true }], expenses: [] });
    hooks.states[1] = false;
    hooks.states[4] = 2026;
    return simulation();
  }
  function numericInput(root: ReactNode, id: string): Node {
    const wrapper = field(root, id);
    const expanded = (wrapper.type as (props: unknown) => ReactNode)(wrapper.props);
    return nodes(expanded).find(node => node.type === Input)!;
  }

  it('shows unavailable fiscal source values after a guarded failure, not invented zero receipts/profit/counts', () => {
    hooks.states[0] = null; hooks.states[1] = false; hooks.states[2] = 'Zahlungszuordnung fachlich prüfen.';
    const tree = simulation(), source = nodes(tree).find(node => node.props['aria-labelledby'] === 'overview-heading')!;
    const sourceText = text(source);
    expect(sourceText).toContain('Nicht verfügbar / fachlich zu prüfen');
    expect(sourceText).toContain('Keine bestätigte steuerliche Datenbasis');
    expect(sourceText).not.toContain('0,00'); expect(sourceText).not.toContain('Buchungen 0');
    expect(calculateIncomeTax).not.toHaveBeenCalled();
  });

  it.each(['loading', 'failed', 'partial-year'])('does not suggest tax optimizations from an unavailable or unsupported basis (%s)', state => {
    hooks.states[0] = state === 'failed' ? null : buildTaxSummary({ year: 2026, timeRange: state === 'partial-year' ? 'last3Months' : 'thisYear', incomes: [], expenses: [] });
    hooks.states[1] = state === 'loading';
    hooks.states[2] = state === 'failed' ? 'Daten nicht verfügbar' : null;
    const panel = nodes(simulation()).find(node => node.props['aria-labelledby'] === 'recommendations-heading')!;
    expect(text(panel)).toContain('vollständiges Steuerjahr');
    expect(nodes(panel).filter(node => node.type === 'li')).toHaveLength(0);
  });

  it('keeps a genuinely loaded zero distinct from unavailable fiscal data', () => {
    hooks.states[0] = buildTaxSummary({ year: 2026, timeRange: 'thisYear', incomes: [], expenses: [] });
    hooks.states[1] = false;
    const source = nodes(simulation()).find(node => node.props['aria-labelledby'] === 'overview-heading')!;
    expect(text(source)).toContain('0,00'); expect(text(source)).not.toContain('Nicht verfügbar');
  });

  it.each([
    ['churchTaxRate', '101'], ['healthInsurance', '-4000'], ['pensionInsurance', '-1'],
    ['careInsurance', '-1'], ['otherDeductions', '-1'], ['tradeTaxHebesatz', '1001'],
    ['grossSalary', '-1'], ['employeeExpenses', '-1'], ['healthInsurance', ''],
  ])('suppresses all calculations and recommendations for %s=%j, then recovers', (id, value) => {
    let tree = readySimulation();
    hooks.states[12] = true; // Church tax enabled.
    hooks.states[14] = 'side-business';
    tree = simulation();
    change(tree, id, value);
    vi.clearAllMocks();
    tree = simulation();
    const input = numericInput(tree, id);
    expect(input.props['aria-invalid']).toBe(true);
    expect(input.props['aria-describedby']).toBe(`${id}-error`);
    expect(input.props.required).toBe(true);
    expect(text(tree)).toContain('Bitte korrigieren Sie die markierten Eingaben');
    expect(text(tree)).toContain('nicht berechnet');
    expect(text(tree)).not.toContain('Hohe Grenzsteuerbelastung');
    expect(text(tree)).not.toContain('Keine weiteren Hinweise');
    expect(calculateIncomeTax).not.toHaveBeenCalled();
    expect(calculateChurchTax).not.toHaveBeenCalled();
    expect(calculateTradeTaxDetails).not.toHaveBeenCalled();
    change(tree, id, String(defaults[id as SimulationNumberField]));
    tree = simulation();
    expect(numericInput(tree, id).props['aria-invalid']).toBe(false);
    expect(text(tree)).not.toContain('Bitte korrigieren Sie die markierten Eingaben');
    expect(calculateIncomeTax).toHaveBeenCalled();
  });

  it('Standardwerte clears invalid assumptions and restores a valid simulation', () => {
    let tree = readySimulation();
    change(tree, 'healthInsurance', '-4000');
    tree = simulation();
    const reset = nodes(tree).find(node => node.type === Button && text(node) === 'Standardwerte')!;
    (reset.props.onClick as () => void)();
    tree = simulation();
    expect(numericInput(tree, 'healthInsurance').props.value).toBe(4000);
    expect(text(tree)).not.toContain('Bitte korrigieren Sie die markierten Eingaben');
    expect(calculateIncomeTax).toHaveBeenCalled();
  });
});
