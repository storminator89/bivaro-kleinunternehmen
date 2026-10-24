/** Controlled service dialogs have external buttons rather than Radix triggers. */
export function captureServiceDialogOpener(document: Document): HTMLElement | null {
  const active = document.activeElement;
  const HTMLElement = document.defaultView?.HTMLElement;
  if (!HTMLElement || !(active instanceof HTMLElement) || active === document.body
    || !active.isConnected || active.closest('[role="dialog"]')) return null;
  return active;
}

/** Never move focus to a removed, hidden, disabled or now-inert opener. */
export function restoreServiceDialogOpener(opener: HTMLElement | null): void {
  const view = opener?.ownerDocument.defaultView;
  if (!opener || !view || !opener.isConnected || opener.getClientRects().length === 0
    || view.getComputedStyle(opener).visibility !== 'visible'
    || opener.matches(':disabled, [aria-disabled="true"]')
    || opener.closest('[inert], [hidden], [aria-hidden="true"], [role="dialog"], [role="menu"]')) return;
  opener.focus({ preventScroll: true });
}
