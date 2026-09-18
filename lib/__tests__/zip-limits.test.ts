import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  createZipReadBudget,
  loadZipWithinLimits,
  readZipEntryWithinLimit,
  ZipResourceLimitError,
} from '@/lib/zip-limits';

describe('ZIP resource limits', () => {
  it('enforces the decompressed budget across multiple entries', async () => {
    const source = new JSZip();
    source.file('one.bin', Buffer.alloc(4, 1));
    source.file('two.bin', Buffer.alloc(4, 2));
    const bytes = await source.generateAsync({ type: 'uint8array' });
    const zip = await loadZipWithinLimits(bytes);
    const budget = createZipReadBudget(6);

    await expect(readZipEntryWithinLimit(zip.file('one.bin')!, 10, budget)).resolves.toHaveLength(4);
    await expect(readZipEntryWithinLimit(zip.file('two.bin')!, 10, budget)).rejects.toBeInstanceOf(ZipResourceLimitError);
  });

  it('rejects traversal in JSZip unsafeOriginalName metadata', async () => {
    const source = new JSZip();
    source.file('../outside.txt', 'blocked');
    const bytes = await source.generateAsync({ type: 'uint8array' });

    await expect(loadZipWithinLimits(bytes)).rejects.toBeInstanceOf(ZipResourceLimitError);
  });

  it('limits actual streamed output even without declared entry sizes', async () => {
    const zip = new JSZip();
    zip.file('stream.bin', Buffer.alloc(100, 1));
    await expect(readZipEntryWithinLimit(zip.file('stream.bin')!, 8)).rejects.toBeInstanceOf(ZipResourceLimitError);
  });

  it('rejects highly compressed archives before extracting their contents', async () => {
    const zip = new JSZip(); zip.file('compressed.bin', Buffer.alloc(1024 * 1024));
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    await expect(loadZipWithinLimits(bytes)).rejects.toBeInstanceOf(ZipResourceLimitError);
  });

});
