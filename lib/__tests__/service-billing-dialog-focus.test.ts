import { describe, expect, it, vi } from 'vitest';
import { captureServiceDialogOpener, restoreServiceDialogOpener } from '@/components/service-billing/service-dialog-focus';

// Pure element fixtures only. No DOM, browser, app server or network is started.
class FocusTarget {
  isConnected = true;
  rectCount = 1;
  visibility = 'visible';
  disabled = false;
  inDialog = false;
  blockedAncestor = false;
  ownerDocument!: Document;
  focus = vi.fn();
  getClientRects() { return { length: this.rectCount } as DOMRectList; }
  matches() { return this.disabled; }
  closest(selector: string) {
    const blocked = selector === '[role="dialog"]' ? this.inDialog : this.inDialog || this.blockedAncestor;
    return blocked ? this as unknown as Element : null;
  }
}
function fixture() {
  const opener = new FocusTarget();
  const body = new FocusTarget();
  const document = {
    activeElement: opener, body,
    defaultView: { HTMLElement: FocusTarget, getComputedStyle: (element: FocusTarget) => ({ visibility: element.visibility }) },
  } as unknown as Document;
  opener.ownerDocument = document;
  body.ownerDocument = document;
  return { opener, body, document, element: opener as unknown as HTMLElement };
}

describe('controlled service dialog opener focus', () => {
  it('captures an outside connected HTMLElement without changing initial focus', () => {
    const { opener, document, element } = fixture();
    expect(captureServiceDialogOpener(document)).toBe(element);
    expect(opener.focus).not.toHaveBeenCalled();
  });
  it.each(['body', 'disconnected', 'inside-dialog', 'non-html', 'no-window'] as const)('does not capture %s as an opener', kind => {
    const { opener, body, document } = fixture();
    if (kind === 'body') Object.defineProperty(document, 'activeElement', { value: body });
    if (kind === 'disconnected') opener.isConnected = false;
    if (kind === 'inside-dialog') opener.inDialog = true;
    if (kind === 'non-html') Object.defineProperty(document, 'activeElement', { value: {} });
    if (kind === 'no-window') Object.defineProperty(document, 'defaultView', { value: null });
    expect(captureServiceDialogOpener(document)).toBeNull();
  });
  it('restores a still-usable opener without scrolling the list', () => {
    const { opener, element } = fixture();
    const matches = vi.spyOn(opener, 'matches');
    const closest = vi.spyOn(opener, 'closest');
    restoreServiceDialogOpener(element);
    expect(opener.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(matches).toHaveBeenCalledWith(':disabled, [aria-disabled="true"]');
    expect(closest).toHaveBeenCalledWith('[inert], [hidden], [aria-hidden="true"], [role="dialog"], [role="menu"]');
  });
  it.each(['disconnected', 'no-layout', 'hidden', 'collapsed', 'disabled', 'inert-or-hidden-ancestor', 'inside-dialog', 'no-window'] as const)('does not restore a %s opener', kind => {
    const { opener, document, element } = fixture();
    if (kind === 'disconnected') opener.isConnected = false;
    if (kind === 'no-layout') opener.rectCount = 0;
    if (kind === 'hidden') opener.visibility = 'hidden';
    if (kind === 'collapsed') opener.visibility = 'collapse';
    if (kind === 'disabled') opener.disabled = true;
    if (kind === 'inert-or-hidden-ancestor') opener.blockedAncestor = true;
    if (kind === 'inside-dialog') opener.inDialog = true;
    if (kind === 'no-window') Object.defineProperty(document, 'defaultView', { value: null });
    restoreServiceDialogOpener(element);
    expect(opener.focus).not.toHaveBeenCalled();
  });
  it('does nothing when success or teardown already cleared the opener', () => {
    expect(() => restoreServiceDialogOpener(null)).not.toThrow();
  });
});
