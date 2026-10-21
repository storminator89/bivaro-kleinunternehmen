import { createHash } from 'node:crypto';

export const CURRENT_BACKUP_VERSION = '3.0';
export const LEGACY_BACKUP_VERSION = '2.0';
/** Combined capability identity: never relabel standalone 061000 or 070000. */
export const CURRENT_SCHEMA_VERSION = '20261021091000_add_ai_receipt_extraction';
export const COMBINED_PHOTO_ANNUAL_SCHEMA_VERSION = '20261021080000_combine_photo_annual_context';
export const MANUAL_PHOTO_APPROVAL_SCHEMA_VERSION = '20261021061000_add_manual_photo_approval';
export const ANNUAL_CONTEXT_SCHEMA_VERSION = '20261021070000_add_annual_business_context';
export const PRE_MANUAL_PHOTO_APPROVAL_SCHEMA_VERSION = '20261021054000_add_purchase_review_drafts';
export const PRE_ANNUAL_CONTEXT_SCHEMA_VERSION = PRE_MANUAL_PHOTO_APPROVAL_SCHEMA_VERSION;
const REVIEW_DRAFT_SCHEMAS: readonly string[] = [CURRENT_SCHEMA_VERSION, COMBINED_PHOTO_ANNUAL_SCHEMA_VERSION, MANUAL_PHOTO_APPROVAL_SCHEMA_VERSION, ANNUAL_CONTEXT_SCHEMA_VERSION, PRE_MANUAL_PHOTO_APPROVAL_SCHEMA_VERSION];
/** Explicit registry preserves the incompatible standalone feature boundaries. */
export const BACKUP_FEATURE_CAPABILITIES: Readonly<Record<string, { manualPhotoApproval: boolean; annualContext: boolean; aiReceiptExtraction?: boolean }>> = Object.freeze({
  [CURRENT_SCHEMA_VERSION]: Object.freeze({ manualPhotoApproval: true, annualContext: true, aiReceiptExtraction: true }),
  [COMBINED_PHOTO_ANNUAL_SCHEMA_VERSION]: Object.freeze({ manualPhotoApproval: true, annualContext: true }),
  [MANUAL_PHOTO_APPROVAL_SCHEMA_VERSION]: Object.freeze({ manualPhotoApproval: true, annualContext: false }),
  [ANNUAL_CONTEXT_SCHEMA_VERSION]: Object.freeze({ manualPhotoApproval: false, annualContext: true }),
  [PRE_MANUAL_PHOTO_APPROVAL_SCHEMA_VERSION]: Object.freeze({ manualPhotoApproval: false, annualContext: false }),
});
export function backupSchemaSupportsManualPhotoApproval(schemaVersion?: string): boolean {
  return schemaVersion !== undefined && BACKUP_FEATURE_CAPABILITIES[schemaVersion]?.manualPhotoApproval === true;
}
export function backupSchemaSupportsAiExtraction(schemaVersion?: string): boolean {
  return schemaVersion !== undefined && BACKUP_FEATURE_CAPABILITIES[schemaVersion]?.aiReceiptExtraction === true;
}
export function backupSchemaSupportsAnnualContext(schemaVersion?: string): boolean {
  return schemaVersion !== undefined && BACKUP_FEATURE_CAPABILITIES[schemaVersion]?.annualContext === true;
}
export const PRE_PURCHASE_REVIEW_DRAFTS_SCHEMA_VERSION = '20261021043000_add_partial_payments';
/** Full-payment journal snapshots retain their immutable evidence semantics. */
export const FULL_PAYMENT_JOURNAL_SCHEMA_VERSION = '20261020230000_add_payment_journal';
/** Supplier booking existed before the additive immutable payment journal. */
export const PRE_PAYMENT_JOURNAL_SCHEMA_VERSION = '20261020223000_add_suppliers_and_purchase_booking';
/** Incoming originals existed before supplier selection and expense approval. */
export const PRE_SUPPLIERS_SCHEMA_VERSION = '20261020220000_add_purchase_documents';
/** Incoming originals are additive; pre-inbox v3 manifests contain no sources. */
export const PRE_PURCHASE_DOCUMENTS_SCHEMA_VERSION = '20261020213000_add_fiscal_profile';
/** Fiscal profiles are additive; existing v3 backups remain importable. */
export const PRE_FISCAL_PROFILE_SCHEMA_VERSION = '20260922100000_add_billing_notes';
/** v3 manifests produced before BillingNote was introduced remain importable. */
export const PRE_BILLING_NOTES_SCHEMA_VERSION = '20260919100000_invoice_issuance_state';

