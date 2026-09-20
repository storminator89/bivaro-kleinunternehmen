import { NextRequest, NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { auditBackup, auditSecurityEvent } from '@/lib/audit-log';
import { restoreBackupData, BackupValidationError } from '@/lib/backup-restore';
import {
  readRequestBodyWithinLimit,
  RequestBodyLimitError,
  MAX_JSON_BACKUP_BYTES,
} from '@/lib/resource-limits';

/** Restore a JSON backup atomically after complete validation. */
export async function POST(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = await readRequestBodyWithinLimit(request, MAX_JSON_BACKUP_BYTES);
    let backup: unknown;
    try {
      backup = JSON.parse(new TextDecoder().decode(body));
    } catch {
      return NextResponse.json({ error: 'Ungültiges JSON-Backup' }, { status: 400 });
    }
    const overwrite = isRecordWithBoolean(backup, 'confirmOverwrite');
    const results = await restoreBackupData({ userId, backup, overwrite });

    await auditBackup(userId, 'RESTORE', {
      overwriteMode: overwrite,
      backupType: 'json',
      results,
    });
    await auditSecurityEvent(userId, {
      event: 'BACKUP_RESTORE',
      outcome: 'success',
      severity: overwrite ? 'critical' : 'warning',
      metadata: {
        backupType: 'json',
        overwriteMode: overwrite,
        importedCustomers: results.customers.imported,
        importedExpenses: results.expenses.imported,
        importedIncomes: results.incomes.imported,
        importedInvoices: results.invoices.imported,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Backup erfolgreich wiederhergestellt',
      results,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    if (error instanceof RequestBodyLimitError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const status = error instanceof BackupValidationError ? error.status : 500;
    console.error('Restore error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Wiederherstellung fehlgeschlagen',
        ...(error instanceof BackupValidationError ? { issues: error.issues, truncated: error.truncated } : {}),
      },
      { status },
    );
  }
}

function isRecordWithBoolean(value: unknown, key: string): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (value as Record<string, unknown>)[key] === true;
}
