import { createHash } from 'node:crypto';
import { QUOTE_RELEASE_BACKUP_SCHEMA_VERSION } from '@/lib/backup-schema-identities';
import { parseQuoteReleaseSnapshot, parseQuoteResponseCommand, type QuoteReleaseSnapshot, type QuoteResponseCommand } from '@/lib/quote-release-contract';

export type QuoteReleaseAuthorityBackup = {
  id: string;
  sourceInvoiceId: number | null;
  revision: number;
  currentReleaseId: string | null;
  boundCustomerId: number | null;
};
export type QuoteReleaseBackup = QuoteReleaseSnapshot & {
  id: string;
  authorityId: string;
  generation: number;
  previousReleaseId: string | null;
  originalArchiveName: string;
  sourcePayload: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  restoredAccessDisabled: 0 | 1;
};
export type QuoteElectronicResponseBackup = QuoteResponseCommand & {
  authorityId: string;
  recordedAt: string;
};
export type QuoteReleaseBackupGraph = {
  authorities: QuoteReleaseAuthorityBackup[];
  releases: QuoteReleaseBackup[];
  responses: QuoteElectronicResponseBackup[];
};

type Row = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_INT = 2147483647;
const MAX_ROWS = 10_000;
const GRAPH_KEYS = ['quoteReleaseAuthorities', 'quoteReleases', 'quoteElectronicResponses'] as const;
const AUTHORITY_FIELDS = ['id', 'sourceInvoiceId', 'revision', 'currentReleaseId', 'boundCustomerId'];
const IMMUTABLE_RELEASE_FIELDS = ['id', 'authorityId', 'generation', 'previousReleaseId', 'version', 'sourceFingerprint', 'originalSha256', 'originalBytes', 'snapshotSha256', 'originalArchiveName', 'sourcePayload', 'createdAt', 'expiresAt'] as const;
const RELEASE_FIELDS = [...IMMUTABLE_RELEASE_FIELDS, 'revokedAt', 'restoredAccessDisabled'];
const RESPONSE_FIELDS = ['requestId', 'authorityId', 'releaseId', 'version', 'snapshotSha256', 'decision', 'comment', 'recordedAt'] as const;
function fail(message: string): never { throw new Error(`Angebotsfreigabe-Backup: ${message}`); }
function object(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail('Kein einfaches Datenobjekt.');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], 'value'))) return fail('Versteckte Felder, Symbole oder Zugriffsfunktionen sind unzulässig.');
  return value as Row;
}
function exact(value: unknown, fields: readonly string[]): Row {
  const row = object(value);
  if (Object.keys(row).length !== fields.length || fields.some(key => !Object.hasOwn(row, key))) return fail('Fehlende oder unbekannte Felder; Besitzer werden ausschließlich vom geprüften Manifest bestimmt.');
  return row;
}
function array(value: unknown, max = MAX_ROWS): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max) return fail('Vollständiger Abschnitt fehlt oder überschreitet das Zeilenlimit.');
  if (Reflect.ownKeys(value).length !== value.length + 1) return fail('Zusätzliche Arrayfelder sind unzulässig.');
  // Read only data descriptors: sparse arrays and getters must never execute.
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return fail('Lücken oder Zugriffsfunktionen im Abschnitt.');
    return descriptor.value;
  });
}
function uuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }
function int(value: unknown, min: number): value is number { return typeof value === 'number' && Number.isInteger(value) && !Object.is(value, -0) && value >= min && value <= MAX_INT; }
function instant(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function archiveName(value: unknown): value is string {
  // Match the private tenant upload resolver: no legacy/private-root fallback.
  return typeof value === 'string' && /^[a-f0-9-]{36}\.[a-z0-9]{1,16}$/u.test(value);
}
function unique(set: Set<string | number>, key: string | number): void {
  if (set.has(key)) fail('Doppelte portable, Quell-, Generations-, Original- oder Antwortidentität.');
  set.add(key);
}
/** Retain the exact supplied text, never reserialize historical private context. */
function sourcePayload(value: unknown): string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 1024 * 1024) return fail('Quellkontext überschreitet 1 MiB oder ist kein JSON-Text.');
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return fail('Ungültiger JSON-Quellkontext.'); }
  const stack: Array<{ value: unknown; depth: number }> = [{ value: parsed, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const item = stack.pop()!;
    if (++nodes > 20_000 || item.depth > 32) return fail('Quellkontext ist zu komplex.');
    if (typeof item.value === 'number' && !Number.isFinite(item.value)) return fail('Nicht endliche JSON-Zahl.');
    if (item.value && typeof item.value === 'object') {
      const children = Object.values(item.value);
      if (nodes + stack.length + children.length > 20_000) return fail('Quellkontext ist zu komplex.');
      for (const child of children) stack.push({ value: child, depth: item.depth + 1 });
    }
  }
  return value;
}

