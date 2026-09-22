import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { withProcessingSlot, ProcessingCapacityError } from '@/lib/processing-limit';
import { extractEmbeddedEInvoiceXml, parseEInvoiceXml } from '@/lib/e-invoice-parser';
import { MAX_XML_INPUT_BYTES, RequestBodyLimitError } from '@/lib/resource-limits';

describe('document processing budgets', () => {
  it('rejects excess parallel work and releases slots after completion and failure', async () => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const first = withProcessingSlot('alice', () => held);
    await expect(withProcessingSlot('alice', async () => undefined)).rejects.toBeInstanceOf(ProcessingCapacityError);
    const second = withProcessingSlot('bob', () => held);
    await expect(withProcessingSlot('carol', async () => undefined)).rejects.toBeInstanceOf(ProcessingCapacityError);
    release();
    await Promise.all([first, second]);
    await expect(withProcessingSlot('alice', async () => { throw new Error('fixture'); })).rejects.toThrow('fixture');
    await expect(withProcessingSlot('alice', async () => 'available')).resolves.toBe('available');
  });

  it('serializes retries with the same idempotency key', async () => {
    let release!: () => void;
    let secondStarted = false;
    const held = new Promise<void>(resolve => { release = resolve; });
    const first = withProcessingSlot('alice', () => held, 'request-1');
    const second = withProcessingSlot('alice', async () => {
      secondStarted = true;
      return 'retried';
    }, 'request-1');

    await Promise.resolve();
    expect(secondStarted).toBe(false);
    release();
    await first;
    await expect(second).resolves.toBe('retried');
    expect(secondStarted).toBe(true);
  });

  it('rejects oversized XML before parsing and bounds embedded XML decompression', async () => {
    const xml = '<Invoice>' + ' '.repeat(MAX_XML_INPUT_BYTES) + '</Invoice>';
    await expect(parseEInvoiceXml(xml)).rejects.toBeInstanceOf(RequestBodyLimitError);
    const document = await PDFDocument.create();
    document.addPage();
    await document.attach(new TextEncoder().encode(xml), 'factur-x.xml', { mimeType: 'text/xml' });
    const bytes = await document.save();
    expect(bytes.byteLength).toBeLessThan(MAX_XML_INPUT_BYTES);
    expect(await extractEmbeddedEInvoiceXml(Buffer.from(bytes))).toBeNull();
  });
});
