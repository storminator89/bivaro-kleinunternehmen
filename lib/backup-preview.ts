import {
  CURRENT_BACKUP_VERSION,
  backupSchemaSupportsPaymentJournal,
  backupSchemaSupportsSupplierTasks,
  backupSchemaSupportsBankMappingProfiles,
  backupSchemaSupportsDocumentNumberingPolicies,
  LEGACY_BACKUP_VERSION,
  manifestWarning,
  validateBackupManifest,
  type BackupManifest,
} from '@/lib/backup-manifest';
import { validateBackupForRestore } from '@/lib/backup-restore';

export type BackupPreview = {
  version: string;
  type: 'json' | 'full' | 'unknown';
  exportedAt?: string;
  user?: {
    email?: string;
    name?: string;
  };
  counts: {
    customers: number;
    suppliers: number;
    serviceArticles: number;
    bankMappingProfiles: number;
    bankMappingProfileRevisions: number;
    documentNumberingPolicies: number;
    quoteCreateReceipts: number;
    bankImportBatches: number;
    bankImportRows: number;
    bankPaymentBindings: number;
    paymentAllocationChanges: number;
    serviceProjects: number;
    billingNotes: number;
    expenses: number;
    incomes: number;
    paymentJournalEvents: number;
    paymentAdjustments: number;
    paymentOperations: number;
    annualBusinessContextRevisions: number;
    invoices: number;
    purchaseDocuments: number;
    templates: number;
    recurringExpenses: number;
    serviceBillingPlans: number;
    serviceBillingPeriods: number;
    reminders: number;
    cashBooks: number;
    cashTransactions: number;
    documentations: number;
    apiKeys: number;
    auditLogs: number;
    invoiceNumberCounters: number;
  };
  totalRecords: number;
  warnings: string[];
  manifest?: Pick<BackupManifest, 'schemaVersion' | 'modelCoverage' | 'auditSegment' | 'invoiceNumberCounters' | 'excludesSecrets' | 'excludedSecretFields' | 'rekeyRequired' | 'fileManifest' | 'snapshot'>;
};

type BackupLike = {
  version?: unknown;
  type?: unknown;
  exportedAt?: unknown;
  user?: {
    email?: unknown;
    name?: unknown;
  };
  data?: Record<string, unknown>;
  manifest?: unknown;
};

function countArray(data: Record<string, unknown>, key: string): number {
  const value = data[key];
  return Array.isArray(value) ? value.length : 0;
}

