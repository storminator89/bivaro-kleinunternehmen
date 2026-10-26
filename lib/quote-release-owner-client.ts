/** Browser-safe transport, explicit one-bit session-storage gate and pure transitions. No server imports. */
import {
  ownerQuoteReleaseId, ownerQuoteReleaseInstant, parseOwnerQuoteReleaseCaptureBody,
  type OwnerQuoteReleaseCaptureBody, type OwnerQuoteReleaseExpected, type OwnerQuoteReleaseState,
} from '@/lib/quote-release-owner-contract';

export type OwnerQuoteReleaseClientReceipt = Readonly<{
  authorityId: string; releaseId: string; revision: number; snapshotSha256: string; createdAt: string; expiresAt: string;
}>;
export type OwnerQuoteReleaseClientGate = Readonly<{
  pending: boolean; reading: boolean; ready: boolean; unauthorized: boolean;
  uncertain: boolean; freshReview: boolean; acknowledged: boolean;
}>;
type GateEvent = { type: 'read-start' | 'read-failed' | 'auth-required' | 'save-start' | 'save-confirmed' | 'save-rejected' | 'save-unknown' | 'uncertainty-found' }
  | { type: 'read-ok'; explicit: boolean } | { type: 'acknowledge'; checked: boolean };
export function ownerQuoteReleaseClientGate(uncertain = false, unauthorized = false): OwnerQuoteReleaseClientGate {
  return { pending: false, reading: false, ready: false, unauthorized, uncertain, freshReview: false, acknowledged: false };
}
export function ownerQuoteReleaseCanCapture(gate: OwnerQuoteReleaseClientGate): boolean {
  return gate.ready && !gate.pending && !gate.reading && !gate.unauthorized && (!gate.uncertain || (gate.freshReview && gate.acknowledged));
}
export function transitionOwnerQuoteReleaseClientGate(gate: OwnerQuoteReleaseClientGate, event: GateEvent): OwnerQuoteReleaseClientGate {
  switch (event.type) {
    case 'read-start': return gate.pending || gate.unauthorized ? gate : { ...gate, reading: true, ready: false, freshReview: false, acknowledged: false };
    case 'read-ok': return gate.unauthorized || gate.pending || !gate.reading ? gate : { ...gate, reading: false, ready: true, freshReview: gate.uncertain && event.explicit, acknowledged: false };
    case 'read-failed': return { ...gate, reading: false, ready: false, freshReview: false, acknowledged: false };
    case 'auth-required': return { ...gate, pending: false, reading: false, ready: false, unauthorized: true, freshReview: false, acknowledged: false };
    case 'acknowledge': return { ...gate, acknowledged: event.checked && gate.uncertain && gate.freshReview && gate.ready && !gate.reading && !gate.pending && !gate.unauthorized };
    case 'save-start': return ownerQuoteReleaseCanCapture(gate) ? { ...gate, pending: true, ready: false, freshReview: false, acknowledged: false } : gate;
    case 'save-confirmed': return { ...gate, pending: false, ready: false, uncertain: false, freshReview: false, acknowledged: false };
    case 'save-rejected': return { ...gate, pending: false, ready: false, freshReview: false, acknowledged: false };
    case 'uncertainty-found': return { ...gate, ready: false, uncertain: true, freshReview: false, acknowledged: false };
    case 'save-unknown': return { ...gate, pending: false, ready: false, uncertain: true, freshReview: false, acknowledged: false };
  }
}


export class OwnerQuoteReleaseStorageError extends Error {
  constructor() { super('Der Browser-Sitzungsspeicher ist nicht sicher verfügbar. Speichern bleibt gesperrt. Bitte die Browsereinstellungen prüfen und den Dialog erneut öffnen.'); }
}
export class OwnerQuoteReleaseReviewRequiredError extends Error {
  constructor() { super('Ein früherer Speicherausgang ist unklar. Den Stand ausdrücklich neu laden und eine weitere Version bewusst bestätigen.'); }
}
type UncertaintyStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
/** Key holds only public owner-session identity metadata; value is only literal "1".
 * Same-tab persistence, not an authentication/SQL or cross-client idempotency control.
 */
