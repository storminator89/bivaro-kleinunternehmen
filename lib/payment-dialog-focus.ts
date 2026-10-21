/** Resolve each priority separately: a selector union is document-order, not preference-order. */
export function paymentDialogReturnTarget(invoiceId: number, previous: HTMLElement | null, root: Document = document): HTMLElement | null {
  const usable = (element: HTMLElement | null): element is HTMLElement => Boolean(element
    && element !== root.body && element.isConnected && element.getClientRects().length > 0
    && !element.matches(':disabled, [aria-disabled="true"]')
    && !element.closest('[role="dialog"], [role="menu"]'));
  // Preserve a real live invoker (for example the invoice Details button), but
  // never trust a menu item, hidden responsive duplicate, or detached old row.
  if (usable(previous)) return previous;
  const firstUsable = (selector: string) => Array.from(root.querySelectorAll<HTMLElement>(selector)).find(usable) ?? null;
  if (Number.isSafeInteger(invoiceId) && invoiceId > 0) {
    const trigger = firstUsable(`[data-invoice-payment-return="${invoiceId}"]`);
    if (trigger) return trigger;
    const invoiceAnchor = firstUsable(`[data-invoice-return="${invoiceId}"]`);
    if (invoiceAnchor) return invoiceAnchor;
  }
  return firstUsable('#invoice-search') ?? firstUsable('main button');
}
