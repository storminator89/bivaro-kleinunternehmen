import type { ServiceStatementResult } from '@/lib/service-statement';

export const STATEMENT_DOWNLOAD_ERROR = 'Aufstellung konnte nicht erstellt werden. Bitte erneut versuchen.';
export class StatementRequestError extends Error {}

/** Gateways can return HTML or malformed JSON; never expose parser internals. */
export async function readStatementResponse(response: Response): Promise<ServiceStatementResult> {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = response.status === 401 ? 'Bitte anmelden und die Aufstellung erneut erstellen.'
      : typeof data?.error === 'string' && data.error.length <= 500 ? data.error : STATEMENT_DOWNLOAD_ERROR;
    throw new StatementRequestError(message);
  }
  if (typeof data?.pdfBase64 !== 'string' || !Array.isArray(data.snapshot?.rows) || !data.snapshot.rows.length || typeof data.filename !== 'string') {
    throw new StatementRequestError('Unvollständige Aufstellung. Bitte erneut versuchen.');
  }
  return data as ServiceStatementResult;
}
