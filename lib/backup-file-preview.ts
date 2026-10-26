import type JSZip from 'jszip';
import { hashBytes, type BackupFileManifestEntry } from '@/lib/backup-manifest';
import { isUnrenderedServiceBillingDraft } from '@/lib/service-billing';
import { isSafeLegacyFileName, isSafeStoredFileName } from '@/lib/upload-path';
import { readZipEntryWithinLimit, type ZipReadBudget } from '@/lib/zip-limits';

export type BackupFileInspection = {
  status: 'MANIFEST_VERIFIED' | 'LEGACY_UNVERIFIED';
  archiveFiles: number;
  referencedFiles: number;
  checkedFiles: number;
  verifiedFiles: number;
  checkedBytes: number;
  unlistedFiles: number;
};

type FileKind = BackupFileManifestEntry['kind'];
type FileReference = { kind: FileKind; sourceName: string };
const prefixes: Record<FileKind, string> = { invoice: 'invoices', receipt: 'receipts', logo: 'logos', 'purchase-document': 'purchase-documents' };

export class BackupFileInspectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupFileInspectionError';
  }
}

function safeName(value: unknown): string {
  if (!(isSafeStoredFileName(value) || isSafeLegacyFileName(value))) {
    throw new BackupFileInspectionError('Das Backup enthält eine unzulässige Dateireferenz.');
  }
  return value;
}

function records(data: Record<string, unknown>, key: string): Record<string, unknown>[] {
  return Array.isArray(data[key]) ? data[key] as Record<string, unknown>[] : [];
}

/** Match the full-restore source selection; no target/storage lookup is allowed here. */
function referencedFiles(data: Record<string, unknown>): FileReference[] {
  const references: FileReference[] = [];
  for (const invoice of records(data, 'invoices')) {
    if (!isUnrenderedServiceBillingDraft(invoice)) references.push({ kind: 'invoice', sourceName: safeName(invoice.storedFileName || `invoice-${String(invoice.id)}`) });
  }
  for (const document of records(data, 'purchaseDocuments')) references.push({ kind: 'purchase-document', sourceName: safeName(document.storedFileName) });
  for (const expense of records(data, 'expenses')) {
    if (expense.storedReceiptFileName) references.push({ kind: 'receipt', sourceName: safeName(expense.storedReceiptFileName) });
  }
  const settings = data.settings as { logoUrl?: unknown } | null | undefined;
  if (settings?.logoUrl) {
    const match = typeof settings.logoUrl === 'string' ? settings.logoUrl.match(/(?:[?&]file=|\/uploads\/)([^&]+)/u) : null;
    let sourceName: string;
    try { sourceName = safeName(match ? decodeURIComponent(match[1]) : null); }
    catch { throw new BackupFileInspectionError('Das Backup enthält eine unzulässige Logo-Dateireferenz.'); }
    references.push({ kind: 'logo', sourceName });
  }
  return references;
}

/**
 * Inspect only an already shape/graph-validated full backup in a bounded ZIP.
 * The caller shares the same read budget with backup.json. No extraction,
 * target-database comparison, media decoding, or restore is performed.
 */
export async function inspectBackupFiles(
  zip: JSZip,
  data: Record<string, unknown>,
  fileManifest: readonly BackupFileManifestEntry[] | undefined,
  budget: ZipReadBudget,
): Promise<BackupFileInspection> {
  const paths = new Map<string, { bytes: number; sha256: string } | null>();
  const sources = new Map<string, string>();
  for (const file of fileManifest ?? []) {
    if (!Object.hasOwn(prefixes, file.kind)) throw new BackupFileInspectionError('Das Backup enthält eine unbekannte Dateiart.');
    const sourceName = safeName(file.sourceName);
    const path = file.zipPath ?? `${prefixes[file.kind]}/${sourceName}`;
    // Manifest validation normally enforces this. Keep the read boundary safe
    // even if a future caller accidentally omits that precondition.
    if (!/^(?:invoices|receipts|logos|purchase-documents)\/[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u.test(path)) throw new BackupFileInspectionError('Das Backup enthält einen unzulässigen ZIP-Dateipfad.');
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/u.test(file.sha256)) throw new BackupFileInspectionError('Das Backup enthält einen ungültigen Dateinachweis.');
    const expected = { bytes: file.bytes, sha256: file.sha256 };
    const known = paths.get(path);
    if (known && (known.bytes !== expected.bytes || known.sha256 !== expected.sha256)) throw new BackupFileInspectionError('Mehrere Dateinachweise desselben ZIP-Eintrags widersprechen sich.');
    const sourceKey = `${file.kind}:${sourceName}`;
    if (sources.has(sourceKey)) throw new BackupFileInspectionError('Das Backup enthält eine doppelte Dateiquelle.');
    paths.set(path, expected);
    sources.set(sourceKey, path);
  }

  const referencedPaths = new Set<string>();
  for (const reference of referencedFiles(data)) {
    const sourceKey = `${reference.kind}:${reference.sourceName}`;
    const path = sources.get(sourceKey) ?? `${prefixes[reference.kind]}/${reference.sourceName}`;
    if (fileManifest && !sources.has(sourceKey)) throw new BackupFileInspectionError('Eine referenzierte Originaldatei fehlt im Backup-Dateimanifest. Bitte ein vollständiges ZIP-Backup auswählen.');
    referencedPaths.add(path);
    if (!paths.has(path)) paths.set(path, null);
  }

  let checkedFiles = 0, verifiedFiles = 0, checkedBytes = 0;
  for (const [path, expected] of paths) {
    const entry = zip.file(path);
    if (!entry) throw new BackupFileInspectionError('Mindestens eine referenzierte oder im Manifest genannte Originaldatei fehlt im ZIP. Bitte ein vollständiges Backup auswählen.');
    const bytes = await readZipEntryWithinLimit(entry, undefined, budget);
    if (bytes.byteLength === 0) throw new BackupFileInspectionError('Das ZIP enthält eine leere Originaldatei. Die Dateiprüfung ist fehlgeschlagen.');
    checkedFiles++;
    checkedBytes += bytes.byteLength;
    if (expected) {
      if (expected.bytes !== bytes.byteLength) throw new BackupFileInspectionError('Die Größe einer Originaldatei stimmt nicht mit dem Backup-Dateimanifest überein.');
      if (expected.sha256 !== hashBytes(bytes)) throw new BackupFileInspectionError('Die SHA-256-Prüfsumme einer Originaldatei stimmt nicht mit dem Backup-Dateimanifest überein.');
      verifiedFiles++;
    }
  }
  const archivePaths = Object.keys(zip.files).filter(path => !zip.files[path].dir && path !== 'backup.json');
  return {
    status: fileManifest ? 'MANIFEST_VERIFIED' : 'LEGACY_UNVERIFIED',
    archiveFiles: archivePaths.length,
    referencedFiles: referencedPaths.size,
    checkedFiles,
    verifiedFiles,
    checkedBytes,
    unlistedFiles: archivePaths.filter(path => !paths.has(path)).length,
  };
}
