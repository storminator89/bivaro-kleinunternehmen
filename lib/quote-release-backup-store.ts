import { createHash } from 'node:crypto';
import type { Prisma, QuoteElectronicResponse, QuoteRelease, QuoteReleaseAuthority } from '@prisma/client';
import { QUOTE_RELEASE_BACKUP_SCHEMA_VERSION } from '@/lib/backup-schema-identities';
import { MAX_BACKUP_ZIP_ENTRY_BYTES } from '@/lib/resource-limits';
import { quoteReleaseGraphFromBackup, quoteReleaseImmutableGraphFingerprint, type QuoteReleaseBackupGraph } from '@/lib/quote-release-backup';

type Client = Pick<Prisma.TransactionClient, 'quoteReleaseAuthority' | 'quoteRelease' | 'quoteElectronicResponse' | 'invoice'>;
type RawGraph = { authorities: QuoteReleaseAuthority[]; releases: QuoteRelease[]; responses: QuoteElectronicResponse[] };
type SourceInvoice = { id: number; userId?: string; type: string; status: string; customerId: number | null; convertedFromQuoteId: number | null };
const MAX_ROWS = 10_000;
const MAX_REVISION = 2147483647;
function fail(message: string): never { throw new Error(`Angebotsfreigabe-Wiederherstellung: ${message}`); }

/** Owner checks precede portable projection; source owners are never imported. */
export function portableQuoteReleaseGraph(raw: RawGraph, userId: string, invoices: SourceInvoice[]): QuoteReleaseBackupGraph {
  if ([raw.authorities, raw.releases, raw.responses].some(rows => rows.length > MAX_ROWS)) fail('Nachweisgraph überschreitet das Limit.');
  if ([...raw.authorities, ...raw.releases, ...raw.responses].some(row => row.userId !== userId)) fail('Nachweis gehört nicht zum Mandanten.');
  for (const row of raw.authorities) if ((row.sourceUserId === null) !== (row.sourceInvoiceId === null) || (row.sourceUserId !== null && row.sourceUserId !== userId)) fail('Quellbindung widerspricht dem Mandanten.');
  return quoteReleaseGraphFromBackup({
    user: { id: userId }, invoices,
    quoteReleaseAuthorities: raw.authorities.map(({ id, sourceInvoiceId, revision, currentReleaseId, boundCustomerId }) => ({ id, sourceInvoiceId, revision, currentReleaseId, boundCustomerId })),
    quoteReleases: raw.releases.map(({ userId: _owner, ...row }) => { void _owner; return row; }),
    quoteElectronicResponses: raw.responses.map(({ userId: _owner, ...row }) => { void _owner; return row; }),
  }, QUOTE_RELEASE_BACKUP_SCHEMA_VERSION);
}

