import { NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import JSZip from 'jszip';
import { loadZipWithinLimits, ZipResourceLimitError } from '@/lib/zip-limits';
import { MAX_BACKUP_ZIP_ENTRIES, MAX_BACKUP_ZIP_ENTRY_BYTES, MAX_BACKUP_ZIP_UNCOMPRESSED_BYTES } from '@/lib/resource-limits';
import { isSafeLegacyFileName, isSafeStoredFileName } from '@/lib/upload-path';
import { findOwnedUploadedFile } from '@/lib/upload-ownership';
import { auditSecurityEvent } from '@/lib/audit-log';
import { createBackupManifest, CURRENT_BACKUP_VERSION } from '@/lib/backup-manifest';
import { BackupFileConsistencyError, BackupFileSizeError, getBackupFileVersion, readBackupSnapshot, readStableBackupFile } from '@/lib/backup-snapshot';

// GET: Export all user data as ZIP including files
export async function GET() {
  try {
    const userId = await requireUserId();

    const snapshot = await readBackupSnapshot(userId);
    const { data } = snapshot;
    const count = (key: string) => Array.isArray(data[key]) ? data[key].length : 0;
    const invoices = Array.isArray(data.invoices) ? data.invoices as Array<{ storedFileName?: string | null }> : [];
    const expenses = Array.isArray(data.expenses) ? data.expenses as Array<{ storedReceiptFileName?: string | null }> : [];
    const settings = data.settings as { logoUrl?: string | null } | null;
    const exportedAt = snapshot.info.endedAt;

    // Create ZIP archive
    const zip = new JSZip();
    const missingFiles: string[] = [];

    // Add files first; backup.json is written after its file manifest is complete.
    let totalBytes = 0;
    let fileCount = 1;
    const fileManifest: import('@/lib/backup-manifest').BackupFileManifestEntry[] = [];
    const packedFiles: Array<{ path: string; sourceVersion: string; sourceName: string }> = [];

    const addOwnedFile = async (kind: 'invoices' | 'receipts' | 'logos', storedName: string | null | undefined) => {
      if (!storedName || !(isSafeStoredFileName(storedName) || isSafeLegacyFileName(storedName))) {
        missingFiles.push(`${kind}/${storedName || '(leer)'}`);
        return;
      }
      if (zip.file(`${kind}/${storedName}`)) return;
      const filePath = await findOwnedUploadedFile(userId, storedName);
      if (!filePath) {
        missingFiles.push(`${kind}/${storedName}`);
        return;
      }
      try {
        if (fileCount + 4 > MAX_BACKUP_ZIP_ENTRIES) throw new ZipResourceLimitError('Der Datenbestand überschreitet die Größenlimits des vollständigen Backups');
        const stable = await readStableBackupFile(filePath, Math.min(MAX_BACKUP_ZIP_ENTRY_BYTES, MAX_BACKUP_ZIP_UNCOMPRESSED_BYTES - totalBytes));
        if (!stable) {
          missingFiles.push(`${kind}/${storedName}`);
          return;
        }
        const size = stable.bytes.byteLength;
        // Reserve room for the three directory entries JSZip adds automatically.
        if (size > MAX_BACKUP_ZIP_ENTRY_BYTES || totalBytes + size > MAX_BACKUP_ZIP_UNCOMPRESSED_BYTES) {
          throw new ZipResourceLimitError('Der Datenbestand überschreitet die Größenlimits des vollständigen Backups');
        }
        totalBytes += size;
        fileCount++;
        zip.file(`${kind}/${storedName}`, stable.bytes);
        const manifestKind = kind === 'invoices' ? 'invoice' : kind === 'receipts' ? 'receipt' : 'logo';
        fileManifest.push({ kind: manifestKind, sourceName: storedName, zipPath: `${kind}/${storedName}`, bytes: stable.bytes.byteLength, sha256: stable.sha256, sourceVersion: stable.sourceVersion });
        packedFiles.push({ path: filePath, sourceVersion: stable.sourceVersion, sourceName: storedName });
      } catch (error) {
        if (error instanceof ZipResourceLimitError) throw error;
        if (error instanceof BackupFileConsistencyError) throw error;
        if (error instanceof BackupFileSizeError) throw new ZipResourceLimitError(error.message);
        missingFiles.push(`${kind}/${storedName}`);
      }
    };

    // Add invoice PDFs. A full archive must fail visibly if a referenced file
    // cannot be read; otherwise a later restore could only create a broken
    // invoice record.
    for (const invoice of invoices) {
      await addOwnedFile('invoices', invoice.storedFileName);
    }

    // Add expense receipts
    for (const expense of expenses) {
      if (expense.storedReceiptFileName) await addOwnedFile('receipts', expense.storedReceiptFileName);
    }

    // Add logo if exists
    if (settings?.logoUrl) {
      const logoMatch = settings.logoUrl.match(/(?:file=|\/uploads\/)(.+?)(?:$|&)/);
      if (logoMatch) {
        let logoFileName: string | null = null;
        try { logoFileName = decodeURIComponent(logoMatch[1]); } catch { /* reported below */ }
        await addOwnedFile('logos', logoFileName);
      } else {
        missingFiles.push('logos/(ungültige Referenz)');
      }
    }

    if (missingFiles.length > 0) {
      return NextResponse.json({
        error: 'Vollständiges Backup nicht möglich: referenzierte Dateien fehlen oder sind nicht zugreifbar.',
        missingFiles: missingFiles.slice(0, 100),
        missingCount: missingFiles.length,
      }, { status: 409 });
    }

    // Recheck every source after all file reads and before the archive metadata
    // is finalized. There is no immutable file-version store yet, so this
    // bounds ordinary concurrent mutation but cannot promise a filesystem-wide
    // atomic point beyond the final stat.
    for (const packed of packedFiles) {
      if (await getBackupFileVersion(packed.path) !== packed.sourceVersion) {
        throw new BackupFileConsistencyError(`Datei ${packed.sourceName} wurde während des Backups verändert`);
      }
    }

    const backup = {
      version: CURRENT_BACKUP_VERSION,
      type: 'full',
      exportedAt,
      manifest: createBackupManifest({ sourceUserId: userId, generatedAt: exportedAt, data, fileManifest, snapshot: snapshot.info }),
      user: data.user,
      data,
      stats: {
        expenses: count('expenses'),
        incomes: count('incomes'),
        invoices: count('invoices'),
        customers: count('customers'),
        templates: count('templates'),
        recurringExpenses: count('recurringExpenses'),
        reminders: count('reminders'),
        cashBooks: count('cashBooks'),
        cashTransactions: count('cashTransactions'),
        documentations: count('documentations'),
        apiKeys: count('apiKeys'),
        auditLogs: count('auditLogs'),
        invoiceNumberCounters: count('invoiceNumberCounters'),
      },
    };
    const metadata = JSON.stringify(backup, null, 2);
    const metadataBytes = Buffer.byteLength(metadata);
    if (metadataBytes > MAX_BACKUP_ZIP_ENTRY_BYTES || totalBytes + metadataBytes > MAX_BACKUP_ZIP_UNCOMPRESSED_BYTES) throw new ZipResourceLimitError('Backup-Metadaten überschreiten die Wiederherstellungsgrenze');
    totalBytes += metadataBytes;
    zip.file('backup.json', metadata);

    // Generate ZIP buffer
    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 }
    });

    // Never emit an archive that our own restore endpoint would reject.
    await loadZipWithinLimits(zipBuffer);

    await auditSecurityEvent(userId, {
      event: 'FULL_BACKUP_EXPORT',
      outcome: 'success',
      severity: 'info',
      metadata: {
        backupType: 'full',
        expensesCount: count('expenses'),
        incomesCount: count('incomes'),
        invoicesCount: count('invoices'),
        customersCount: count('customers'),
      },
    });

    const filename = `bivaro-full-backup-${new Date().toISOString().split('T')[0]}.zip`;

    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': zipBuffer.length.toString(),
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    if (error instanceof BackupFileConsistencyError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof ZipResourceLimitError) return NextResponse.json({ error: error.message }, { status: 413 });
    console.error('Full backup error:', error);
    return NextResponse.json({ error: 'Vollständiges Backup fehlgeschlagen' }, { status: 500 });
  }
}
