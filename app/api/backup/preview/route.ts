import { NextRequest, NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { createBackupPreview } from '@/lib/backup-preview';
import { BackupValidationError } from '@/lib/backup-restore';
import { auditSecurityEvent } from '@/lib/audit-log';
import { MAX_JSON_BACKUP_BYTES, readRequestBodyWithinLimit, RequestBodyLimitError } from '@/lib/resource-limits';

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
    const preview = createBackupPreview(backup);

    await auditSecurityEvent(userId, {
      event: 'BACKUP_RESTORE_PREVIEW',
      outcome: 'success',
      severity: 'info',
      metadata: {
        backupType: preview.type,
        version: preview.version,
        totalRecords: preview.totalRecords,
      },
    });

    return NextResponse.json({ preview });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    if (error instanceof RequestBodyLimitError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof BackupValidationError) {
      return NextResponse.json({ error: error.message, issues: error.issues, truncated: error.truncated }, { status: error.status });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Backup-Vorschau fehlgeschlagen' },
      { status: 400 }
    );
  }
}
