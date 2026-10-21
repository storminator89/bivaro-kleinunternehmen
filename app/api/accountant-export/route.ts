import { NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { AccountantExportError, createAccountantExport, previewAccountantExport, parseAccountantExportPeriod } from '@/lib/accountant-export';
import { BackupFileConsistencyError } from '@/lib/backup-snapshot';
import { ProcessingCapacityError, withProcessingSlot } from '@/lib/processing-limit';
import { auditSecurityEvent } from '@/lib/audit-log';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const params = new URL(request.url).searchParams;
    const previewValues = params.getAll('preview');
    const fingerprints = params.getAll('expectedFingerprint');
    if (previewValues.length > 1 || (previewValues.length && previewValues[0] !== '1') ||
        fingerprints.length > 1 || (fingerprints.length && !/^[a-f0-9]{64}$/.test(fingerprints[0])) ||
        (previewValues.length && fingerprints.length)) {
      throw new AccountantExportError('Ungültige Vorschau- oder Paketbestätigung. Bitte die Vorschau erneut öffnen.');
    }
    const preview = previewValues.length === 1;
    const expectedFingerprint = fingerprints[0];
    params.delete('preview');
    params.delete('expectedFingerprint');
    const period = parseAccountantExportPeriod(params);
    return await withProcessingSlot(userId, async () => {
      if (preview) {
        const result = await previewAccountantExport(userId, period);
        return NextResponse.json({ manifest: result.manifest, filename: result.filename }, {
          headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
        });
      }
      const result = await createAccountantExport(userId, period, expectedFingerprint);
      await auditSecurityEvent(userId, {
        event: 'ACCOUNTANT_HANDOFF_EXPORT', outcome: 'success', severity: 'info',
        metadata: { formatVersion: 1, from: period.from, to: period.to, counts: result.counts, warningCount: result.warningCount },
      });
      return new NextResponse(new Uint8Array(result.bytes), {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${result.filename}"`,
          'Content-Length': String(result.bytes.byteLength),
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
          'X-Bivaro-Export-Warnings': String(result.warningCount),
        },
      });
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    if (error instanceof AccountantExportError || error instanceof BackupFileConsistencyError || error instanceof ProcessingCapacityError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'private, no-store' } });
    }
    console.error('Accountant handoff export failed');
    return NextResponse.json({ error: 'Übergabepaket konnte nicht erstellt werden.' }, { status: 500, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