/** Capabilities are explicit: a non-current schema may already contain a journal. */
const JOURNAL_SCHEMAS: readonly string[] = [...REVIEW_DRAFT_SCHEMAS, PRE_PURCHASE_REVIEW_DRAFTS_SCHEMA_VERSION, FULL_PAYMENT_JOURNAL_SCHEMA_VERSION];
const SUPPLIER_SCHEMAS: readonly string[] = [...JOURNAL_SCHEMAS, PRE_PAYMENT_JOURNAL_SCHEMA_VERSION];
const PURCHASE_DOCUMENT_SCHEMAS: readonly string[] = [...SUPPLIER_SCHEMAS, PRE_SUPPLIERS_SCHEMA_VERSION];
const SUPPORTED_SCHEMAS: readonly string[] = [...PURCHASE_DOCUMENT_SCHEMAS, PRE_PURCHASE_DOCUMENTS_SCHEMA_VERSION, PRE_FISCAL_PROFILE_SCHEMA_VERSION, PRE_BILLING_NOTES_SCHEMA_VERSION];

export function backupSchemaSupportsPaymentJournal(schemaVersion: string): boolean {
  return JOURNAL_SCHEMAS.includes(schemaVersion);
}

export type BackupCoverageMode = 'included' | 'metadata-only' | 'excluded';

export type BackupCoverageEntry = {
  model: string;
  key: string;
  mode: BackupCoverageMode;
  count: number;
  sha256?: string;
  reason?: string;
};

export type BackupFileManifestEntry = {
  kind: 'invoice' | 'receipt' | 'logo' | 'purchase-document';
  sourceName: string;
  zipPath?: string;
  bytes: number;
  sha256: string;
  sourceVersion?: string;
};

export type BackupSnapshotInfo = {
  id: string;
  startedAt: string;
  endedAt: string;
  consistency: 'single-read-transaction';
};

export type BackupManifest = {
  format: 'bivaro-backup';
  version: typeof CURRENT_BACKUP_VERSION;
  schemaVersion: string;
  backupId: string;
  sourceUserId: string;
  generatedAt: string;
  excludesSecrets: true;
  excludedSecretFields: string[];
  rekeyRequired: string[];
  modelCoverage: BackupCoverageEntry[];
  auditSegment: {
    key: 'auditLogs';
    count: number;
    sha256: string;
    restoreMode: 'append-only';
  };
  invoiceNumberCounters: {
    key: 'invoiceNumberCounters';
    count: number;
    sha256: string;
    highWaterMark: 'max-existing-imported-historical';
  };
  fileManifest: BackupFileManifestEntry[];
  snapshot?: BackupSnapshotInfo;
};

export type BackupManifestData = Record<string, unknown>;

const COVERAGE = [
  { model: 'User', key: 'user', mode: 'metadata-only' as const, reason: 'Identity and password remain target-owned.' },
  { model: 'AppSettings', key: 'appSettings', mode: 'excluded' as const, reason: 'Host-wide bootstrap setting, not tenant data.' },
  { model: 'AiProviderSettings', key: 'aiProviderSettings', mode: 'excluded' as const, reason: 'Provider configuration and encrypted credentials remain target-owned; never imported or enabled by business restore.' },
  { model: 'SmtpSettings', key: 'smtpSettings', mode: 'excluded' as const, reason: 'Host-wide SMTP override and encrypted credential material are never backed up.' },
  { model: 'RateLimitBucket', key: 'rateLimitBuckets', mode: 'excluded' as const, reason: 'Operational runtime state is not restorable business data.' },
  { model: 'Customer', key: 'customers', mode: 'included' as const },
  { model: 'Supplier', key: 'suppliers', mode: 'included' as const },
  { model: 'Expense', key: 'expenses', mode: 'included' as const },
  { model: 'Income', key: 'incomes', mode: 'included' as const },
  { model: 'PaymentJournalEvent', key: 'paymentJournalEvents', mode: 'included' as const },
  { model: 'Invoice', key: 'invoices', mode: 'included' as const },
  { model: 'PurchaseDocument', key: 'purchaseDocuments', mode: 'included' as const },
  { model: 'Settings', key: 'settings', mode: 'included' as const },
  { model: 'AnnualBusinessContextRevision', key: 'annualBusinessContextRevisions', mode: 'included' as const },
  { model: 'InvoiceTemplate', key: 'templates', mode: 'included' as const },
  { model: 'RecurringExpense', key: 'recurringExpenses', mode: 'included' as const },
  { model: 'Reminder', key: 'reminders', mode: 'included' as const },
  { model: 'BillingNote', key: 'billingNotes', mode: 'included' as const },
  { model: 'ApiKey', key: 'apiKeys', mode: 'metadata-only' as const, reason: 'Hash and usable secret are deliberately excluded; re-key required.' },
  { model: 'ApiLog', key: 'apiLogs', mode: 'excluded' as const, reason: 'Operational API telemetry is not tenant business state.' },
  { model: 'AuditLog', key: 'auditLogs', mode: 'included' as const, reason: 'Appended as a provenance-preserving audit segment.' },
  { model: 'CashBook', key: 'cashBooks', mode: 'included' as const },
  { model: 'CashTransaction', key: 'cashTransactions', mode: 'included' as const },
  { model: 'Documentation', key: 'documentations', mode: 'included' as const },
  { model: 'InvoiceNumberCounter', key: 'invoiceNumberCounters', mode: 'included' as const, reason: 'High-water marks are merged by maximum.' },
] as const;

