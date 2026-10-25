import type { ManualFinancialRecordKind } from '@/lib/manual-financial-record-contract';

/** Stable semantic identity survives a list refresh replacing the invoking DOM node. */
export function manualRecordOpenerKey(kind: ManualFinancialRecordKind, id: number): string {
  return `${kind}:${id}`;
}
export function manualRecordReturnTarget(kind: ManualFinancialRecordKind, id: number, previous: HTMLElement | null, root: Document = document): HTMLElement | null {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const key = manualRecordOpenerKey(kind, id);
  const usable = (element: HTMLElement | null): element is HTMLElement => Boolean(element
    && element !== root.body && element.isConnected && element.getClientRects().length > 0
    && element.getAttribute('data-manual-record-opener') === key
    && !element.matches(':disabled, [aria-disabled="true"]')
    && !element.closest('[role="dialog"], [role="menu"]'));
  if (usable(previous)) return previous;
  // Do not fall back to another financial record or an arbitrary page button.
  return Array.from(root.querySelectorAll<HTMLElement>(`[data-manual-record-opener="${key}"]`)).find(usable) ?? null;
}
/** Cancelling Radix's custom dismiss event alone does not cancel native pointer
 * focus. That later default action can steal focus from a newly mounted warning.
 */
export function preventManualRecordOutsideFocus(event: { preventDefault: () => void; detail: { originalEvent: { preventDefault: () => void } } }): void {
  event.preventDefault();
  event.detail.originalEvent.preventDefault();
}