export function createBackupPreview(backup: unknown): BackupPreview {
  if (!backup || typeof backup !== 'object') {
    throw new Error('Ungültiges Backup-Format');
  }

  const candidate = backup as BackupLike;
  if (typeof candidate.version !== 'string' || !candidate.data || typeof candidate.data !== 'object') {
    throw new Error('Ungültiges Backup-Format');
  }

  // Preview is the dry-run gate for restore. Keep this call before building
  // counts so a backup accepted here is governed by exactly the same shape,
  // relationship and domain rules as the committing restore.
  validateBackupForRestore(backup);

  const data = candidate.data;
  const counts = {
    customers: countArray(data, 'customers'),
    suppliers: countArray(data, 'suppliers'),
    serviceArticles: countArray(data, 'serviceArticles'),
    bankMappingProfiles: countArray(data, 'bankMappingProfiles'),
    bankMappingProfileRevisions: countArray(data, 'bankMappingProfileRevisions'),
    documentNumberingPolicies: countArray(data, 'documentNumberingPolicies'),
    quoteCreateReceipts: countArray(data, 'quoteCreateReceipts'),
    bankImportBatches: countArray(data, 'bankImportBatches'),
    bankImportRows: countArray(data, 'bankImportRows'),
    bankPaymentBindings: countArray(data, 'bankPaymentBindings'),
    paymentAllocationChanges: countArray(data, 'paymentAllocationChanges'),
    serviceProjects: countArray(data, 'serviceProjects'),
    billingNotes: countArray(data, 'billingNotes'),
    expenses: countArray(data, 'expenses'),
    incomes: countArray(data, 'incomes'),
    paymentJournalEvents: countArray(data, 'paymentJournalEvents'),
    paymentAdjustments: countArray(data, 'paymentAdjustments'),
    paymentOperations: countArray(data, 'paymentOperations'),
    annualBusinessContextRevisions: countArray(data, 'annualBusinessContextRevisions'),
    invoices: countArray(data, 'invoices'),
    purchaseDocuments: countArray(data, 'purchaseDocuments'),
    templates: countArray(data, 'templates'),
    recurringExpenses: countArray(data, 'recurringExpenses'),
    serviceBillingPlans: countArray(data, 'serviceBillingPlans'),
    serviceBillingPeriods: countArray(data, 'serviceBillingPeriods'),
    reminders: countArray(data, 'reminders'),
    cashBooks: countArray(data, 'cashBooks'),
    cashTransactions: countArray(data, 'cashTransactions'),
    documentations: countArray(data, 'documentations'),
    apiKeys: countArray(data, 'apiKeys'),
    auditLogs: countArray(data, 'auditLogs'),
    invoiceNumberCounters: countArray(data, 'invoiceNumberCounters'),
  };

  const warnings: string[] = [];
  let manifest: BackupPreview['manifest'];
  if (candidate.version === CURRENT_BACKUP_VERSION) {
    manifest = validateBackupManifest(candidate.manifest, data);
  } else if (candidate.version === LEGACY_BACKUP_VERSION) {
    warnings.push(manifestWarning(LEGACY_BACKUP_VERSION)!);
  } else {
    warnings.push(`Backup-Version ${candidate.version} kann inkompatibel sein.`);
  }
  if (!backupSchemaSupportsSupplierTasks(manifest?.schemaVersion)) warnings.push('Dieses ältere Backup enthält keine Lieferanten-Vormerkungen; es erfindet oder reaktiviert keine Aufgaben.');
  if (Array.isArray(data.purchaseDocuments) && data.purchaseDocuments.some(document => document && typeof document === 'object' && (document as Record<string, unknown>).supplierTaskKind != null)) warnings.push('Lieferanten-Vormerkungen bleiben interne Aufgaben: nicht bezahlt oder bankgeprüft. Wiederherstellung löst keine Zahlung, Buchung oder Benachrichtigung aus.');
  if (!backupSchemaSupportsBankMappingProfiles(manifest?.schemaVersion)) warnings.push('Dieses ältere Backup enthält keine Zuordnungsprofile. Bestehende Zielprofile und ihre Löschbelege bleiben unverändert.');
  if (!backupSchemaSupportsDocumentNumberingPolicies(manifest?.schemaVersion)) warnings.push('Dieses ältere Backup enthält keine Nummernformat-Historie. Bestehende Zielrevisionen und höhere Nummernzähler bleiben erhalten.');
  if (manifest && !backupSchemaSupportsPaymentJournal(manifest.schemaVersion)) {
    warnings.push('Dieses Backup enthält keine Zahlungsidentitäten. Zusammenführen mit bereits journalisierten Rechnungen ist nicht sicher; hierfür ein leeres Ziel verwenden.');
  }
  if (Array.isArray(data.paymentJournalEvents) && data.paymentJournalEvents.some((event) => event && typeof event === 'object' && (event as Record<string, unknown>).dateCertainty !== 'ACTUAL')) {
    warnings.push('Historische Zahlungsnachweise behalten ihre ursprüngliche Datumsunsicherheit; fehlende Einnahmen oder Daten werden nicht ergänzt.');
  }
  if (counts.purchaseDocuments > 0 && candidate.type !== 'full') {
    warnings.push('Eingangsbeleg-Originale sind im JSON-Backup nicht eingebettet. Zum Wiederherstellen ist ein vollständiges ZIP-Backup erforderlich.');
  }
  if (Array.isArray(data.purchaseDocuments) && data.purchaseDocuments.some(document => document && typeof document === 'object' && (document as Record<string, unknown>).aiExtraction != null)) warnings.push('KI-Herkunft bleibt erhalten. Unterbrochene Analysen werden nicht fortgesetzt; Provider-Verbindungsdaten sind ausgeschlossen, vorhandene Ziel-Einstellungen bleiben unverändert.');
  if (counts.bankMappingProfiles > 0) warnings.push('Zuordnungsprofile und unveränderliche Revisionen werden konfliktfrei ergänzt. Gelöschte Profile bleiben gelöscht; Profilherkunft bestehender Quittungen bleibt historisch.');
  if (counts.quoteCreateReceipts > 0) warnings.push('Dauerhafte Angebotsanfragen und Löschbelege bleiben erhalten. Verbrauchte Anfrage-IDs werden nicht reaktiviert; bestehende Original-PDFs gleicher Anfrage bleiben unverändert. Abweichende Anfrage- oder Originalhashes brechen die Wiederherstellung vollständig ab.');
  if (candidate.type !== 'full' && Array.isArray(data.quoteCreateReceipts) && data.quoteCreateReceipts.some(row => row && typeof row === 'object' && (row as Record<string, unknown>).invoiceId != null)) warnings.push('Original-PDFs dauerhafter Angebotsanfragen sind nicht eingebettet. Ohne bereits geprüftes Zieloriginal ist ein vollständiges ZIP-Backup erforderlich.');
  if (counts.documentNumberingPolicies > 0) warnings.push('Nummernformat-Historie wird nur konfliktfrei ergänzt. Bestehende Nummern und höhere Zähler bleiben erhalten; abweichende Revisionen brechen die gesamte Wiederherstellung ab.');
  if (counts.bankImportBatches > 0) warnings.push('Bankimport-Quittungen und Bankzeilen bleiben historische Evidenz. Wiederherstellen führt keine Zahlung, Einnahme, Ausgabe oder neue Dublettenbewertung aus.');
  if (counts.bankPaymentBindings > 0) warnings.push('Bank-Zahlungsbindungen und vollständige Zuordnungsketten bleiben erhalten. Keine Zahlung, Erstattung oder Umzuordnung wird ausgeführt; CSV-Herkunft ist kein authentifizierter Geldeingangsnachweis.');
  if (counts.serviceProjects > 0) warnings.push('Projekte, archivierte Zustände und manuell erfasste Minuten bleiben erhalten. Bestehende Leistungsnotizen und Rechnungszuordnungen werden beim Zusammenführen nicht überschrieben.');
  if (Array.isArray(data.purchaseValidationReports) && data.purchaseValidationReports.length > 0) warnings.push(`${data.purchaseValidationReports.length} technische Eingangsprüfberichte werden nur als historische Nachweise übernommen. Keine aktuelle technische oder steuerliche Freigabe; keine automatische erneute Prüfung.`);
  if (counts.serviceBillingPlans > 0) warnings.push('Servicepläne und erledigte Perioden bleiben erhalten. Wiederherstellen erzeugt, versendet oder verbucht keine Rechnungen; abweichende Periodenidentitäten werden nicht überschrieben.');
  if (counts.apiKeys > 0) {
    warnings.push('API-Schlüssel werden aus Sicherheitsgründen ohne geheime Schlüssel wiederhergestellt und müssen neu erstellt werden.');
  }
  if (!candidate.exportedAt) {
    warnings.push('Das Backup enthält kein Exportdatum.');
  }

  const totalRecords = Object.values(counts).reduce((sum, count) => sum + count, 0);

  return {
    version: candidate.version,
    type: candidate.type === 'full' ? 'full' : candidate.type === 'json' || candidate.type === undefined ? 'json' : 'unknown',
    exportedAt: typeof candidate.exportedAt === 'string' ? candidate.exportedAt : undefined,
    user: candidate.user && typeof candidate.user === 'object' ? {
      email: typeof candidate.user.email === 'string' ? candidate.user.email : undefined,
      name: typeof candidate.user.name === 'string' ? candidate.user.name : undefined,
    } : undefined,
    counts,
    totalRecords,
    warnings,
    manifest,
  };
}
