/** Pure UI gate / transport and fake sessionStorage only; no rendered UI, requests, browser, DB or files. */
import { describe, expect, it, vi } from 'vitest';
import {
  createOwnerQuoteReleaseUncertainty, OwnerQuoteReleaseReviewRequiredError, OwnerQuoteReleaseStorageError,
  ownerQuoteReleaseCanCapture, ownerQuoteReleaseClientBody, ownerQuoteReleaseClientGate, ownerQuoteReleaseLocalDateTime,
  parseOwnerQuoteReleaseClientReceipt, parseOwnerQuoteReleaseClientState, transitionOwnerQuoteReleaseClientGate,
  type OwnerQuoteReleaseClientGate,
} from '@/lib/quote-release-owner-client';

vi.mock('@/lib/prisma', () => { throw new Error('Real Prisma singleton forbidden in owner client tests'); });
vi.mock('@prisma/client', () => { throw new Error('No Prisma runtime in owner client'); });
vi.mock('server-only', () => { throw new Error('No server-only imports in owner client'); });

const SHA = 'a'.repeat(64);
const CREATED = '2026-10-26T12:00:00.000Z';
const EXPIRES = '2026-11-01T12:00:00.000Z';
const uid = (n: number) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const guards = () => ({ authorityId: null as string | null, revision: 0, currentReleaseId: null as string | null, sourceFingerprint: SHA });
const wireState = () => ({ quoteId: 10, expected: guards(), eligibility: 'RECEIPT_BOUND', validUntil: '2026-12-01T00:00:00.000Z', totalVersions: 0, history: [] as unknown[], hasMore: false, publicAccessEnabled: false });
const body = () => ownerQuoteReleaseClientBody(guards(), ownerQuoteReleaseLocalDateTime(new Date(EXPIRES)), '  Explicit review  ', null, Date.parse(CREATED));
const receipt = () => ({ authorityId: uid(80), releaseId: uid(1), revision: 1, snapshotSha256: SHA, createdAt: CREATED, expiresAt: EXPIRES });
const move = transitionOwnerQuoteReleaseClientGate;
function refreshed(gate: OwnerQuoteReleaseClientGate, explicit = true) { return move(move(gate, { type: 'read-start' }), { type: 'read-ok', explicit }); }

describe('owner release UI request gate, pure synchronous transitions', () => {
  it('requires a successful read and blocks a second synchronous save or refresh while saving', () => {
    const initial = ownerQuoteReleaseClientGate();
    expect(ownerQuoteReleaseCanCapture(initial)).toBe(false);
    expect(move(initial, { type: 'read-ok', explicit: true })).toBe(initial);
    const ready = refreshed(initial), saving = move(ready, { type: 'save-start' });
    expect(ownerQuoteReleaseCanCapture(ready)).toBe(true); expect(saving.pending).toBe(true); expect(ownerQuoteReleaseCanCapture(saving)).toBe(false);
    expect(move(saving, { type: 'save-start' })).toBe(saving); expect(move(saving, { type: 'read-start' })).toBe(saving);
  });
  it('does not retry known rejection; a fresh read and a new deliberate save action are separate transitions', () => {
    const rejected = move(move(refreshed(ownerQuoteReleaseClientGate()), { type: 'save-start' }), { type: 'save-rejected' });
    expect(ownerQuoteReleaseCanCapture(rejected)).toBe(false); expect(rejected.pending).toBe(false); expect(rejected.uncertain).toBe(false);
    const reread = refreshed(rejected);
    expect(reread.pending).toBe(false); expect(ownerQuoteReleaseCanCapture(reread)).toBe(true);
  });
  it('latches unknown outcomes until explicit fresh GET and separate acknowledgement, never hash equality or automatic refresh', () => {
    let gate = move(move(refreshed(ownerQuoteReleaseClientGate()), { type: 'save-start' }), { type: 'save-unknown' });
    expect(gate).toMatchObject({ uncertain: true, freshReview: false, acknowledged: false, pending: false });
    gate = move(gate, { type: 'acknowledge', checked: true }); expect(ownerQuoteReleaseCanCapture(gate)).toBe(false);
    gate = refreshed(gate, false); gate = move(gate, { type: 'acknowledge', checked: true });
    expect(gate.freshReview).toBe(false); expect(gate.acknowledged).toBe(false); expect(ownerQuoteReleaseCanCapture(gate)).toBe(false);
    gate = refreshed(gate, true); expect(ownerQuoteReleaseCanCapture(gate)).toBe(false);
    gate = move(gate, { type: 'acknowledge', checked: true }); expect(ownerQuoteReleaseCanCapture(gate)).toBe(true);
    gate = move(gate, { type: 'save-start' }); expect(gate).toMatchObject({ pending: true, uncertain: true, freshReview: false, acknowledged: false });
    gate = move(gate, { type: 'save-confirmed' }); gate = refreshed(gate, false);
    expect(gate.uncertain).toBe(false); expect(gate.pending).toBe(false); expect(ownerQuoteReleaseCanCapture(gate)).toBe(true);
  });
  it('drops acknowledgement on another refresh, failed read or edited input while retaining the unknown latch', () => {
    let gate = move(refreshed(ownerQuoteReleaseClientGate(true)), { type: 'acknowledge', checked: true });
    expect(ownerQuoteReleaseCanCapture(gate)).toBe(true);
    gate = move(gate, { type: 'acknowledge', checked: false }); expect(ownerQuoteReleaseCanCapture(gate)).toBe(false);
    gate = move(gate, { type: 'acknowledge', checked: true }); gate = move(gate, { type: 'read-start' });
    expect(gate.acknowledged).toBe(false); gate = move(gate, { type: 'read-failed' });
    expect(gate).toMatchObject({ uncertain: true, freshReview: false, ready: false }); expect(ownerQuoteReleaseCanCapture(gate)).toBe(false);
  });
  it('keeps 401 blocked until a new authenticated mount and retains uncertainty through a quote-scope reset', () => {
    const blocked = move(refreshed(ownerQuoteReleaseClientGate(true)), { type: 'auth-required' });
    expect(blocked).toMatchObject({ unauthorized: true, ready: false, uncertain: true });
    expect(move(blocked, { type: 'read-start' })).toBe(blocked); expect(move(blocked, { type: 'read-ok', explicit: true })).toBe(blocked);
    expect(ownerQuoteReleaseCanCapture(move(blocked, { type: 'acknowledge', checked: true }))).toBe(false);
    const newScope = ownerQuoteReleaseClientGate(blocked.uncertain, blocked.unauthorized);
    expect(newScope).toMatchObject({ unauthorized: true, uncertain: true, freshReview: false });
  });
});

