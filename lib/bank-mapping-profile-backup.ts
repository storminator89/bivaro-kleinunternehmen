import type { Prisma } from '@prisma/client';
import { bankImportUuid } from '@/lib/bank-import-contract';
import { BANK_MAPPING_PROFILE_LIMIT, bankMappingProfileRevision, parseBankMappingProfileConfiguration, type BankMappingProfileConfiguration } from '@/lib/bank-mapping-profile-contract';

type RecordValue = Record<string, unknown>;
export type PortableBankMappingProfile = { id: string; revision: number; deletedAt: string | null; deleteMutationId: string | null; createdAt: string; updatedAt: string };
export type PortableBankMappingProfileRevision = { profileId: string; revision: number; mutationId: string; configuration: BankMappingProfileConfiguration; createdAt: string };
export type BankMappingProfileBackup = { profiles: PortableBankMappingProfile[]; revisions: PortableBankMappingProfileRevision[] };
const PROFILE_FIELDS = ['id', 'revision', 'deletedAt', 'deleteMutationId', 'createdAt', 'updatedAt'];
const REVISION_FIELDS = ['profileId', 'revision', 'mutationId', 'configuration', 'createdAt'];
function fail(message: string): never { throw new Error(`Zuordnungsprofil-Backup: ${message}`); }
function closed(value: unknown, fields: readonly string[]): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Eintrag muss ein Objekt sein.');
  const row = value as RecordValue;
  if (Object.keys(row).length !== fields.length || Object.keys(row).some(key => !fields.includes(key))) fail('Fehlende oder unbekannte Felder; Bankdatensätze sind keine Profilkonfiguration.');
  return row;
}
function iso(value: unknown): string {
  const text = value instanceof Date ? value.toISOString() : value;
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString() !== text) fail('Ungültiger Zeitstempel.');
  return text;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  return JSON.stringify(value);
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/** The closed configuration contract accepts no raw headers, samples or transaction rows. */
export function bankMappingProfilesFromBackup(data: RecordValue, supported: boolean): BankMappingProfileBackup {
  if (!supported) {
    if (Object.hasOwn(data, 'bankMappingProfiles') || Object.hasOwn(data, 'bankMappingProfileRevisions')) fail('Dieses Backupschema unterstützt keine Zuordnungsprofile.');
    if (Array.isArray(data.bankImportBatches) && data.bankImportBatches.some(batch => batch && typeof batch === 'object' && (batch as RecordValue).receipt && typeof (batch as RecordValue).receipt === 'object' && Object.hasOwn((batch as RecordValue).receipt as object, 'mappingProfile'))) fail('Dieses Backupschema unterstützt keine Profilherkunft.');
    return { profiles: [], revisions: [] };
  }
  if (!Array.isArray(data.bankMappingProfiles) || data.bankMappingProfiles.length > 10_000 || !Array.isArray(data.bankMappingProfileRevisions) || data.bankMappingProfileRevisions.length > 100_000) fail('Erforderlicher Profilabschnitt fehlt oder ist zu groß.');
  const ids = new Set<string>();
  const profiles = data.bankMappingProfiles.map(value => {
    const row = closed(value, PROFILE_FIELDS);
    const id = bankImportUuid(row.id), revision = bankMappingProfileRevision(row.revision);
    if (ids.has(id)) fail('Doppelte Profilkennung.'); ids.add(id);
    const deletedAt = row.deletedAt === null ? null : iso(row.deletedAt), deleteMutationId = row.deleteMutationId === null ? null : bankImportUuid(row.deleteMutationId);
    const createdAt = iso(row.createdAt), updatedAt = iso(row.updatedAt);
    if ((deletedAt === null) !== (deleteMutationId === null) || updatedAt < createdAt || (deletedAt !== null && (deletedAt < createdAt || deletedAt > updatedAt))) fail('Inkonsistenter Löschbeleg oder Zeitverlauf.');
    return { id, revision, deletedAt, deleteMutationId, createdAt, updatedAt };
  });
  if (profiles.filter(row => row.deletedAt === null).length > BANK_MAPPING_PROFILE_LIMIT) fail('Mehr als 100 aktive Profile.');
  const byId = new Map(profiles.map(row => [row.id, row])), grouped = new Map<string, PortableBankMappingProfileRevision[]>(), mutationIds = new Set<string>();
  const revisions = data.bankMappingProfileRevisions.map(value => {
    const row = closed(value, REVISION_FIELDS), profileId = bankImportUuid(row.profileId), revision = bankMappingProfileRevision(row.revision), mutationId = bankImportUuid(row.mutationId);
    if (!byId.has(profileId)) fail('Revision ohne Profil.');
    const key = `${profileId}:${mutationId}`;
    if (mutationIds.has(key)) fail('Doppelte Änderungskennung.'); mutationIds.add(key);
    const configuration = parseBankMappingProfileConfiguration(row.configuration);
    if (!same(configuration, row.configuration)) fail('Profilkonfiguration ist nicht kanonisch.');
    const item = { profileId, revision, mutationId, configuration, createdAt: iso(row.createdAt) };
    const group = grouped.get(profileId) ?? []; group.push(item); grouped.set(profileId, group);
    return item;
  });
  for (const profile of profiles) {
    const group = (grouped.get(profile.id) ?? []).sort((a, b) => a.revision - b.revision);
    if (group.length !== profile.revision) fail('Profilhistorie muss vollständig und lückenlos sein.');
    let previous = profile.createdAt;
    for (const [index, item] of group.entries()) {
      if (item.revision !== index + 1 || item.createdAt < previous || item.createdAt > (profile.deletedAt ?? profile.updatedAt)) fail('Widersprüchliche Profilrevision oder Zeitfolge.');
      previous = item.createdAt;
    }
    if (profile.deleteMutationId && mutationIds.has(`${profile.id}:${profile.deleteMutationId}`)) fail('Löschkennung kollidiert mit einer Profilrevision.');
  }
  // Bind historical receipt provenance to the exact retained revision, not its latest name.
  const revisionMap = new Map(revisions.map(row => [`${row.profileId}:${row.revision}`, row]));
  if (Array.isArray(data.bankImportBatches)) for (const candidate of data.bankImportBatches) {
    if (!candidate || typeof candidate !== 'object') continue;
    const batch = candidate as RecordValue, receipt = batch.receipt as RecordValue | undefined;
    if (!receipt || !Object.hasOwn(receipt, 'mappingProfile')) continue;
    const reference = closed(receipt.mappingProfile, ['id', 'revision', 'name']);
    const id = bankImportUuid(reference.id), revision = bankMappingProfileRevision(reference.revision), historical = revisionMap.get(`${id}:${revision}`);
    if (!historical || reference.name !== historical.configuration.name || !same(batch.mapping, historical.configuration.mapping) || batch.delimiter !== historical.configuration.delimiter || batch.parserVersion !== historical.configuration.parserVersion || batch.mappingVersion !== historical.configuration.mappingVersion || iso(batch.createdAt) < historical.createdAt) fail('Profilherkunft stimmt nicht mit ihrer unveränderlichen Revision überein.');
  }
  return { profiles, revisions };
}

