import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { NextRequest } from 'next/server';
import type { PrismaClient } from '@prisma/client';
import type { AiProviderSettingsDto } from '@/lib/ai-provider/types';
import { EMPTY_REVIEW_DRAFT } from '@/lib/purchase-documents/review-draft';
import { createTestDatabase } from './helpers/database';

// Authentication and the Prisma connection are the only application seams. The
// saved settings, crypto, policy, HTTP transport, routes and database are real.
const state = vi.hoisted(() => ({ client: null as PrismaClient | null, userId: 'ai-journey-owner' }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => ({
  requireUserId: async () => state.userId,
  UnauthorizedError: class extends Error {},
  ForbiddenError: class extends Error {},
  unauthorizedResponse: () => new Response(null, { status: 401 }),
  forbiddenResponse: () => new Response(null, { status: 403 }),
}));

type ExtractionResponse = Awaited<ReturnType<typeof import('@/lib/purchase-documents/ai-extraction').runPurchaseAiExtraction>>;
const syntheticKey = 'synthetic-local-fixture-key-not-a-real-credential';
const rawResult = {
  supplierName: 'Synthetic journey supplier', invoiceNumber: 'JOURNEY-029', invoiceDate: '2026-10-21',
  currency: 'EUR', documentType: 'INVOICE', grossAmount: '0.29', netAmount: '0.24', taxAmount: '0.05',
  lineItems: [], lineItemsComplete: true,
};
// A fixed, one-pixel PNG: no document, provider account, renderer or fee involved.
const originalBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=', 'base64');
let database: ReturnType<typeof createTestDatabase>;
let directory: string;
let server: Server;
let baseUrl: string;
let providerMode: 'ok' | 'reject' | 'hold' = 'ok';
let heldResponse: ServerResponse | null = null;
let onProviderRequest: (() => void) | null = null;
const providerRequests: Array<{ path: string; method: string; authorization: string | undefined; body: unknown }> = [];
let settingsRoute: typeof import('@/app/api/settings/ai-provider/route');
let connectionRoute: typeof import('@/app/api/settings/ai-provider/test/route');
let extractionRoute: typeof import('@/app/api/purchase-documents/[id]/ai-extraction/route');
let applyRoute: typeof import('@/app/api/purchase-documents/[id]/ai-extraction/apply/route');
let draftRoute: typeof import('@/app/api/purchase-documents/[id]/review-draft/route');
let intakeRoute: typeof import('@/app/api/purchase-documents/route');
let storage: typeof import('@/lib/upload-path');
let originals: typeof import('@/lib/purchase-documents/original');

function request(url: string, body: unknown, method = 'POST') {
  return new NextRequest(`http://localhost${url}`, {
    method, headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}
const context = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
function complete(response: ServerResponse) {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(rawResult) } }] }));
}
async function configure() {
  const current = await (await settingsRoute.GET()).json() as AiProviderSettingsDto;
  const response = await settingsRoute.PUT(request('/api/settings/ai-provider', {
    enabled: true, autoAnalyzeNewUploads: false, baseUrl, model: 'synthetic-fixture-model',
    expectedVersion: current.version, keyAction: 'replace', apiKey: syntheticKey,
  }, 'PUT'));
  expect(response.status).toBe(200);
  return response.json() as Promise<AiProviderSettingsDto>;
}
async function source() {
  const storedFileName = await storage.writeTenantFile(state.userId, 'synthetic.png', originalBytes);
  return database.client.purchaseDocument.create({ data: {
    userId: state.userId, originalFileName: 'synthetic.png', storedFileName,
    originalSha256: originals.originalHash(originalBytes), originalByteCount: originalBytes.length,
    mediaType: 'image/png', uploadRequestId: randomUUID(), parseStatus: 'FAILED',
    parseErrorCode: 'PHOTO_MANUAL_REVIEW', revision: 1,
  } });
}
function analyze(id: number, revision: number, config: AiProviderSettingsDto, retry = false) {
  return extractionRoute.POST(request(`/api/purchase-documents/${id}/ai-extraction`, {
    expectedRevision: revision, expectedConfigVersion: config.version,
    expectedConfigRevision: config.configurationRevision, acknowledgeCost: true, retry,
  }), context(id));
}

