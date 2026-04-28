import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { createBackupPreview } from '@/lib/backup-preview';
import { auditSecurityEvent } from '@/lib/audit-log';

export async function POST(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'Keine Datei hochgeladen' }, { status: 400 });
    }

    const zip = await JSZip.loadAsync(Buffer.from(await file.arrayBuffer()));
    const backupFile = zip.file('backup.json');
    if (!backupFile) {
      return NextResponse.json({ error: 'Ungültiges Backup: backup.json fehlt' }, { status: 400 });
    }

    const backup = JSON.parse(await backupFile.async('string'));
    const preview = createBackupPreview(backup);
    const fileCount = Object.keys(zip.files).filter((path) => !zip.files[path].dir && path !== 'backup.json').length;

    await auditSecurityEvent(userId, {
      event: 'BACKUP_RESTORE_PREVIEW',
      outcome: 'success',
      severity: 'info',
      metadata: {
        backupType: 'full',
        version: preview.version,
        totalRecords: preview.totalRecords,
        fileCount,
      },
    });

    return NextResponse.json({ preview: { ...preview, fileCount } });
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
