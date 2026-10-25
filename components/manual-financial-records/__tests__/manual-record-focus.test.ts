import { describe, expect, it, vi } from 'vitest';
import { manualRecordOpenerKey, manualRecordReturnTarget, preventManualRecordOutsideFocus } from '../manual-record-focus';

// Authored only: no local DOM, browser or functional execution is authorized.
function element(options: { key?: string; connected?: boolean; visible?: boolean; disabled?: boolean; dialog?: boolean } = {}) {
  return { isConnected: options.connected ?? true, getClientRects: () => options.visible === false ? [] : [{}],
    getAttribute: () => options.key ?? 'expense:7', matches: () => options.disabled ?? false,
    closest: () => options.dialog ? {} : null, focus: vi.fn() } as unknown as HTMLElement;
}
function documentWith(elements: HTMLElement[]) {
  return { body: element(), querySelectorAll: vi.fn(() => elements) } as unknown as Document;
}
describe('manual-record semantic focus restoration', () => {
  it('preserves the real live same-record invoker without querying another control', () => {
    const opener = element(), root = documentWith([element()]);
    expect(manualRecordReturnTarget('expense', 7, opener, root)).toBe(opener);
    expect(root.querySelectorAll).not.toHaveBeenCalled(); expect(opener.focus).not.toHaveBeenCalled();
  });
  it('finds the current same-record visible opener after FINALIZED replaces the old expense row subtree', () => {
    const detached = element({ connected: false }), hiddenMobile = element({ visible: false }), currentDesktop = element();
    const root = documentWith([hiddenMobile, currentDesktop]);
    expect(manualRecordReturnTarget('expense', 7, detached, root)).toBe(currentDesktop);
    expect(root.querySelectorAll).toHaveBeenCalledExactlyOnceWith('[data-manual-record-opener="expense:7"]');
    expect(detached.focus).not.toHaveBeenCalled();
  });
  it.each([{ visible: false }, { disabled: true }, { dialog: true }, { key: 'income:7' }, { key: 'expense:8' }])('rejects an unusable or foreign captured opener %j', options => {
    const current = element(), root = documentWith([current]);
    expect(manualRecordReturnTarget('expense', 7, element(options), root)).toBe(current);
  });
  it('never substitutes an unrelated financial record, generic page control or invalid ID', () => {
    const root = documentWith([element({ key: 'income:7' }), element({ key: 'expense:8' })]);
    expect(manualRecordReturnTarget('expense', 7, null, root)).toBeNull();
    expect(manualRecordReturnTarget('expense', 0, null, root)).toBeNull();
    expect(manualRecordOpenerKey('income', 7)).not.toBe(manualRecordOpenerKey('expense', 7));
  });
  it('cancels BOTH Radix dismiss and native pointer focus before mounting a dirty-exit warning', () => {
    const order: string[] = [];
    const dismiss = vi.fn(() => order.push('custom-dismiss'));
    const pointer = vi.fn(() => order.push('native-pointer-focus'));
    preventManualRecordOutsideFocus({ preventDefault: dismiss, detail: { originalEvent: { preventDefault: pointer } } });
    expect(order).toEqual(['custom-dismiss', 'native-pointer-focus']);
    expect(dismiss).toHaveBeenCalledTimes(1); expect(pointer).toHaveBeenCalledTimes(1);
  });
});
