import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';

// Browser/UI acceptance only: every browser email mutation is intercepted.
// SMTP is NEVER contacted. Durable Prisma/transport behavior has separate unit
// integration coverage in lib/__tests__/email-outbox.test.ts. Real authentication,
// PDF creation/download, preview, payment reads and database assertions stay live.
type State = 'PREPARED' | 'PROCESSING' | 'ACCEPTED' | 'FAILED' | 'UNKNOWN' | 'CANCELLED';
type Draft = {
  from: string; replyTo?: string; to: string; subject: string; text: string;
  attachmentFileName: string; attachmentSha256: string; storageScope: string; emailConfigured: boolean;
};
type Attempt = {
  id: string; requestId: string; state: State; startedAt: string; finishedAt: string | null;
  errorCode: string | null; uncertaintyRecordedAt: string | null; duplicateRiskAcknowledged: boolean;
};
type Item = {
  id: string; invoiceId: number | null; requestId: string; from: string; replyTo: string | null; to: string; cc: string; bcc: string;
  subject: string; text: string; attachmentFileName: string; attachmentSha256: string;
  state: State; createdAt: string; updatedAt: string; errorCode: string | null; attempts: Attempt[];
};
type RecordedCall = { path: string; body: Record<string, unknown> };
const recipient = 'synthetic-recipient@example.test';
const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu;

async function isolatedAccount(page: Page) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  expect(Boolean(process.env.SMTP_HOST)).toBe(false);
  expect(Boolean(process.env.SMTP_USER)).toBe(false);
  expect(Boolean(process.env.SMTP_PASSWORD)).toBe(false);
  expect(await prisma.smtpSettings.count()).toBe(0);
  const email = `email-outbox-${randomUUID()}@example.test`;
  const password = 'SyntheticOutboxPass123!';
  const user = await prisma.user.create({ data: { email, name: 'Synthetic mocked-email acceptance', password: await hashPassword(password), role: 'USER' } });
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  const settings = await page.request.post('/api/settings', { data: { companyName: 'Synthetic outbox company', email: 'synthetic-sender@example.test' } });
  expect(settings.status()).toBe(200);
  return user.id;
}

async function createInvoice(page: Page, invoiceNumber: string) {
  const pdf = await PDFDocument.create(); pdf.addPage();
  const response = await page.request.post('/api/invoices', { data: {
    fileName: `${invoiceNumber}.pdf`, invoiceNumber, totalAmount: 120,
    invoiceDate: '2026-10-01', dueDate: '2026-10-15', parsedData: { currency: 'EUR' }, pdfBytes: await pdf.saveAsBase64(),
  } });
  expect(response.status()).toBe(200);
  return response.json() as Promise<{ id: number }>;
}

async function financialSnapshot(userId: string, invoiceId: number) {
  return {
    invoice: await prisma.invoice.findFirst({ where: { userId, id: invoiceId }, select: { id: true, status: true, issuanceState: true, paidAt: true, totalAmount: true } }),
    incomes: await prisma.income.findMany({ where: { userId, invoiceId }, orderBy: { id: 'asc' } }),
    payments: await prisma.paymentJournalEvent.findMany({ where: { userId, invoiceId }, orderBy: { id: 'asc' } }),
    reminders: await prisma.reminder.findMany({ where: { userId, invoiceId }, orderBy: { id: 'asc' } }),
    cashBookings: await prisma.cashTransaction.count({ where: { userId } }),
    deliveryAudits: await prisma.auditLog.count({ where: { userId, action: 'EMAIL_SENT' } }),
    realOutboxRows: await prisma.emailOutbox.count({ where: { userId } }),
  };
}

