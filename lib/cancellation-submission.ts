/** Local UI gate only: dismissal never cancels or rolls back a sent request. */
export function cancellationSubmissionGate() {
  let pending = false;
  return {
    begin() { if (pending) return false; pending = true; return true; },
    finish() { pending = false; },
    dismiss(close: () => void) { if (pending) return false; close(); return true; },
    preventDismiss(event: { preventDefault: () => void }) { if (pending) event.preventDefault(); },
  };
}