/** Pure append/retain plan. Divergent history and tombstone resurrection fail closed. */
export function planBankMappingProfileRestore(target: BankMappingProfileBackup, source: BankMappingProfileBackup): BankMappingProfileBackup {
  const byId = new Map(target.profiles.map(row => [row.id, row])), revisions = new Map(target.revisions.map(row => [`${row.profileId}:${row.revision}`, row]));
  const profiles: PortableBankMappingProfile[] = [], appended: PortableBankMappingProfileRevision[] = [];
  for (const incoming of source.profiles) {
    const existing = byId.get(incoming.id);
    if (existing && existing.createdAt !== incoming.createdAt) fail('Profilkennung kollidiert mit anderer Historie.');
    if (existing?.deletedAt && incoming.revision > existing.revision) fail('Neue Revision nach bestehendem Löschbeleg ist nicht zulässig.');
    if (incoming.deletedAt && existing && incoming.revision < existing.revision) fail('Älterer Löschbeleg darf keine neuere Zielrevision löschen.');
    if (incoming.deletedAt && existing?.deletedAt && (incoming.deletedAt !== existing.deletedAt || incoming.deleteMutationId !== existing.deleteMutationId || incoming.revision !== existing.revision)) fail('Abweichende Löschbelege.');
    const merged = existing && existing.revision >= incoming.revision
      ? { ...existing, ...(incoming.deletedAt && !existing.deletedAt ? { deletedAt: incoming.deletedAt, deleteMutationId: incoming.deleteMutationId, updatedAt: incoming.updatedAt > existing.updatedAt ? incoming.updatedAt : existing.updatedAt } : {}) }
      : incoming;
    profiles.push(merged);
    byId.set(incoming.id, merged);
  }
  const mutationIds = new Map(target.revisions.map(row => [`${row.profileId}:${row.mutationId}`, row.revision]));
  for (const incoming of source.revisions) {
    const key = `${incoming.profileId}:${incoming.revision}`, existing = revisions.get(key), mutationRevision = mutationIds.get(`${incoming.profileId}:${incoming.mutationId}`);
    if ((existing && !same(existing, incoming)) || (mutationRevision !== undefined && mutationRevision !== incoming.revision)) fail('Abweichende unveränderliche Profilrevision.');
    if (!existing) { appended.push(incoming); revisions.set(key, incoming); }
  }
  if ([...byId.values()].filter(row => row.deletedAt === null).length > BANK_MAPPING_PROFILE_LIMIT) fail('Zusammenführen überschreitet die Grenze aktiver Profile.');
  return { profiles, revisions: appended };
}

