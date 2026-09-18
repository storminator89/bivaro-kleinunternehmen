import { NextRequest, NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { auditBackup, auditSecurityEvent } from '@/lib/audit-log';
import { restoreBackupData, BackupValidationError } from '@/lib/backup-restore';
import { createZipReadBudget, loadZipWithinLimits, readZipEntryWithinLimit, ZipResourceLimitError } from '@/lib/zip-limits';
import {
  MAX_BACKUP_ZIP_BYTES,
  MAX_JSON_BACKUP_BYTES,
  readRequestBodyWithinLimit,
  requestWithBody,
  RequestBodyLimitError,
} from '@/lib/resource-limits';

/** Restore a full ZIP backup with bounded decompression and atomic DB import. */
export async function POST(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const { searchParams } = new URL(request.url);
    const overwrite = searchParams.get('confirmOverwrite') === 'true';
    const boundedBody = await readRequestBodyWithinLimit(request, MAX_BACKUP_ZIP_BYTES + 128 * 1024);
    const formData = await requestWithBody(request, boundedBody).formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Keine Datei hochgeladen' }, { status: 400 });
    }
    if (file.size > MAX_BACKUP_ZIP_BYTES) {
      return NextResponse.json({ error: 'Das ZIP-Backup ist zu groß' }, { status: 413 });
    }

    const zip = await loadZipWithinLimits(new Uint8Array(await file.arrayBuffer()));
    const zipReadBudget = createZipReadBudget();
    const backupFile = zip.file('backup.json');
    if (!backupFile) {
      return NextResponse.json({ error: 'Ungültiges Backup: backup.json fehlt' }, { status: 400 });
    }
    let backup: Record<string, unknown>;
    try {
      backup = JSON.parse((await readZipEntryWithinLimit(backupFile, MAX_JSON_BACKUP_BYTES, zipReadBudget)).toString('utf8')) as Record<string, unknown>;
    } catch (error) {
      if (error instanceof ZipResourceLimitError) throw error;
      return NextResponse.json({ error: 'Ungültiges JSON-Backup im ZIP' }, { status: 400 });
    }
    if (backup.type !== 'full') {
      return NextResponse.json({ error: 'Das ZIP-Backup enthält keinen vollständigen Export' }, { status: 400 });
    }

    const resolveFile = async (kind: 'invoice' | 'receipt' | 'logo', sourceName: string): Promise<Uint8Array | null> => {
      const prefix = kind === 'invoice' ? 'invoices' : kind === 'receipt' ? 'receipts' : 'logos';
      const entry = zip.file(`${prefix}/${sourceName}`);
      if (!entry) return null;
      return readZipEntryWithinLimit(entry, undefined, zipReadBudget);
    };

    const results = await restoreBackupData({
      userId,
      backup,
      overwrite,
      resolveFile,
    });

    await auditBackup(userId, 'RESTORE', {
      overwriteMode: overwrite,
      backupType: 'full',
      results,
    });
    await auditSecurityEvent(userId, {
      event: 'FULL_BACKUP_RESTORE',
      outcome: 'success',
      severity: overwrite ? 'critical' : 'warning',
      metadata: {
        backupType: 'full',
        overwriteMode: overwrite,
        importedCustomers: results.customers.imported,
        importedExpenses: results.expenses.imported,
        importedIncomes: results.incomes.imported,
        importedInvoices: results.invoices.imported,
        importedFiles: results.files.imported,
      },
    });

    return NextResponse.json({
      success: true,
      message: overwrite
        ? 'Vollständiges Backup erfolgreich wiederhergestellt (Daten überschrieben)'
        : 'Vollständiges Backup erfolgreich wiederhergestellt',
      results,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    if (error instanceof RequestBodyLimitError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const status = error instanceof BackupValidationError || error instanceof ZipResourceLimitError
      ? 400
      : 500;
    console.error('Full restore error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Wiederherstellung fehlgeschlagen' },
      { status },
    );
  }
}
