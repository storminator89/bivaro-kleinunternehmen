import { NextRequest, NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { createBackupPreview } from '@/lib/backup-preview';
import { auditSecurityEvent } from '@/lib/audit-log';

export async function POST(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const backup = await request.json();
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

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Backup-Vorschau fehlgeschlagen' },
      { status: 400 }
    );
  }
}
