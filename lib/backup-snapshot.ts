import { validateSupplierTaskBackupFields } from '@/lib/purchase-documents/supplier-task-backup';
import { quoteCreateReceiptsFromBackup } from '@/lib/quote-create-receipt-backup';
import { validateQuoteCreateBackup } from '@/lib/quote-create-backup';
import { bankMappingProfilesFromBackup } from '@/lib/bank-mapping-profile-backup';
import { numberingPoliciesFromBackup } from '@/lib/document-numbering-policy-backup';
import { portableBankAllocations } from '@/lib/bank-allocation-backup';
import { readAnnualContextRevision } from '@/lib/annual-business-context';
import { prisma } from '@/lib/prisma';
import { hashBytes, hashJson, redactAuditLog } from '@/lib/backup-manifest';
import { stat, readFile } from 'node:fs/promises';

export type BackupSnapshotInfo = {
  id: string;
  startedAt: string;
  endedAt: string;
  consistency: 'single-read-transaction';
};

export type BackupSnapshot = {
  data: Record<string, unknown>;
  info: BackupSnapshotInfo;
};

export class BackupFileConsistencyError extends Error {
  readonly status = 409;

  constructor(message = 'Eine referenzierte Datei wurde während des Backups verändert') {
    super(message);
    this.name = 'BackupFileConsistencyError';
  }
}

export class BackupFileSizeError extends Error {
  readonly status = 413;

  constructor(message = 'Eine referenzierte Datei überschreitet das Backup-Größenlimit') {
    super(message);
    this.name = 'BackupFileSizeError';
  }
}

function fileVersion(value: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }): string {
  return [value.dev, value.ino, value.size, value.mtimeMs, value.ctimeMs].join(':');
}

