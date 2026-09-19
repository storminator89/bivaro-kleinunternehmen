import {
  CURRENT_BACKUP_VERSION,
  LEGACY_BACKUP_VERSION,
  manifestWarning,
  validateBackupManifest,
  type BackupManifest,
} from '@/lib/backup-manifest';

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
    expenses: number;
    incomes: number;
    invoices: number;
    templates: number;
    recurringExpenses: number;
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

  const data = candidate.data;
  const counts = {
    customers: countArray(data, 'customers'),
    expenses: countArray(data, 'expenses'),
    incomes: countArray(data, 'incomes'),
    invoices: countArray(data, 'invoices'),
    templates: countArray(data, 'templates'),
    recurringExpenses: countArray(data, 'recurringExpenses'),
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