beforeAll(async () => {
  database = createTestDatabase(); state.client = database.client;
  await database.client.user.createMany({ data: ['ai-journey-owner', 'ai-journey-other'].map(id => ({
    id, email: `${id}@synthetic.invalid`, password: 'unused-synthetic-hash',
  })) });
  server = createServer((incoming, response) => {
    const chunks: Buffer[] = [];
    let size = 0;
    incoming.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 64 * 1024) { response.writeHead(413); response.end(); incoming.destroy(); }
      else chunks.push(chunk);
    });
    incoming.on('end', () => {
      providerRequests.push({ path: incoming.url ?? '', method: incoming.method ?? '', authorization: incoming.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      if (providerMode === 'reject') { response.writeHead(503); response.end('provider-secret-echo-must-never-be-returned'); }
      else if (providerMode === 'hold') heldResponse = response;
      else complete(response);
      onProviderRequest?.(); onProviderRequest = null;
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Synthetic provider failed to bind.');
  baseUrl = `http://127.0.0.1:${address.port}/synthetic-v1`;
  // Only this fixture process authorizes this exact random loopback endpoint.
  // Production policy is unchanged: there is no test flag or bypass in app code.
  vi.stubEnv('BIVARO_AI_PRIVATE_BASE_URLS', JSON.stringify([baseUrl]));
  vi.stubEnv('NEXTAUTH_SECRET', 'synthetic-isolated-journey-secret-at-least-32-characters');
  vi.stubEnv('NEXTAUTH_URL', 'http://localhost');
  directory = await mkdtemp(path.join(tmpdir(), 'bivaro-ai-real-http-'));
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(directory);
  try {
    storage = await import('@/lib/upload-path'); originals = await import('@/lib/purchase-documents/original');
    settingsRoute = await import('@/app/api/settings/ai-provider/route');
    connectionRoute = await import('@/app/api/settings/ai-provider/test/route');
    extractionRoute = await import('@/app/api/purchase-documents/[id]/ai-extraction/route');
    applyRoute = await import('@/app/api/purchase-documents/[id]/ai-extraction/apply/route');
    draftRoute = await import('@/app/api/purchase-documents/[id]/review-draft/route');
    intakeRoute = await import('@/app/api/purchase-documents/route');
  } finally { cwd.mockRestore(); }
}, 40_000);
beforeEach(async () => {
  state.userId = 'ai-journey-owner'; providerMode = 'ok'; providerRequests.length = 0;
  await database.client.purchaseDocument.deleteMany();
});
afterEach(async () => {
  heldResponse?.destroy(); heldResponse = null; onProviderRequest = null;
  // AI routes may write source-review evidence, never financial business rows.
  for (const count of await Promise.all([
    database.client.expense.count(), database.client.income.count(), database.client.cashTransaction.count(),
    database.client.invoice.count(), database.client.paymentJournalEvent.count(),
  ])) expect(count).toBe(0);
  const audit = await database.client.auditLog.findMany();
  expect(JSON.stringify(audit)).not.toContain(syntheticKey);
  for (const event of audit) {
    const metadata = event.metadata ? JSON.parse(event.metadata) : null;
    if (metadata?.operation === 'purchase-document.ai-extraction' || metadata?.operation === 'purchase-document.apply-ai-suggestions') {
      expect(metadata).toMatchObject({ actorId: event.userId, tenantId: event.userId });
    }
  }
});
afterAll(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await database?.cleanup();
  if (directory) await rm(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('real backend optional AI receipt journey with a local synthetic provider', () => {
  it('saves masked tenant-bound encrypted settings and tests only the exact saved consented configuration', async () => {
    const config = await configure();
    expect(config).toMatchObject({ enabled: true, configured: true, hasKey: true, autoAnalyzeNewUploads: false });
    expect(providerRequests).toHaveLength(0);
    const atRest = await database.client.aiProviderSettings.findUniqueOrThrow({ where: { userId: state.userId } });
    expect(atRest.keyCiphertext).toBeTruthy(); expect(atRest.keyCiphertext).not.toBe(syntheticKey);
    expect(JSON.stringify(atRest)).not.toContain(syntheticKey);
    const { decryptAiKey } = await import('@/lib/ai-provider/crypto');
    expect(decryptAiKey(state.userId, atRest)).toBe(syntheticKey);
    expect(() => decryptAiKey('ai-journey-other', atRest)).toThrow(/erneut eingeben/);
    const visible = await settingsRoute.GET();
    expect(visible.headers.get('cache-control')).toContain('no-store');
    expect(await visible.text()).not.toMatch(/apiKey|keyCiphertext|keyIv|keyTag|synthetic-local-fixture-key/);
    state.userId = 'ai-journey-other';
    expect(await (await settingsRoute.GET()).json()).toMatchObject({ enabled: false, configured: false, hasKey: false, version: 0 });
    state.userId = 'ai-journey-owner';
    const missingConsent = await connectionRoute.POST(request('/api/settings/ai-provider/test', {
      expectedVersion: config.version, expectedConfigRevision: config.configurationRevision,
    }));
    expect(missingConsent.status).toBe(400);
    const stale = await connectionRoute.POST(request('/api/settings/ai-provider/test', {
      expectedVersion: config.version, expectedConfigRevision: randomUUID(), acknowledgeCost: true,
    }));
    expect(stale.status).toBe(409); expect(providerRequests).toHaveLength(0);
    const connected = await connectionRoute.POST(request('/api/settings/ai-provider/test', {
      expectedVersion: config.version, expectedConfigRevision: config.configurationRevision, acknowledgeCost: true,
    }));
    expect(connected.status).toBe(200); expect(await connected.json()).toEqual({ ok: true });
    expect(providerRequests).toHaveLength(1);
    expect(providerRequests[0]).toMatchObject({ method: 'POST', path: '/synthetic-v1/chat/completions', authorization: `Bearer ${syntheticKey}`,
      body: { model: 'synthetic-fixture-model', store: false, stream: false, max_tokens: 8,
        messages: [{ role: 'user', content: expect.stringContaining('synthetic connection test without receipt data') }] } });
    expect(JSON.stringify(providerRequests[0].body)).not.toContain('data:image');
  });

  it('dispatches original bytes through the real endpoint, fills only an unreviewed draft and reuses its completed result', async () => {
    const config = await configure(), document = await source();
    state.userId = 'ai-journey-other';
    expect((await analyze(document.id, 1, config)).status).toBe(404); expect(providerRequests).toHaveLength(0);
    state.userId = 'ai-journey-owner';
    const response = await analyze(document.id, 1, config);
    expect(response.status).toBe(200);
    const completed = await response.json() as ExtractionResponse;
    expect(completed.extraction).toMatchObject({ status: 'completed', draftApplied: true, configRevision: config.configurationRevision });
    expect(completed.document.reviewDraft).toMatchObject({ supplierName: rawResult.supplierName, amount: '0.29', paymentDate: '', note: '' });
    expect(completed.document.aiDraftProvenance?.provenance).toBe('AI_UNREVIEWED');
    expect(providerRequests).toHaveLength(1);
    expect(providerRequests[0]).toMatchObject({ path: '/synthetic-v1/chat/completions', authorization: `Bearer ${syntheticKey}`,
      body: { model: 'synthetic-fixture-model', store: false, stream: false, messages: [
        { role: 'system', content: expect.any(String) },
        { role: 'user', content: expect.arrayContaining([{ type: 'image_url', image_url: { detail: 'high', url: `data:image/png;base64,${originalBytes.toString('base64')}` } }]) },
      ] } });
    expect((await analyze(document.id, completed.document.revision, config)).status).toBe(200);
    expect(providerRequests).toHaveLength(1);
    const persisted = await database.client.purchaseDocument.findUniqueOrThrow({ where: { id: document.id } });
    expect(persisted.originalSha256).toBe(document.originalSha256);
    expect(await originals.readPurchaseOriginal(persisted)).toEqual(originalBytes);
    expect(persisted.expenseId).toBeNull(); expect(persisted.reviewStatus).toBe('REVIEW');
  });

  it('preserves a concurrent manual save, then applies only empty fields without another provider call', async () => {
    const config = await configure(), document = await source();
    providerMode = 'hold';
    const arrived = new Promise<void>(resolve => { onProviderRequest = resolve; });
    const pending = analyze(document.id, 1, config);
    await arrived;
    const saved = await draftRoute.POST(request(`/api/purchase-documents/${document.id}/review-draft`, {
      expectedRevision: 1, draft: { ...EMPTY_REVIEW_DRAFT, supplierName: 'Manually confirmed supplier', amount: '1.23', note: 'Keep my note', paymentDate: '2026-10-20' },
    }), context(document.id));
    expect(saved.status).toBe(200);
    expect(heldResponse).not.toBeNull(); complete(heldResponse!); heldResponse = null;
    const completed = await (await pending).json() as ExtractionResponse;
    expect(completed.extraction).toMatchObject({ status: 'completed', draftApplied: false });
    expect(completed.document.reviewDraft).toMatchObject({ supplierName: 'Manually confirmed supplier', amount: '1.23', note: 'Keep my note', paymentDate: '2026-10-20', invoiceNumber: '' });
    const appliedResponse = await applyRoute.POST(request(`/api/purchase-documents/${document.id}/ai-extraction/apply`, {
      expectedRevision: completed.document.revision, jobId: completed.extraction!.id,
    }), context(document.id));
    expect(appliedResponse.status).toBe(200);
    const applied = await appliedResponse.json() as ExtractionResponse;
    expect(applied.document.reviewDraft).toMatchObject({ supplierName: 'Manually confirmed supplier', amount: '1.23', note: 'Keep my note', paymentDate: '2026-10-20', invoiceNumber: rawResult.invoiceNumber, invoiceDate: rawResult.invoiceDate });
    expect(providerRequests).toHaveLength(1);
    const auditRows = await database.client.auditLog.findMany({ where: { entityType: 'PurchaseDocument', entityId: String(document.id) } });
    const aiMetadata = auditRows.map(event => event.metadata ? JSON.parse(event.metadata) : null).filter(metadata => metadata?.operation === 'purchase-document.ai-extraction' || metadata?.operation === 'purchase-document.apply-ai-suggestions');
    expect(aiMetadata).toHaveLength(2);
    expect(aiMetadata).toEqual(expect.arrayContaining([
      expect.objectContaining({ actorId: state.userId, tenantId: state.userId, operation: 'purchase-document.ai-extraction' }),
      expect.objectContaining({ actorId: state.userId, tenantId: state.userId, operation: 'purchase-document.apply-ai-suggestions' }),
    ]));
  });

  it('uses separate automatic opt-in only for new uploads, never replay or exact duplicates', async () => {
    const config = await configure();
    const upload = (bytes: Buffer, uploadRequestId: string) => {
      const form = new FormData();
      form.set('file', new File([new Uint8Array(bytes)], 'synthetic-upload.png', { type: 'image/png' }));
      form.set('uploadRequestId', uploadRequestId);
      return intakeRoute.POST(new NextRequest('http://localhost/api/purchase-documents', {
        method: 'POST', headers: { origin: 'http://localhost' }, body: form,
      }));
    };
    const bytes = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#fff' } }).png().toBuffer();
    const requestId = randomUUID();
    expect((await upload(bytes, requestId)).status).toBe(201);
    expect(providerRequests).toHaveLength(0);
    const optedIn = await settingsRoute.PUT(request('/api/settings/ai-provider', {
      enabled: true, autoAnalyzeNewUploads: true, baseUrl, model: config.model,
      expectedVersion: config.version, keyAction: 'keep',
    }, 'PUT'));
    expect(optedIn.status).toBe(200); expect(providerRequests).toHaveLength(0);
    expect((await upload(bytes, requestId)).status).toBe(200);
    expect((await upload(bytes, randomUUID())).status).toBe(409);
    expect(providerRequests).toHaveLength(0);
    const newBytes = await sharp({ create: { width: 21, height: 20, channels: 3, background: '#fff' } }).png().toBuffer();
    const newRequestId = randomUUID();
    const captured = await upload(newBytes, newRequestId);
    expect(captured.status).toBe(201);
    expect(await captured.json()).toMatchObject({ replayed: false, document: {
      parseStatus: 'FAILED', parseErrorCode: 'PHOTO_MANUAL_REVIEW',
      reviewDraft: { amount: '0.29' }, aiDraftProvenance: { provenance: 'AI_UNREVIEWED' },
    } });
    expect(providerRequests).toHaveLength(1);
    expect((await upload(newBytes, newRequestId)).status).toBe(200);
    expect((await upload(newBytes, randomUUID())).status).toBe(409);
    expect(providerRequests).toHaveLength(1);
  });

  it('makes a provider refusal durably unknown and never automatically pays for a retry', async () => {
    const config = await configure(), document = await source();
    providerMode = 'reject';
    const response = await analyze(document.id, 1, config);
    expect(response.status).toBe(200);
    const failed = await response.json() as ExtractionResponse;
    expect(failed.extraction).toMatchObject({ status: 'unknown', errorCode: 'PROVIDER_REJECTED', result: null, draftApplied: false });
    expect(failed.document.reviewDraft).toBeNull();
    expect(JSON.stringify(failed)).not.toContain('provider-secret-echo');
    expect(providerRequests).toHaveLength(1);
    providerMode = 'ok';
    const polled = await extractionRoute.GET(new NextRequest(`http://localhost/api/purchase-documents/${document.id}/ai-extraction`), context(document.id));
    expect(await polled.json()).toMatchObject({ extraction: { id: failed.extraction!.id, status: 'unknown' } });
    const repeated = await (await analyze(document.id, 1, config)).json() as ExtractionResponse;
    expect(repeated.extraction?.id).toBe(failed.extraction!.id); expect(repeated.extraction?.status).toBe('unknown');
    expect(providerRequests).toHaveLength(1);
    const retried = await (await analyze(document.id, 1, config, true)).json() as ExtractionResponse;
    expect(retried.extraction).toMatchObject({ status: 'completed', draftApplied: true });
    expect(retried.extraction!.id).not.toBe(failed.extraction!.id); expect(providerRequests).toHaveLength(2);
  });
});
