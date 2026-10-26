export type ManualEntryPhase = 'idle' | 'pending' | 'unknown' | 'accepted' | 'discarding';
export type ManualEntrySubmitState = { phase: ManualEntryPhase; message: string };

/** A component-local lease, not server idempotency or cross-tab/reload deduplication. */
export function createManualEntryGate() {
  let sequence = 0;
  let phase: ManualEntryPhase = 'idle';
  let active = true;
  return {
    mount() { active = true; },
    dispose() { active = false; sequence += 1; },
    begin(): number | null {
      if (!active || phase !== 'idle') return null;
      phase = 'pending';
      return ++sequence;
    },
    current(token: number) { return active && token === sequence && phase === 'pending'; },
    editable() { return active && phase === 'idle'; },
    settle(token: number, next: 'idle' | 'unknown' | 'accepted'): boolean {
      if (!active || token !== sequence || phase !== 'pending') return false;
      phase = next;
      return true;
    },
    reset(): boolean {
      if (!active || phase !== 'idle') return false;
      sequence += 1;
      phase = 'idle';
      return true;
    },
    discard(): boolean {
      if (!active || (phase !== 'unknown' && phase !== 'accepted')) return false;
      sequence += 1;
      phase = 'discarding';
      return true;
    },
    releaseAfterCommit(): boolean {
      if (!active || (phase !== 'accepted' && phase !== 'discarding')) return false;
      sequence += 1;
      phase = 'idle';
      return true;
    },
  };
}

export type ManualEntryOutcome =
  | { kind: 'accepted'; id: number }
  | { kind: 'rejected'; message: string; field?: string }
  | { kind: 'unknown' };

// These statuses originate before a write, or from a rolled-back service
// transaction, in income/expense POST/PUT and protectMutation. Never include
// timeout/5xx statuses: they do not prove that a write was rolled back.
const NO_WRITE_STATUSES = new Set([400, 401, 403, 404, 409, 413]);

export async function manualEntryOutcome(response: Response, expectedId?: number): Promise<ManualEntryOutcome> {
  if (response.redirected || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) return { kind: 'unknown' };
  let body: unknown;
  try { body = await response.json(); } catch { return { kind: 'unknown' }; }
  if (!body || typeof body !== 'object') return { kind: 'unknown' };
  if (response.ok) {
    const id = 'id' in body ? body.id : undefined;
    if (!Number.isSafeInteger(id) || (id as number) <= 0 || (expectedId !== undefined && expectedId !== id)) return { kind: 'unknown' };
    return { kind: 'accepted', id: id as number };
  }
  if (NO_WRITE_STATUSES.has(response.status) && 'error' in body && typeof body.error === 'string') {
    return { kind: 'rejected', message: body.error, ...('field' in body && typeof body.field === 'string' ? { field: body.field } : {}) };
  }
  return { kind: 'unknown' };
}
