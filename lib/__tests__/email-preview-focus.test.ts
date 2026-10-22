import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';

// Pure component-handler tests: no browser, server, fetch, SMTP or database.
// Keep committed open transitions and Radix's delayed close autofocus separate.
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], layout: [] as (() => void)[] }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const useState = (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.slots[index], (value: unknown) => { hooks.slots[index] = typeof value === 'function' ? value(hooks.slots[index]) : value; }];
  };
  const useRef = (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  };
  const useLayoutEffect = (callback: () => void, dependencies: unknown[]) => {
    const index = hooks.cursor++, previous = hooks.slots[index] as unknown[] | undefined;
    if (!previous || dependencies.some((value, position) => !Object.is(value, previous[position]))) {
      hooks.slots[index] = dependencies;
      hooks.layout.push(callback);
    }
  };
  return { ...actual, default: { ...actual, useState, useRef, useLayoutEffect }, useState, useRef, useLayoutEffect, useEffect: vi.fn() };
});

import { EmailPreviewDialog } from '@/components/dashboard/email-preview-dialog';
import { InvoicesTab } from '@/components/dashboard/tabs/invoices-tab';
import { QuotesTab } from '@/components/dashboard/tabs/quotes-tab';
import { DialogContent } from '@/components/ui/dialog';
import { DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

type Node = ReactElement<Record<string, unknown>>;
function nodes(tree: ReactNode): Node[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...nodes(tree.props.children as ReactNode)];
}
function find(tree: ReactNode, predicate: (node: Node) => boolean): Node {
  const node = nodes(tree).find(predicate);
  expect(node).toBeDefined();
  return node!;
}
function render<T>(component: (props: T) => ReactNode, props: T) {
  hooks.cursor = 0;
  const tree = component(props);
  hooks.layout.splice(0).forEach(callback => callback());
  return tree;
}
function target(options: { connected?: boolean; visible?: boolean; visibility?: string; disabled?: boolean; excludedAncestor?: boolean } = {}) {
  return {
    isConnected: options.connected ?? true,
    visibility: options.visibility ?? 'visible',
    getClientRects: () => options.visible === false ? [] : [{}],
    matches: vi.fn(() => options.disabled ?? false),
    closest: vi.fn(() => options.excludedAncestor ? {} : null),
    focus: vi.fn(),
  } as unknown as HTMLElement;
}
function closeAutoFocus(node: Node, scope: Pick<HTMLElement, 'contains'> | null = null) {
  const event = { preventDefault: vi.fn(), currentTarget: scope };
  (node.props.onCloseAutoFocus as (event: Event) => void)(event as unknown as Event);
  return event;
}
function dialog(props: Partial<ComponentProps<typeof EmailPreviewDialog>> = {}) {
  const tree = render(EmailPreviewDialog, {
    open: true, onOpenChange: vi.fn(), documentType: 'invoice', documentId: 120,
    returnFocusRef: { current: target() }, ...props,
  });
  return find(tree, node => node.type === DialogContent);
}

