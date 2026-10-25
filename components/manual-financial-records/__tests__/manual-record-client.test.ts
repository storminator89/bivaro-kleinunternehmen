import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManualFinancialRecordDto, ManualFinancialRecordMutation } from '@/lib/manual-financial-record-contract';
import { correctionAmount, createDraftClock, forgetCommand, hasConfirmedMutation, isUnchangedCorrection, loadManualRecord, ManualRecordRequestError, pendingIdentity, protectedManualRecordState, readManualRecordResponse, readPendingIdentity, recordStorageKey, rememberCommand, rememberedCommand, saveManualRecord } from '../manual-record-client';

// Source-only acceptance. No suite execution is authorized for this preparation.
const mutationId = '00000000-0000-4000-8000-000000000001';
const fingerprint = 'a'.repeat(64);
const command: ManualFinancialRecordMutation = { kind: 'income', id: 7, operation: 'CORRECT_AMOUNT', expectedRevision: 1, fingerprint, mutationId, amount: '80.00', reason: 'Synthetic correction reason' };
function record(): ManualFinancialRecordDto {
  return { contractVersion: 1, kind: 'income', id: 7, recordId: mutationId, state: 'FINALIZED', origin: 'MANUAL', revision: 2, fingerprint, description: 'Synthetic retained original', paymentDate: '2025-06-15', effectiveAmount: '80.00', currency: 'EUR', canFinalize: false, canCorrectAmount: true, readOnlyReason: null, requiresLegacyDeclaration: false, original: { status: 'NONE', fileName: null, sha256: null, byteCount: null }, history: [{ id: 'original', sequence: 1, operation: 'FINALIZE', mutationId: '00000000-0000-4000-8000-000000000002', amount: '100.00', originalAmount: '100.00', paymentDate: '2025-06-15', description: 'Synthetic retained original', reason: null, createdAt: '2026-10-25T08:00:00.000Z', hash: fingerprint, previousHash: null }, { id: 'correction', sequence: 2, operation: 'CORRECT_AMOUNT', mutationId, amount: '80.00', originalAmount: '100.00', paymentDate: '2025-06-15', description: 'Synthetic retained original', reason: command.reason!, createdAt: '2026-10-25T08:01:00.000Z', hash: fingerprint, previousHash: fingerprint }] };
}
afterEach(() => { vi.unstubAllGlobals(); });
describe('manual lifecycle draft generations', () => {
  it('adopts only clean, unchanged read generations', () => {
    const draft = createDraftClock(); const initial = draft.snapshot();
    expect(draft.canAdopt(initial)).toBe(true);
    draft.edit(); expect(draft.canAdopt(initial)).toBe(false); expect(draft.isDirty()).toBe(true);
    expect(draft.markClean(initial)).toBe(false); expect(draft.isDirty()).toBe(true);
    expect(draft.markClean(draft.snapshot())).toBe(true); expect(draft.isDirty()).toBe(false);
  });
  it('retains a newer keyboard edit even when it returns EXACTLY to the old server value', () => {
    const draft = createDraftClock(); const submitted = draft.snapshot();
    // 100 -> 80 -> 100 must not be treated as a pristine value-equality draft.
    draft.edit(); draft.edit();
    expect(draft.markClean(submitted)).toBe(false);
    expect(draft.canAdopt(submitted)).toBe(false); expect(draft.isDirty()).toBe(true);
  });
});
describe('monotonic finalized row protection', () => {
  it('does not let an earlier RECORDED detail observation override a later FINALIZED list refresh', () => {
    const earlierDetail = 'RECORDED';
    expect(protectedManualRecordState('RECORDED', earlierDetail)).toBe('RECORDED');
    // Close details, finalize in another tab, then observe its refreshed list.
    expect(protectedManualRecordState('FINALIZED', earlierDetail)).toBe('FINALIZED');
    expect(protectedManualRecordState('LEGACY_UNREVIEWED', 'FINALIZED')).toBe('FINALIZED');
    expect(protectedManualRecordState('RECORDED', undefined)).toBe('RECORDED');
  });
});
describe('strict correction amounts and private request metadata', () => {
  it.each([['80,2', '80.20'], ['0', '0.00'], ['100.00', '100.00'], [' 1.01 ', '1.01']])('canonicalizes %s without floating point rounding', (input, result) => expect(correctionAmount(input)).toBe(result));
  it.each(['-1', '+1', '1e2', '1.001', '01.00', 'NaN', 'Infinity', '1,000.00', '90071992547409.92', ''])('rejects %s rather than silently rounding', input => expect(() => correctionAmount(input)).toThrow());
  it('rejects a no-op even when server decimals omit trailing zeroes', () => {
    expect(isUnchangedCorrection('80,00', '80')).toBe(true);
    expect(isUnchangedCorrection('80.0', '80.00')).toBe(true);
    expect(isUnchangedCorrection('80.01', '80')).toBe(false);
  });
  it('persists UUID/CAS metadata only, never the reason or amount', () => {
    const raw = JSON.stringify(pendingIdentity(command));
    expect(raw).not.toContain('80.00'); expect(raw).not.toContain(command.reason);
    expect(JSON.parse(raw)).toEqual({ mutationId, operation: 'CORRECT_AMOUNT', expectedRevision: 1, fingerprint });
    expect(readPendingIdentity(raw)).toEqual(pendingIdentity(command));
    expect(readPendingIdentity('{')).toBeNull(); expect(readPendingIdentity(JSON.stringify({ ...pendingIdentity(command), mutationId: 'bad' }))).toBeNull();
  });
  it('separates account, role, session version, kind and record identities', () => {
    const key = recordStorageKey('["authenticated","user-a","USER",1]', 'income', 7);
    expect(key).not.toBe(recordStorageKey('["authenticated","user-b","USER",1]', 'income', 7));
    expect(key).not.toBe(recordStorageKey('["authenticated","user-a","ADMIN",1]', 'income', 7));
    expect(key).not.toBe(recordStorageKey('["authenticated","user-a","USER",2]', 'income', 7));
    expect(key).not.toBe(recordStorageKey('["authenticated","user-a","USER",1]', 'expense', 7));
  });
  it('keeps exact retry semantics in memory and removes them after resolution', () => {
    const key = 'synthetic-only'; rememberCommand(key, command);
    expect(rememberedCommand(key)).toBe(command); forgetCommand(key); expect(rememberedCommand(key)).toBeNull();
  });
});
describe('authoritative complete read and saved-evidence validation', () => {
  it('retains original 100 and the old payment day while effective projection is 80', () => {
    const actual = readManualRecordResponse({ record: record() }, 'income', 7);
    expect(actual.effectiveAmount).toBe('80.00'); expect(actual.history[0].amount).toBe('100.00');
    expect(actual.paymentDate).toBe('2025-06-15'); expect(hasConfirmedMutation(actual, command)).toBe(true);
    expect(hasConfirmedMutation(actual, { ...pendingIdentity(command), mutationId: '00000000-0000-4000-8000-000000000009' })).toBe(false);
  });
  it('does not infer eligibility when the server disallows correction without visible source relations', () => {
    const actual = readManualRecordResponse({ record: { ...record(), canCorrectAmount: false, readOnlyReason: 'Source workflow only' } }, 'income', 7);
    expect(actual.canCorrectAmount).toBe(false); expect(actual.readOnlyReason).toBe('Source workflow only');
  });
  it('rejects mismatched owner-scoped record identity and incomplete/unbounded histories', () => {
    expect(() => readManualRecordResponse({ record: record() }, 'expense', 7)).toThrow();
    expect(() => readManualRecordResponse({ record: record() }, 'income', 8)).toThrow();
    expect(() => readManualRecordResponse({ record: { ...record(), history: Array(257).fill(record().history[0]) } }, 'income', 7)).toThrow();
    expect(() => readManualRecordResponse({ record: { ...record(), history: [{ ...record().history[0], mutationId: null }] } }, 'income', 7)).toThrow();
  });
  it('never considers a read or retry failure to be success', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('Synthetic network failure')); vi.stubGlobal('fetch', fetch);
    await expect(loadManualRecord('income', 7, new AbortController().signal)).rejects.toThrow('Synthetic network failure');
    await expect(saveManualRecord(command, new AbortController().signal)).rejects.toThrow('Synthetic network failure');
  });
  it.each([[409, 'MANUAL_RECORD_STALE'], [409, 'MANUAL_RECORD_MUTATION_CONFLICT'], [409, 'MANUAL_RECORD_ORIGINAL_UNAVAILABLE'], [500, 'MANUAL_RECORD_UNKNOWN_RESPONSE']])('retains exact request identity on failure %s %s', async (status, code) => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code }), { status })); vi.stubGlobal('fetch', fetch);
    await expect(saveManualRecord(command, new AbortController().signal)).rejects.toBeInstanceOf(ManualRecordRequestError);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(command);
  });
});
