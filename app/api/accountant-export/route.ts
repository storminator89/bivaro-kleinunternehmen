import { NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { AccountantExportError, createAccountantExport, parseAccountantExportPeriod } from '@/lib/accountant-export';
import { BackupFileConsistencyError } from '@/lib/backup-snapshot';
import { ProcessingCapacityError, withProcessingSlot } from '@/lib/processing-limit';
import { auditSecurityEvent } from '@/lib/audit-log';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const period = parseAccountantExportPeriod(new URL(request.url).searchParams);
    return await withProcessingSlot(userId, async () => {
      const result = await createAccountantExport(userId, period);
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
