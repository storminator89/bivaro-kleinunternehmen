import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSwitchingReview, createSwitchingState, switchingTopics } from '@/lib/switching-checklist';

// A bounded hook/DOM mock: exercise production handlers, not browser layout,
// native keyboard behavior, server access or actual filesystem downloads.
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[] }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.slots[index], (value: unknown) => {
      hooks.slots[index] = typeof value === 'function' ? value(hooks.slots[index]) : value;
    }];
  },
}));
import { SwitchingChecklist } from '@/components/public-accounting/switching-checklist';

type Node = ReactElement<Record<string, unknown>>;
let tree: Node;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children as ReactNode)];
}
function find(predicate: (node: Node) => boolean): Node {
  const result = nodes(tree).find(predicate);
  expect(result).toBeDefined();
  return result!;
}
function render() { hooks.cursor = 0; tree = SwitchingChecklist() as Node; }
function change(id: string, value: string) {
  const node = find(node => node.type === 'select' && node.props.id === `umstieg-${id}`);
  (node.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
  render();
}
function click(label: string) {
  const node = find(node => node.type === 'button' && node.props.children === label);
  (node.props.onClick as () => void)();
  render();
}
function reviewText() { return find(node => node.props.id === 'umstieg-review-text').props.value; }
function noticeText() { return find(node => node.type === 'p' && node.props.role === 'status').props.children; }
const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
const appendChild = vi.fn();

beforeEach(() => {
  hooks.cursor = 0; hooks.slots = [];
  anchor.href = ''; anchor.download = ''; anchor.click.mockReset(); anchor.remove.mockReset(); appendChild.mockReset();
  vi.useFakeTimers();
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic-review');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.stubGlobal('document', { createElement: vi.fn(() => anchor), body: { appendChild } });
  render();
});
afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('synthetic switching-checklist component handlers', () => {
  it('keeps distinct statuses, rejects unsupported values and derives the copy from current state', () => {
    change('company', 'prepared'); change('open-items', 'review'); change('numbers', 'verified');
    expect(find(node => node.props.id === 'umstieg-company').props.value).toBe('prepared');
    expect(find(node => node.props.id === 'umstieg-open-items').props.value).toBe('review');
    expect(find(node => node.props.id === 'umstieg-numbers').props.value).toBe('open');
    expect(reviewText()).toContain('Selbst vorbereitet: 1 von 6 · Noch offen: 4 · Prüfbedarf: 1');
    expect(nodes(tree).some(node => node.props.children === 'Prüfbedarf zuerst mit Betreiber oder fachlicher Prüfstelle klären. Nicht als Umstiegsfreigabe behandeln.')).toBe(true);
  });

  it('retains the manual approval gate even when all six selections are prepared', () => {
    for (const topic of switchingTopics) change(topic.id, 'prepared');
    expect(reviewText()).toContain('Selbst vorbereitet: 6 von 6');
    expect(nodes(tree).some(node => node.props.children === 'Die Selbsteinschätzung ist ausgefüllt. Der manuelle Review und die Entscheidung über den Umstieg bleiben offen.')).toBe(true);
  });

  it('requests exactly the current local text and disposes every temporary download handle', async () => {
    change('numbers', 'review'); change('start-date', 'prepared');
    const expected = reviewText();
    click('Reviewbogen herunterladen (.txt)');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(blob.type).toBe('text/plain;charset=utf-8');
    expect(await blob.text()).toBe(expected);
    expect(anchor.href).toBe('blob:synthetic-review');
    expect(anchor.download).toBe('bivaro-manueller-umstiegsreview.txt');
    expect(appendChild).toHaveBeenCalledExactlyOnceWith(anchor);
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(anchor.remove).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:synthetic-review');
    expect(noticeText()).toContain('Falls keine Datei erscheint');
  });

  it.each(['object-url', 'click'] as const)('keeps the readable fallback and choices after %s failure', failure => {
    change('control-totals', 'review');
    const expected = reviewText();
    if (failure === 'object-url') vi.mocked(URL.createObjectURL).mockImplementation(() => { throw new Error('synthetic failure'); });
    else anchor.click.mockImplementation(() => { throw new Error('synthetic failure'); });
    click('Reviewbogen herunterladen (.txt)');
    expect(noticeText()).toContain('Download nicht verfügbar');
    expect(reviewText()).toBe(expected);
    expect(find(node => node.props.id === 'umstieg-control-totals').props.value).toBe('review');
    if (failure === 'click') {
      expect(anchor.remove).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1000);
      expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:synthetic-review');
    } else expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('keeps repeated downloads independent and exports the updated state on the next click', async () => {
    vi.mocked(URL.createObjectURL).mockReturnValueOnce('blob:first-review').mockReturnValueOnce('blob:second-review');
    click('Reviewbogen herunterladen (.txt)');
    const first = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    change('company', 'prepared');
    expect(noticeText()).toBe('');
    click('Reviewbogen herunterladen (.txt)');
    const second = vi.mocked(URL.createObjectURL).mock.calls[1][0] as Blob;
    expect(await first.text()).toContain('Selbst vorbereitet: 0 von 6');
    expect(await second.text()).toContain('Selbst vorbereitet: 1 von 6');
    expect(anchor.remove).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(vi.mocked(URL.revokeObjectURL).mock.calls).toEqual([['blob:first-review'], ['blob:second-review']]);
  });

  it('resets every selection and freshly mounted state without changing earlier downloaded content', async () => {
    for (const topic of switchingTopics) change(topic.id, 'prepared');
    click('Reviewbogen herunterladen (.txt)');
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    click('Auswahl zurücksetzen');
    expect(reviewText()).toBe(createSwitchingReview(createSwitchingState()));
    expect(noticeText()).toContain('Alle sechs Statusangaben');
    expect(await blob.text()).toContain('Selbst vorbereitet: 6 von 6');
    change('company', 'review');
    hooks.slots = []; render();
    expect(reviewText()).toBe(createSwitchingReview(createSwitchingState()));
    expect(noticeText()).toBe('');
  });
});
