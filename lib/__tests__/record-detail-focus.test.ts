import { describe, expect, it, vi } from 'vitest';
import { restoreRecordDetailFocus } from '@/lib/record-search/detail-focus';

function target(connected = true) {
  const opener = { isConnected: connected, focus: vi.fn(), getClientRects: () => [{}], matches: () => false, closest: () => null,
    ownerDocument: { defaultView: { getComputedStyle: () => ({ visibility: 'visible' }) } } };
  return opener as unknown as HTMLElement;
}

describe('programmatic record detail focus return', () => {
  it('returns an ordinary close to the connected row, without scrolling', () => {
    const opener = target();
    const body = {} as HTMLElement;
    restoreRecordDetailFocus(opener, null, { activeElement: body, body });
    expect(opener.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  });
  it('allows focus still in the closing dialog but never steals a newer control or chooser', () => {
    const opener = target();
    const body = {} as HTMLElement, input = {} as HTMLElement, chooser = {} as HTMLElement;
    const content = { contains: (element: unknown) => element === input } as unknown as HTMLElement;
    restoreRecordDetailFocus(opener, content, { activeElement: input, body });
    expect(opener.focus).toHaveBeenCalledTimes(1);
    restoreRecordDetailFocus(opener, content, { activeElement: chooser, body });
    expect(opener.focus).toHaveBeenCalledTimes(1);
  });
  it('does not revive detached source rows after navigation/account replacement', () => {
    const opener = target(false);
    const body = {} as HTMLElement;
    restoreRecordDetailFocus(opener, null, { activeElement: body, body });
    restoreRecordDetailFocus(null, null, { activeElement: body, body });
    expect(opener.focus).not.toHaveBeenCalled();
  });
});