export const BACKUP_MODEL_COVERAGE = COVERAGE;

// Scalar allowlist is closed for every supported schema. Feature evidence is
// additionally gated by its source identity, never merely by recomputed hashes.
const PURCHASE_DOCUMENT_BACKUP_FIELDS = new Set([
  'id', 'userId', 'originalFileName', 'storedFileName', 'originalSha256',
  'originalByteCount', 'mediaType', 'uploadedAt', 'uploadRequestId', 'parsedData',
  'parseStatus', 'parserVersion', 'parseErrorCode', 'supplierName', 'supplierId',
  'selectedSupplierSnapshot', 'invoiceNumber', 'invoiceDate', 'currency',
  'totalAmount', 'reviewDraftSearch', 'reviewDraft', 'reviewDraftSavedAt',
  'reviewStatus', 'revision', 'expenseId', 'approvalRequestId',
  'approvalFingerprint', 'approvedAt', 'dismissedAt', 'dismissalReason', 'updatedAt',
]);

export function validatePurchaseDocumentBackupFields(document: Record<string, unknown>, label: string, schemaVersion?: string): void {
  if (document.reviewedSourceSnapshot != null && !backupSchemaSupportsManualPhotoApproval(schemaVersion)) {
    throw new Error(`${label}.reviewedSourceSnapshot: Älteres Backupschema unterstützt keine manuellen Foto-Freigaben. Die Quelldaten bleiben unverändert; ein passendes Wiederherstellungsziel ist erforderlich.`);
  }
  for (const field of Object.keys(document)) {
    if (['aiExtraction','aiDraftProvenance','aiApprovedSnapshot'].includes(field)) {
      if (document[field] == null || backupSchemaSupportsAiExtraction(schemaVersion)) continue;
      throw new Error(`${label}.${field}: Älteres Backupschema unterstützt keine KI-Herkunft. Quelldaten dürfen nicht verworfen werden.`);
    }
    // An explicitly absent future snapshot carries no evidence to discard.
    if (field === 'reviewedSourceSnapshot' && (document[field] == null || backupSchemaSupportsManualPhotoApproval(schemaVersion))) continue;
    if (!PURCHASE_DOCUMENT_BACKUP_FIELDS.has(field)) throw new Error(`${label}: Nicht unterstütztes Eingangsbelegfeld; Wiederherstellung würde Quelldaten verlieren.`);
  }
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

export function hashBytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function redactSensitiveValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !/(?:password|secret|token|keyhash|privatekey|accesskey)/iu.test(key))
    .map(([key, item]) => [key, redactSensitiveValue(item)]));
}

function redactJsonText(value: string | null | undefined): string | null | undefined {
  if (value === null || value === undefined) return value;
  try {
    return JSON.stringify(redactSensitiveValue(JSON.parse(value)));
  } catch {
    return '[REDACTED_UNPARSEABLE]';
  }
}

export function redactAuditLog<T extends Record<string, unknown>>(log: T): T {
  return {
    ...log,
    oldValues: redactJsonText(typeof log.oldValues === 'string' ? log.oldValues : null),
    newValues: redactJsonText(typeof log.newValues === 'string' ? log.newValues : null),
    metadata: redactJsonText(typeof log.metadata === 'string' ? log.metadata : null),
  } as T;
}

