/** Owner-only transport contract. No public capability, file path or private source JSON. */
export type OwnerQuoteReleaseExpected = Readonly<{
  authorityId: string | null;
  revision: number;
  currentReleaseId: string | null;
  sourceFingerprint: string;
}>;
export type OwnerQuoteReleaseCaptureBody = Readonly<{
  expected: OwnerQuoteReleaseExpected;
  expiresAt: string;
  reason: string;
}>;
export type OwnerQuoteReleaseHistoryItem = Readonly<{
  id: string;
  generation: number;
  snapshotSha256: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  permanentlyClosed: boolean;
  current: boolean;
  response: Readonly<{ decision: 'ACCEPT' | 'REJECT'; recordedAt: string }> | null;
}>;
export type OwnerQuoteReleaseState = Readonly<{
  quoteId: number;
  expected: OwnerQuoteReleaseExpected | null;
  eligibility: 'RECEIPT_BOUND' | 'UNAVAILABLE';
  validUntil: string | null;
  totalVersions: number;
  history: readonly OwnerQuoteReleaseHistoryItem[];
  hasMore: boolean;
  // Captures are internal evidence only, regardless of the stored access bit.
  publicAccessEnabled: false;
}>;

export class OwnerQuoteReleaseInputError extends Error {
  constructor() { super('Ungültige Versionsanfrage. Bitte das Angebot erneut laden und prüfen.'); }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA = /^[0-9a-f]{64}$/u;
function closed(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === fields.length && keys.every(key => {
    if (typeof key !== 'string' || !fields.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    return descriptor.enumerable && Object.hasOwn(descriptor, 'value');
  });
}
export function ownerQuoteReleaseInstant(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
export function ownerQuoteReleaseId(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }
export function parseOwnerQuoteReleaseCaptureBody(value: unknown): OwnerQuoteReleaseCaptureBody {
  if (!closed(value, ['expected', 'expiresAt', 'reason']) || !closed(value.expected, ['authorityId', 'revision', 'currentReleaseId', 'sourceFingerprint'])) throw new OwnerQuoteReleaseInputError();
  const expected = value.expected;
  if ((expected.authorityId !== null && !ownerQuoteReleaseId(expected.authorityId))
    || (expected.currentReleaseId !== null && !ownerQuoteReleaseId(expected.currentReleaseId))
    || typeof expected.revision !== 'number' || !Number.isInteger(expected.revision) || expected.revision < 0 || expected.revision >= 2147483646
    || (expected.authorityId === null && (expected.revision !== 0 || expected.currentReleaseId !== null))
    || typeof expected.sourceFingerprint !== 'string' || !SHA.test(expected.sourceFingerprint)
    || !ownerQuoteReleaseInstant(value.expiresAt)
    || typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 500 || /[\0-\x1f\x7f]/u.test(value.reason)) throw new OwnerQuoteReleaseInputError();
  return Object.freeze({ expected: Object.freeze({ authorityId: expected.authorityId, revision: expected.revision, currentReleaseId: expected.currentReleaseId, sourceFingerprint: expected.sourceFingerprint }), expiresAt: value.expiresAt, reason: value.reason.trim() });
}