/**
 * Pure closed-shape/integrity validation, never recipient authentication or
 * evidence that a historical response was genuine consent. No I/O or activation.
 */
export function quoteReleaseGraphFromBackup(data: Record<string, unknown>, schemaVersion?: string): QuoteReleaseBackupGraph {
  const root = object(data);
  if (schemaVersion !== QUOTE_RELEASE_BACKUP_SCHEMA_VERSION) {
    if (GRAPH_KEYS.some(key => Object.hasOwn(root, key))) fail('Diese Schemaidentität erlaubt keine Freigabeabschnitte, auch nicht leer, null oder undefined.');
    return { authorities: [], releases: [], responses: [] };
  }
  if (GRAPH_KEYS.some(key => !Object.hasOwn(root, key))) fail('Vollständige Freigabeabschnitte fehlen.');
  const authorityIds = new Set<string | number>(), sourceIds = new Set<string | number>();
  const authorities = array(root.quoteReleaseAuthorities).map(value => {
    const row = exact(value, AUTHORITY_FIELDS);
    if (!uuid(row.id) || !int(row.revision, 0) || (row.sourceInvoiceId !== null && !int(row.sourceInvoiceId, 1)) || (row.currentReleaseId !== null && !uuid(row.currentReleaseId)) || (row.boundCustomerId !== null && !int(row.boundCustomerId, 1))) return fail('Ungültige Authority-Identität oder Int32-Revision.');
    if (row.sourceInvoiceId === null && (row.boundCustomerId !== null || row.currentReleaseId !== null)) return fail('Abgetrennte Authority muss dauerhaft geschlossen sein.');
    unique(authorityIds, row.id);
    if (row.sourceInvoiceId !== null) unique(sourceIds, row.sourceInvoiceId);
    return Object.freeze({ ...row }) as QuoteReleaseAuthorityBackup;
  });
  const byAuthority = new Map(authorities.map(row => [row.id, row]));
  const releaseIds = new Set<string | number>(), generations = new Set<string | number>(), archives = new Set<string | number>();
  const releases = array(root.quoteReleases).map(value => {
    const row = exact(value, RELEASE_FIELDS);
    if (!uuid(row.id) || !uuid(row.authorityId) || !int(row.generation, 1) || (row.previousReleaseId !== null && !uuid(row.previousReleaseId)) || !archiveName(row.originalArchiveName) || !instant(row.createdAt) || !instant(row.expiresAt) || row.expiresAt <= row.createdAt || (row.revokedAt !== null && (!instant(row.revokedAt) || row.revokedAt < row.createdAt)) || (row.restoredAccessDisabled !== 0 && row.restoredAccessDisabled !== 1)) return fail('Ungültige Freigabebindung, Zeit oder Int0/1-Zugriffssperre.');
    parseQuoteReleaseSnapshot(Object.fromEntries(['version', 'sourceFingerprint', 'originalSha256', 'originalBytes', 'snapshotSha256'].map(key => [key, row[key]])));
    sourcePayload(row.sourcePayload);
    const authority = byAuthority.get(row.authorityId);
    if (!authority || row.generation > authority.revision) return fail('Verwaiste Freigabe oder Generation oberhalb der High-Water-Revision.');
    unique(releaseIds, row.id); unique(generations, `${row.authorityId}:${row.generation}`); unique(archives, row.originalArchiveName);
    return Object.freeze({ ...row }) as QuoteReleaseBackup;
  });
  const byRelease = new Map(releases.map(row => [row.id, row]));
  for (const release of releases) if (release.previousReleaseId !== null) {
    const previous = byRelease.get(release.previousReleaseId);
    if (!previous || previous.authorityId !== release.authorityId || previous.generation >= release.generation) fail('Vorfahr gehört nicht zur selben früheren Authority-Generation.');
  }
  // A later generation may be a root: source invalidation deliberately forms forests.
  const boundAuthorities = authorities.filter(row => row.sourceInvoiceId !== null);
  if (boundAuthorities.length) {
    const invoices = array(root.invoices, MAX_INT).map(object);
    const sourceOwner = root.user === undefined ? undefined : object(root.user).id;
    const byInvoice = new Map<number, Row>();
    const convertedSources = new Set(invoices.map(row => row.convertedFromQuoteId));
    for (const invoice of invoices) {
      if (!int(invoice.id, 1)) fail('Ungültige Int32-Quellbeleg-ID.');
      if (byInvoice.has(invoice.id)) fail('Doppelte Quellbeleg-ID.');
      byInvoice.set(invoice.id, invoice);
    }
    for (const authority of boundAuthorities) {
      const invoice = byInvoice.get(authority.sourceInvoiceId!);
      if (!invoice || invoice.type !== 'QUOTE' || (invoice.userId !== undefined && (typeof sourceOwner !== 'string' || invoice.userId !== sourceOwner)) || invoice.customerId !== authority.boundCustomerId) fail('Authority benötigt ein eigenes Angebot mit exaktem Kundenmirror.');
      if (authority.currentReleaseId !== null && (typeof invoice.status !== 'string' || !['DRAFT', 'SENT'].includes(invoice.status) || convertedSources.has(invoice.id))) fail('Aktuelle Freigabe benötigt eine lebende, nicht umgewandelte Quelle.');
    }
  }
  for (const authority of authorities) if (authority.currentReleaseId !== null) {
    const release = byRelease.get(authority.currentReleaseId);
    if (!release || release.authorityId !== authority.id || release.generation !== authority.revision || release.generation >= MAX_INT || release.restoredAccessDisabled !== 0 || release.revokedAt !== null || authority.sourceInvoiceId === null) fail('Aktueller Freigabezeiger ist widersprüchlich, ausgeschöpft oder geschlossen.');
  }
  const requestIds = new Set<string | number>(), responseReleaseIds = new Set<string | number>();
  const responses = array(root.quoteElectronicResponses).map(value => {
    const row = exact(value, RESPONSE_FIELDS);
    const { authorityId, recordedAt, ...commandFields } = row;
    const command = parseQuoteResponseCommand(commandFields);
    const release = byRelease.get(command.releaseId);
    if (!uuid(authorityId) || !release || authorityId !== release.authorityId || command.version !== release.version || command.snapshotSha256 !== release.snapshotSha256 || !instant(recordedAt) || recordedAt < release.createdAt || recordedAt >= release.expiresAt || (release.revokedAt !== null && recordedAt > release.revokedAt)) return fail('Antwort widerspricht Freigabe, Snapshot oder historischem Zeitfenster.');
    unique(requestIds, command.requestId); unique(responseReleaseIds, command.releaseId);
    return Object.freeze({ ...command, authorityId, recordedAt });
  });
  return { authorities, releases, responses };
}

