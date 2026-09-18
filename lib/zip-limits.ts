import JSZip, { type JSZipObject } from 'jszip';
import {
  MAX_BACKUP_ZIP_BYTES,
  MAX_BACKUP_ZIP_COMPRESSION_RATIO,
  MAX_BACKUP_ZIP_ENTRIES,
  MAX_BACKUP_ZIP_ENTRY_BYTES,
  MAX_BACKUP_ZIP_UNCOMPRESSED_BYTES,
} from '@/lib/resource-limits';

export class ZipResourceLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipResourceLimitError';
  }
}

type ZipInternalData = {
  compressedSize?: number;
  uncompressedSize?: number;
};

export type ZipReadBudget = {
  readonly maxBytes: number;
  consumedBytes: number;
};

export function createZipReadBudget(maxBytes = MAX_BACKUP_ZIP_UNCOMPRESSED_BYTES): ZipReadBudget {
  return { maxBytes, consumedBytes: 0 };
}

function entrySizes(entry: JSZipObject): ZipInternalData {
  const candidate = entry as JSZipObject & { _data?: ZipInternalData };
  return candidate._data ?? {};
}

function assertSafeEntryName(name: string): void {
  if (
    name.startsWith('/')
    || name.startsWith('\\')
    || name.includes('\0')
    || name.split(/[\\/]/u).some((part) => part === '..')
  ) {
    throw new ZipResourceLimitError('Ungültiger ZIP-Eintrag');
  }
}

function assertEntryNames(entry: JSZipObject): void {
  assertSafeEntryName(entry.name);
  // JSZip normalizes names such as "../backup.json" in `name`, while keeping
  // the original spelling separately. Validate both forms before a caller
  // constructs a path from the normalized name.
  const originalName = (entry as JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName;
  if (originalName && originalName !== entry.name) assertSafeEntryName(originalName);
}

export function assertZipEntryName(name: string): void {
  assertSafeEntryName(name);
}

export async function loadZipWithinLimits(bytes: Uint8Array): Promise<JSZip> {
  if (bytes.byteLength > MAX_BACKUP_ZIP_BYTES) {
    throw new ZipResourceLimitError('Das ZIP-Backup ist zu groß');
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new ZipResourceLimitError('Ungültiges ZIP-Backup');
  }

  const entries = Object.entries(zip.files);
  if (entries.length > MAX_BACKUP_ZIP_ENTRIES) {
    throw new ZipResourceLimitError('Das ZIP-Backup enthält zu viele Einträge');
  }

  let totalUncompressed = 0;
  for (const [name, entry] of entries) {
    assertSafeEntryName(name);
    assertEntryNames(entry);
    if (entry.dir) continue;

    const { compressedSize, uncompressedSize } = entrySizes(entry);
    if (typeof uncompressedSize === 'number') {
      if (uncompressedSize > MAX_BACKUP_ZIP_ENTRY_BYTES) {
        throw new ZipResourceLimitError('Ein ZIP-Eintrag ist zu groß');
      }
      totalUncompressed += uncompressedSize;
      if (totalUncompressed > MAX_BACKUP_ZIP_UNCOMPRESSED_BYTES) {
        throw new ZipResourceLimitError('Das entpackte ZIP-Backup ist zu groß');
      }
    }
    if (
      typeof compressedSize === 'number'
      && typeof uncompressedSize === 'number'
      && compressedSize > 0
      && uncompressedSize / compressedSize > MAX_BACKUP_ZIP_COMPRESSION_RATIO
    ) {
      throw new ZipResourceLimitError('Unzulässiges ZIP-Kompressionsverhältnis');
    }
  }

  return zip;
}

export async function readZipEntryWithinLimit(
  entry: JSZipObject,
  maxBytes = MAX_BACKUP_ZIP_ENTRY_BYTES,
  budget = createZipReadBudget(),
): Promise<Buffer> {
  if (entry.dir) throw new ZipResourceLimitError('Verzeichnisse können nicht gelesen werden');
  assertEntryNames(entry);
  const { uncompressedSize } = entrySizes(entry);
  if (typeof uncompressedSize === 'number' && uncompressedSize > maxBytes) {
    throw new ZipResourceLimitError('Ein ZIP-Eintrag ist zu groß');
  }
  const candidate = entry as JSZipObject & {
    internalStream?: (type: 'nodebuffer') => {
      on: (event: 'data' | 'error' | 'end', callback: (value?: Buffer | Uint8Array | Error) => void) => unknown;
      pause?: () => void;
      resume: () => void;
    };
  };
  if (typeof candidate.internalStream === 'function') {
    const stream = candidate.internalStream('nodebuffer');
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      let settled = false;
      stream.on('data', (value) => {
        if (settled || !value || value instanceof Error) return;
        const chunk = value instanceof Buffer ? value : Buffer.from(value);
        total += chunk.byteLength;
        if (total > maxBytes) {
          settled = true;
          stream.pause?.();
          reject(new ZipResourceLimitError('Ein ZIP-Eintrag ist zu groß'));
          return;
        }
        if (budget.consumedBytes + chunk.byteLength > budget.maxBytes) {
          settled = true;
          stream.pause?.();
          reject(new ZipResourceLimitError('Das entpackte ZIP-Backup ist zu groß'));
          return;
        }
        budget.consumedBytes += chunk.byteLength;
        chunks.push(chunk);
      });
      stream.on('error', (error) => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new ZipResourceLimitError('ZIP-Eintrag konnte nicht gelesen werden'));
      });
      stream.on('end', () => {
        if (settled) return;
        settled = true;
        resolve(Buffer.concat(chunks, total));
      });
      stream.resume();
    });
  }

  const bytes = await entry.async('nodebuffer');
  if (bytes.byteLength > maxBytes) throw new ZipResourceLimitError('Ein ZIP-Eintrag ist zu groß');
  if (budget.consumedBytes + bytes.byteLength > budget.maxBytes) {
    throw new ZipResourceLimitError('Das entpackte ZIP-Backup ist zu groß');
  }
  budget.consumedBytes += bytes.byteLength;
  return Buffer.from(bytes);
}