/** Run only inside the encompassing atomic business restore; overwrite never deletes profiles. */
export async function restoreBankMappingProfiles(tx: Prisma.TransactionClient, userId: string, source: BankMappingProfileBackup) {
  const counts = { profiles: { imported: 0, skipped: 0 }, revisions: { imported: 0, skipped: 0 } };
  if (!source.profiles.length) return counts;
  const stored = await tx.bankMappingProfile.findMany({ where: { userId }, include: { revisions: { orderBy: { revision: 'asc' } } } });
  const target = bankMappingProfilesFromBackup({
    bankMappingProfiles: stored.map(({ id, revision, deletedAt, deleteMutationId, createdAt, updatedAt }) => ({ id, revision, deletedAt, deleteMutationId, createdAt, updatedAt })),
    bankMappingProfileRevisions: stored.flatMap(row => row.revisions.map(({ profileId, revision, mutationId, configuration, createdAt }) => ({ profileId, revision, mutationId, configuration, createdAt }))),
  }, true);
  const plan = planBankMappingProfileRestore(target, source), existingIds = new Set(target.profiles.map(row => row.id));
  for (const row of plan.profiles) {
    const values = { revision: row.revision, deletedAt: row.deletedAt ? new Date(row.deletedAt) : null, deleteMutationId: row.deleteMutationId, updatedAt: new Date(row.updatedAt) };
    if (!existingIds.has(row.id)) {
      try { await tx.bankMappingProfile.create({ data: { id: row.id, userId, createdAt: new Date(row.createdAt), ...values } }); }
      catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') fail('Profilkennung kann im Ziel nicht übernommen werden.'); throw error; }
      counts.profiles.imported++;
    } else {
      const previous = target.profiles.find(item => item.id === row.id)!;
      if (same(previous, row)) counts.profiles.skipped++;
      else { await tx.bankMappingProfile.updateMany({ where: { id: row.id, userId }, data: values }); counts.profiles.imported++; }
    }
  }
  for (const row of plan.revisions) await tx.bankMappingProfileRevision.create({ data: { userId, ...row, configuration: row.configuration as unknown as Prisma.InputJsonValue, createdAt: new Date(row.createdAt) } });
  counts.revisions.imported = plan.revisions.length;
  counts.revisions.skipped = source.revisions.length - plan.revisions.length;
  return counts;
}