function coverageCount(data: BackupManifestData, key: string): number {
  const value = data[key];
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return 1;
  return 0;
}

function coverageHash(data: BackupManifestData, key: string): string | undefined {
  const value = data[key];
  if (value === undefined || value === null) return undefined;
  return hashJson(value);
}

export function createBackupManifest(options: {
  sourceUserId: string;
  generatedAt: string;
  data: BackupManifestData;
  fileManifest?: BackupFileManifestEntry[];
  snapshot?: BackupSnapshotInfo;
}): BackupManifest {
  const modelCoverage: BackupCoverageEntry[] = COVERAGE.filter(entry => entry.model !== 'AnnualBusinessContextRevision' || options.data.annualBusinessContextRevisions !== undefined).map((entry) => ({
    ...entry,
    count: coverageCount(options.data, entry.key),
    ...(entry.mode === 'excluded' ? {} : { sha256: coverageHash(options.data, entry.key) }),
  }));
  const auditLogs = options.data.auditLogs ?? [];
  const counters = options.data.invoiceNumberCounters ?? [];
  const backupId = hashJson({
    sourceUserId: options.sourceUserId,
    generatedAt: options.generatedAt,
    auditLogs,
    counters,
    ...(options.snapshot ? { snapshotId: options.snapshot.id } : {}),
  });
  return {
    format: 'bivaro-backup',
    version: CURRENT_BACKUP_VERSION,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    backupId,
    sourceUserId: options.sourceUserId,
    generatedAt: options.generatedAt,
    excludesSecrets: true,
    excludedSecretFields: ['User.password', 'ApiKey.keyHash', 'ApiKey.secret', 'AiProviderSettings.keyCiphertext', 'AiProviderSettings.keyIv', 'AiProviderSettings.keyTag'],
    rekeyRequired: ['ApiKey'],
    modelCoverage,
    auditSegment: {
      key: 'auditLogs',
      count: Array.isArray(auditLogs) ? auditLogs.length : 0,
      sha256: hashJson(auditLogs),
      restoreMode: 'append-only',
    },
    invoiceNumberCounters: {
      key: 'invoiceNumberCounters',
      count: Array.isArray(counters) ? counters.length : 0,
      sha256: hashJson(counters),
      highWaterMark: 'max-existing-imported-historical',
    },
    fileManifest: options.fileManifest ?? [],
    ...(options.snapshot ? { snapshot: options.snapshot } : {}),
  };
}

