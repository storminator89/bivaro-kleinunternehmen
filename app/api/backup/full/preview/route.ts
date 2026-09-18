import { NextRequest, NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { createBackupPreview } from '@/lib/backup-preview';
import { auditSecurityEvent } from '@/lib/audit-log';
import { loadZipWithinLimits, readZipEntryWithinLimit } from '@/lib/zip-limits';
import {
  MAX_BACKUP_ZIP_BYTES,
  MAX_JSON_BACKUP_BYTES,
  readRequestBodyWithinLimit,
  requestWithBody,
  RequestBodyLimitError,
} from '@/lib/resource-limits';

export async function POST(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const boundedBody = await readRequestBodyWithinLimit(request, MAX_BACKUP_ZIP_BYTES + 128 * 1024);
    const formData = await requestWithBody(request, boundedBody).formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'Keine Datei hochgeladen' }, { status: 400 });
    }

    if (file.size > MAX_BACKUP_ZIP_BYTES) {
      return NextResponse.json({ error: 'Das ZIP-Backup ist zu groß' }, { status: 413 });
    }

    const zip = await loadZipWithinLimits(new Uint8Array(await file.arrayBuffer()));
    const backupFile = zip.file('backup.json');
    if (!backupFile) {
      return NextResponse.json({ error: 'Ungültiges Backup: backup.json fehlt' }, { status: 400 });
    }

    const backupBytes = await readZipEntryWithinLimit(backupFile, MAX_JSON_BACKUP_BYTES);
    const backup = JSON.parse(backupBytes.toString('utf8'));
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
    if (error instanceof RequestBodyLimitError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Backup-Vorschau fehlgeschlagen' },
      { status: 400 }
    );
  }
}
