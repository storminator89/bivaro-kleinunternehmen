import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTestDatabase } from './helpers/database';
const state = vi.hoisted(() => ({ client: null as ReturnType<typeof createTestDatabase>['client'] | null, file: '', actor: 'outbox-owner', send: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/upload-ownership', () => ({ findOwnedUploadedFile: async () => state.file || null }));
vi.mock('@/lib/get-user-id', () => {
  class UnauthorizedError extends Error {}
  return { requireUserId: async () => { if (!state.actor) throw new UnauthorizedError(); return state.actor; }, UnauthorizedError, unauthorizedResponse: () => new Response(null, { status: 401 }) };
});
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: state.send }) } }));
import { buildDocumentEmailDraft, sendDocumentEmail, normalizeSendEmailRequest, EmailDeliveryRecordingError, sendOutboxMail } from '@/lib/email';
import { attachmentSha256, readEmailOutbox, listEmailOutbox, classifyEmailTransportError, finishEmailAttempt, listEmailOutboxPage } from '@/lib/email-outbox';
import { GET as outboxRoute } from '@/app/api/email/outbox/route';
import { POST as retryRoute } from '@/app/api/email/outbox/[id]/retry/route';
import { POST as sendRoute } from '@/app/api/email/send/route';
import { stripEmptyProjectServiceTimesForLegacy } from './helpers/backup-schema';
import { readBackupSnapshot } from '@/lib/backup-snapshot';
import { createBackupManifest, validateBackupManifest, CURRENT_SCHEMA_VERSION, PAYMENT_ADJUSTMENT_SCHEMA_VERSION } from '@/lib/backup-manifest';
import { restoreBackupData } from '@/lib/backup-restore';
let database: ReturnType<typeof createTestDatabase>;
let directory: string;
const hash = attachmentSha256(Buffer.from('synthetic immutable original'));
beforeAll(async () => {
  database = createTestDatabase(); state.client = database.client;
  directory = await mkdtemp(path.join(tmpdir(), 'bivaro-outbox-'));
  state.file = path.join(directory, 'original.pdf'); await writeFile(state.file, 'synthetic immutable original');
  await database.client.user.createMany({ data: [
    { id: 'outbox-owner', email: 'owner@example.test', password: 'unused' },
    { id: 'outbox-other', email: 'other@example.test', password: 'unused' },
  ] });
  vi.stubEnv('SMTP_HOST', 'smtp.example.test'); vi.stubEnv('SMTP_PORT', '587');
  vi.stubEnv('EMAIL_FROM', 'sender@example.test'); vi.stubEnv('SMTP_USER', ''); vi.stubEnv('SMTP_PASSWORD', '');
});
afterAll(async () => { vi.unstubAllEnvs(); await database?.cleanup(); await rm(directory, { recursive: true, force: true }); });
const invoice = () => database.client.invoice.create({ data: {
  userId: 'outbox-owner', fileName: 'original.pdf', storedFileName: 'original.pdf', parsedData: {},
  type: 'INVOICE', status: 'DRAFT', issuanceState: 'UNISSUED', totalAmount: 25,
} });
const request = (id: number) => ({ id, documentType: 'invoice' as const, requestId: randomUUID(), attachmentSha256: hash,
  reviewedFrom: 'sender@example.test', reviewedReplyTo: null, to: 'recipient@example.test', subject: 'Synthetic invoice', text: 'Synthetic test message' });

