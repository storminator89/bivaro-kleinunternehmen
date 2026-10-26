import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { paymentConfirmationStillOwnsFocus, paymentDialogReturnTarget } from '@/lib/payment-dialog-focus';
import { StatusBadge } from '@/components/dashboard/status-badge';

function element(options: { connected?: boolean; visible?: boolean; disabled?: boolean; inside?: 'dialog' | 'menu' } = {}) {
  return {
    isConnected: options.connected ?? true,
    getClientRects: () => options.visible === false ? [] : [{}],
    matches: () => options.disabled ?? false,
    closest: () => options.inside ? {} : null,
    focus: vi.fn(),
  } as unknown as HTMLElement;
}
function fixture(rows: Record<string, HTMLElement[]>) {
  const body = element();
  const querySelectorAll = vi.fn((selector: string) => rows[selector] ?? []);
  return { body, querySelectorAll } as unknown as Document;
}
const trigger = '[data-invoice-payment-return="7"]';
const anchor = '[data-invoice-return="7"]';

describe('saved payment completion visibility does not take focus back', () => {
  it('permits a reflow scroll only while the live rendered saved proof still owns focus', () => {
    const confirmation = element();
    expect(paymentConfirmationStillOwnsFocus(confirmation, { activeElement: confirmation })).toBe(true);
    expect(confirmation.focus).not.toHaveBeenCalled();
  });
  it('refuses to interfere when the user has advanced to Close, history or another control', () => {
    const confirmation = element(), userControl = element();
    for (const activeElement of [userControl, null]) expect(paymentConfirmationStillOwnsFocus(confirmation, { activeElement })).toBe(false);
    expect(confirmation.focus).not.toHaveBeenCalled(); expect(userControl.focus).not.toHaveBeenCalled();
  });
  it.each([{ connected: false }, { visible: false }])('does not scroll unavailable saved proof %j', options => {
    const confirmation = element(options);
    expect(paymentConfirmationStillOwnsFocus(confirmation, { activeElement: confirmation })).toBe(false);
    expect(paymentConfirmationStillOwnsFocus(null, { activeElement: confirmation })).toBe(false);
  });
  it('keeps immediate confirmation focus but only conditionally scrolls after journal completion, never refocusing', () => {
    const dialog = readFileSync('components/dashboard/full-payment-dialog.tsx', 'utf8');
    expect(dialog).toContain('useEffect(() => { if (confirmed) successRef.current?.focus(); }, [confirmed])');
    const reflow = dialog.slice(dialog.indexOf('if (!confirmed || isLoading) return;'), dialog.indexOf('}, [confirmed, isLoading, adjustmentJournal])'));
    expect(reflow).toContain("paymentConfirmationStillOwnsFocus(confirmation)) confirmation.scrollIntoView({ block: 'nearest', inline: 'nearest' })");
    expect(reflow).not.toContain('.focus(');
  });
});

describe('payment dialog focus return stays with the same invoice', () => {
  it('preserves a connected, visible, enabled legitimate invoker without querying other controls', () => {
    const details = element(), status = element();
    const root = fixture({ [trigger]: [status] });
    expect(paymentDialogReturnTarget(7, details, root)).toBe(details);
    expect(root.querySelectorAll).not.toHaveBeenCalled();
    expect(details.focus).not.toHaveBeenCalled(); // Pure resolution never mutates financial/UI state.
  });
  it.each([
    { connected: false }, { visible: false }, { disabled: true }, { inside: 'menu' as const }, { inside: 'dialog' as const },
  ])('rejects an unavailable captured origin %j and prefers the same-invoice status trigger', options => {
    const stale = element(options), status = element(), search = element(), earlierMainButton = element();
    const root = fixture({ [trigger]: [status], '#invoice-search': [search], 'main button': [earlierMainButton] });
    expect(paymentDialogReturnTarget(7, stale, root)).toBe(status);
    expect(root.querySelectorAll).toHaveBeenCalledWith(trigger);
    expect(root.querySelectorAll).not.toHaveBeenCalledWith('main button');
  });
  it('rejects body capture and hidden responsive copies, resolving the newly rendered visible invoice trigger', () => {
    const hiddenMobile = element({ visible: false }), detachedOldRow = element({ connected: false }), visibleDesktop = element();
    const root = fixture({ [trigger]: [hiddenMobile, detachedOldRow, visibleDesktop] });
    expect(paymentDialogReturnTarget(7, root.body, root)).toBe(visibleDesktop);
    expect(paymentDialogReturnTarget(7, detachedOldRow, root)).toBe(visibleDesktop);
  });
  it('tries the same-invoice anchor before search or generic buttons when the status trigger is unavailable', () => {
    const details = element(), generic = element(), search = element();
    const root = fixture({ [trigger]: [element({ disabled: true })], [anchor]: [details], '#invoice-search': [search], 'main button': [generic] });
    expect(paymentDialogReturnTarget(7, null, root)).toBe(details);
    expect(root.querySelectorAll).not.toHaveBeenCalledWith('main button');
  });
  it('prefers search to generic document-order buttons and returns null if no usable control exists', () => {
    const search = element(), generic = element();
    const root = fixture({ [anchor]: [element({ visible: false })], '#invoice-search': [search], 'main button': [generic] });
    expect(paymentDialogReturnTarget(7, null, root)).toBe(search);
    expect(paymentDialogReturnTarget(7, null, fixture({ 'main button': [element({ inside: 'dialog' })] }))).toBeNull();
  });
  it('renders the explicit invoice trigger marker and wires both responsive invoice layouts without weakening the Escape journey', () => {
    const html = renderToStaticMarkup(createElement(StatusBadge, { status: 'DRAFT', paymentState: 'OPEN', paymentReturnId: 7, availableStatuses: ['PAID'], onStatusChange: vi.fn() }));
    expect(html).toContain('data-invoice-payment-return="7"');
    expect(html).toContain('aria-label="Zahlungsstatus: Offen"');
    const tab = readFileSync('components/dashboard/tabs/invoices-tab.tsx', 'utf8');
    expect(tab.match(/paymentReturnId=\{invoice.id\}/g)).toHaveLength(2);
    const dialog = readFileSync('components/dashboard/full-payment-dialog.tsx', 'utf8');
    expect(dialog).toContain('paymentDialogReturnTarget(invoice.id, returnFocusRef.current)?.focus({ preventScroll: true })');
    const browser = readFileSync('e2e/auth-dashboard-invoice.spec.ts', 'utf8');
    expect(browser).toContain("name: 'Zahlung erfassen', exact: true })).toBeFocused()");
    const primary = tab.slice(tab.indexOf('const renderInvoicePrimaryAction'), tab.indexOf('const renderInvoiceActions'));
    expect(primary).toContain('data-invoice-payment-return={invoice.id}');
    expect(primary).toContain("availableInvoiceStatuses(invoice).includes('PAID')");
  });
  it('keeps the browser focus assertion on the saved payment confirmation rather than every live status', () => {
    const browser = readFileSync('e2e/auth-dashboard-invoice.spec.ts', 'utf8');
    expect(browser).toContain("const savedConfirmation = dialog.getByRole('status').filter({ has: page.getByText('Zahlung gespeichert', { exact: true }) });");
    expect(browser).toContain('await expect(savedConfirmation).toBeVisible();');
    expect(browser).toContain('await expect(savedConfirmation).toBeFocused();');
    expect(browser).not.toContain("await expect(dialog.getByRole('status')).toBeFocused();");
  });
});
