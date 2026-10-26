import { protectMutation } from '@/lib/request-security';
import { NextRequest, NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { createBackupPreview } from '@/lib/backup-preview';
import { BackupValidationError } from '@/lib/backup-restore';
import { auditSecurityEvent } from '@/lib/audit-log';
import { createZipReadBudget, loadZipWithinLimits, readZipEntryWithinLimit } from '@/lib/zip-limits';
import { inspectBackupFiles } from '@/lib/backup-file-preview';
import { ProcessingCapacityError, withProcessingSlot } from '@/lib/processing-limit';
import {
  MAX_BACKUP_ZIP_BYTES,
  MAX_JSON_BACKUP_BYTES,
  readRequestBodyWithinLimit,
  requestWithBody,
  RequestBodyLimitError,
} from '@/lib/resource-limits';

async function postHandler(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const boundedBody = await readRequestBodyWithinLimit(request, MAX_BACKUP_ZIP_BYTES + 128 * 1024);
    const formData = await requestWithBody(request, boundedBody).formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Keine Datei hochgeladen' }, { status: 400 });
    }

    if (file.size > MAX_BACKUP_ZIP_BYTES) {
      return NextResponse.json({ error: 'Das ZIP-Backup ist zu groß' }, { status: 413 });
    }

    return await withProcessingSlot(userId, async () => {
      const zip = await loadZipWithinLimits(new Uint8Array(await file.arrayBuffer()));
      const zipReadBudget = createZipReadBudget();
      const backupFile = zip.file('backup.json');
      if (!backupFile) {
        return NextResponse.json({ error: 'Ungültiges Backup: backup.json fehlt' }, { status: 400 });
      }

      const backupBytes = await readZipEntryWithinLimit(backupFile, MAX_JSON_BACKUP_BYTES, zipReadBudget);
      const backup = JSON.parse(backupBytes.toString('utf8'));
      if (backup?.type !== 'full') {
        return NextResponse.json({ error: 'Das ZIP-Backup enthält keinen vollständigen Export' }, { status: 400 });
      }
      const preview = createBackupPreview(backup);
      const fileInspection = await inspectBackupFiles(zip, backup.data, preview.manifest?.fileManifest, zipReadBudget, preview.manifest?.schemaVersion);
      const fileCount = fileInspection.archiveFiles;

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

      return NextResponse.json({ preview: { ...preview, fileCount, fileInspection } });
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    if (error instanceof ProcessingCapacityError) {
      return NextResponse.json({ error: error.message, code: 'PROCESSING_BUSY' }, { status: error.status, headers: { 'Retry-After': '1' } });
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

export const POST = protectMutation(postHandler);
