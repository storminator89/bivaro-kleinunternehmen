import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createManualEntryGate, manualEntryOutcome } from '@/lib/manual-entry-submission';
import { ManualEntrySubmitFeedback } from '@/components/dashboard/manual-entry-submit-feedback';

describe('component-local manual entry lease', () => {
  it('claims synchronously and rejects every additional begin before any await/render', () => {
    const gate = createManualEntryGate();
    const token = gate.begin();
    expect(token).not.toBeNull();
    expect(gate.begin()).toBeNull();
    expect(gate.begin()).toBeNull();
    expect(gate.reset()).toBe(false);
    expect(gate.discard()).toBe(false);
    expect(gate.editable()).toBe(false);
  });

  it('unlocks a definite rejection, but never reuses the previous token', () => {
    const gate = createManualEntryGate(), token = gate.begin()!;
    expect(gate.settle(token, 'idle')).toBe(true);
    const retry = gate.begin()!;
    expect(retry).not.toBe(token);
    expect(gate.settle(token, 'accepted')).toBe(false);
    expect(gate.current(retry)).toBe(true);
  });

  it('cannot reset or retry an unknown write, including after a read-only reconciliation', () => {
    const gate = createManualEntryGate(), token = gate.begin()!;
    expect(gate.settle(token, 'unknown')).toBe(true);
    expect(gate.begin()).toBeNull();
    expect(gate.reset()).toBe(false);
    expect(gate.releaseAfterCommit()).toBe(false);
    // A list response is deliberately not an input to this state machine.
    expect(gate.editable()).toBe(false);
  });

  it('keeps an explicit discard locked until the cleared-form/unmounted-editor commit barrier', () => {
    const gate = createManualEntryGate(), token = gate.begin()!;
    gate.settle(token, 'unknown');
    expect(gate.discard()).toBe(true);
    // Deterministic queued-submit regression: clearing React state has not
    // committed yet, so an old form must not acquire a fresh write lease.
    expect(gate.begin()).toBeNull();
    expect(gate.reset()).toBe(false);
    expect(gate.settle(token, 'accepted')).toBe(false);
    expect(gate.releaseAfterCommit()).toBe(true);
    expect(gate.begin()).not.toBeNull();
  });

  it('also holds accepted writes until the new empty form/editor-close commit', () => {
    const gate = createManualEntryGate(), token = gate.begin()!;
    gate.settle(token, 'accepted');
    expect(gate.begin()).toBeNull();
    expect(gate.reset()).toBe(false);
    expect(gate.releaseAfterCommit()).toBe(true);
    expect(gate.begin()).not.toBeNull();
  });

  it('does not apply a late completion or reset after unmount', () => {
    const gate = createManualEntryGate(), token = gate.begin()!;
    gate.dispose();
    expect(gate.current(token)).toBe(false);
    expect(gate.settle(token, 'accepted')).toBe(false);
    expect(gate.begin()).toBeNull();
    expect(gate.releaseAfterCommit()).toBe(false);
  });

  it('does not accidentally share a gate across distinct forms or claim cross-tab idempotency', () => {
    const first = createManualEntryGate(), second = createManualEntryGate();
    expect(first.begin()).not.toBeNull();
    expect(second.begin()).not.toBeNull();
  });
});

describe('actual manual-entry response contract', () => {
  it('accepts the authoritative JSON row response and validates a PUT row identity', async () => {
    expect(await manualEntryOutcome(Response.json({ id: 17 }))).toEqual({ kind: 'accepted', id: 17 });
    expect(await manualEntryOutcome(Response.json({ id: 17 }), 17)).toEqual({ kind: 'accepted', id: 17 });
    expect(await manualEntryOutcome(Response.json({ id: 18 }), 17)).toEqual({ kind: 'unknown' });
  });

  it.each([400, 401, 403, 404, 409, 413])('permits an explicit retry only for proven prewrite/rollback JSON rejection %i', async status => {
    expect(await manualEntryOutcome(Response.json({ error: 'Synthetic rejection', field: 'date' }, { status })))
      .toEqual({ kind: 'rejected', message: 'Synthetic rejection', field: 'date' });
  });

  it.each([408, 429, 500, 502, 503])('keeps unproven or postcommit-possible status %i unknown', async status => {
    expect(await manualEntryOutcome(Response.json({ error: 'Synthetic uncertain outcome' }, { status }))).toEqual({ kind: 'unknown' });
  });

  it('does not interpret malformed/redirected/HTML success or error-less rejection as financial success/failure', async () => {
    const redirected = Response.json({ id: 17 });
    Object.defineProperty(redirected, 'redirected', { value: true });
    const responses = [
      redirected, new Response('<html>Login</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      new Response('{', { status: 200, headers: { 'content-type': 'application/json' } }),
      Response.json({ id: '17' }), Response.json({ id: 0 }), Response.json({ ok: true }),
      Response.json({ message: 'Unknown response shape' }, { status: 400 }),
    ];
    for (const response of responses) expect(await manualEntryOutcome(response)).toEqual({ kind: 'unknown' });
  });
});

describe('honest manual-entry feedback (static component contract only)', () => {
  it('offers read-only reconciliation and explicit local discard, never a retry of an unknown write', () => {
    const html = renderToStaticMarkup(createElement(ManualEntrySubmitFeedback, { controls: {
      state: { phase: 'unknown', message: '' }, refreshing: false, onDiscard: vi.fn(), onRefresh: vi.fn(), onStopWaiting: vi.fn(),
    } }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('Nicht erneut senden');
    expect(html).toContain('Liste aktualisieren (nur lesen)');
    expect(html).toContain('Lokalen Entwurf verwerfen');
    expect(html).toContain('nimmt serverseitige Arbeit nicht zurück');
    expect(html).toContain('Ein gleicher Listeneintrag beweist den Ausgang dieses Auftrags nicht');
    expect(html).toContain('Nach einem Reload oder in einem anderen Tab');
    expect(html).not.toContain('Erneut speichern');
    expect(html).not.toContain('type="submit"');
  });

  it.each(['pending', 'discarding'] as const)('has no replay/discard action while %s is still crossing its barrier', phase => {
    const html = renderToStaticMarkup(createElement(ManualEntrySubmitFeedback, { controls: {
      state: { phase, message: '' }, refreshing: false, onDiscard: vi.fn(), onRefresh: vi.fn(), onStopWaiting: vi.fn(),
    } }));
    expect(html).toContain('role="status"');
    expect(html).not.toContain('type="submit"');
    expect(html).not.toContain('Lokalen Entwurf verwerfen');
    if (phase === 'pending') expect(html).toContain('Warten beenden / Liste prüfen');
    else expect(html).not.toContain('<button');
  });
});