it('persists before SMTP and coalesces double clicks and concurrent clients with distinct request keys', async () => {
  const source = await invoice(); const payload = request(source.id);
  let entered!: () => void; let release!: () => void;
  const start = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  state.send.mockImplementationOnce(async () => {
    const saved = await database.client.emailOutbox.findFirstOrThrow({ where: { invoiceId: source.id }, include: { attempts: true } });
    expect(saved.state).toBe('PROCESSING'); expect(saved.attempts).toHaveLength(1);
    expect(saved.attachmentSha256).toBe(hash); expect(saved.text).toBe(payload.text);
    entered(); await gate; return { messageId: 'accepted-once' };
  });
  const before = state.send.mock.calls.length;
  const pending = sendDocumentEmail('outbox-owner', payload); await start;
  const duplicate = await sendDocumentEmail('outbox-owner', payload);
  const otherClient = await sendDocumentEmail('outbox-owner', { ...payload, requestId: randomUUID() });
  expect(duplicate.outbox?.state).toBe('PROCESSING'); expect(otherClient.outbox?.id).toBe(duplicate.outbox?.id);
  release(); const result = await pending;
  expect(result.outbox?.state).toBe('ACCEPTED'); expect(state.send.mock.calls.length - before).toBe(1);
  expect((await sendDocumentEmail('outbox-owner', payload)).outbox?.state).toBe('ACCEPTED');
  expect(state.send.mock.calls.length - before).toBe(1);
});

it('records a definite rejection and permits one explicitly keyed manual retry, never replaying it', async () => {
  const source = await invoice(); const payload = request(source.id);
  state.send.mockRejectedValueOnce(Object.assign(new Error('sensitive provider raw text'), { code: 'EENVELOPE' }));
  const failed = await sendDocumentEmail('outbox-owner', payload);
  expect(failed.outbox).toMatchObject({ state: 'FAILED', errorCode: 'RECIPIENT_REJECTED' });
  expect(JSON.stringify(failed)).not.toContain('sensitive provider');
  const before = state.send.mock.calls.length;
  expect((await sendDocumentEmail('outbox-owner', payload)).outbox?.state).toBe('FAILED');
  expect(state.send.mock.calls.length).toBe(before);
  state.send.mockResolvedValueOnce({ messageId: 'retry-accepted' });
  const retry = { outboxId: failed.outbox!.id, requestId: randomUUID(), acknowledgeUnknown: false };
  const result = await sendDocumentEmail('outbox-owner', payload, retry);
  expect(result.outbox?.attempts.map(x => x.state)).toEqual(['FAILED', 'ACCEPTED']);
  await sendDocumentEmail('outbox-owner', payload, retry);
  expect(state.send.mock.calls.length - before).toBe(1);
});

it('allows a corrected recipient only as a newly confirmed immutable envelope after a definite rejection', async () => {
  const source = await invoice(); const payload = request(source.id);
  state.send.mockRejectedValueOnce(Object.assign(new Error('recipient invalid'), { code: 'EENVELOPE' }));
  const failed = await sendDocumentEmail('outbox-owner', payload);
  state.send.mockResolvedValueOnce({ messageId: 'corrected-recipient-accepted' });
  const corrected = await sendDocumentEmail('outbox-owner', { ...payload, requestId: randomUUID(), to: 'corrected@example.test' });
  expect(corrected.outbox?.state).toBe('ACCEPTED');
  expect(corrected.outbox?.id).not.toBe(failed.outbox?.id);
  expect((await readEmailOutbox('outbox-owner', failed.outbox!.id))?.to).toBe('recipient@example.test');
});

it('supports quote outbox sends and preserves legacy wholly unpaid reminders outside the outbox', async () => {
  const quote = await invoice();
  await database.client.invoice.update({ where: { id: quote.id }, data: { type: 'QUOTE' } });
  state.send.mockResolvedValueOnce({ messageId: 'quote-accepted' });
  const sentQuote = await sendDocumentEmail('outbox-owner', { ...request(quote.id), documentType: 'quote' });
  expect(sentQuote.outbox).toMatchObject({ state: 'ACCEPTED', documentType: 'quote' });
  const unpaid = await invoice(); const before = await database.client.emailOutbox.count();
  state.send.mockResolvedValueOnce({ messageId: 'legacy-unpaid-reminder' });
  const reminder = await sendDocumentEmail('outbox-owner', { id: unpaid.id, documentType: 'reminder', to: 'synthetic@example.test', subject: 'Existing reminder', text: 'Existing wholly unpaid reminder' });
  expect(reminder.messageId).toBe('legacy-unpaid-reminder');
  expect(await database.client.reminder.count({ where: { invoiceId: unpaid.id } })).toBe(1);
  expect(await database.client.emailOutbox.count()).toBe(before);
  expect(await database.client.income.count({ where: { invoiceId: unpaid.id } })).toBe(0);
});