export async function getBackupFileVersion(filePath: string): Promise<string | null> {
  try {
    return fileVersion(await stat(filePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function readStableBackupFile(filePath: string, maxBytes?: number): Promise<{
  bytes: Buffer;
  sha256: string;
  sourceVersion: string;
} | null> {
  let beforeStat: Awaited<ReturnType<typeof stat>>;
  try {
    beforeStat = await stat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (maxBytes !== undefined && beforeStat.size > maxBytes) throw new BackupFileSizeError();
  const before = fileVersion(beforeStat);
  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (maxBytes !== undefined && bytes.byteLength > maxBytes) throw new BackupFileSizeError();
  const after = await getBackupFileVersion(filePath);
  if (!after) return null;
  if (before !== after) throw new BackupFileConsistencyError();
  return { bytes, sha256: hashBytes(bytes), sourceVersion: after };
}

/**
 * Read every exportable tenant model in one short interactive transaction.
 * Callers must materialize/pack the result only after this promise resolves;
 * no file I/O or compression belongs inside the transaction.
 */
export async function readBackupSnapshot(userId: string): Promise<BackupSnapshot> {
  const startedAt = new Date().toISOString();
  const raw = await prisma.$transaction(async (tx) => {
    const [
      user,
      expenses,
      incomes,
      paymentJournalEvents,
      paymentAdjustments,
      paymentOperations,
      bankPaymentBindings,
      paymentAllocationChanges,
      invoices,
      purchaseDocuments,
      purchaseValidationReports,
      customers,
      suppliers,
      serviceArticles,
      bankImportBatches,
      bankImportRows,
      bankMappingProfiles,
      bankMappingProfileRevisions,
      documentNumberingPolicies,
      quoteCreateReceipts,
      settings,
      annualBusinessContextRevisions,
      templates,
      recurringExpenses,
      serviceBillingPlans,
      serviceBillingPeriods,
      reminders,
      serviceProjects,
      billingNotes,
      cashBooks,
      cashTransactions,
      documentations,
      apiKeys,
      auditLogs,
      invoiceNumberCounters,
    ] = await Promise.all([
      tx.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true, role: true, createdAt: true },
      }),
      tx.expense.findMany({ where: { userId } }),
      tx.income.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
      tx.paymentJournalEvent.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
      tx.paymentAdjustment.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
      tx.paymentOperation.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
      tx.bankPaymentBinding.findMany({ where: { userId }, orderBy: { stableKey: 'asc' } }),
      tx.paymentAllocationChange.findMany({ where: { userId }, orderBy: [{ bindingId: 'asc' }, { revision: 'asc' }] }),
      tx.invoice.findMany({ where: { userId } }),
      tx.purchaseDocument.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
      tx.purchaseValidationReport.findMany({ where: { userId }, orderBy: [{ checkedAt: 'asc' }, { id: 'asc' }] }),
      tx.customer.findMany({ where: { userId } }),
      tx.supplier.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
      tx.serviceArticle.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
      tx.bankImportBatch.findMany({ where: { userId }, orderBy: { stableKey: 'asc' }, select: {
        stableKey: true, requestId: true, fingerprint: true, sourceSha256: true, sourceBytes: true,
        parserVersion: true, mappingVersion: true, accountAlias: true, delimiter: true, mapping: true, receipt: true, createdAt: true,
      } }),
      tx.bankImportRow.findMany({ where: { userId, batch: { userId } }, orderBy: [{ batch: { stableKey: 'asc' } }, { sourceRow: 'asc' }], select: {
        id: true, stableKey: true, sourceRow: true, evidence: true, externalKey: true, contentKey: true, dayAmountKey: true,
        batch: { select: { stableKey: true } },
      } }),
      tx.bankMappingProfile.findMany({ where: { userId }, orderBy: { id: 'asc' }, select: { id: true, revision: true, deletedAt: true, deleteMutationId: true, createdAt: true, updatedAt: true } }),
      tx.bankMappingProfileRevision.findMany({ where: { userId, profile: { userId } }, orderBy: [{ profileId: 'asc' }, { revision: 'asc' }], select: { profileId: true, revision: true, mutationId: true, configuration: true, createdAt: true } }),
      tx.documentNumberingPolicy.findMany({ where: { userId }, orderBy: [{ type: 'asc' }, { revision: 'asc' }], select: { type: true, revision: true, formatVersion: true, prefix: true, includeYear: true, sequenceWidth: true, startSequence: true, effectiveYear: true, createdAt: true } }),
      tx.quoteCreateReceipt.findMany({ where: { userId }, orderBy: { requestId: 'asc' }, select: { requestId: true, fingerprint: true, pdfSha256: true, invoiceId: true, createdAt: true } }),
      tx.settings.findUnique({ where: { userId } }),
      tx.annualBusinessContextRevision.findMany({ where: { userId }, orderBy: { revision: 'asc' } }),
      tx.invoiceTemplate.findMany({ where: { userId } }),
      tx.recurringExpense.findMany({ where: { userId } }),
      tx.serviceBillingPlan.findMany({ where: { userId }, orderBy: { stableKey: 'asc' } }),
      tx.serviceBillingPeriod.findMany({ where: { userId }, orderBy: [{ planId: 'asc' }, { periodIndex: 'asc' }] }),
      tx.reminder.findMany({ where: { userId } }),
      tx.serviceProject.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
      tx.billingNote.findMany({ where: { userId }, orderBy: { id: 'asc' }, select: {
        id: true, userId: true, customerId: true, projectId: true, durationMinutes: true,
        // Capture receipts are durable business evidence, not disposable API telemetry.
        captureKey: true, captureFingerprint: true, deletedAt: true,
        serviceDate: true, description: true, quantity: true, unit: true, invoiceId: true,
        createdAt: true, updatedAt: true,
      } }),
      tx.cashBook.findMany({ where: { userId } }),
      tx.cashTransaction.findMany({ where: { userId } }),
      tx.documentation.findMany({ where: { userId } }),
      tx.apiKey.findMany({ where: { userId }, select: { id: true, name: true, keyPrefix: true, scopes: true, isActive: true, expiresAt: true, createdAt: true } }),
      tx.auditLog.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
      tx.invoiceNumberCounter.findMany({ where: { userId }, orderBy: [{ type: 'asc' }, { year: 'asc' }] }),
    ]);

    // JSON configuration blobs are validated before export, not merely trusted
    // because the scalar select omitted tenant keys. Corrupt/unknown raw fields fail closed.
    const mappingHistory = bankMappingProfilesFromBackup({ bankMappingProfiles, bankMappingProfileRevisions, bankImportBatches }, true);
    const numberingHistory = numberingPoliciesFromBackup({ documentNumberingPolicies }, true);
    validateQuoteCreateBackup({ invoices, quoteCreateReceipts }, true);
    const quoteReceipts = quoteCreateReceiptsFromBackup({ invoices, quoteCreateReceipts }, true);
    const allocations = portableBankAllocations(bankPaymentBindings, paymentAllocationChanges, bankImportRows, paymentJournalEvents);
    for (const document of purchaseDocuments) validateSupplierTaskBackupFields(document as unknown as Record<string, unknown>, `purchaseDocuments[${document.id}]`, true);
    const includedOriginalHashes = new Set(purchaseDocuments.map(document => document.originalSha256));
    return {
      user: { id: user?.id, email: user?.email, name: user?.name },
      expenses: expenses.map((item) => ({ ...item, userId: undefined })),
      incomes: incomes.map((item) => ({ ...item, userId: undefined })),
      paymentAdjustments: paymentAdjustments.map(({ allocationBindingId, allocationChangeId, allocationRevision, allocationBasisSnapshot, ...item }) => ({ ...item, userId: undefined,
        ...(item.contractVersion === 3 ? { allocationBindingStableKey: bankPaymentBindings.find(binding => binding.id === allocationBindingId)?.stableKey, allocationRevision,
          allocationChangeStableKey: allocationChangeId == null ? null : paymentAllocationChanges.find(change => change.id === allocationChangeId)?.stableKey, allocationBasisSnapshot } : {}),
      })),
      bankPaymentBindings: allocations.bindings,
      paymentAllocationChanges: allocations.changes,
      paymentOperations: paymentOperations.map((item) => ({ ...item, userId: undefined })),
      paymentJournalEvents: paymentJournalEvents.map((item) => ({ ...item, userId: undefined, bankPaymentBindingStableKey: bankPaymentBindings.find(binding => binding.paymentJournalEventId === item.id)?.stableKey ?? null })),
      invoices: invoices.map((item) => ({ ...item, userId: undefined })),
      purchaseDocuments: purchaseDocuments.map((item) => ({ ...item, userId: undefined })),
      // Orphaned historical proof remains target-owned but is not exported without its original.
      purchaseValidationReports: purchaseValidationReports.filter(item => includedOriginalHashes.has(item.originalSha256)).map(item => ({ stableKey: item.stableKey, originalSha256: item.originalSha256, sourceDocumentIdAtCheck: item.sourceDocumentIdAtCheck, requestId: item.requestId, fingerprint: item.fingerprint, provenance: item.provenance, report: item.report, checkedAt: item.checkedAt, createdAt: item.createdAt })),
      customers: customers.map((item) => ({ ...item, userId: undefined })),
      suppliers: suppliers.map((item) => ({ ...item, userId: undefined })),
      annualBusinessContextRevisions: annualBusinessContextRevisions.map(readAnnualContextRevision),
      serviceArticles: serviceArticles.map((item) => ({ ...item, userId: undefined })),
      bankMappingProfiles: mappingHistory.profiles,
      bankMappingProfileRevisions: mappingHistory.revisions,
      documentNumberingPolicies: numberingHistory,
      quoteCreateReceipts: quoteReceipts,
      bankImportBatches,
      bankImportRows: bankImportRows.map(({ id: _localId, batch, ...row }) => { void _localId; return { ...row, batchStableKey: batch.stableKey }; }),
      settings: settings ? { ...settings, userId: undefined } : null,
      templates: templates.map((item) => ({ ...item, userId: undefined })),
      serviceBillingPlans: serviceBillingPlans.map((item) => ({ ...item, userId: undefined })),
      serviceBillingPeriods: serviceBillingPeriods.map((item) => ({ ...item, userId: undefined })),
      recurringExpenses: recurringExpenses.map((item) => ({ ...item, userId: undefined })),
      reminders: reminders.map((item) => ({ ...item, userId: undefined })),
      serviceProjects: serviceProjects.map((item) => ({ ...item, userId: undefined })),
      billingNotes: billingNotes.map((item) => ({ ...item, userId: undefined })),
      cashBooks: cashBooks.map((item) => ({ ...item, userId: undefined })),
      cashTransactions: cashTransactions.map((item) => ({ ...item, userId: undefined })),
      documentations: documentations.map((item) => ({ ...item, userId: undefined })),
      apiKeys: apiKeys.map((item) => ({ ...item })),
      auditLogs: auditLogs.map((item) => redactAuditLog({ ...item })),
      invoiceNumberCounters: invoiceNumberCounters.map((item) => ({ type: item.type, year: item.year, value: item.value })),
    } satisfies Record<string, unknown>;
  }, { maxWait: 15_000, timeout: 120_000 });
  const endedAt = new Date().toISOString();
  const id = hashJson({ sourceUserId: userId, startedAt, endedAt, data: raw });
  return {
    data: raw,
    info: { id, startedAt, endedAt, consistency: 'single-read-transaction' },
  };
}
