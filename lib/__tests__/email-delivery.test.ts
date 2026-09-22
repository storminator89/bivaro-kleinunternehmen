import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTestDatabase } from './helpers/database';

const state = vi.hoisted(() => ({ client: null as ReturnType<typeof createTestDatabase>['client'] | null, file: '', send: vi.fn(), transport: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/upload-ownership', () => ({ findOwnedUploadedFile: async () => state.file }));
vi.mock('nodemailer', () => ({ default: { createTransport: (options: unknown) => { state.transport(options); return { sendMail: state.send }; } } }));
vi.mock('@/lib/get-user-id', () => ({
  requireUserId: async () => 'mail-owner', UnauthorizedError: class extends Error {},
  unauthorizedResponse: () => new Response(null, { status: 401 }),
}));
import { buildDocumentEmailDraft, sendDocumentEmail } from '@/lib/email';
import { deleteSmtpSettings, saveSmtpSettings } from '@/lib/smtp-settings';
import { recordDocumentDelivery } from '@/lib/email-delivery';
import { updateInvoiceStatus } from '@/lib/invoice-payments';
import { POST as sendRoute } from '@/app/api/email/send/route';

let database: ReturnType<typeof createTestDatabase>;
let directory: string;
beforeAll(async () => {
  database = createTestDatabase();
  state.client = database.client;
  directory = await mkdtemp(path.join(tmpdir(), 'bivaro-mail-'));
  state.file = path.join(directory, 'fixture.pdf');
  await writeFile(state.file, 'synthetic attachment');
  await database.client.user.createMany({ data: [
    { id: 'mail-owner', email: 'mail@test.invalid', password: 'unused' },
    { id: 'other-owner', email: 'other@test.invalid', password: 'unused' },
  ] });
  vi.stubEnv('SMTP_HOST', 'smtp.invalid');
  vi.stubEnv('EMAIL_FROM', 'sender@test.invalid');
  vi.stubEnv('SMTP_USER', '');
  vi.stubEnv('SMTP_PASSWORD', '');
}, 40_000);
afterAll(async () => { vi.unstubAllEnvs(); await database?.cleanup(); if (directory) await rm(directory, { recursive: true, force: true }); });

const invoice = () => database.client.invoice.create({ data: {
  userId: 'mail-owner', fileName: 'invoice.pdf', storedFileName: 'invoice.pdf', parsedData: {},
  type: 'INVOICE', status: 'DRAFT', issuanceState: 'UNISSUED', totalAmount: 25,
} });
const acknowledgement = (id: number, messageId: string) => ({
  userId: 'mail-owner', invoiceId: id, documentType: 'invoice' as const, expectedStatus: 'DRAFT', messageId,
});

it('keeps customer context out of outgoing mail and respects its visibility and owner', async () => {
  const note = 'INTERNAL_ONLY: Bestellnummer vor Versand prüfen';
  const customer = await database.client.customer.create({ data: {
    userId: 'mail-owner', name: 'Context fixture', email: 'context@example.test',
    internalNote: note, noteVisibility: 'BOTH',
  } });
  const source = await invoice();
  await database.client.invoice.update({ where: { id: source.id }, data: { customerId: customer.id } });
  const request = { id: source.id, documentType: 'invoice' as const };
  const draft = await buildDocumentEmailDraft('mail-owner', request);
  expect(draft.internalCustomerNote).toBe(note);
  expect(draft.text).not.toContain(note);
  expect(draft.subject).not.toContain(note);
  state.send.mockResolvedValueOnce({ messageId: 'internal-context-test' });
  await sendDocumentEmail('mail-owner', { ...request, to: draft.to, subject: draft.subject, text: draft.text });
  expect(JSON.stringify(state.send.mock.calls.at(-1))).not.toContain(note);
  await database.client.customer.update({ where: { id: customer.id }, data: { noteVisibility: 'EDITOR' } });
  expect((await buildDocumentEmailDraft('mail-owner', request)).internalCustomerNote).toBeNull();
  // Even malformed legacy relations must not disclose another tenant's note.
  await database.client.customer.update({ where: { id: customer.id }, data: { userId: 'other-owner', noteVisibility: 'BOTH' } });
  const foreignDraft = await buildDocumentEmailDraft('mail-owner', request);
  expect(foreignDraft.internalCustomerNote).toBeNull();
  expect(foreignDraft.to).toBe('');
});

it('uses saved SMTP settings for the preview and transport with required STARTTLS', async () => {
  vi.stubEnv('NEXTAUTH_SECRET', 'synthetic-key-for-smtp-integration');
  await saveSmtpSettings({ host: 'configured.example.test', port: 587, secure: false,
    from: 'Bivaro <configured@example.test>', user: 'configured-user', password: 'synthetic-password' });
  try {
    const source = await invoice();
    const draft = await buildDocumentEmailDraft('mail-owner', { id: source.id, documentType: 'invoice' });
    expect(draft).toMatchObject({ from: 'Bivaro <configured@example.test>', emailConfigured: true });
    state.send.mockResolvedValueOnce({ messageId: 'database-configuration' });
    await sendDocumentEmail('mail-owner', { id: source.id, documentType: 'invoice',
      to: 'recipient@test.invalid', subject: 'Test', text: 'Synthetic test' });
    expect(state.transport).toHaveBeenLastCalledWith(expect.objectContaining({
      host: 'configured.example.test', port: 587, secure: false, requireTLS: true,
      auth: { user: 'configured-user', pass: 'synthetic-password' },
    }));
    expect(state.send).toHaveBeenLastCalledWith(expect.objectContaining({ from: 'Bivaro <configured@example.test>' }));
  } finally {
    await deleteSmtpSettings();
  }
});

it.each(['PAID', 'CANCELLED'])('keeps %s when it changes while SMTP is pending and records the conflict', async status => {
  const source = await invoice();
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  state.send.mockImplementationOnce(async () => { entered(); await gate; return { messageId: `race-${status}` }; });
  const sending = sendDocumentEmail('mail-owner', { id: source.id, documentType: 'invoice', to: 'recipient@test.invalid', subject: 'Test', text: 'Synthetic test' });
  await started;
  try {
    if (status === 'PAID') await updateInvoiceStatus('mail-owner', source.id, 'PAID', '2026-09-20');
    else await database.client.invoice.update({ where: { id: source.id }, data: { status } });
  } finally { release(); }
  await sending;
  const saved = await database.client.invoice.findUniqueOrThrow({ where: { id: source.id }, include: { income: true } });
  expect(saved.status).toBe(status);
  if (status === 'PAID') expect(saved.income?.amount).toBe(25);
  const event = await database.client.auditLog.findFirstOrThrow({ where: { entityId: String(source.id), action: 'EMAIL_SENT' } });
  expect(JSON.parse(event.metadata!)).toMatchObject({ statusConflict: true, observedStatus: status, resultingStatus: status });
});

it('records normal delivery and deduplicates concurrent and serial acknowledgements', async () => {
  const source = await invoice();
  state.send.mockResolvedValueOnce({ messageId: 'normal-delivery' });
  await sendDocumentEmail('mail-owner', { id: source.id, documentType: 'invoice', to: 'recipient@test.invalid', subject: 'Test', text: 'Synthetic test' });
  await Promise.all(Array.from({ length: 4 }, () => recordDocumentDelivery(acknowledgement(source.id, 'normal-delivery'))));
  await recordDocumentDelivery(acknowledgement(source.id, 'normal-delivery'));
  expect((await database.client.invoice.findUniqueOrThrow({ where: { id: source.id } })).status).toBe('SENT');
  expect(await database.client.auditLog.count({ where: { entityId: String(source.id), action: 'EMAIL_SENT' } })).toBe(1);
});

it('rolls back the status if the completion audit fails, then permits a retry', async () => {
  const source = await invoice();
  await database.client.invoice.update({ where: { id: source.id }, data: { issuanceState: 'ISSUED' } });
  await database.client.$executeRawUnsafe(`CREATE TRIGGER fail_delivery BEFORE INSERT ON AuditLog WHEN NEW.action = 'EMAIL_SENT' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;`);
  try { await expect(recordDocumentDelivery(acknowledgement(source.id, 'retry'))).rejects.toThrow(); }
  finally { await database.client.$executeRawUnsafe('DROP TRIGGER fail_delivery'); }
  expect((await database.client.invoice.findUniqueOrThrow({ where: { id: source.id } })).status).toBe('DRAFT');
  expect(await database.client.auditLog.count({ where: { entityId: String(source.id) } })).toBe(0);
  await expect(recordDocumentDelivery(acknowledgement(source.id, 'retry'))).resolves.toEqual({ recorded: true });
});

it('rejects a foreign owner without altering or acknowledging their document', async () => {
  const source = await invoice();
  await expect(recordDocumentDelivery({ ...acknowledgement(source.id, 'foreign'), userId: 'other-owner' })).rejects.toThrow('Dokument nicht gefunden');
  expect(await database.client.auditLog.count({ where: { entityId: String(source.id) } })).toBe(0);
});

it('reports SMTP acceptance explicitly when the acknowledgement cannot be stored', async () => {
  const source = await invoice();
  state.send.mockResolvedValueOnce({ messageId: 'accepted-but-unrecorded' });
  const callsBefore = state.send.mock.calls.length;
  await database.client.$executeRawUnsafe(`CREATE TRIGGER fail_delivery_response BEFORE INSERT ON AuditLog WHEN NEW.action = 'EMAIL_SENT' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;`);
  try {
    const response = await sendRoute(new Request('http://localhost/api/email/send', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: source.id, documentType: 'invoice', to: 'recipient@test.invalid', subject: 'Test', text: 'Synthetic test' }),
    }));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: 'DELIVERY_RECORDING_FAILED', smtpAccepted: true, retryUnsafe: true });
    expect(state.send.mock.calls.length - callsBefore).toBe(1);
    expect(await database.client.invoice.findUniqueOrThrow({ where: { id: source.id } })).toMatchObject({ status: 'DRAFT', issuanceState: 'ISSUED' });
  } finally { await database.client.$executeRawUnsafe('DROP TRIGGER fail_delivery_response'); }
});