export function validateBackupManifest(manifest: unknown, data: BackupManifestData): BackupManifest {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Backup-Manifest fehlt oder ist ungültig');
  }
  const value = manifest as Partial<BackupManifest>;
  if (value.format !== 'bivaro-backup' || value.version !== CURRENT_BACKUP_VERSION) {
    throw new Error('Nicht unterstützte Backup-Manifest-Version');
  }
  if (!SUPPORTED_SCHEMAS.includes(value.schemaVersion!) || typeof value.backupId !== 'string' || typeof value.sourceUserId !== 'string' || typeof value.generatedAt !== 'string') {
    throw new Error('Backup-Manifest enthält keine gültige Herkunft');
  }
  if (value.excludesSecrets !== true || !Array.isArray(value.excludedSecretFields) || !value.excludedSecretFields.includes('User.password') || !value.excludedSecretFields.includes('ApiKey.keyHash') || !value.excludedSecretFields.includes('ApiKey.secret') || !Array.isArray(value.rekeyRequired) || !value.rekeyRequired.includes('ApiKey')) {
    throw new Error('Backup-Manifest weist den Secret-Ausschluss nicht nach');
  }
  if (!Array.isArray(value.modelCoverage)) throw new Error('Backup-Manifest enthält keine Modellabdeckung');
  const expectedCoverage = COVERAGE.filter((entry) =>
    (entry.model !== 'AiProviderSettings' || backupSchemaSupportsAiExtraction(value.schemaVersion))
    && (value.schemaVersion !== PRE_BILLING_NOTES_SCHEMA_VERSION || entry.model !== 'BillingNote')
    && (PURCHASE_DOCUMENT_SCHEMAS.includes(value.schemaVersion!) || entry.model !== 'PurchaseDocument')
    && (SUPPLIER_SCHEMAS.includes(value.schemaVersion!) || entry.model !== 'Supplier')
    && (backupSchemaSupportsPaymentJournal(value.schemaVersion!) || entry.model !== 'PaymentJournalEvent')
    && (entry.model !== 'AnnualBusinessContextRevision' || (backupSchemaSupportsAnnualContext(value.schemaVersion) && data.annualBusinessContextRevisions !== undefined)));
  if (data.aiProviderSettings !== undefined || data.aiProviderSecrets !== undefined) throw new Error('Provider-Konfiguration und Schlüsselmaterial sind kein wiederherstellbares Geschäftsbackup');
  if (Array.isArray(data.purchaseDocuments)) data.purchaseDocuments.forEach((document, index) => {
    if (document && typeof document === 'object' && !Array.isArray(document)) validatePurchaseDocumentBackupFields(document as Record<string, unknown>, `purchaseDocuments[${index}]`, value.schemaVersion);
  });
  if (!backupSchemaSupportsAnnualContext(value.schemaVersion) && coverageCount(data, 'annualBusinessContextRevisions') > 0) throw new Error('Älteres Backupschema darf keine Jahreskontexthistorie enthalten');
  if (!REVIEW_DRAFT_SCHEMAS.includes(value.schemaVersion!) && Array.isArray(data.purchaseDocuments) && data.purchaseDocuments.some(item => item && typeof item === 'object' && ((item as Record<string, unknown>).reviewDraft != null || (item as Record<string, unknown>).reviewDraftSavedAt != null || ['image/jpeg', 'image/png'].includes(String((item as Record<string, unknown>).mediaType))))) throw new Error('Älteres Backupschema darf keine Foto- oder Prüfentwurfsdaten enthalten');
  if (!PURCHASE_DOCUMENT_SCHEMAS.includes(value.schemaVersion!) && coverageCount(data, 'purchaseDocuments') > 0) {
    throw new Error('Ein altes Backup-Manifest darf keine ungebundenen Eingangsbelege enthalten');
  }
  if (!SUPPLIER_SCHEMAS.includes(value.schemaVersion!) && (coverageCount(data, 'suppliers') > 0
    || (Array.isArray(data.purchaseDocuments) && data.purchaseDocuments.some((item) => item && typeof item === 'object' && ((item as Record<string, unknown>).supplierId != null || (item as Record<string, unknown>).selectedSupplierSnapshot != null))))) {
    throw new Error('Ein altes Backup-Manifest darf keine ungebundenen Lieferanten oder Lieferantenauswahlen enthalten');
  }
  if (!backupSchemaSupportsPaymentJournal(value.schemaVersion!) && coverageCount(data, 'paymentJournalEvents') > 0) {
    throw new Error('Ein altes Backup-Manifest darf keine ungebundenen Zahlungsereignisse enthalten');
  }
  if (value.schemaVersion === PRE_BILLING_NOTES_SCHEMA_VERSION && coverageCount(data, 'billingNotes') > 0) {
    throw new Error('Ein altes Backup-Manifest darf keine ungebundenen BillingNotes enthalten');
  }
  // These additive sections are mandatory once their model exists in the schema.
  // An absent section is not evidence of an empty collection, even if an attacker
  // recomputes a zero-count coverage entry without a data hash.
  for (const entry of expectedCoverage) {
    if (['Supplier', 'PurchaseDocument', 'PaymentJournalEvent'].includes(entry.model) && !Array.isArray(data[entry.key])) {
      throw new Error(`Backup-Daten enthalten keinen erforderlichen Abschnitt: ${entry.key}`);
    }
  }
  const expectedModels = new Set<string>(expectedCoverage.map((entry) => entry.model));
  const seenModels = new Set<string>();
  for (const item of value.modelCoverage) {
    if (!item || typeof item !== 'object') throw new Error('Backup-Manifest enthält einen ungültigen Modelleintag');
    const entry = item as BackupCoverageEntry;
    if (typeof entry.model !== 'string' || !expectedModels.has(entry.model) || seenModels.has(entry.model)) {
      throw new Error(`Backup-Manifest enthält ein unbekanntes oder doppeltes Modell: ${String(entry.model)}`);
    }
    seenModels.add(entry.model);
    if (!Number.isSafeInteger(entry.count) || entry.count < 0) throw new Error(`Backup-Manifest count für ${entry.model} ist ungültig`);
    const definition = expectedCoverage.find((candidate) => candidate.model === entry.model)!;
    if (entry.key !== definition.key || entry.mode !== definition.mode) throw new Error(`Backup-Manifest Abdeckung für ${entry.model} stimmt nicht mit dem Vertrag überein`);
    if (entry.mode !== 'excluded' && entry.count !== coverageCount(data, entry.key)) throw new Error(`Backup-Manifest count für ${entry.model} stimmt nicht mit den Daten überein`);
    if (entry.mode !== 'excluded' && entry.sha256 !== coverageHash(data, entry.key)) throw new Error(`Backup-Manifest Hash für ${entry.model} stimmt nicht mit den Daten überein`);
  }
  if (seenModels.size !== expectedCoverage.length) throw new Error('Backup-Manifest ist nicht vollständig');
  if (!value.auditSegment || value.auditSegment.count !== coverageCount(data, 'auditLogs') || value.auditSegment.sha256 !== coverageHash(data, 'auditLogs')) {
    throw new Error('Backup-Manifest Auditsegment stimmt nicht mit den Daten überein');
  }
  if (!value.invoiceNumberCounters || value.invoiceNumberCounters.count !== coverageCount(data, 'invoiceNumberCounters') || value.invoiceNumberCounters.sha256 !== coverageHash(data, 'invoiceNumberCounters')) {
    throw new Error('Backup-Manifest Nummernzähler stimmt nicht mit den Daten überein');
  }
  if (!Array.isArray(value.fileManifest)) throw new Error('Backup-Manifest Dateimanifest fehlt');
  const seenFiles = new Set<string>();
  for (const item of value.fileManifest) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Backup-Manifest enthält einen ungültigen Dateieintrag');
    const file = item as BackupFileManifestEntry;
    if (!['invoice', 'receipt', 'logo', 'purchase-document'].includes(file.kind) || typeof file.sourceName !== 'string' || file.sourceName.length === 0) {
      throw new Error('Backup-Manifest Dateieintrag enthält keine gültige Quelle');
    }
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/iu.test(file.sha256)) {
      throw new Error(`Backup-Manifest Dateieintrag für ${file.sourceName} ist ungültig`);
    }
    if (file.zipPath !== undefined && (typeof file.zipPath !== 'string' || !/^(?:invoices|receipts|logos|purchase-documents)\/[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u.test(file.zipPath))) {
      throw new Error(`Backup-Manifest Dateipfad für ${file.sourceName} ist ungültig`);
    }
    if (file.sourceVersion !== undefined && (typeof file.sourceVersion !== 'string' || file.sourceVersion.length === 0)) {
      throw new Error(`Backup-Manifest Dateiversion für ${file.sourceName} ist ungültig`);
    }
    const fileKey = `${file.kind}:${file.sourceName}`;
    if (seenFiles.has(fileKey)) throw new Error(`Backup-Manifest enthält die Datei doppelt: ${fileKey}`);
    seenFiles.add(fileKey);
  }
  if (value.snapshot !== undefined) {
    const snapshot = value.snapshot;
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
      || typeof snapshot.id !== 'string' || !/^[a-f0-9]{64}$/iu.test(snapshot.id)
      || typeof snapshot.startedAt !== 'string' || Number.isNaN(Date.parse(snapshot.startedAt))
      || typeof snapshot.endedAt !== 'string' || Number.isNaN(Date.parse(snapshot.endedAt))
      || Date.parse(snapshot.endedAt) < Date.parse(snapshot.startedAt)
      || snapshot.consistency !== 'single-read-transaction') {
      throw new Error('Backup-Manifest Snapshotangaben sind ungültig');
    }
  }
  const expectedBackupId = hashJson({
    sourceUserId: value.sourceUserId,
    generatedAt: value.generatedAt,
    auditLogs: data.auditLogs ?? [],
    counters: data.invoiceNumberCounters ?? [],
    ...(value.snapshot ? { snapshotId: value.snapshot.id } : {}),
  });
  if (value.backupId !== expectedBackupId) throw new Error('Backup-Manifest ist nicht an Auditsegment und Nummernzähler gebunden');
  return value as BackupManifest;
}

export function manifestWarning(version: string): string | null {
  if (version === LEGACY_BACKUP_VERSION) {
    return 'Legacy-Backup 2.0 ohne Manifest, Auditsegment und Nummernzähler; Vollständigkeit und historische High-Water-Marks sind nicht nachgewiesen.';
  }
  return null;
}