it('distinguishes partial SMTP acceptance and prevents replaying the whole envelope', async () => {
  const source = await invoice(); const payload = { ...request(source.id), to: 'first@example.test, second@example.test' };
  state.send.mockResolvedValueOnce({ messageId: 'partial-recipient-acceptance', accepted: ['first@example.test'], rejected: ['second@example.test'] });
  const result = await sendDocumentEmail('outbox-owner', payload);
  expect(result.outbox).toMatchObject({ state: 'ACCEPTED', errorCode: 'PARTIAL_RECIPIENTS' });
  const before = state.send.mock.calls.length;
  await sendDocumentEmail('outbox-owner', payload);
  expect(state.send.mock.calls.length).toBe(before);
});

it('keeps timeout uncertainty across reads/reload, blocks altered mail and requires duplicate-risk confirmation', async () => {
  const source = await invoice(); const payload = request(source.id);
  state.send.mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT', command: 'DATA' }));
  const unknown = await sendDocumentEmail('outbox-owner', payload);
  expect(unknown.outbox?.state).toBe('UNKNOWN'); const before = state.send.mock.calls.length;
  expect((await listEmailOutbox('outbox-owner', source.id, 'invoice'))[0].state).toBe('UNKNOWN');
  await expect(sendDocumentEmail('outbox-owner', { ...payload, requestId: randomUUID(), text: 'changed' })).rejects.toThrow('Versandversuch');
  await expect(sendDocumentEmail('outbox-owner', payload, { outboxId: unknown.outbox!.id, requestId: randomUUID(), acknowledgeUnknown: false })).rejects.toThrow('Doppelversandrisiko');
  expect(state.send.mock.calls.length).toBe(before);
  state.send.mockResolvedValueOnce({ messageId: 'explicit-risk-retry' });
  const accepted = await sendDocumentEmail('outbox-owner', payload, { outboxId: unknown.outbox!.id, requestId: randomUUID(), acknowledgeUnknown: true });
  expect(accepted.outbox?.attempts.map(x => x.state)).toEqual(['UNKNOWN', 'ACCEPTED']);
});

it('retains an earlier UNKNOWN risk after a definitively failed retry and requires confirmation again', async () => {
  const source = await invoice(); const payload = request(source.id);
  state.send.mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
  const unknown = await sendDocumentEmail('outbox-owner', payload);
  state.send.mockRejectedValueOnce(Object.assign(new Error('no recipient'), { code: 'EENVELOPE' }));
  const failed = await sendDocumentEmail('outbox-owner', payload, { outboxId: unknown.outbox!.id, requestId: randomUUID(), acknowledgeUnknown: true });
  expect(failed.outbox?.state).toBe('FAILED');
  expect(failed.outbox?.attempts[0].uncertaintyRecordedAt).not.toBeNull();
  expect(failed.outbox?.attempts[1].duplicateRiskAcknowledged).toBe(true);
  await expect(sendDocumentEmail('outbox-owner', { ...payload, requestId: randomUUID(), text: 'edited fresh mail' })).rejects.toThrow('Versandversuch');
  await expect(sendDocumentEmail('outbox-owner', payload, { outboxId: unknown.outbox!.id, requestId: randomUUID(), acknowledgeUnknown: false })).rejects.toThrow('Doppelversandrisiko');
});

