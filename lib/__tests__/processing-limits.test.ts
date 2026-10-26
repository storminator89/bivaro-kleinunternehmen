import { describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { withProcessingSlot, ProcessingCapacityError } from '@/lib/processing-limit';
import { extractEmbeddedEInvoiceXml, parseEInvoiceXml } from '@/lib/e-invoice-parser';
import { MAX_XML_INPUT_BYTES, RequestBodyLimitError } from '@/lib/resource-limits';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
}

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

  it('admits one waiting retry per owner and permits a new retry after slot handoff', async () => {
    const firstWork = deferred(), retryWork = deferred(), retryStarted = deferred();
    const neverStarted = vi.fn(async () => 'unexpected');
    const first = withProcessingSlot('bounded-owner', () => firstWork.promise, 'request');
    const retry = withProcessingSlot('bounded-owner', () => {
      retryStarted.resolve();
      return retryWork.promise;
    }, 'request');
    try {
      for (let index = 0; index < 3; index++) {
        await expect(withProcessingSlot('bounded-owner', neverStarted, 'request')).rejects.toBeInstanceOf(ProcessingCapacityError);
      }
      await expect(withProcessingSlot('bounded-owner', neverStarted, 'different-request')).rejects.toBeInstanceOf(ProcessingCapacityError);
      expect(neverStarted).not.toHaveBeenCalled();
      firstWork.resolve();
      await first;
      await retryStarted.promise;
      const next = withProcessingSlot('bounded-owner', async () => 'next result', 'request');
      retryWork.resolve();
      await retry;
      await expect(next).resolves.toBe('next result');
    } finally {
      firstWork.resolve();
      retryWork.resolve();
      await Promise.allSettled([first, retry]);
    }
  });

  it('keeps independent retry outcomes and releases budgets after predecessor and retry failures', async () => {
    const work = deferred();
    const firstError = new Error('first failure'), retryError = new Error('retry failure');
    const first = withProcessingSlot('failed-owner', async () => { await work.promise; throw firstError; }, 'request');
    const retry = withProcessingSlot('failed-owner', async () => { throw retryError; }, 'request');
    const firstOutcome = expect(first).rejects.toBe(firstError);
    const retryOutcome = expect(retry).rejects.toBe(retryError);
    work.resolve();
    await Promise.all([firstOutcome, retryOutcome]);
    await expect(withProcessingSlot('failed-owner', async () => 'available', 'request')).resolves.toBe('available');
  });

  it('enforces the global pending ceiling during an owner handoff and releases a rejected waiter', async () => {
    const aliceWork = deferred(), bobWork = deferred(), carolWork = deferred(), raced = deferred();
    const aliceRetryWork = vi.fn(async () => 'alice retry');
    const carolRetryWork = vi.fn(async () => 'carol retry');
    let carol!: Promise<void>;
    let carolRejected!: Promise<unknown>;
    // Register before Alice starts awaiting the same work. On completion this
    // schedules Carol after Alice releases her active slot, but before Alice's
    // waiting retry resumes. No sleeps, timing thresholds or load are involved.
    const scheduling = aliceWork.promise.then(() => {
      queueMicrotask(() => {
        carol = withProcessingSlot('pending-carol', () => carolWork.promise, 'carol-key');
        carolRejected = withProcessingSlot('pending-carol', carolRetryWork, 'carol-key').catch(error => error);
        raced.resolve();
      });
    });
    const alice = withProcessingSlot('pending-alice', () => aliceWork.promise, 'alice-key');
    const bob = withProcessingSlot('pending-bob', () => bobWork.promise, 'bob-key');
    const aliceRetry = withProcessingSlot('pending-alice', aliceRetryWork, 'alice-key');
    const aliceRejected = expect(aliceRetry).rejects.toBeInstanceOf(ProcessingCapacityError);
    const bobRetry = withProcessingSlot('pending-bob', async () => 'bob retry', 'bob-key');
    try {
      aliceWork.resolve();
      await raced.promise;
      expect(await carolRejected).toBeInstanceOf(ProcessingCapacityError);
      await aliceRejected;
      expect(aliceRetryWork).not.toHaveBeenCalled();
      expect(carolRetryWork).not.toHaveBeenCalled();
      // Alice's failed handoff must release the global pending budget, and
      // Carol's rejected admission must not reserve a per-owner waiter token.
      const carolRetry = withProcessingSlot('pending-carol', carolRetryWork, 'carol-key');
      bobWork.resolve();
      carolWork.resolve();
      await expect(bobRetry).resolves.toBe('bob retry');
      await expect(carolRetry).resolves.toBe('carol retry');
    } finally {
      aliceWork.resolve();
      bobWork.resolve();
      carolWork.resolve();
      await scheduling;
      await Promise.allSettled([alice, bob, carol, aliceRetry, bobRetry, carolRejected]);
    }
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