/** Full immutable history identity. Closure changes cannot reopen or merge it. */
export function quoteReleaseImmutableGraphFingerprint(graph: QuoteReleaseBackupGraph, authorityId: string): string {
  if (!uuid(authorityId) || !graph.authorities.some(row => row.id === authorityId)) return fail('Authority für exakten Verlaufsvergleich fehlt.');
  const ordered = <T>(rows: T[], key: (row: T) => string) => [...rows].sort((left, right) => key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0);
  const payload = [authorityId,
    ordered(graph.releases.filter(row => row.authorityId === authorityId), row => row.id).map(row => IMMUTABLE_RELEASE_FIELDS.map(key => row[key])),
    ordered(graph.responses.filter(row => row.authorityId === authorityId), row => row.requestId).map(row => RESPONSE_FIELDS.map(key => row[key])),
  ];
  return createHash('sha256').update('bivaro.quote-release.immutable-backup.v1\0').update(JSON.stringify(payload)).digest('hex');
}

/** JSON is metadata only: callers must independently verify existing originals. */
export function validateQuoteReleaseOriginalManifest(graph: QuoteReleaseBackupGraph, files: Array<{ kind: string; sourceName: string; sha256: string; bytes: number; zipPath?: string }>, requireFiles: boolean): void {
  const originals = new Map(graph.releases.map(release => [release.originalArchiveName, release]));
  const seen = new Set<string | number>();
  for (const value of array(files, MAX_INT)) {
    const file = object(value);
    if (file.kind !== 'quote-release-original') continue;
    if (typeof file.sourceName !== 'string') fail('Originalquelle fehlt.');
    unique(seen, file.sourceName);
    const release = originals.get(file.sourceName);
    if (!release || file.sha256 !== release.originalSha256 || file.bytes !== release.originalBytes || (file.zipPath !== undefined && file.zipPath !== `quote-release-originals/${release.originalArchiveName}`) || (requireFiles && file.zipPath === undefined)) fail('Originalmanifest ist verwaist oder widerspricht exakter Datei-/Hash-/Bytebindung.');
  }
  if (requireFiles && [...originals.keys()].some(name => !seen.has(name))) fail('Vollständiges ZIP benötigt jedes gebundene Freigabeoriginal.');
}