export function createOwnerQuoteReleaseUncertainty(storage: () => UncertaintyStorage, ownerSessionKey: string, quoteId: number) {
  let identity: unknown;
  try { identity = JSON.parse(ownerSessionKey); } catch { throw new OwnerQuoteReleaseStorageError(); }
  if (!Array.isArray(identity) || identity.length !== 4 || identity[0] !== 'authenticated'
    || typeof identity[1] !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(identity[1])
    || typeof identity[2] !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/u.test(identity[2])
    || !Number.isSafeInteger(identity[3]) || identity[3] < 0 || ownerSessionKey !== JSON.stringify(identity)
    || !Number.isInteger(quoteId) || quoteId < 1 || quoteId > 2147483647) throw new OwnerQuoteReleaseStorageError();
  const key = `bivaro:quote-release-owner:uncertain:v1:${encodeURIComponent(ownerSessionKey)}:${quoteId}`;
  function read(): boolean {
    try {
      const value = storage().getItem(key);
      if (value === null) return false;
      if (value === '1') return true;
      throw new OwnerQuoteReleaseStorageError();
    } catch { throw new OwnerQuoteReleaseStorageError(); }
  }
  function clear() {
    try { const target = storage(); target.removeItem(key); if (target.getItem(key) !== null) throw new OwnerQuoteReleaseStorageError(); }
    catch { throw new OwnerQuoteReleaseStorageError(); }
  }
  return Object.freeze({
    read,
    begin(reviewedUncertainty: boolean) {
      const priorUncertainty = read();
      if (priorUncertainty && !reviewedUncertainty) throw new OwnerQuoteReleaseReviewRequiredError();
      try {
        const target = storage(); target.setItem(key, '1');
        if (target.getItem(key) !== '1') throw new OwnerQuoteReleaseStorageError();
      } catch { throw new OwnerQuoteReleaseStorageError(); }
      return Object.freeze({ priorUncertainty });
    },
    confirmed(value: unknown, body: OwnerQuoteReleaseCaptureBody) {
      const receipt = parseOwnerQuoteReleaseClientReceipt(value, body); // Never clear on an inferred/malformed success.
      clear(); return receipt;
    },
    knownRejected(priorUncertainty: boolean) { if (!priorUncertainty) clear(); },
  });
}