async function assertNoFinancialMutation(page: Page, userId: string, invoiceId: number, before: Awaited<ReturnType<typeof financialSnapshot>>) {
  const response = await page.request.get(`/api/invoices/${invoiceId}/payments`);
  expect(response.status()).toBe(200);
  const ledger = await response.json();
  expect(ledger.events).toEqual([]);
  expect(ledger.summary).toMatchObject({ paidCents: '0', openCents: '12000' });
  expect(await financialSnapshot(userId, invoiceId)).toEqual(before);
  expect(before.incomes).toEqual([]); expect(before.payments).toEqual([]); expect(before.reminders).toEqual([]);
  expect(before.cashBookings).toBe(0); expect(before.realOutboxRows).toBe(0);
}

async function emailBrowserMock(page: Page, invoiceId: number, options: {
  sendState?: State; initialState?: State; initialDetached?: boolean; loseFirstSendBeforeRecording?: boolean; loseRetryResponse?: boolean;
} = {}) {
  // This is a real preview of the real API-created PDF; no SMTP configuration is installed.
  const response = await page.request.post('/api/email/preview', { data: { documentType: 'invoice', id: invoiceId } });
  expect(response.status()).toBe(200);
  const draft = await response.json() as Draft;
  expect(draft.attachmentSha256).toMatch(/^[\da-f]{64}$/u);
  expect(draft.from).not.toBe('');
  expect(draft.emailConfigured).toBe(false);
  const calls: RecordedCall[] = [];
  const unexpected: string[] = [];
  let historyReads = 0;
  const items: Item[] = [];
  const attempt = (state: State, requestId: string, acknowledged = false): Attempt => ({
    id: randomUUID(), requestId, state, startedAt: new Date().toISOString(), finishedAt: state === 'PROCESSING' ? null : new Date().toISOString(),
    errorCode: state === 'FAILED' ? 'RECIPIENT_REJECTED' : state === 'UNKNOWN' ? 'TRANSPORT_UNCERTAIN' : null,
    uncertaintyRecordedAt: state === 'UNKNOWN' ? new Date().toISOString() : null, duplicateRiskAcknowledged: acknowledged,
  });
  const makeItem = (state: State, body: Record<string, unknown>): Item => ({
    id: randomUUID(), invoiceId: options.initialDetached ? null : invoiceId, requestId: String(body.requestId), from: draft.from, replyTo: draft.replyTo ?? null,
    to: String(body.to ?? recipient), cc: String(body.cc ?? ''), bcc: String(body.bcc ?? ''), subject: String(body.subject ?? draft.subject), text: String(body.text ?? draft.text),
    attachmentFileName: draft.attachmentFileName, attachmentSha256: draft.attachmentSha256, state,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), errorCode: state === 'FAILED' ? 'RECIPIENT_REJECTED' : null,
    attempts: state === 'PREPARED' ? [] : [attempt(state, String(body.requestId))],
  });
  if (options.initialState) items.push(makeItem(options.initialState, { requestId: randomUUID() }));
  const handler = async (route: Route) => {
    const request = route.request(); const url = new URL(request.url());
    if (url.pathname === '/api/email/preview' && request.method() === 'POST') {
      const actual = await route.fetch(); expect(actual.status()).toBe(200);
      // Only the configuration flag is mocked; PDF URL/hash and all preview copy are live.
      await route.fulfill({ response: actual, json: { ...await actual.json(), emailConfigured: true } });
      return;
    }
    if (url.pathname === '/api/email/outbox' && request.method() === 'GET') {
      expect(url.searchParams.get('id')).toBe(String(invoiceId));
      historyReads += 1;
      await route.fulfill({ json: { items } }); return;
    }
    if (url.pathname === '/api/email/send' && request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>; calls.push({ path: url.pathname, body });
      expect(body.id).toBe(invoiceId); expect(body.documentType).toBe('invoice');
      expect(body.requestId).toMatch(uuid); expect(body.attachmentSha256).toBe(draft.attachmentSha256);
      expect(body.reviewedFrom).toBe(draft.from); expect(body.reviewedReplyTo).toBe(draft.replyTo ?? null);
      if (options.loseFirstSendBeforeRecording && calls.length === 1) { await route.abort('failed'); return; }
      let item = items.find((entry) => entry.requestId === body.requestId);
      if (item?.state === 'PREPARED') {
        expect(body).toMatchObject({ to: item.to, subject: item.subject, text: item.text });
        item.state = 'ACCEPTED'; item.attempts.push(attempt('ACCEPTED', item.requestId));
      } else if (!item) {
        item = makeItem(options.sendState ?? 'ACCEPTED', body); items.unshift(item);
      }
      await route.fulfill({ json: { success: true, outbox: item } }); return;
    }
    const retry = url.pathname.match(/^\/api\/email\/outbox\/([^/]+)\/retry$/u);
    if (retry && request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>; calls.push({ path: url.pathname, body });
      const item = items.find((entry) => entry.id === decodeURIComponent(retry[1])); expect(item).toBeDefined();
      if (!item) { await route.abort('blockedbyclient'); return; }
      expect(body.requestId).toMatch(uuid); expect(body.requestId).not.toBe(item.requestId);
      expect(Object.keys(body).sort()).toEqual(['acknowledgeUnknown', 'requestId']);
      if (item.attempts.some((entry) => entry.uncertaintyRecordedAt)) expect(body.acknowledgeUnknown).toBe(true);
      if (!item.attempts.some((entry) => entry.requestId === body.requestId)) {
        item.state = 'ACCEPTED'; item.updatedAt = new Date().toISOString();
        item.attempts.push(attempt('ACCEPTED', String(body.requestId), body.acknowledgeUnknown === true));
      }
      if (options.loseRetryResponse) { await route.abort('failed'); return; }
      await route.fulfill({ json: { success: true, outbox: item } }); return;
    }
    // Fail closed for any unexpected browser email path/method: never forward a mutation.
    unexpected.push(`${request.method()} ${url.pathname}`); await route.abort('blockedbyclient');
  };
  await page.route('**/api/email/**', handler);
  return { draft, calls, items, unexpected, historyReads: () => historyReads, dispose: () => page.unroute('**/api/email/**', handler) };
}