let querySelectorAll: ReturnType<typeof vi.fn>;
let body: HTMLElement, documentElement: HTMLElement, activeElement: HTMLElement | null;
beforeEach(() => {
  hooks.cursor = 0; hooks.slots = []; hooks.layout = [];
  querySelectorAll = vi.fn(() => []);
  body = target(); documentElement = target(); activeElement = body;
  vi.stubGlobal('document', { querySelectorAll, body, documentElement, get activeElement() { return activeElement; } });
  vi.stubGlobal('getComputedStyle', (element: { visibility: string }) => ({ visibility: element.visibility }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('email dialog explicit return-focus ownership (#127)', () => {
  it('keeps default opening autofocus, then returns to the captured invoker without scrolling', () => {
    const original = target(), transientMenuItem = target({ excludedAncestor: true });
    const returnFocusRef = { current: original };
    const content = dialog({ returnFocusRef });
    expect(content.props.onOpenAutoFocus).toBeUndefined();
    expect(original.focus).not.toHaveBeenCalled();
    // Do not consult activeElement (which may now be a dialog/menu control).
    returnFocusRef.current = transientMenuItem;
    const closed = dialog({ open: false, documentId: null, returnFocusRef });
    expect(closeAutoFocus(closed).preventDefault).toHaveBeenCalledExactlyOnceWith();
    expect(original.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(transientMenuItem.focus).not.toHaveBeenCalled();
    expect(querySelectorAll).not.toHaveBeenCalled();
  });

  it.each([
    { connected: false }, { visible: false }, { visibility: 'hidden' },
    { disabled: true }, { excludedAncestor: true },
  ])('rejects an unavailable invoker %j and skips hidden/detached responsive copies', options => {
    const original = target(options), hidden = target({ visible: false }), detached = target({ connected: false }), replacement = target();
    const returnFocusRef = { current: original };
    dialog({ returnFocusRef });
    const closed = dialog({ open: false, documentId: null, returnFocusRef });
    querySelectorAll.mockReturnValue([hidden, detached, replacement]);
    closeAutoFocus(closed);
    expect(querySelectorAll).toHaveBeenCalledExactlyOnceWith('[data-email-preview-return="invoice:120"]');
    expect(replacement.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    for (const unavailable of [original, hidden, detached]) expect(unavailable.focus).not.toHaveBeenCalled();
  });

  it('retains the opened document identity after the controlled caller clears it on close', () => {
    const returnFocusRef = { current: target({ connected: false }) }, replacement = target();
    dialog({ documentType: 'quote', documentId: 42, returnFocusRef });
    const closedContent = dialog({ open: false, documentType: 'quote', documentId: null, returnFocusRef });
    querySelectorAll.mockReturnValue([replacement]);
    closeAutoFocus(closedContent);
    expect(querySelectorAll).toHaveBeenCalledExactlyOnceWith('[data-email-preview-return="quote:42"]');
    expect(replacement.focus).toHaveBeenCalledTimes(1);
  });

  it('safely leaves removed documents alone instead of choosing another document or arbitrary button', () => {
    const original = target({ connected: false }), unrelated = target();
    const returnFocusRef = { current: original };
    dialog({ returnFocusRef });
    closeAutoFocus(dialog({ open: false, documentId: null, returnFocusRef }));
    expect(querySelectorAll).toHaveBeenCalledExactlyOnceWith('[data-email-preview-return="invoice:120"]');
    expect(original.focus).not.toHaveBeenCalled(); expect(unrelated.focus).not.toHaveBeenCalled();
  });

  it.each([null, -1, 0, NaN, 1.5])('does not query an invalid document identity %s', documentId => {
    const returnFocusRef = { current: null };
    dialog({ documentId, returnFocusRef });
    closeAutoFocus(dialog({ open: false, documentId: null, returnFocusRef }));
    expect(querySelectorAll).not.toHaveBeenCalled();
  });

  it('reopens for a new invoker without retaining the old document or focusing twice', () => {
    const first = target(), second = target();
    const returnFocusRef = { current: first };
    dialog({ returnFocusRef });
    const closed = dialog({ open: false, documentId: null, returnFocusRef });
    closeAutoFocus(closed); closeAutoFocus(closed);
    returnFocusRef.current = second;
    dialog({ documentId: 121, returnFocusRef });
    closeAutoFocus(dialog({ open: false, documentId: null, returnFocusRef }));
    expect(first.focus).toHaveBeenCalledTimes(1); expect(second.focus).toHaveBeenCalledTimes(1);
  });

  it('ignores an old delayed close while reopened and preserves the new origin for its own close', () => {
    const first = target(), second = target();
    const returnFocusRef = { current: first };
    dialog({ returnFocusRef });
    const oldClosed = dialog({ open: false, documentId: null, returnFocusRef });
    returnFocusRef.current = second;
    // This opening need not remount Radix content or fire onOpenAutoFocus.
    dialog({ documentId: 121, returnFocusRef });
    closeAutoFocus(oldClosed);
    expect(first.focus).not.toHaveBeenCalled(); expect(second.focus).not.toHaveBeenCalled();
    closeAutoFocus(dialog({ open: false, documentId: null, returnFocusRef }));
    expect(first.focus).not.toHaveBeenCalled();
    expect(second.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  });

  it.each(['captured', 'replacement'])('preserves a later outside control instead of restoring the %s invoker', mode => {
    const original = target({ connected: mode === 'captured' }), replacement = target(), laterControl = target();
    const returnFocusRef = { current: original };
    dialog({ returnFocusRef });
    const closed = dialog({ open: false, documentId: null, returnFocusRef });
    querySelectorAll.mockReturnValue([replacement]);
    activeElement = laterControl;
    const scope = { contains: vi.fn(() => false) };
    expect(closeAutoFocus(closed, scope).preventDefault).toHaveBeenCalledExactlyOnceWith();
    expect(activeElement).toBe(laterControl);
    expect(scope.contains).toHaveBeenCalledExactlyOnceWith(laterControl);
    expect(querySelectorAll).not.toHaveBeenCalled();
    expect(original.focus).not.toHaveBeenCalled(); expect(replacement.focus).not.toHaveBeenCalled();
    // This close is finished; a duplicate callback must not restore it later.
    activeElement = body;
    closeAutoFocus(closed, scope);
    expect(original.focus).not.toHaveBeenCalled(); expect(replacement.focus).not.toHaveBeenCalled();
  });

  it.each(['body', 'root', 'absent', 'detached', 'closing-scope'])('still restores normal Escape/close focus from %s', mode => {
    const original = target(), closingControl = target({ connected: mode !== 'detached' });
    const returnFocusRef = { current: original };
    dialog({ returnFocusRef });
    const closed = dialog({ open: false, documentId: null, returnFocusRef });
    activeElement = mode === 'body' ? body : mode === 'root' ? documentElement : mode === 'absent' ? null : closingControl;
    const scope = { contains: vi.fn((node: unknown) => mode === 'closing-scope' && node === closingControl) };
    closeAutoFocus(closed, scope);
    expect(original.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  });
});

const invoiceProps: ComponentProps<typeof InvoicesTab> = {
  invoices: [{ id: 120, invoiceNumber: 'OUTBOX-DESKTOP-120', fileName: 'synthetic.pdf', uploadedAt: '2026-10-22', status: 'SENT' }],
  selectedFile: null, isUploading: false, onFileChange: vi.fn(), onFileUpload: vi.fn(), onOpenCreateModal: vi.fn(),
  filters: { searchTerm: '', paidStatus: 'all', dateRange: 'all', sortBy: 'date', sortOrder: 'desc' },
  setFilters: vi.fn(), page: 1, pageSize: 20, total: 1, totalPages: 1,
  onPageChange: vi.fn(), onPageSizeChange: vi.fn(), loadInvoices: vi.fn(), onViewReceipt: vi.fn(),
  onOpenDetails: vi.fn(), onStatusChange: vi.fn(), onCancel: vi.fn(), onDelete: vi.fn(), isDeleting: false,
};
const quoteProps: ComponentProps<typeof QuotesTab> = {
  quotes: [{ id: 42, invoiceNumber: 'QUOTE-42', fileName: 'synthetic.pdf', uploadedAt: '2026-10-22', status: 'SENT' }],
  total: 1, page: 1, pageSize: 20, totalPages: 1, statusFilter: 'all', searchTerm: '',
  onPageChange: vi.fn(), onPageSizeChange: vi.fn(), onStatusFilterChange: vi.fn(), onSearchChange: vi.fn(),
  onOpenCreateModal: vi.fn(), onStatusChange: vi.fn(), onConvertToInvoice: vi.fn(), onDelete: vi.fn(), loadQuotes: vi.fn(),
};

describe('all shared email-dialog invokers retain their own responsive control', () => {
  it.each(['onPointerDown', 'onKeyDown'] as const)('captures the invoice menu trigger for %s on both layouts', handler => {
    let tree = render(InvoicesTab, invoiceProps);
    const triggers = nodes(tree).filter(node => node.type === DropdownMenuTrigger);
    expect(triggers).toHaveLength(2);
    for (const [index, trigger] of triggers.entries()) {
      const original = target();
      (trigger.props[handler] as (event: { currentTarget: HTMLElement }) => void)({ currentTarget: original });
      const emailItem = nodes(tree).filter(node => typeof node.props.onSelect === 'function' && Array.isArray(node.props.children) && node.props.children.includes('Per E-Mail senden'))[index];
      expect(emailItem).toBeDefined();
      (emailItem.props.onSelect as () => void)();
      tree = render(InvoicesTab, invoiceProps);
      const preview = find(tree, node => node.type === EmailPreviewDialog);
      expect(preview.props.open).toBe(true); expect(preview.props.documentId).toBe(120);
      expect((preview.props.returnFocusRef as { current: HTMLElement }).current).toBe(original);
      expect(nodes(trigger).some(node => node.props['data-email-preview-return'] === 'invoice:120')).toBe(true);
    }
  });

  it('captures each direct quote email button, not its icon or a hidden responsive duplicate', () => {
    let tree = render(QuotesTab, quoteProps);
    const buttons = nodes(tree).filter(node => node.props['data-email-preview-return'] === 'quote:42');
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      const original = target();
      (button.props.onClick as (event: { currentTarget: HTMLElement }) => void)({ currentTarget: original });
      tree = render(QuotesTab, quoteProps);
      const preview = find(tree, node => node.type === EmailPreviewDialog);
      expect(preview.props.open).toBe(true); expect(preview.props.documentId).toBe(42);
      expect((preview.props.returnFocusRef as { current: HTMLElement }).current).toBe(original);
    }
  });
});