describe('browser-safe owner transport, exact redacted envelopes', () => {
  it('accepts only the expected quote/state capability and rejects malformed or over-returned private evidence', () => {
    expect(parseOwnerQuoteReleaseClientState(wireState(), 10)).toEqual(wireState());
    for (const value of [{ ...wireState(), quoteId: 11 }, { ...wireState(), publicAccessEnabled: true }, { ...wireState(), sourcePayload: '{}' },
      { ...wireState(), expected: { ...guards(), userId: 'foreign' } }, { ...wireState(), eligibility: ['UNAVAILABLE'], expected: null },
      { ...wireState(), history: Array(21).fill({}), totalVersions: 21 }, { ...wireState(), hasMore: true }]) {
      expect(() => parseOwnerQuoteReleaseClientState(value, 10)).toThrow();
    }
  });
  it('validates the bounded current pointer/history and keeps response display data owner-free', () => {
    const row = { id: uid(1), generation: 1, snapshotSha256: SHA, createdAt: CREATED, expiresAt: EXPIRES, revokedAt: null, permanentlyClosed: false, current: true,
      response: { decision: 'REJECT', recordedAt: CREATED } };
    const state = { ...wireState(), expected: { ...guards(), authorityId: uid(80), revision: 1, currentReleaseId: uid(1) }, totalVersions: 1, history: [row] };
    expect(parseOwnerQuoteReleaseClientState(state, 10).history).toEqual([row]);
    for (const value of [{ ...state, expected: { ...state.expected, revision: 2 } }, { ...state, history: [{ ...row, permanentlyClosed: true }] },
      { ...state, history: [{ ...row, originalArchiveName: 'private.pdf' }] }, { ...state, history: [{ ...row, response: { ...row.response, confirmationText: 'private' } }] }]) {
      expect(() => parseOwnerQuoteReleaseClientState(value, 10)).toThrow();
    }
  });
  it('requires the exact successful receipt bound to this attempt; malformed successes must remain unknown, not inferred', () => {
    expect(parseOwnerQuoteReleaseClientReceipt(receipt(), body())).toEqual(receipt());
    for (const value of [{ ...receipt(), sourcePayload: '{}' }, { ...receipt(), revision: 2 }, { ...receipt(), expiresAt: '2026-11-02T12:00:00.000Z' },
      { ...receipt(), snapshotSha256: 'bad-hash' }]) expect(() => parseOwnerQuoteReleaseClientReceipt(value, body())).toThrow();
    const replacement = { ...body(), expected: { ...guards(), authorityId: uid(80), revision: 1, currentReleaseId: uid(1) } };
    expect(() => parseOwnerQuoteReleaseClientReceipt({ ...receipt(), revision: 2 }, replacement)).toThrow();
    expect(() => parseOwnerQuoteReleaseClientReceipt({ ...receipt(), authorityId: uid(79), releaseId: uid(2), revision: 2 }, replacement)).toThrow();
  });
  it('converts local future expiry to exact UTC and builds a frozen closed owner-free body without changing input guards', () => {
    const original = guards(), local = ownerQuoteReleaseLocalDateTime(new Date(EXPIRES));
    const value = ownerQuoteReleaseClientBody(original, local, '  Explicit review  ', EXPIRES, Date.parse(CREATED));
    expect(value).toEqual({ expected: original, expiresAt: EXPIRES, reason: 'Explicit review' });
    expect(Object.keys(value).sort()).toEqual(['expected', 'expiresAt', 'reason']); expect(Object.isFrozen(value)).toBe(true); expect(Object.isFrozen(value.expected)).toBe(true);
    original.sourceFingerprint = 'b'.repeat(64); expect(value.expected.sourceFingerprint).toBe(SHA);
  });
  it('rejects past, invalid, over-validity expiry and invalid reason before any save action', () => {
    const local = ownerQuoteReleaseLocalDateTime(new Date(EXPIRES));
    expect(() => ownerQuoteReleaseClientBody(guards(), local, 'reason', null, Date.parse(EXPIRES))).toThrow(/zukünftiges/);
    expect(() => ownerQuoteReleaseClientBody(guards(), '2026-02-30T12:00', 'reason', null, 0)).toThrow(/gültiges/);
    expect(() => ownerQuoteReleaseClientBody(guards(), local, 'reason', CREATED, Date.parse(CREATED))).toThrow(/Angebot selbst/);
    expect(() => ownerQuoteReleaseClientBody(guards(), local, ' ', null, Date.parse(CREATED))).toThrow();
    expect(() => ownerQuoteReleaseClientBody(guards(), local, 'x'.repeat(501), null, Date.parse(CREATED))).toThrow();
  });
});


