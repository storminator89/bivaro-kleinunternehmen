/** Explicit server-side budgets for authenticated file-processing endpoints. */
export const MAX_INVOICE_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_RECEIPT_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_LOGO_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_INPUT_BYTES = 20 * 1024 * 1024;
export const MAX_XML_INPUT_BYTES = 8 * 1024 * 1024;
export const MAX_PDF_XML_COMBINED_BYTES = 25 * 1024 * 1024;
export const MAX_BACKUP_ZIP_BYTES = 100 * 1024 * 1024;
export const MAX_BACKUP_ZIP_ENTRIES = 2_000;
export const MAX_BACKUP_ZIP_ENTRY_BYTES = 50 * 1024 * 1024;
export const MAX_BACKUP_ZIP_UNCOMPRESSED_BYTES = 250 * 1024 * 1024;
export const MAX_BACKUP_ZIP_COMPRESSION_RATIO = 200;
export const MAX_JSON_BACKUP_BYTES = 100 * 1024 * 1024;
export const MAX_JSON_REQUEST_BYTES = 40 * 1024 * 1024;

export class RequestBodyLimitError extends Error {
  readonly status = 413;

  constructor(message = 'Anfrage ist zu groß') {
    super(message);
    this.name = 'RequestBodyLimitError';
  }
}

export function isRequestBodyWithinLimit(request: Request, maxBytes: number): boolean {
  const value = request.headers.get('content-length');
  if (!value) return true;
  const length = Number(value);
  return Number.isFinite(length) && length >= 0 && length <= maxBytes;
}

/** Read a request body while counting actual bytes, including chunked bodies. */
export async function readRequestBodyWithinLimit(request: Request, maxBytes: number): Promise<Uint8Array> {
  if (!isRequestBodyWithinLimit(request, maxBytes)) {
    throw new RequestBodyLimitError();
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new RequestBodyLimitError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/** Recreate a request after bounded body reading so FormData/JSON parsers see the bytes. */
export function requestWithBody(request: Request, body: Uint8Array): Request {
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  headers.set('content-length', String(body.byteLength));
  return new Request(request.url, {
    method: request.method,
    headers,
    body,
  });
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
