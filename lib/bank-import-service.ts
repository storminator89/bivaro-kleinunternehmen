import 'server-only';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { inTransaction } from '@/lib/db-transaction';
import { BANK_IMPORT_PAGE_SIZE, BankImportError, bankImportUuid, parseBankImportInput, type BankImportReceipt, type BankImportEvidence, type BankImportDetail } from '@/lib/bank-import-contract';
import { readBankAllocationRowsInTransaction } from '@/lib/bank-allocation-service';
import { applyBankMappingProfile, parseBankMappingProfileConfiguration } from '@/lib/bank-mapping-profile-contract';
import { bankImportHash, bankImportEvidenceHash, bankImportRowKeys, bankImportTotals, prepareBankImport } from '@/lib/bank-import-evidence';

const json = (value: unknown) => value as Prisma.InputJsonValue;
const receiptOf = (value: Prisma.JsonValue) => value as unknown as BankImportReceipt;
export async function confirmBankImport(userId: string, value: unknown): Promise<{ receipt: BankImportReceipt; replayed: boolean }> {
  const input = parseBankImportInput(value);
  const prepared = prepareBankImport(input); // Independently decode/reparse ACTUAL bytes, never browser rows/totals.
  const save = () => inTransaction(async tx => {
    const prior = await tx.bankImportBatch.findUnique({ where: { userId_requestId: { userId, requestId: input.requestId } } });
    if (prior) {
      if (prior.fingerprint !== prepared.fingerprint) throw new BankImportError('Diese Importkennung gehört bereits zu einer anderen Datei oder Zuordnung.', 409);
      return { receipt: receiptOf(prior.receipt), replayed: true };
    }
    let mappingProfile: BankImportReceipt['mappingProfile'];
    if (input.mappingProfile) {
      const profile = await tx.bankMappingProfile.findFirst({ where: { id: input.mappingProfile.id, userId, deletedAt: null } });
      const revision = profile && await tx.bankMappingProfileRevision.findUnique({ where: { userId_profileId_revision: { userId, profileId: profile.id, revision: input.mappingProfile.revision } } });
      if (!revision) throw new BankImportError('Das Zuordnungsprofil wurde gelöscht oder ist nicht verfügbar. Datei ohne Profil neu prüfen.', 409);
      const configuration = parseBankMappingProfileConfiguration(revision.configuration);
      const applied = await applyBankMappingProfile(configuration, prepared.parsed);
      if (!applied.matches || bankImportHash(configuration.mapping) !== bankImportHash(input.mapping)) throw new BankImportError('Die Zuordnung passt nicht mehr zur Profilrevision. Bitte erneut prüfen.', 409);
      mappingProfile = { id: profile!.id, revision: revision.revision, name: configuration.name };
    }
    const same = await tx.bankImportBatch.findUnique({ where: { userId_fingerprint: { userId, fingerprint: prepared.fingerprint } } });
    if (same) throw new BankImportError('Diese Datei und Zuordnung wurden bereits gespeichert. Vorhandene Quittung öffnen.', 409, same.stableKey);
    const rows = prepared.rows.map(source => {
      const evidence = structuredClone(source); // Every DB retry starts with clean immutable parser evidence.
      return { sourceRow: evidence.rowNumber, evidence, ...bankImportRowKeys(input.mapping.accountAlias, evidence) };
    });
    const keys = (field: 'externalKey' | 'contentKey' | 'dayAmountKey') => [...new Set(rows.map(row => row[field]).filter((key): key is string => key !== null))];
    // groupBy returns at most one count per supplied key, not an unbounded transaction history.
    const [external, content, dayAmount, sameFile] = await Promise.all([
      tx.bankImportRow.groupBy({ by: ['externalKey'], where: { userId, externalKey: { in: keys('externalKey') } }, _count: true }),
      tx.bankImportRow.groupBy({ by: ['contentKey'], where: { userId, contentKey: { in: keys('contentKey') } }, _count: true }),
      tx.bankImportRow.groupBy({ by: ['dayAmountKey'], where: { userId, dayAmountKey: { in: keys('dayAmountKey') } }, _count: true }),
      tx.bankImportBatch.findFirst({ where: { userId, sourceSha256: prepared.sourceSha256 }, select: { id: true } }),
    ]);
    const externalCounts = new Map(external.map(row => [row.externalKey, row._count]));
    const contentCounts = new Map(content.map(row => [row.contentKey, row._count]));
    const dayCounts = new Map(dayAmount.map(row => [row.dayAmountKey, row._count]));
    for (const row of rows) {
      row.evidence.priorMatches = { external: row.externalKey ? externalCounts.get(row.externalKey) ?? 0 : 0, content: row.contentKey ? contentCounts.get(row.contentKey) ?? 0 : 0, dayAmount: row.dayAmountKey ? dayCounts.get(row.dayAmountKey) ?? 0 : 0 };
      if (Object.values(row.evidence.priorMatches).some(count => count > 0)) {
        row.evidence.duplicate = true;
        const warning = 'Ähnliche Zeilen oder dieselbe Konto-/Bank-ID wurden früher gespeichert. Das beweist keine Dublette; keine Zeile wurde entfernt.';
        row.evidence.warnings = [...row.evidence.warnings, warning];
        row.evidence.duplicateWarnings = [...row.evidence.duplicateWarnings, warning];
      }
    }
    const stableKey = randomUUID(), now = new Date();
    const receipt: BankImportReceipt = { ...(mappingProfile ? { mappingProfile } : {}), version: 1, id: stableKey, requestId: input.requestId, savedAt: now.toISOString(), accountAlias: input.mapping.accountAlias,
      sourceSha256: prepared.sourceSha256, sourceBytes: prepared.sourceBytes, parserVersion: input.parserVersion, mappingVersion: input.mappingVersion,
      ...bankImportTotals(rows.map(row => row.evidence)), evidenceSha256: bankImportEvidenceHash(rows), sameFilePreviouslySaved: sameFile !== null };
    const batch = await tx.bankImportBatch.create({ data: { userId, stableKey, requestId: input.requestId, fingerprint: prepared.fingerprint, sourceSha256: prepared.sourceSha256,
      sourceBytes: prepared.sourceBytes, parserVersion: input.parserVersion, mappingVersion: input.mappingVersion, accountAlias: input.mapping.accountAlias, delimiter: input.delimiter, mapping: json(input.mapping), receipt: json(receipt), createdAt: now } });
    await tx.bankImportRow.createMany({ data: rows.map(row => ({ ...row, evidence: json(row.evidence), stableKey: randomUUID(), userId, batchId: batch.id })) });
    await tx.auditLog.create({ data: { userId, action: 'BANK_IMPORT_SAVED', entityType: 'BankImportBatch', entityId: stableKey,
      metadata: JSON.stringify({ total: receipt.counts.total, invalid: receipt.counts.invalid, duplicates: receipt.counts.duplicates, overlapRows: receipt.counts.overlapRows }) } });
    return { receipt, replayed: false };
  });
  try { return await save(); }
  catch (error) {
    // A separate worker may have won a uniqueness race after our read. Re-run only
    // this DB-only transaction to resolve its committed immutable receipt.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return save();
    throw error;
  }
}
export async function recoverBankImport(userId: string, requestId: string): Promise<BankImportReceipt | null> {
  bankImportUuid(requestId);
  const batch = await prisma.bankImportBatch.findUnique({ where: { userId_requestId: { userId, requestId } }, select: { receipt: true } });
  return batch ? receiptOf(batch.receipt) : null;
}
export async function listBankImports(userId: string, page: number): Promise<{ receipts: BankImportReceipt[]; page: number; hasMore: boolean }> {
  const batches = await prisma.bankImportBatch.findMany({ where: { userId }, orderBy: { id: 'desc' }, skip: page * BANK_IMPORT_PAGE_SIZE, take: BANK_IMPORT_PAGE_SIZE + 1, select: { receipt: true } });
  return { receipts: batches.slice(0, BANK_IMPORT_PAGE_SIZE).map(batch => receiptOf(batch.receipt)), page, hasMore: batches.length > BANK_IMPORT_PAGE_SIZE };
}
export async function readBankImport(userId: string, stableKey: string, page: number): Promise<BankImportDetail> {
  bankImportUuid(stableKey);
  return prisma.$transaction(async tx => {
  const batch = await tx.bankImportBatch.findUnique({ where: { userId_stableKey: { userId, stableKey } }, select: { id: true, receipt: true } });
  if (!batch) throw new BankImportError('Importquittung nicht gefunden.', 404);
  const receipt = receiptOf(batch.receipt);
  const rows = await tx.bankImportRow.findMany({ where: { userId, batchId: batch.id }, orderBy: { sourceRow: 'asc' }, skip: page * BANK_IMPORT_PAGE_SIZE, take: BANK_IMPORT_PAGE_SIZE, select: { evidence: true, stableKey: true } });
  const assignmentCount = await tx.bankPaymentBinding.count({ where: { userId, bankImportRow: { batchId: batch.id } } });
  const rowEnvelopes = await readBankAllocationRowsInTransaction(tx, userId, rows);
  return { receipt, rows: rows.map(row => row.evidence as unknown as BankImportEvidence), rowEnvelopes, assignmentCount, page, pages: Math.ceil(receipt.counts.total / BANK_IMPORT_PAGE_SIZE) };
  });
}