it('bounds total SMTP time and closes the transport before the durable lease can expire', async () => {
  vi.useFakeTimers();
  const close = vi.fn();
  const transport = { close, sendMail: vi.fn(() => new Promise(() => {})) } as unknown as Parameters<typeof sendOutboxMail>[0];
  try {
    const sending = expect(sendOutboxMail(transport, {})).rejects.toMatchObject({ code: 'ETIMEDOUT' });
    await vi.advanceTimersByTimeAsync(45_000); await sending;
    expect(close).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});

it('preserves a late old acceptance without overriding a newer explicit retry or clearing old risk', async () => {
  const source = await invoice(); const payload = request(source.id);
  let firstEntered!: () => void; let secondEntered!: () => void; let acceptFirst!: () => void; let rejectSecond!: () => void;
  const firstStart = new Promise<void>(resolve => { firstEntered = resolve; });
  const secondStart = new Promise<void>(resolve => { secondEntered = resolve; });
  const firstGate = new Promise<void>(resolve => { acceptFirst = resolve; });
  const secondGate = new Promise<void>(resolve => { rejectSecond = resolve; });
  state.send.mockImplementationOnce(async () => { firstEntered(); await firstGate; return { messageId: 'late-old-accepted' }; });
  const first = sendDocumentEmail('outbox-owner', payload); await firstStart;
  const saved = await database.client.emailOutbox.findFirstOrThrow({ where: { invoiceId: source.id } });
  await database.client.emailOutbox.update({ where: { id: saved.id }, data: { processingExpiresAt: new Date(Date.now() - 1) } });
  const unknown = await readEmailOutbox('outbox-owner', saved.id);
  const marker = unknown!.attempts[0].uncertaintyRecordedAt;
  // Repeated uncertainty refines the same event without replacing its marker.
  await finishEmailAttempt('outbox-owner', saved.id, unknown!.attempts[0].id, { state: 'UNKNOWN', errorCode: 'TRANSPORT_UNCERTAIN' });
  expect((await readEmailOutbox('outbox-owner', saved.id))!.attempts[0].uncertaintyRecordedAt).toEqual(marker);
  state.send.mockImplementationOnce(async () => { secondEntered(); await secondGate; throw Object.assign(new Error('rejected'), { code: 'EENVELOPE' }); });
  const second = sendDocumentEmail('outbox-owner', payload, { outboxId: saved.id, requestId: randomUUID(), acknowledgeUnknown: true }); await secondStart;
  acceptFirst(); const late = await first;
  expect(late.outbox?.state).toBe('PROCESSING');
  expect(late.outbox?.attempts.map(x => x.state)).toEqual(['ACCEPTED', 'PROCESSING']);
  expect(late.outbox?.attempts[0].uncertaintyRecordedAt).toEqual(marker);
  rejectSecond(); const last = await second;
  expect(last.outbox?.state).toBe('FAILED');
  await expect(sendDocumentEmail('outbox-owner', payload, { outboxId: saved.id, requestId: randomUUID(), acknowledgeUnknown: false })).rejects.toThrow('Doppelversandrisiko');
});

it('retries the stored sender/reply-to after settings change and rejects first-send sender drift', async () => {
  const source = await invoice(); const payload = request(source.id);
  state.send.mockRejectedValueOnce(Object.assign(new Error('rejected'), { code: 'EENVELOPE' }));
  const failed = await sendDocumentEmail('outbox-owner', payload);
  await database.client.settings.create({ data: { userId: 'outbox-owner', email: 'new-contact@example.test' } });
  vi.stubEnv('EMAIL_FROM', 'new-sender@example.test');
  try {
    state.send.mockResolvedValueOnce({ messageId: 'stored-sender-retry' });
    const retried = await sendDocumentEmail('outbox-owner', payload, { outboxId: failed.outbox!.id, requestId: randomUUID(), acknowledgeUnknown: false });
    expect(retried.outbox).toMatchObject({ state: 'ACCEPTED', from: 'sender@example.test', replyTo: null });
    expect(state.send).toHaveBeenLastCalledWith(expect.objectContaining({ from: 'sender@example.test', replyTo: undefined }));
    const fresh = await invoice();
    await expect(sendDocumentEmail('outbox-owner', request(fresh.id))).rejects.toThrow('Absender');
  } finally { vi.stubEnv('EMAIL_FROM', 'sender@example.test'); await database.client.settings.delete({ where: { userId: 'outbox-owner' } }); }
});

it('recovers an interrupted process to UNKNOWN without network access or automatic retry', async () => {
  const source = await invoice(); const payload = request(source.id);
  state.send.mockResolvedValueOnce({ messageId: 'acceptance-write-fails' });
  await database.client.$executeRawUnsafe(`CREATE TRIGGER fail_outbox_accept BEFORE UPDATE ON EmailOutboxAttempt WHEN NEW.state = 'ACCEPTED' BEGIN SELECT RAISE(ABORT, 'synthetic persistence failure'); END;`);
  try { await expect(sendDocumentEmail('outbox-owner', payload)).rejects.toBeInstanceOf(EmailDeliveryRecordingError); }
  finally { await database.client.$executeRawUnsafe('DROP TRIGGER fail_outbox_accept'); }
  const item = await database.client.emailOutbox.findFirstOrThrow({ where: { invoiceId: source.id } });
  expect(item.state).toBe('PROCESSING');
  await database.client.emailOutbox.update({ where: { id: item.id }, data: { processingExpiresAt: new Date(Date.now() - 1) } });
  const before = state.send.mock.calls.length;
  const recovered = await readEmailOutbox('outbox-owner', item.id);
  expect(recovered).toMatchObject({ state: 'UNKNOWN', errorCode: 'PROCESS_INTERRUPTED', attempts: [{ state: 'UNKNOWN' }] });
  expect((await sendDocumentEmail('outbox-owner', payload)).outbox?.state).toBe('UNKNOWN');
  expect(state.send.mock.calls.length).toBe(before);
});

it('blocks missing, changed and foreign originals before SMTP; changed request IDs cannot mutate snapshots', async () => {
  const source = await invoice(); const payload = request(source.id); const before = state.send.mock.calls.length;
  await expect(sendDocumentEmail('outbox-other', payload)).rejects.toThrow('Dokument nicht gefunden');
  await expect(sendDocumentEmail('outbox-owner', { ...payload, attachmentSha256: '0'.repeat(64) })).rejects.toThrow('Originalanhang');
  const file = state.file; state.file = '';
  try { await expect(sendDocumentEmail('outbox-owner', payload)).rejects.toThrow('Datei nicht gefunden'); }
  finally { state.file = file; }
  expect(state.send.mock.calls.length).toBe(before);
  state.send.mockResolvedValueOnce({ messageId: 'immutable' });
  const result = await sendDocumentEmail('outbox-owner', payload);
  await expect(sendDocumentEmail('outbox-owner', { ...payload, to: 'changed@example.test' })).rejects.toThrow('geändert');
  await expect(database.client.emailOutbox.update({ where: { id: result.outbox!.id }, data: { text: 'mutated' } })).rejects.toThrow();
  await expect(database.client.emailOutboxAttempt.delete({ where: { id: result.outbox!.attempts[0].id } })).rejects.toThrow();
  expect(await readEmailOutbox('outbox-other', result.outbox!.id)).toBeNull();
});

it('rolls back atomic claim when attempt persistence fails, before issuance or transport', async () => {
  const source = await invoice(); const payload = request(source.id); const before = state.send.mock.calls.length;
  await database.client.$executeRawUnsafe(`CREATE TRIGGER fail_outbox_attempt BEFORE INSERT ON EmailOutboxAttempt BEGIN SELECT RAISE(ABORT, 'synthetic rollback'); END;`);
  try { await expect(sendDocumentEmail('outbox-owner', payload)).rejects.toThrow(); }
  finally { await database.client.$executeRawUnsafe('DROP TRIGGER fail_outbox_attempt'); }
  expect((await database.client.invoice.findUniqueOrThrow({ where: { id: source.id } })).issuanceState).toBe('UNISSUED');
  expect((await database.client.emailOutbox.findFirstOrThrow({ where: { invoiceId: source.id } })).state).toBe('PREPARED');
  expect(state.send.mock.calls.length).toBe(before);
});

it('requires explicit review identity and a hash, and scopes preview storage to its owner', async () => {
  const source = await invoice(); const payload = request(source.id);
  expect(() => normalizeSendEmailRequest({ ...payload, requestId: '' })).toThrow();
  expect(() => normalizeSendEmailRequest({ ...payload, attachmentSha256: '' })).toThrow();
  const draft = await buildDocumentEmailDraft('outbox-owner', payload);
  expect(draft.attachmentSha256).toBe(hash); expect(draft.storageScope).toMatch(/^[a-f0-9]{64}$/u);
  expect(draft.storageScope).not.toContain('outbox-owner');
});

it('enforces HTTP session/ownership and retries only the stored envelope, never request-body recipient edits', async () => {
  const source = await invoice(); const payload = request(source.id);
  const http = (body: unknown) => new Request('http://localhost/api/email/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const listRequest = new Request(`http://localhost/api/email/outbox?documentType=invoice&id=${source.id}`);
  state.actor = '';
  expect((await outboxRoute(listRequest)).status).toBe(401);
  expect((await sendRoute(http(payload))).status).toBe(401);
  state.actor = 'outbox-other';
  expect((await outboxRoute(listRequest)).status).toBe(400);
  state.actor = 'outbox-owner';
  state.send.mockRejectedValueOnce(Object.assign(new Error('synthetic rejection'), { code: 'EENVELOPE' }));
  const failedResponse = await sendRoute(http(payload));
  expect(failedResponse.status).toBe(200);
  const failed = (await failedResponse.json()).outbox;
  const routeContext = { params: Promise.resolve({ id: failed.id }) };
  state.actor = 'outbox-other';
  expect((await retryRoute(http({ requestId: randomUUID() }), routeContext)).status).toBe(404);
  state.actor = 'outbox-owner';
  const before = state.send.mock.calls.length;
  state.send.mockResolvedValueOnce({ messageId: 'http-retry-accepted' });
  const retryBody = { requestId: randomUUID(), acknowledgeUnknown: false, to: 'must-not-send@example.test', text: 'must not mutate' };
  const accepted = await retryRoute(http(retryBody), routeContext);
  expect(accepted.status).toBe(200);
  expect((await accepted.json()).outbox.state).toBe('ACCEPTED');
  expect(state.send).toHaveBeenLastCalledWith(expect.objectContaining({ to: ['recipient@example.test'], text: payload.text }));
  expect((await retryRoute(http(retryBody), routeContext)).status).toBe(200);
  expect(state.send.mock.calls.length - before).toBe(1);
  const history = await outboxRoute(listRequest);
  expect(history.headers.get('cache-control')).toBe('no-store');
  expect((await history.json()).items).toHaveLength(1);
});

it('keeps known SMTP acceptance explicit if a retry acknowledgment cannot be persisted', async () => {
  const source = await invoice(); const payload = request(source.id);
  state.send.mockRejectedValueOnce(Object.assign(new Error('definite rejection'), { code: 'EENVELOPE' }));
  const failed = await sendDocumentEmail('outbox-owner', payload);
  state.send.mockResolvedValueOnce({ messageId: 'retry-accepted-write-fails' });
  await database.client.$executeRawUnsafe(`CREATE TRIGGER fail_retry_accept BEFORE UPDATE ON EmailOutboxAttempt WHEN NEW.state = 'ACCEPTED' BEGIN SELECT RAISE(ABORT, 'synthetic persistence failure'); END;`);
  try {
    const response = await retryRoute(new Request('http://localhost/api/email/outbox/retry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID(), acknowledgeUnknown: false }) }), { params: Promise.resolve({ id: failed.outbox!.id }) });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: 'DELIVERY_RECORDING_FAILED', smtpAccepted: true, retryUnsafe: true, messageId: 'retry-accepted-write-fails' });
    expect((await readEmailOutbox('outbox-owner', failed.outbox!.id))?.state).toBe('PROCESSING');
  } finally { await database.client.$executeRawUnsafe('DROP TRIGGER fail_retry_accept'); }
});

it('prioritizes an old unresolved blocker over 31 newer accepted receipts and reports bounded unknown totals', async () => {
  const source = await invoice(); const payload = request(source.id);
  state.send.mockRejectedValueOnce(Object.assign(new Error('uncertain'), { code: 'ETIMEDOUT' }));
  const first = (await sendDocumentEmail('outbox-owner', payload)).outbox!;
  const { id: _id, createdAt: _created, updatedAt: _updated, attempts: _attempts, ...envelope } = first;
  void _id; void _created; void _updated; void _attempts;
  for (let index = 0; index < 31; index++) await database.client.emailOutbox.create({ data: { ...envelope,
    requestId: randomUUID(), fingerprint: attachmentSha256(Buffer.from(randomUUID())), state: 'ACCEPTED',
    currentAttemptId: null, processingExpiresAt: null, errorCode: null, createdAt: new Date(Date.now() + 1000 + index),
  } });
  const page = await listEmailOutboxPage('outbox-owner', source.id, 'invoice');
  expect(page).toMatchObject({ total: 32, unresolvedCount: 1, hasMore: true });
  expect(page.items).toHaveLength(30); expect(page.items[0].id).toBe(first.id);
  for (let index = 0; index < 34; index++) await database.client.emailOutbox.create({ data: { ...envelope,
    requestId: randomUUID(), fingerprint: attachmentSha256(Buffer.from(randomUUID())), state: 'UNKNOWN',
    currentAttemptId: null, processingExpiresAt: null,
  } });
  const crowded = await listEmailOutboxPage('outbox-owner', source.id, 'invoice');
  expect(crowded).toMatchObject({ total: 66, unresolvedCount: 35, hasMore: true });
  expect(crowded.items).toHaveLength(30); expect(crowded.items.every(item => item.state === 'UNKNOWN')).toBe(true);
  const calls = state.send.mock.calls.length;
  await expect(sendDocumentEmail('outbox-owner', { ...payload, requestId: randomUUID(), text: 'different envelope' })).rejects.toThrow('Versandversuch');
  expect(state.send.mock.calls.length).toBe(calls);
});

it('excludes runtime from current backups and rejects imported/replayed outbox data while keeping old identity valid', async () => {
  const snapshot = await readBackupSnapshot('outbox-owner');
  expect(snapshot.data.emailOutbox).toBeUndefined(); expect(snapshot.data.emailOutboxAttempts).toBeUndefined();
  const manifest = createBackupManifest({ sourceUserId: 'outbox-owner', generatedAt: snapshot.info.endedAt, data: snapshot.data });
  expect(manifest.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  expect(manifest.modelCoverage.filter(x => x.model.startsWith('EmailOutbox')).map(x => x.mode)).toEqual(['excluded', 'excluded']);
  expect(() => validateBackupManifest(manifest, { ...snapshot.data, emailOutbox: [] })).toThrow('importiert');
  const old = { ...manifest, schemaVersion: PAYMENT_ADJUSTMENT_SCHEMA_VERSION,
    modelCoverage: manifest.modelCoverage.filter(x => !x.model.startsWith('EmailOutbox')) };
  const oldData = structuredClone(snapshot.data);
  stripEmptyProjectServiceTimesForLegacy({ data: oldData, manifest: old });
  expect(validateBackupManifest(old, oldData).schemaVersion).toBe(PAYMENT_ADJUSTMENT_SCHEMA_VERSION);
});

it('does not cancel unrelated pending target outbox during a nondestructive merge restore', async () => {
  const snapshot = await readBackupSnapshot('outbox-other');
  const manifest = createBackupManifest({ sourceUserId: 'outbox-other', generatedAt: snapshot.info.endedAt, data: snapshot.data });
  const before = await database.client.emailOutbox.findMany({ orderBy: { id: 'asc' } });
  await restoreBackupData({ userId: 'outbox-owner', overwrite: false, backup: { version: '3.0', data: snapshot.data, manifest } });
  expect(await database.client.emailOutbox.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
});

it('retains target attempt history and detaches old originals on destructive restore, with no send', async () => {
  const snapshot = await readBackupSnapshot('outbox-other');
  const manifest = createBackupManifest({ sourceUserId: 'outbox-other', generatedAt: snapshot.info.endedAt, data: snapshot.data });
  const before = state.send.mock.calls.length;
  const count = await database.client.emailOutboxAttempt.count();
  await restoreBackupData({ userId: 'outbox-owner', overwrite: true, backup: { version: '3.0', data: snapshot.data, manifest } });
  expect(await database.client.emailOutboxAttempt.count()).toBe(count);
  expect(await database.client.emailOutbox.count({ where: { userId: 'outbox-owner', invoiceId: { not: null } } })).toBe(0);
  expect(await database.client.emailOutbox.count({ where: { userId: 'outbox-owner', state: { in: ['PROCESSING', 'PREPARED', 'FAILED'] } } })).toBe(0);
  expect(state.send.mock.calls.length).toBe(before);
});

it('retains detached unknown proof across new IDs, scopes historic lookup, and distinguishes changed bytes', async () => {
  const before = await database.client.emailOutboxAttempt.count();
  const restored = await invoice(); const payload = request(restored.id);
  const historical = await listEmailOutbox('outbox-owner', restored.id, 'invoice');
  // >30 retained unknown records are intentionally prioritized over accepted history.
  expect(await database.client.emailOutbox.count({ where: { userId: 'outbox-owner', invoiceId: null, state: 'ACCEPTED', attachmentSha256: hash } })).toBeGreaterThan(0);
  expect(historical.some(x => x.invoiceId === null && (x.state === 'UNKNOWN' || x.attempts.some(a => a.uncertaintyRecordedAt)))).toBe(true);
  const calls = state.send.mock.calls.length;
  await expect(sendDocumentEmail('outbox-owner', payload)).rejects.toThrow('Versandversuch');
  await expect(listEmailOutbox('outbox-other', restored.id, 'invoice')).rejects.toThrow('Dokument nicht gefunden');
  expect(state.send.mock.calls.length).toBe(calls);
  await writeFile(state.file, 'different synthetic original bytes');
  try {
    expect(await listEmailOutbox('outbox-owner', restored.id, 'invoice')).toEqual([]);
    state.send.mockResolvedValueOnce({ messageId: 'different-original' });
    const accepted = await sendDocumentEmail('outbox-owner', { ...payload, attachmentSha256: attachmentSha256(Buffer.from('different synthetic original bytes')) });
    expect(accepted.outbox?.state).toBe('ACCEPTED');
    expect(await database.client.emailOutboxAttempt.count()).toBe(before + 1);
  } finally { await writeFile(state.file, 'synthetic immutable original'); }
});

it.each([{ code: 'ETIMEDOUT' }, { code: 'ESOCKET' }, {}, new Error('unknown')])('treats ambiguous transport failures as UNKNOWN, not safe retries: %j', error => {
  expect(classifyEmailTransportError(error).state).toBe('UNKNOWN');
});