const session = (owner = 'synthetic-owner', role = 'USER', version = 0) => JSON.stringify(['authenticated', owner, role, version]);
function fakeStorage() {
  const values = new Map<string, string>();
  const faults = { read: false, write: false, remove: false, silentWrite: false };
  const storage = {
    getItem: vi.fn((key: string) => { if (faults.read) throw new Error('synthetic read unavailable'); return values.get(key) ?? null; }),
    setItem: vi.fn((key: string, value: string) => { if (faults.write) throw new Error('synthetic quota unavailable'); if (!faults.silentWrite) values.set(key, value); }),
    removeItem: vi.fn((key: string) => { if (faults.remove) throw new Error('synthetic remove unavailable'); values.delete(key); }),
  };
  return { values, faults, storage, scope: (owner = session(), quote = 10) => createOwnerQuoteReleaseUncertainty(() => storage, owner, quote) };
}

describe('same-tab owner-scoped one-bit write-ahead marker, fake storage only', () => {
  it('verifies literal 1 before the simulated POST; remount/reload and automatic GET never clear or acknowledge it', () => {
    const f = fakeStorage(), send = vi.fn(), marker = f.scope();
    expect(marker.read()).toBe(false);
    expect(marker.begin(false)).toEqual({ priorUncertainty: false }); send();
    expect(f.storage.setItem.mock.calls[0][1]).toBe('1');
    expect(f.storage.setItem.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
    expect(f.storage.getItem.mock.invocationCallOrder.at(-1)!).toBeLessThan(send.mock.invocationCallOrder[0]);
    const reopened = f.scope(); // New helper identity, same retained tab-storage map.
    let gate = ownerQuoteReleaseClientGate(reopened.read()); gate = refreshed(gate, false);
    expect(gate).toMatchObject({ uncertain: true, freshReview: false, acknowledged: false });
    expect(ownerQuoteReleaseCanCapture(gate)).toBe(false); expect(reopened.read()).toBe(true); expect(f.storage.removeItem).not.toHaveBeenCalled();
    expect([...f.values.values()]).toEqual(['1']);
  });
  it('requires explicit fresh GET plus acknowledgement after reopening; newly discovered prior marker cannot bypass review', () => {
    const f = fakeStorage(); f.scope().begin(false);
    const reopened = f.scope();
    expect(() => reopened.begin(false)).toThrow(OwnerQuoteReleaseReviewRequiredError);
    let gate = refreshed(ownerQuoteReleaseClientGate(reopened.read()), true);
    expect(ownerQuoteReleaseCanCapture(gate)).toBe(false);
    gate = move(gate, { type: 'acknowledge', checked: true }); expect(ownerQuoteReleaseCanCapture(gate)).toBe(true);
    expect(reopened.begin(gate.freshReview && gate.acknowledged)).toEqual({ priorUncertainty: true });
  });
  it('clears only an initial known rejection, never a known rejection following earlier uncertainty', () => {
    const f = fakeStorage(), marker = f.scope();
    marker.knownRejected(marker.begin(false).priorUncertainty); expect(marker.read()).toBe(false);
    marker.begin(false); const reopened = f.scope(), attempt = reopened.begin(true);
    reopened.knownRejected(attempt.priorUncertainty); expect(reopened.read()).toBe(true);
    expect(f.storage.removeItem).toHaveBeenCalledTimes(1);
  });
  it('retains network/5xx/401/unmounted pending marker without a receipt; malformed success cannot clear it', () => {
    const f = fakeStorage(); f.scope().begin(false);
    // Discarding an attempt performs no finalization: no success is inferred.
    const afterNavigation = f.scope(); expect(afterNavigation.read()).toBe(true);
    expect(() => afterNavigation.confirmed({ ...receipt(), revision: 2 }, body())).toThrow();
    expect(afterNavigation.read()).toBe(true); expect(f.storage.removeItem).not.toHaveBeenCalled();
    expect(afterNavigation.confirmed(receipt(), body())).toEqual(receipt()); expect(afterNavigation.read()).toBe(false);
  });
  it('isolates exact owner, role, session version and quote scopes and never enumerates/removes other markers', () => {
    const f = fakeStorage();
    const scopes = [f.scope(), f.scope(session('other-owner')), f.scope(session('synthetic-owner', 'ADMIN')), f.scope(session('synthetic-owner', 'USER', 1)), f.scope(session(), 11)];
    for (const marker of scopes) marker.begin(false);
    expect(f.values.size).toBe(5); expect(new Set(f.storage.setItem.mock.calls.map(([key]) => key)).size).toBe(5);
    expect([...f.values.values()]).toEqual(['1', '1', '1', '1', '1']);
    scopes[0].confirmed(receipt(), body()); expect(scopes[0].read()).toBe(false);
    for (const marker of scopes.slice(1)) expect(marker.read()).toBe(true);
    expect(f.storage.removeItem).toHaveBeenCalledExactlyOnceWith(f.storage.setItem.mock.calls[0][0]);
  });
  it('fails closed on unavailable/read-failing storage, write errors or unverified writes before any simulated POST', () => {
    expect(() => createOwnerQuoteReleaseUncertainty(() => { throw new Error('blocked sessionStorage getter'); }, session(), 10).read()).toThrow(OwnerQuoteReleaseStorageError);
    for (const fault of ['read', 'write', 'silentWrite'] as const) {
      const f = fakeStorage(), send = vi.fn(); f.faults[fault] = true;
      expect(() => { f.scope().begin(false); send(); }).toThrow(OwnerQuoteReleaseStorageError); expect(send).not.toHaveBeenCalled();
    }
  });
  it('fails closed on clear/read verification errors and never repairs malformed markers by deleting evidence', () => {
    const f = fakeStorage(), marker = f.scope(); marker.begin(false); f.faults.remove = true;
    expect(() => marker.confirmed(receipt(), body())).toThrow(OwnerQuoteReleaseStorageError); expect(marker.read()).toBe(true);
    f.faults.remove = false; f.faults.read = true; expect(() => marker.read()).toThrow(OwnerQuoteReleaseStorageError);
    f.faults.read = false; const key = f.storage.setItem.mock.calls[0][0]; f.values.set(key, 'unexpected'); f.storage.removeItem.mockClear();
    expect(() => marker.read()).toThrow(OwnerQuoteReleaseStorageError); expect(f.storage.removeItem).not.toHaveBeenCalled(); expect(f.values.get(key)).toBe('unexpected');
  });
  it('rejects missing/unauthenticated or malformed owner session metadata instead of using a global fallback key', () => {
    const f = fakeStorage();
    for (const key of ['', '[]', JSON.stringify(['unauthenticated', null, null, null]), JSON.stringify(['authenticated', 'owner', 'USER', '0'])]) {
      expect(() => f.scope(key)).toThrow(OwnerQuoteReleaseStorageError);
    }
    expect(f.storage.getItem).not.toHaveBeenCalled(); expect(f.storage.setItem).not.toHaveBeenCalled();
  });
});