const SHA = /^[a-f0-9]{64}$/u;
function fields(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function invalid(): never { throw new Error('Der geladene Versionsstand ist ungültig. Bitte nicht erneut speichern.'); }
function expected(value: unknown): OwnerQuoteReleaseExpected {
  try { return parseOwnerQuoteReleaseCaptureBody({ expected: value, expiresAt: '2000-01-01T00:00:00.000Z', reason: 'Transportprüfung' }).expected; }
  catch { return invalid(); }
}
export function parseOwnerQuoteReleaseClientState(value: unknown, quoteId: number): OwnerQuoteReleaseState {
  if (!fields(value, ['quoteId', 'expected', 'eligibility', 'validUntil', 'totalVersions', 'history', 'hasMore', 'publicAccessEnabled'])
    || value.quoteId !== quoteId || value.publicAccessEnabled !== false || (value.eligibility !== 'RECEIPT_BOUND' && value.eligibility !== 'UNAVAILABLE')
    || (value.validUntil !== null && !ownerQuoteReleaseInstant(value.validUntil)) || !Number.isSafeInteger(value.totalVersions) || Number(value.totalVersions) < 0
    || !Array.isArray(value.history) || value.history.length > 20 || Number(value.totalVersions) < value.history.length
    || value.hasMore !== (Number(value.totalVersions) > value.history.length)
    || (value.eligibility === 'RECEIPT_BOUND') !== (value.expected !== null)) return invalid();
  const guards = value.expected === null ? null : expected(value.expected);
  const ids = new Set<string>();
  const history = value.history.map(row => {
    if (!fields(row, ['id', 'generation', 'snapshotSha256', 'createdAt', 'expiresAt', 'revokedAt', 'permanentlyClosed', 'current', 'response'])
      || !ownerQuoteReleaseId(row.id) || ids.has(row.id) || !Number.isInteger(row.generation) || Number(row.generation) < 1 || Number(row.generation) > 2147483647
      || typeof row.snapshotSha256 !== 'string' || !SHA.test(row.snapshotSha256) || !ownerQuoteReleaseInstant(row.createdAt) || !ownerQuoteReleaseInstant(row.expiresAt)
      || Date.parse(row.expiresAt) <= Date.parse(row.createdAt) || (row.revokedAt !== null && !ownerQuoteReleaseInstant(row.revokedAt))
      || typeof row.permanentlyClosed !== 'boolean' || typeof row.current !== 'boolean') return invalid();
    ids.add(row.id);
    if (row.response !== null && (!fields(row.response, ['decision', 'recordedAt']) || (row.response.decision !== 'ACCEPT' && row.response.decision !== 'REJECT') || !ownerQuoteReleaseInstant(row.response.recordedAt))) return invalid();
    return { id: row.id, generation: Number(row.generation), snapshotSha256: row.snapshotSha256, createdAt: row.createdAt, expiresAt: row.expiresAt,
      revokedAt: row.revokedAt as string | null, permanentlyClosed: row.permanentlyClosed, current: row.current,
      response: row.response === null ? null : { decision: (row.response as Record<string, unknown>).decision as 'ACCEPT' | 'REJECT', recordedAt: (row.response as Record<string, unknown>).recordedAt as string } };
  });
  const current = history.filter(row => row.current);
  if (current.length > 1 || (guards && (guards.currentReleaseId === null ? current.length !== 0
    : current.length !== 1 || current[0].id !== guards.currentReleaseId || current[0].generation !== guards.revision || current[0].revokedAt !== null || current[0].permanentlyClosed))) return invalid();
  return { quoteId, expected: guards, eligibility: value.eligibility as OwnerQuoteReleaseState['eligibility'], validUntil: value.validUntil as string | null,
    totalVersions: Number(value.totalVersions), history, hasMore: value.hasMore as boolean, publicAccessEnabled: false };
}
export function parseOwnerQuoteReleaseClientReceipt(value: unknown, body: OwnerQuoteReleaseCaptureBody): OwnerQuoteReleaseClientReceipt {
  if (!fields(value, ['authorityId', 'releaseId', 'revision', 'snapshotSha256', 'createdAt', 'expiresAt'])
    || !ownerQuoteReleaseId(value.authorityId) || !ownerQuoteReleaseId(value.releaseId) || value.releaseId === body.expected.currentReleaseId
    || (body.expected.authorityId !== null && value.authorityId !== body.expected.authorityId) || value.revision !== body.expected.revision + 1
    || typeof value.snapshotSha256 !== 'string' || !SHA.test(value.snapshotSha256) || !ownerQuoteReleaseInstant(value.createdAt)
    || value.expiresAt !== body.expiresAt || Date.parse(body.expiresAt) <= Date.parse(value.createdAt)) return invalid();
  return { authorityId: value.authorityId, releaseId: value.releaseId, revision: Number(value.revision), snapshotSha256: value.snapshotSha256, createdAt: value.createdAt, expiresAt: body.expiresAt };
}
export function ownerQuoteReleaseLocalDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function ownerQuoteReleaseClientBody(guards: OwnerQuoteReleaseExpected, localExpiry: string, reason: string, validUntil: string | null, now = Date.now()): OwnerQuoteReleaseCaptureBody {
  const expiry = new Date(localExpiry);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/u.test(localExpiry) || !Number.isFinite(expiry.getTime()) || ownerQuoteReleaseLocalDateTime(expiry) !== localExpiry || expiry.getTime() <= now)
    throw new Error('Bitte ein gültiges zukünftiges Ablaufdatum in Ihrer lokalen Zeit wählen.');
  if (validUntil !== null && expiry.getTime() > Date.parse(validUntil)) throw new Error('Die interne Version darf nicht länger als das Angebot selbst gültig sein.');
  return parseOwnerQuoteReleaseCaptureBody({ expected: guards, expiresAt: expiry.toISOString(), reason });
}