async function openEmail(page: Page, invoiceNumber: string, keyboard = false) {
  const trigger = page.getByRole('button', { name: `Weitere Aktionen fuer Rechnung ${invoiceNumber}`, exact: true });
  await expect(trigger).toBeVisible();
  if (keyboard) { await trigger.focus(); await trigger.press('Enter'); }
  else await trigger.click();
  const menuitem = page.getByRole('menuitem', { name: 'Per E-Mail senden', exact: true });
  if (keyboard) { await menuitem.focus(); await menuitem.press('Enter'); }
  else await menuitem.click();
  const dialog = page.getByRole('dialog', { name: 'Rechnung per E-Mail senden', exact: true });
  await expect(dialog.getByRole('button', { name: 'Status aktualisieren', exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Betreff', { exact: true })).not.toHaveValue('');
  return { dialog, trigger };
}

async function assertFitsViewport(page: Page, dialog: Locator) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  const action = dialog.locator('[data-slot="dialog-footer"]').getByRole('button').last();
  const box = await action.boundingBox(); expect(box).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
}

test('mocked browser email: 1440px explicit ACCEPTED, review/reopen, keyboard Escape and cancel never resend', async ({ page }, testInfo) => {
  test.setTimeout(90_000); await page.setViewportSize({ width: 1440, height: 1000 });
  const userId = await isolatedAccount(page);
  try {
    const number = 'OUTBOX-DESKTOP-120'; const invoice = await createInvoice(page, number);
    const before = await financialSnapshot(userId, invoice.id); const api = await emailBrowserMock(page, invoice.id);
    await page.goto('/dashboard?tab=invoices');
    let { dialog, trigger } = await openEmail(page, number, true);
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
    expect(api.calls).toHaveLength(0);
    ({ dialog, trigger } = await openEmail(page, number));
    await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click(); await expect(dialog).toHaveCount(0);
    expect(api.calls).toHaveLength(0);
    ({ dialog, trigger } = await openEmail(page, number));
    await dialog.getByLabel('An', { exact: true }).fill(recipient);
    await dialog.getByRole('button', { name: 'E-Mail senden', exact: true }).dblclick();
    await expect(dialog.getByRole('status').getByText('Vom E-Mail-Server angenommen', { exact: true })).toBeVisible();
    await expect(dialog).toContainText('Nicht als zugestellt oder gelesen bestätigt.');
    await expect(dialog.getByRole('button', { name: 'E-Mail senden', exact: true })).toBeDisabled();
    expect(api.calls).toHaveLength(1); await assertFitsViewport(page, dialog);
    await page.screenshot({ path: testInfo.outputPath('mocked-email-accepted-1440.png'), fullPage: false });
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
    ({ dialog } = await openEmail(page, number));
    await expect(dialog.getByRole('status').getByText('Vom E-Mail-Server angenommen', { exact: true })).toBeVisible();
    expect(api.calls).toHaveLength(1);
    await dialog.getByRole('button', { name: 'Neue E-Mail vorbereiten', exact: true }).click();
    await expect(dialog.getByLabel('An', { exact: true })).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Neue E-Mail senden', exact: true })).toBeDisabled();
    const review = dialog.getByRole('checkbox'); await expect(review).toBeDisabled();
    await dialog.getByLabel('Betreff', { exact: true }).fill('Synthetic deliberately edited message');
    await expect(review).toBeEnabled(); await review.check();
    await expect(dialog.getByRole('button', { name: 'Neue E-Mail senden', exact: true })).toBeEnabled();
    await dialog.getByLabel('E-Mail-Text', { exact: true }).fill('A further edit invalidates the fresh review.');
    await expect(review).not.toBeChecked(); await expect(dialog.getByRole('button', { name: 'Neue E-Mail senden', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    expect(api.calls).toHaveLength(1); expect(api.unexpected).toEqual([]);
    await assertNoFinancialMutation(page, userId, invoice.id, before);
    await testInfo.attach('mocked-browser-email-scope.json', { body: Buffer.from(JSON.stringify({ browserEmailApiMocked: true, liveSmtp: false, calls: api.calls, historyReads: api.historyReads() }, null, 2)), contentType: 'application/json' });
  } finally { await prisma.$disconnect(); }
});

test('mocked browser email: 360px safe FAILED retry and PREPARED same-UUID resume stay manual', async ({ page }) => {
  test.setTimeout(90_000); await page.setViewportSize({ width: 360, height: 900 });
  const userId = await isolatedAccount(page);
  try {
    const number = 'OUTBOX-FAILED-360'; const invoice = await createInvoice(page, number);
    const before = await financialSnapshot(userId, invoice.id); const api = await emailBrowserMock(page, invoice.id, { sendState: 'FAILED' });
    await page.goto('/dashboard?tab=invoices'); let { dialog } = await openEmail(page, number);
    await dialog.getByLabel('An', { exact: true }).fill(recipient);
    await dialog.getByRole('button', { name: 'E-Mail senden', exact: true }).click();
    await expect(dialog.getByRole('status').getByText('Versand fehlgeschlagen', { exact: true })).toBeVisible();
    expect(api.calls).toHaveLength(1); await expect(dialog.getByRole('checkbox')).toHaveCount(0);
    await expect(dialog.getByLabel('An', { exact: true })).toHaveAttribute('readonly', '');
    await assertFitsViewport(page, dialog);
    const originalId = api.items[0].requestId;
    await dialog.getByRole('button', { name: 'Erneut versuchen', exact: true }).click();
    await expect(dialog.getByRole('status').getByText('Vom E-Mail-Server angenommen', { exact: true })).toBeVisible();
    expect(api.calls).toHaveLength(2); expect(api.calls[1].body.requestId).not.toBe(originalId);
    expect(api.calls[1].body.acknowledgeUnknown).toBe(false); expect(api.items[0].attempts.map((entry) => entry.state)).toEqual(['FAILED', 'ACCEPTED']);
    await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    await assertNoFinancialMutation(page, userId, invoice.id, before); await api.dispose();

    const preparedNumber = 'OUTBOX-PREPARED-360'; const prepared = await createInvoice(page, preparedNumber);
    const preparedBefore = await financialSnapshot(userId, prepared.id);
    const preparedApi = await emailBrowserMock(page, prepared.id, { initialState: 'PREPARED' });
    const preparedRequestId = preparedApi.items[0].requestId;
    await page.goto('/dashboard?tab=invoices'); ({ dialog } = await openEmail(page, preparedNumber));
    expect(preparedApi.calls).toHaveLength(0);
    await expect(dialog.getByRole('status').getByText('Versand vorbereitet', { exact: true })).toBeVisible();
    await assertFitsViewport(page, dialog);
    await dialog.getByRole('button', { name: 'Vorbereiteten Versand fortsetzen', exact: true }).click();
    await expect(dialog.getByRole('status').getByText('Vom E-Mail-Server angenommen', { exact: true })).toBeVisible();
    expect(preparedApi.calls).toHaveLength(1); expect(preparedApi.calls[0].body.requestId).toBe(preparedRequestId);
    expect(preparedApi.calls[0].path).toBe('/api/email/send'); expect(preparedApi.unexpected).toEqual([]); expect(api.unexpected).toEqual([]);
    await assertNoFinancialMutation(page, userId, prepared.id, preparedBefore);
  } finally { await prisma.$disconnect(); }
});

test('mocked browser email: 390px lost responses preserve UUID, UNKNOWN consent/history and accepted reload', async ({ page }, testInfo) => {
  test.setTimeout(90_000); await page.setViewportSize({ width: 390, height: 900 });
  const userId = await isolatedAccount(page);
  try {
    const number = 'OUTBOX-UNKNOWN-390'; const invoice = await createInvoice(page, number);
    const before = await financialSnapshot(userId, invoice.id);
    const api = await emailBrowserMock(page, invoice.id, { sendState: 'UNKNOWN', loseFirstSendBeforeRecording: true, loseRetryResponse: true });
    await page.goto('/dashboard?tab=invoices'); let { dialog } = await openEmail(page, number);
    await dialog.getByLabel('An', { exact: true }).fill(recipient);
    await dialog.getByRole('button', { name: 'E-Mail senden', exact: true }).click();
    await expect(dialog.getByRole('alert').filter({ hasText: 'Keine sichere Versandbestätigung' })).toBeVisible();
    expect(api.calls).toHaveLength(1); const firstRequestId = api.calls[0].body.requestId;
    await page.reload(); ({ dialog } = await openEmail(page, number));
    expect(api.calls).toHaveLength(1);
    await expect(dialog.getByLabel('An', { exact: true })).toHaveValue(recipient);
    await dialog.getByRole('button', { name: 'Versandversuch fortsetzen', exact: true }).click();
    await expect(dialog.getByRole('status').getByText('Versandstatus unklar', { exact: true })).toBeVisible();
    expect(api.calls).toHaveLength(2); expect(api.calls[1].body.requestId).toBe(firstRequestId);
    await expect(dialog.getByRole('button', { name: 'Erneut versuchen', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('checkbox')).not.toBeChecked();
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
    ({ dialog } = await openEmail(page, number));
    expect(api.calls).toHaveLength(2); await expect(dialog.getByRole('checkbox')).not.toBeChecked();
    await dialog.locator('summary').click();
    await expect(dialog.locator('details')).toContainText('Versandstatus unklar');
    await expect(dialog.getByRole('button', { name: 'Neue E-Mail vorbereiten', exact: true })).toHaveCount(0);
    const consent = dialog.getByRole('checkbox'); await consent.scrollIntoViewIfNeeded(); await consent.focus(); await page.keyboard.press('Space');
    await expect(consent).toBeChecked(); await expect(dialog.getByRole('button', { name: 'Erneut versuchen', exact: true })).toBeEnabled();
    await assertFitsViewport(page, dialog);
    await page.screenshot({ path: testInfo.outputPath('mocked-email-unknown-390.png'), fullPage: false });
    await dialog.getByRole('button', { name: 'Erneut versuchen', exact: true }).click();
    await expect(dialog.getByRole('alert').filter({ hasText: 'Keine sichere Versandbestätigung' })).toBeVisible();
    expect(api.calls).toHaveLength(3); expect(api.calls[2].body.acknowledgeUnknown).toBe(true);
    expect(api.calls[2].body.requestId).not.toBe(firstRequestId);
    await page.reload(); ({ dialog } = await openEmail(page, number));
    await expect(dialog.getByRole('status').getByText('Vom E-Mail-Server angenommen', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'E-Mail senden', exact: true })).toBeDisabled();
    await dialog.locator('summary').click(); await expect(dialog.locator('details')).toContainText('Doppelversandrisiko bestätigt');
    expect(api.calls).toHaveLength(3); expect(api.items[0].attempts.map((entry) => entry.state)).toEqual(['UNKNOWN', 'ACCEPTED']);
    expect(api.unexpected).toEqual([]); await assertNoFinancialMutation(page, userId, invoice.id, before);
    await testInfo.attach('mocked-browser-response-loss-evidence.json', { body: Buffer.from(JSON.stringify({ browserEmailApiMocked: true, liveSmtp: false, calls: api.calls, persistedMockHistory: api.items, historyReads: api.historyReads() }, null, 2)), contentType: 'application/json' });
  } finally { await prisma.$disconnect(); }
});


test('mocked browser email: detached uncertain original stays historical and cannot retry or rebind', async ({ page }) => {
  test.setTimeout(90_000); await page.setViewportSize({ width: 390, height: 900 });
  const userId = await isolatedAccount(page);
  try {
    const number = 'OUTBOX-DETACHED-390'; const invoice = await createInvoice(page, number);
    const before = await financialSnapshot(userId, invoice.id);
    const api = await emailBrowserMock(page, invoice.id, { initialState: 'UNKNOWN', initialDetached: true });
    await page.goto('/dashboard?tab=invoices'); const { dialog } = await openEmail(page, number);
    const status = dialog.getByRole('status');
    await expect(status).toContainText('Früherer Versand derselben Originalversion');
    await expect(status).toContainText('Original wurde wiederhergestellt oder ersetzt.');
    await expect(dialog.getByRole('button', { name: 'Neue E-Mail vorbereiten', exact: true })).toHaveCount(0);
    await dialog.getByRole('checkbox').check();
    await expect(dialog.getByRole('button', { name: 'Erneut versuchen', exact: true })).toBeDisabled();
    expect(api.calls).toHaveLength(0); await assertFitsViewport(page, dialog);
    // A definitive historical acceptance is NOT a claim that the restored row is sent.
    api.items[0].state = 'ACCEPTED';
    await dialog.getByRole('button', { name: 'Status aktualisieren', exact: true }).click();
    await expect(status).toContainText('Vom E-Mail-Server angenommen');
    await expect(status).toContainText('Früherer Versand derselben Originalversion');
    await expect(dialog.getByRole('button', { name: 'E-Mail senden', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Neue E-Mail vorbereiten', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Neue E-Mail senden', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    expect(api.calls).toHaveLength(0); expect(api.unexpected).toEqual([]);
    await assertNoFinancialMutation(page, userId, invoice.id, before);
  } finally { await prisma.$disconnect(); }
});
