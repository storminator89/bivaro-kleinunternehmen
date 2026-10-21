import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { cancellationSubmissionGate } from '@/lib/cancellation-submission';
import { CancellationProgress } from '@/components/dashboard/modals/credit-note-modal';

describe('confirmed cancellation dismissal gate', () => {
  it('allows ordinary pre-submit cancel without starting any request', () => {
    const gate = cancellationSubmissionGate(), close = vi.fn(), event = { preventDefault: vi.fn() };
    expect(gate.dismiss(close)).toBe(true); expect(close).toHaveBeenCalledOnce();
    gate.preventDismiss(event); expect(event.preventDefault).not.toHaveBeenCalled();
  });
  it('locks synchronously, prevents duplicate submission and blocks all dismissal handlers while pending', () => {
    const gate = cancellationSubmissionGate(), close = vi.fn();
    expect(gate.begin()).toBe(true); expect(gate.begin()).toBe(false);
    for (const reason of ['X', 'Escape', 'outside', 'Cancel']) {
      const event = { preventDefault: vi.fn() };
      gate.preventDismiss(event); expect(event.preventDefault, reason).toHaveBeenCalledOnce();
      expect(gate.dismiss(close), reason).toBe(false);
    }
    expect(close).not.toHaveBeenCalled();
  });
  it.each(['success', 'server error', 'network uncertainty'])('unlocks after terminal %s, not by pretending request abortion', () => {
    const gate = cancellationSubmissionGate(), close = vi.fn(); gate.begin(); gate.finish();
    expect(gate.dismiss(close)).toBe(true); expect(close).toHaveBeenCalledOnce();
    expect(gate.begin()).toBe(true);
  });
  it('renders clear accessible progress without claiming the request can be undone', () => {
    const html = renderToStaticMarkup(createElement(CancellationProgress));
    expect(html).toContain('role="status"'); expect(html).toContain('aria-live="polite"');
    expect(html).toContain('bis zur Antwort geöffnet'); expect(html).toContain('Schließen würde den Auftrag nicht zurücknehmen');
  });
  it('wires the gate to modal close, escape, pointer and interaction and releases it in finally', () => {
    const source = readFileSync('components/dashboard/modals/credit-note-modal.tsx', 'utf8');
    expect(source).toContain('submission.current.dismiss'); expect(source).toContain('if (!submission.current.begin()) return');
    for (const event of ['onEscapeKeyDown', 'onPointerDownOutside', 'onInteractOutside']) expect(source).toContain(`${event}={event => submission.current.preventDismiss(event)}`);
    expect(source).toContain('showCloseButton={!isSubmitting}'); expect(source).toContain('aria-busy={isSubmitting}');
    expect(source).toContain('finally {\n            submission.current.finish();');
  });
});
