import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PDFDocument } from 'pdf-lib';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTestDatabase } from './helpers/database';

const state = vi.hoisted(() => ({ client: null as unknown, userId: 'upload-owner' }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => ({ requireUserId: async () => state.userId, UnauthorizedError: class extends Error {}, unauthorizedResponse: () => new Response(null, { status: 401 }) }));

let database: ReturnType<typeof createTestDatabase>;
let storageDirectory: string;
let upload: typeof import('@/app/api/invoices/upload/route');

const sourceXml = (invoiceNumber: string) => `<Invoice><ID>${invoiceNumber}</ID><IssueDate>2026-09-18</IssueDate><DocumentCurrencyCode>EUR</DocumentCurrencyCode><LegalMonetaryTotal><TaxInclusiveAmount currencyID="EUR">25</TaxInclusiveAmount><PayableAmount currencyID="EUR">25</PayableAmount></LegalMonetaryTotal></Invoice>`;

function request(source: string | ArrayBuffer, generatedRequestId: string | null, kind: 'xml' | 'pdf' = 'xml', numberingSelection?: unknown) {
  const form = new FormData();
  form.append('file', new File([source], `invoice.${kind}`, { type: kind === 'pdf' ? 'application/pdf' : 'application/xml' }));
  if (generatedRequestId) form.append('generatedRequestId', generatedRequestId);
  if (numberingSelection !== undefined) form.append('numberingSelection', JSON.stringify(numberingSelection));
  return new NextRequest('http://localhost/api/invoices/upload', { method: 'POST', body: form });
}

beforeAll(async () => {
  database = createTestDatabase();
  state.client = database.client;
  await database.client.user.create({ data: { id: state.userId, email: 'upload-owner@test.invalid', password: 'unused' } });
  storageDirectory = await mkdtemp(path.join(tmpdir(), 'bivaro-upload-idempotency-'));
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(storageDirectory);
  try {
    upload = await import('@/app/api/invoices/upload/route');
  } finally {
    cwd.mockRestore();
  }
}, 40_000);

afterAll(async () => {
  await database?.cleanup();
  if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
});

describe('invoice upload idempotency', () => {
  it('returns the committed invoice for an identical retry and rejects a changed retry', async () => {
    const requestId = '8d9a54b4-5cf7-4ad4-ae4c-eec8e3cb5d4f';
    const first = await upload.POST(request(sourceXml('IDEMP-1'), requestId));
    expect(first.status).toBe(200);
    const firstBody = await first.json() as { id: number };
    expect(await database.client.invoice.count({ where: { userId: state.userId } })).toBe(1);

    const retry = await upload.POST(request(sourceXml('IDEMP-1'), requestId));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ id: firstBody.id, idempotent: true });
    expect(await database.client.invoice.count({ where: { userId: state.userId } })).toBe(1);

    const changed = await upload.POST(request(sourceXml('IDEMP-2'), requestId));
    expect(changed.status).toBe(409);
    expect(await database.client.invoice.count({ where: { userId: state.userId } })).toBe(1);
  });

  it('serializes simultaneous retries to one invoice', async () => {
    const requestId = '0b6a5b69-45ca-42a6-9d6d-a90391cd2a82';
    const responses = await Promise.all([
      upload.POST(request(sourceXml('IDEMP-RACE'), requestId)),
      upload.POST(request(sourceXml('IDEMP-RACE'), requestId)),
    ]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(new Set((await Promise.all(responses.map(response => response.json()))).map(body => body.id)).size).toBe(1);
    expect(await database.client.invoice.count({ where: { userId: state.userId, invoiceNumber: 'IDEMP-RACE' } })).toBe(1);
  });

  it.each(['identical', 'changed', 'pdf', 'configured'] as const)('handles a retry (%s) whose marker miss precedes the winner commit and number check', async retryKind => {
    const requestId = {
      identical: 'f10d5cb3-b543-445f-9738-81e24904822a',
      changed: '26f590df-b6d4-429f-bfc8-26e5cf13200c',
      pdf: '83678f66-369e-45c8-9991-26f3c8303799',
      configured: '5e062162-34d8-4a44-8d19-a81b21352378',
    }[retryKind];
    const previousUser = state.userId;
    let invoiceNumber = `IDEMP-COMMITTED-RACE-${retryKind}`;
    let numberingSelection: unknown;
    if (retryKind === 'configured') {
      state.userId = 'upload-numbering-owner';
      await database.client.user.create({ data: { id: state.userId, email: 'upload-numbering-owner@test.invalid', password: 'fixture-only' } });
      await database.client.documentNumberingPolicy.create({ data: { userId: state.userId, type: 'INVOICE', revision: 1, formatVersion: 1, prefix: 'RACE-', includeYear: true, sequenceWidth: 2, startSequence: 100, effectiveYear: 2026 } });
      invoiceNumber = 'RACE-2026-100';
      numberingSelection = { version: 1, type: 'INVOICE', revision: 1, year: 2026, number: invoiceNumber, automatic: true };
    }
    const xml = sourceXml(invoiceNumber);
    let originalBytes: string | ArrayBuffer = `\uFEFF${xml}\n`;
    if (retryKind === 'pdf') {
      // A pure pdf-lib fixture: no native renderer or user document is used.
      const document = await PDFDocument.create();
      document.addPage();
      await document.attach(Buffer.from(xml), 'factur-x.xml', { mimeType: 'application/xml' });
      originalBytes = Uint8Array.from(await document.save()).buffer;
    }
    const expectedFileBytes = typeof originalBytes === 'string' ? Buffer.from(originalBytes) : Buffer.from(originalBytes);
    const retryBytes = retryKind === 'pdf' ? originalBytes : retryKind === 'changed' ? xml.replaceAll('>25<', '>26<') : xml;
    const fileKind = retryKind === 'pdf' ? 'pdf' : 'xml';
    const filesBefore = await readdir(path.join(storageDirectory, 'data', 'uploads', state.userId)).catch(() => [] as string[]);
    const auditBefore = await database.client.auditLog.count({ where: { userId: state.userId } });
    const firstRead = Promise.withResolvers<void>();
    const retryRead = Promise.withResolvers<void>();
    const winnerCommitted = Promise.withResolvers<void>();
    const queryRaw = database.client.$queryRaw.bind(database.client);
    const markerResults: unknown[] = [];
    let reads = 0;
    // Only the client preflight reads are paused; transactional reads still use
    // the real fixture database. Both requests see no marker, then the retry
    // resumes only after the first request has committed its invoice and file.
    // The route only awaits these reads; retain that narrower mock contract
    // rather than pretending the barrier returns Prisma's lazy query wrapper.
    const preflightClient: { $queryRaw: (...args: Parameters<typeof queryRaw>) => Promise<unknown> } = database.client;
    const markerLookup = vi.spyOn(preflightClient, '$queryRaw').mockImplementation(async (...args) => {
      const matches = await queryRaw(...args);
      markerResults.push(matches);
      const read = ++reads;
      if (read === 1) {
        firstRead.resolve();
        await retryRead.promise;
      } else if (read === 2) {
        // Prisma's transaction proxy shares methods with its parent client.
        // Restore before releasing the winner, leaving transaction reads real.
        markerLookup.mockRestore();
        retryRead.resolve();
        await winnerCommitted.promise;
      }
      return matches;
    });
    try {
      const first = upload.POST(request(originalBytes, requestId, fileKind, numberingSelection));
      await firstRead.promise;
      const retry = upload.POST(request(retryBytes, requestId, fileKind, numberingSelection));
      const winner = await first;
      if (retryKind === 'configured') await database.client.documentNumberingPolicy.create({ data: { userId: state.userId, type: 'INVOICE', revision: 2, formatVersion: 1, prefix: 'NEW-', includeYear: true, sequenceWidth: 2, startSequence: 101, effectiveYear: 2026 } });
      winnerCommitted.resolve();
      const responses = [winner, await retry];
      const bodies = await Promise.all(responses.map(response => response.json()));
      expect(markerResults).toEqual([[], []]);
      if (retryKind !== 'changed') {
        expect(responses.map(response => response.status), JSON.stringify(bodies.map(body => body.error ?? body.id))).toEqual([200, 200]);
        expect(bodies[1]).toMatchObject({ id: bodies[0].id, storedFileName: bodies[0].storedFileName, idempotent: true });
      } else {
        expect(responses.map(response => response.status)).toEqual([200, 409]);
        expect(bodies[1]).toEqual({ error: 'Diese Upload-Anfrage wurde bereits mit anderen Rechnungsdaten verarbeitet.' });
      }
      const invoices = await database.client.invoice.findMany({ where: { userId: state.userId, invoiceNumber } });
      expect(invoices).toHaveLength(1);
      expect(invoices[0]).toMatchObject({ id: bodies[0].id, storedFileName: bodies[0].storedFileName, totalAmount: 25 });
      const tenantDirectory = path.join(storageDirectory, 'data', 'uploads', state.userId);
      expect(await readFile(path.join(tenantDirectory, bodies[0].storedFileName))).toEqual(expectedFileBytes);
      expect((await readdir(tenantDirectory)).filter(file => !filesBefore.includes(file))).toEqual([bodies[0].storedFileName]);
      expect(await database.client.auditLog.count({ where: { userId: state.userId } })).toBe(auditBefore + 1);
      expect(await database.client.income.count({ where: { userId: state.userId } })).toBe(0);
      expect(await database.client.paymentJournalEvent.count({ where: { userId: state.userId } })).toBe(0);
      if (retryKind === 'configured') expect((await database.client.invoiceNumberCounter.findUniqueOrThrow({ where: { userId_type_year: { userId: state.userId, type: 'INVOICE', year: 2026 } } })).value).toBe(100);
    } finally {
      retryRead.resolve();
      winnerCommitted.resolve();
      markerLookup.mockRestore();
      state.userId = previousUser;
    }
  });

  it.each(['different request', 'no request'] as const)('rejects a duplicate invoice number with %s without changing the original', async kind => {
    const xml = sourceXml(`IDEMP-DUPLICATE-${kind}`);
    const first = await upload.POST(request(xml, kind === 'different request' ? '34a2c503-1d54-4e06-91aa-e62a0d6559be' : 'a2b4bdef-b66f-4019-80c4-7fe6da832c95'));
    expect(first.status).toBe(200);
    const winner = await first.json();
    const before = await database.client.invoice.findUniqueOrThrow({ where: { id: winner.id } });
    const tenantDirectory = path.join(storageDirectory, 'data', 'uploads', state.userId);
    const filesBefore = await readdir(tenantDirectory);
    const auditBefore = await database.client.auditLog.count();
    const duplicate = await upload.POST(request(xml.replaceAll('>25<', '>26<'), kind === 'no request' ? null : 'a656719b-a170-4e4d-b9d9-80b9381fbc25'));
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: `Eine Rechnung mit der Nummer IDEMP-DUPLICATE-${kind} existiert bereits.` });
    expect(await database.client.invoice.findUniqueOrThrow({ where: { id: winner.id } })).toEqual(before);
    expect(await readdir(tenantDirectory)).toEqual(filesBefore);
    expect(await database.client.auditLog.count()).toBe(auditBefore);
    expect(await readFile(path.join(tenantDirectory, winner.storedFileName), 'utf8')).toBe(xml);
  });

  it('keeps P2002 recovery and retains the original file, cleaning only the retry file', async () => {
    const requestId = '5b2abe40-a31d-48e5-b09f-d67ce36f029f';
    const xml = sourceXml('IDEMP-P2002');
    const first = await upload.POST(request(xml, requestId));
    expect(first.status).toBe(200);
    const winner = await first.json();
    const tenantDirectory = path.join(storageDirectory, 'data', 'uploads', state.userId);
    const filesBefore = await readdir(tenantDirectory);
    const markerLookup = vi.spyOn(database.client, '$queryRaw').mockResolvedValueOnce([]);
    const transaction = vi.spyOn(database.client, '$transaction').mockRejectedValueOnce(Object.assign(new Error('Synthetic unique collision'), { code: 'P2002' }));
    try {
      const retry = await upload.POST(request(xml, requestId));
      expect(retry.status).toBe(200);
      expect(await retry.json()).toMatchObject({ id: winner.id, storedFileName: winner.storedFileName, idempotent: true });
      expect(transaction).toHaveBeenCalledOnce();
      expect(await readdir(tenantDirectory)).toEqual(filesBefore);
      expect(await readFile(path.join(tenantDirectory, winner.storedFileName), 'utf8')).toBe(xml);
    } finally {
      markerLookup.mockRestore();
      transaction.mockRestore();
    }
  });

  it('does not replay a matching request marker or number from another tenant', async () => {
    const requestId = '6090cfe4-6152-46f2-b152-9753a07001c3';
    const xml = sourceXml('IDEMP-TENANTS');
    const first = await upload.POST(request(xml, requestId));
    expect(first.status).toBe(200);
    const ownerInvoice = await first.json();
    const owner = state.userId;
    await database.client.user.create({ data: { id: 'upload-other', email: 'upload-other@test.invalid', password: 'unused' } });
    try {
      state.userId = 'upload-other';
      const other = await upload.POST(request(xml, requestId));
      expect(other.status).toBe(200);
      const otherInvoice = await other.json();
      expect(otherInvoice).toMatchObject({ userId: 'upload-other', invoiceNumber: 'IDEMP-TENANTS' });
      expect(otherInvoice.id).not.toBe(ownerInvoice.id);
      expect(otherInvoice.idempotent).toBeUndefined();
      expect(await database.client.invoice.count({ where: { invoiceNumber: 'IDEMP-TENANTS' } })).toBe(2);
      expect(await readFile(path.join(storageDirectory, 'data', 'uploads', owner, ownerInvoice.storedFileName), 'utf8')).toBe(xml);
      expect(await readFile(path.join(storageDirectory, 'data', 'uploads', 'upload-other', otherInvoice.storedFileName), 'utf8')).toBe(xml);
    } finally {
      state.userId = owner;
    }
  });

});
