import { BANK_IMPORT_MAPPING_VERSION, BANK_IMPORT_PARSER_VERSION, BankImportError, type BankImportReceipt, type BankImportDetail } from '@/lib/bank-import-contract';
import type { BankCsvDelimiter, BankCsvMapping } from '@/lib/bank-csv';

export function bankImportOriginalBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
  return btoa(binary);
}
async function result<T>(response: Response): Promise<T> {
  const value = await response.json();
  if (!response.ok) throw new BankImportError(typeof value.error === 'string' ? value.error : 'Die Quittung konnte nicht geladen werden.', response.status, value.existingReceiptId);
  return value as T;
}
const read = <T>(path: string, signal: AbortSignal, fetcher: typeof fetch) => fetcher(path, { method: 'GET', cache: 'no-store', credentials: 'same-origin', signal }).then(result<T>);
export async function saveBankImport(input: { originalBase64: string; mapping: BankCsvMapping; delimiter: BankCsvDelimiter; requestId: string }, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  return result<{ receipt: BankImportReceipt; replayed: boolean }>(await fetcher('/api/bank-imports', { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ ...input, parserVersion: BANK_IMPORT_PARSER_VERSION, mappingVersion: BANK_IMPORT_MAPPING_VERSION, reviewed: true }) }));
}
export function recoverBankImportReceipt(requestId: string, signal: AbortSignal, fetcher: typeof fetch = fetch) { return read<{ receipt: BankImportReceipt | null }>(`/api/bank-imports?requestId=${encodeURIComponent(requestId)}`, signal, fetcher); }
export function loadBankImportReceipt(id: string, page: number, signal: AbortSignal, fetcher: typeof fetch = fetch) { return read<BankImportDetail>(`/api/bank-imports/${encodeURIComponent(id)}?page=${page}`, signal, fetcher); }
export function loadBankImportHistory(page: number, signal: AbortSignal, fetcher: typeof fetch = fetch) { return read<{ receipts: BankImportReceipt[]; page: number; hasMore: boolean }>(`/api/bank-imports?page=${page}`, signal, fetcher); }

/** Unknown response retries always ask for the SAME UUID before resubmission. */
export async function resolveBankImportReceipt(input: Parameters<typeof saveBankImport>[0], uncertain: boolean, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<BankImportReceipt> {
  if (uncertain) {
    const recovered = await recoverBankImportReceipt(input.requestId, signal, fetcher);
    if (recovered.receipt) return recovered.receipt;
  }
  try { return (await saveBankImport(input, signal, fetcher)).receipt; }
  catch (failure) {
    if (failure instanceof BankImportError && failure.status === 409 && failure.existingReceiptId) return (await loadBankImportReceipt(failure.existingReceiptId, 0, signal, fetcher)).receipt;
    throw failure;
  }
}