/** Bounded pages avoid materializing 10,000 maximal private payloads at once. */
export async function readQuoteReleaseRows(client: Client, userId: string): Promise<RawGraph> {
  const [authorities, responses] = await Promise.all([
    client.quoteReleaseAuthority.findMany({ where: { userId }, orderBy: { id: 'asc' }, take: MAX_ROWS + 1 }),
    client.quoteElectronicResponse.findMany({ where: { userId }, orderBy: { requestId: 'asc' }, take: MAX_ROWS + 1 }),
  ]);
  if (authorities.length > MAX_ROWS || responses.length > MAX_ROWS) fail('Nachweisgraph überschreitet das Limit.');
  const releases: QuoteRelease[] = [];
  let cursor: string | undefined;
  let metadataBytes = 0;
  for (;;) {
    const page = await client.quoteRelease.findMany({ where: { userId }, orderBy: { id: 'asc' }, take: 32, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    for (const release of page) {
      metadataBytes += Buffer.byteLength(JSON.stringify(release), 'utf8');
      if (metadataBytes > MAX_BACKUP_ZIP_ENTRY_BYTES || releases.length >= MAX_ROWS) fail('Freigabemetadaten überschreiten das Backup-Limit.');
      releases.push(release);
    }
    if (page.length < 32) break;
    cursor = page.at(-1)!.id;
  }
  return { authorities, releases, responses };
}

async function readTarget(client: Client, userId: string): Promise<QuoteReleaseBackupGraph> {
  const raw = await readQuoteReleaseRows(client, userId);
  const sourceIds = raw.authorities.flatMap(row => row.sourceInvoiceId === null ? [] : [row.sourceInvoiceId]);
  const invoices = new Map<number, SourceInvoice>();
  for (const ids of chunks(sourceIds)) for (const row of await client.invoice.findMany({
    where: { userId, OR: [{ id: { in: ids } }, { convertedFromQuoteId: { in: ids } }] },
    select: { id: true, userId: true, type: true, status: true, customerId: true, convertedFromQuoteId: true },
  })) invoices.set(row.id, row);
  return portableQuoteReleaseGraph(raw, userId, [...invoices.values()]);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
function signature(graph: QuoteReleaseBackupGraph): string {
  const hash = createHash('sha256');
  for (const key of ['authorities', 'releases', 'responses'] as const) {
    hash.update(key + '\0');
    for (const row of graph[key]) hash.update(JSON.stringify(canonical(row)) + '\0');
  }
  return hash.digest('hex');
}
function chunks<T>(rows: T[]): T[][] { return Array.from({ length: Math.ceil(rows.length / 400) }, (_, index) => rows.slice(index * 400, index * 400 + 400)); }

export type QuoteReleaseRestorePlan = {
  targetSignature: string;
  importAuthorityIds: string[];
  replayAuthorityIds: string[];
  retire: Array<{ id: string; revision: number; currentReleaseId: string }>;
  disableReleaseIds: string[];
  /** Only these release UUIDs may reuse independently checked target originals. */
  reuseReleaseIds: string[];
};

/** Read before file staging and again in the enclosing serializable transaction. */
export async function preflightQuoteReleaseRestore(client: Client, userId: string, source: QuoteReleaseBackupGraph, overwrite: boolean): Promise<QuoteReleaseRestorePlan> {
  const target = await readTarget(client, userId);
  if (overwrite && target.authorities.length) fail('Überschreiben bestehender Freigabeidentitäten ist nicht unterstützt; Zusammenführen oder leeres Ziel verwenden.');
  for (const ids of chunks(source.authorities.map(row => row.id))) {
    const owners = await client.quoteReleaseAuthority.findMany({ where: { id: { in: ids } }, select: { id: true, userId: true } });
    if (owners.some(row => row.userId !== userId)) fail('Portable Authority-UUID kollidiert mit einem anderen Mandanten.');
  }
  for (const ids of chunks(source.releases.map(row => row.id))) {
    const owners = await client.quoteRelease.findMany({ where: { id: { in: ids } }, select: { id: true, userId: true, authorityId: true } });
    for (const row of owners) {
      if (row.userId !== userId) fail('Portable Freigabe-UUID kollidiert mit einem anderen Mandanten.');
      if (source.releases.find(value => value.id === row.id)!.authorityId !== row.authorityId) fail('Freigabe-UUID gehört zu einer anderen Authority.');
    }
  }
  for (const row of source.releases) if (target.releases.some(existing => existing.originalArchiveName === row.originalArchiveName && existing.id !== row.id)) fail('Unveränderliche Originalidentität kollidiert im Ziel.');
  for (const row of source.responses) {
    const existing = target.responses.find(value => value.requestId === row.requestId);
    if (existing && (existing.authorityId !== row.authorityId || existing.releaseId !== row.releaseId)) fail('Antwortanfrage-ID gehört zu einem anderen Zielnachweis.');
  }
  const plan: QuoteReleaseRestorePlan = { targetSignature: signature(target), importAuthorityIds: [], replayAuthorityIds: [], retire: [], disableReleaseIds: [], reuseReleaseIds: [] };
  for (const authority of source.authorities) {
    const existing = target.authorities.find(row => row.id === authority.id);
    if (!existing) { plan.importAuthorityIds.push(authority.id); continue; }
    if (quoteReleaseImmutableGraphFingerprint(source, authority.id) !== quoteReleaseImmutableGraphFingerprint(target, authority.id)) fail('Vollständiger unveränderlicher Zielgraph ist älter, neuer oder abweichend; keine Vorfahren-Zusammenführung.');
    if (existing.revision < authority.revision || (existing.sourceInvoiceId === null && existing.revision !== authority.revision)) fail('High-Water-Revision des Ziels ist nicht kompatibel.');
    if (existing.currentReleaseId !== null) {
      if (existing.revision >= MAX_REVISION) fail('Authority kann nicht mehr sicher stillgelegt werden.');
      plan.retire.push({ id: existing.id, revision: existing.revision, currentReleaseId: existing.currentReleaseId });
    }
    const releases = target.releases.filter(row => row.authorityId === authority.id);
    plan.disableReleaseIds.push(...releases.filter(row => row.restoredAccessDisabled === 0).map(row => row.id));
    plan.reuseReleaseIds.push(...releases.map(row => row.id));
    plan.replayAuthorityIds.push(authority.id);
  }
  return plan;
}

export type QuoteReleaseRestoreCounts = {
  authorities: { imported: number; skipped: number };
  releases: { imported: number; skipped: number };
  responses: { imported: number; skipped: number };
};

/** Server-only closed path. Caller must supply its mandatory audit in SAME tx.
 * No incoming owner, current pointer, source binding or enabled flag is copied. */
export async function restoreQuoteReleaseClosedGraph(tx: Client, userId: string, source: QuoteReleaseBackupGraph, overwrite: boolean, expected: QuoteReleaseRestorePlan): Promise<QuoteReleaseRestoreCounts> {
  const plan = await preflightQuoteReleaseRestore(tx, userId, source, overwrite);
  if (JSON.stringify(plan) !== JSON.stringify(expected)) fail('Zielnachweise wurden seit der Vorprüfung verändert.');
  for (const row of plan.retire) {
    const result = await tx.quoteReleaseAuthority.updateMany({ where: { id: row.id, userId, revision: row.revision, currentReleaseId: row.currentReleaseId }, data: { revision: row.revision + 1, currentReleaseId: null } });
    if (result.count !== 1) fail('Authority-Stilllegung verlor ihren exakten CAS.');
  }
  for (const id of plan.disableReleaseIds) {
    const result = await tx.quoteRelease.updateMany({ where: { id, userId, restoredAccessDisabled: 0 }, data: { restoredAccessDisabled: 1 } });
    if (result.count !== 1) fail('Freigabe wurde während der Stilllegung verändert.');
  }
  const imported = new Set(plan.importAuthorityIds);
  const counts: QuoteReleaseRestoreCounts = { authorities: { imported: 0, skipped: plan.replayAuthorityIds.length }, releases: { imported: 0, skipped: 0 }, responses: { imported: 0, skipped: 0 } };
  for (const row of source.authorities.filter(row => imported.has(row.id))) {
    await tx.quoteReleaseAuthority.create({ data: { id: row.id, userId, sourceUserId: null, sourceInvoiceId: null, boundCustomerId: null, revision: row.revision, currentReleaseId: null } });
    counts.authorities.imported++;
    for (const release of source.releases.filter(value => value.authorityId === row.id).sort((a, b) => a.generation - b.generation)) {
      await tx.quoteRelease.create({ data: { ...release, userId, restoredAccessDisabled: 1 } });
      counts.releases.imported++;
    }
    for (const response of source.responses.filter(value => value.authorityId === row.id)) {
      await tx.quoteElectronicResponse.create({ data: { ...response, userId } });
      counts.responses.imported++;
    }
  }
  counts.releases.skipped = source.releases.length - counts.releases.imported;
  counts.responses.skipped = source.responses.length - counts.responses.imported;
  const after = await readTarget(tx, userId);
  for (const row of source.authorities) {
    const stored = after.authorities.find(value => value.id === row.id);
    if (!stored || stored.currentReleaseId !== null || (imported.has(row.id) && stored.sourceInvoiceId !== null)) fail('Wiederhergestellte Authority ist nicht geschlossen.');
    if (quoteReleaseImmutableGraphFingerprint(source, row.id) !== quoteReleaseImmutableGraphFingerprint(after, row.id)) fail('Wiederhergestellter unveränderlicher Graph stimmt nicht überein.');
  }
  if (source.releases.some(row => after.releases.find(value => value.id === row.id)?.restoredAccessDisabled !== 1)) fail('Historische Freigabe wurde nicht dauerhaft geschlossen.');
  return counts;
}
