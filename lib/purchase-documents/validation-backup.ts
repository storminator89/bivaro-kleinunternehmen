import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { technicalReportFingerprint, validateTechnicalReport, validationRequestId } from './validation-evidence';
import type { PurchaseTechnicalReport } from './validation-contract';

export type PortableValidationReport = {
  stableKey: string; originalSha256: string; sourceDocumentIdAtCheck: number; requestId: string; fingerprint: string;
  provenance: 'LOCAL' | 'IMPORTED_HISTORIC'; report: PurchaseTechnicalReport; checkedAt: string; createdAt: string;
};
/** Validate all references before files or target data change. No validator runs on restore. */
export function validationReportsFromBackup(data: Record<string, unknown>, supported: boolean): PortableValidationReport[] {
  const input = data.purchaseValidationReports;
  if (!supported) {
    if (input !== undefined) throw new Error('Dieses Backupschema unterstützt keine technischen Eingangsprüfberichte.');
    return [];
  }
  if (!Array.isArray(input) || input.length > 10_000) throw new Error('Abschnitt für technische Eingangsprüfberichte fehlt oder ist zu groß.');
  const hashes = new Set((Array.isArray(data.purchaseDocuments) ? data.purchaseDocuments : []).map(value => (value as Record<string, unknown>)?.originalSha256));
  const keys = new Set<string>(), requests = new Set<string>();
  return input.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ungültiger technischer Backup-Prüfbericht.');
    const row = value as Record<string, unknown>;
    const allowed = ['stableKey', 'originalSha256', 'sourceDocumentIdAtCheck', 'requestId', 'fingerprint', 'provenance', 'report', 'checkedAt', 'createdAt'];
    if (Object.keys(row).length !== allowed.length || Object.keys(row).some(key => !allowed.includes(key))) throw new Error('Unbekannte Felder im Backup-Prüfbericht.');
    const stableKey = validationRequestId(row.stableKey), requestId = validationRequestId(row.requestId);
    if (keys.has(stableKey) || requests.has(requestId)) throw new Error('Doppelte Identität im Backup-Prüfbericht.');
    keys.add(stableKey); requests.add(requestId);
    if (typeof row.originalSha256 !== 'string' || !hashes.has(row.originalSha256) || !Number.isSafeInteger(row.sourceDocumentIdAtCheck) || Number(row.sourceDocumentIdAtCheck) < 1 || Number(row.sourceDocumentIdAtCheck) > 2_147_483_647) throw new Error('Prüfbericht verweist nicht auf ein enthaltenes Original.');
    const report = validateTechnicalReport(row.report, row.originalSha256);
    if (technicalReportFingerprint(report) !== row.fingerprint || row.checkedAt !== report.checkedAt || !['LOCAL', 'IMPORTED_HISTORIC'].includes(String(row.provenance))
      || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt)) || new Date(row.createdAt).toISOString() !== row.createdAt) throw new Error('Prüfberichtshistorie ist inkonsistent.');
    return row as unknown as PortableValidationReport;
  });
}

/** Target evidence is append-only, including during overwrite restore. */
export async function restoreValidationReports(tx: Prisma.TransactionClient, userId: string, reports: PortableValidationReport[]): Promise<void> {
  for (const source of reports) {
    const original = await tx.purchaseDocument.findUnique({ where: { userId_originalSha256: { userId, originalSha256: source.originalSha256 } }, select: { id: true } });
    if (!original) throw new Error('Prüfbericht kann keinem wiederhergestellten Original zugeordnet werden.');
    const existing = await tx.purchaseValidationReport.findUnique({ where: { userId_stableKey: { userId, stableKey: source.stableKey } } });
    if (existing) {
      if (existing.originalSha256 !== source.originalSha256 || existing.sourceDocumentIdAtCheck !== source.sourceDocumentIdAtCheck || existing.requestId !== source.requestId || existing.createdAt.toISOString() !== source.createdAt || existing.fingerprint !== source.fingerprint || technicalReportFingerprint(validateTechnicalReport(existing.report, source.originalSha256)) !== source.fingerprint) throw new Error('Prüfbericht-ID kollidiert mit anderem unveränderlichem Inhalt.');
      continue;
    }
    const request = await tx.purchaseValidationReport.findUnique({ where: { userId_requestId: { userId, requestId: source.requestId } } });
    if (request) throw new Error('Prüfschlüssel kollidiert mit bestehender Historie.');
    await tx.purchaseValidationReport.create({ data: { id: randomUUID(), stableKey: source.stableKey, userId,
      originalSha256: source.originalSha256, sourceDocumentIdAtCheck: source.sourceDocumentIdAtCheck, requestId: source.requestId, fingerprint: source.fingerprint,
      provenance: 'IMPORTED_HISTORIC', report: source.report as unknown as Prisma.InputJsonValue, checkedAt: new Date(source.checkedAt), createdAt: new Date(source.createdAt) } });
  }
}
