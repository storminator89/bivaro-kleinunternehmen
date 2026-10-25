import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import type { IncomingDocument, IncomingDocumentResponse } from '../lib/purchase-documents/types';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';

// Authored acceptance, not executed during source reconstruction. The caller
// must separately authorize the published candidate / hosted fixture run.
// No fake browser or HTTP clock: every filter reads the actual server Berlin day.
const review = (page: Page) => page.getByRole('dialog', { name: 'Eingangsbeleg prüfen', exact: true });
const panel = (page: Page) => review(page).getByRole('region', { name: 'Lieferantenaufgabe · interne Vormerkung', exact: true });
const headers = (page: Page) => ({ Origin: new URL(page.url()).origin, 'Sec-Fetch-Site': 'same-origin' });
async function account(page: Page) {
  const fixture = `file:${e2eDatabasePath()}`;
  if (process.env.DATABASE_URL !== fixture) throw new Error('Supplier-task acceptance requires the exact isolated synthetic E2E database.');
  await isolateSyntheticLoginIpBudget();
  const password = 'SyntheticSupplierTasks123!';
  const user = await prisma.user.create({ data: { email: `supplier-tasks-${randomUUID()}@example.test`, name: 'Synthetic supplier task owner', password: await hashPassword(password), role: 'USER' } });
  await page.goto('/login'); await page.getByLabel('E-Mail').fill(user.email); await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click(); await expect(page).toHaveURL(/\/dashboard/);
  return user;
}
async function upload(page: Page, suffix: string) {
  const bytes = Buffer.from((await readFile('lib/__tests__/fixtures/incoming-validation/valid-ubl.xml', 'utf8')).replace('SYNTHETIC-UBL-001', `SYN-TASK-${suffix}`));
  const response = await page.request.post('/api/purchase-documents', { headers: headers(page), multipart: { file: { name: `SYN-TASK-${suffix}.xml`, mimeType: 'application/xml', buffer: bytes }, uploadRequestId: randomUUID(), analysisMode: 'manual' } });
  expect(response.status(), await response.text()).toBe(201);
  return { document: (await response.json() as IncomingDocumentResponse).document, bytes };
}
async function detail(page: Page, id: number) {
  const response = await page.request.get(`/api/purchase-documents/${id}`); expect(response.status()).toBe(200);
  return (await response.json() as IncomingDocumentResponse).document;
}
async function setTask(page: Page, document: IncomingDocument, kind: 'PAYMENT_CHECK' | 'DIRECT_DEBIT_WAIT' | 'CLARIFY', followUpDate: string | null) {
  const response = await page.request.post(`/api/purchase-documents/${document.id}/supplier-task`, { headers: headers(page), data: { expectedRevision: document.revision, task: { kind, followUpDate } } });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json() as IncomingDocumentResponse).document;
}
async function finances(userId: string) {
  return prisma.$transaction([
    prisma.expense.findMany({ where: { userId } }), prisma.income.findMany({ where: { userId } }),
    prisma.cashTransaction.findMany({ where: { userId } }), prisma.invoice.findMany({ where: { userId } }),
    prisma.paymentJournalEvent.findMany({ where: { userId } }), prisma.paymentOperation.findMany({ where: { userId } }),
    prisma.paymentAdjustment.findMany({ where: { userId } }), prisma.invoiceNumberCounter.findMany({ where: { userId } }),
    prisma.documentNumberingPolicy.findMany({ where: { userId } }), prisma.emailOutbox.findMany({ where: { userId } }),
  ]);
}
async function originalUnchanged(page: Page, document: IncomingDocument, bytes: Buffer) {
  const response = await page.request.get(`/api/purchase-documents/${document.id}/original`);
  expect(response.status()).toBe(200); expect(await response.body()).toEqual(bytes);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(document.originalRef.sha256);
}
async function screenshot(page: Page, info: TestInfo, name: string, surface = panel(page)) {
  await surface.scrollIntoViewIfNeeded();
  await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const overflow = await surface.evaluate(root => [...root.querySelectorAll('button,input,select')].filter(element => {
    const box = element.getBoundingClientRect(); return box.width > 0 && (box.left < -1 || box.right > document.documentElement.clientWidth + 1);
  }).map(element => element.textContent));
  expect(overflow).toEqual([]);
  const path = info.outputPath(name), png = await page.screenshot({ path, fullPage: true, animations: 'disabled' });
  expect(png.readUInt32BE(16)).toBe(page.viewportSize()!.width);
  await info.attach(name, { path, contentType: 'image/png' });
  // Human image inspection must be recorded separately; producing PNG bytes is
  // not itself visual acceptance or proof that this authored test passed.
}

test('supplier task keyboard/mobile save, explicit source date, dirty cancel, filters, original return and reopened history remain unposted', async ({ page }, info) => {
  test.setTimeout(150_000); await page.setViewportSize({ width: 1440, height: 1000 });
  const user = await account(page), source = await upload(page, 'MAIN');
  const before = await finances(user.id);
  await page.goto('/purchases'); const row = page.locator(`[data-incoming-document-id="${source.document.id}"]`);
  await row.focus(); await expect(row).toBeFocused(); await page.keyboard.press('Enter');
  await expect(review(page).getByRole('heading', { name: 'Eingangsbeleg prüfen', exact: true })).toBeFocused();
  await expect(panel(page)).toContainText('nicht bezahlt / nicht bankgeprüft');
  await expect(panel(page).getByLabel('Wiedervorlagetag (optional)', { exact: true })).toHaveValue('');
  await panel(page).getByLabel('Aufgabenart', { exact: true }).focus(); await page.keyboard.press('d');
  await panel(page).getByLabel('Aufgabenart', { exact: true }).selectOption('DIRECT_DEBIT_WAIT');
  await panel(page).getByRole('button', { name: 'Vormerkung speichern', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(panel(page)).toContainText('Vormerkung gespeichert · keine Zahlungs- oder Buchungswirkung');
  let saved = await detail(page, source.document.id);
  expect(saved.supplierTask).toEqual({ kind: 'DIRECT_DEBIT_WAIT', followUpDate: null, confirmationRequired: false });
  expect(saved.reviewDraft).toEqual(source.document.reviewDraft); expect(saved.linkedExpenseId).toBeNull();
  await page.reload(); await expect(panel(page).getByLabel('Aufgabenart', { exact: true })).toHaveValue('DIRECT_DEBIT_WAIT');
  await panel(page).getByRole('button', { name: 'Als Wiedervorlage übernehmen', exact: true }).click();
  expect(source.document.preview?.dueDate?.slice(0, 10)).toBe('2026-11-20');
  await expect(panel(page).getByLabel('Wiedervorlagetag (optional)', { exact: true })).toHaveValue('2026-11-20');
  await review(page).getByRole('button', { name: 'Zur Liste', exact: true }).click();
  const chooser = review(page).getByRole('alertdialog', { name: 'Ungespeicherte Vormerkung', exact: true });
  await expect(chooser.getByRole('heading')).toBeFocused(); await chooser.getByRole('button', { name: 'Hier bleiben', exact: true }).click();
  await expect(review(page).getByRole('button', { name: 'Zur Liste', exact: true })).toBeFocused();
  await panel(page).getByRole('button', { name: 'Vormerkung abbrechen', exact: true }).click();
  await expect(panel(page).getByLabel('Wiedervorlagetag (optional)', { exact: true })).toHaveValue('');
  await expect(panel(page).getByRole('heading')).toBeFocused();
  await panel(page).getByLabel('Wiedervorlagetag (optional)', { exact: true }).fill('2026-12-25');
  await review(page).getByRole('button', { name: 'Zur Liste', exact: true }).click();
  await chooser.getByRole('button', { name: 'Speichern & weiter', exact: true }).click();
  await expect(review(page)).toHaveCount(0); expect((await detail(page, source.document.id)).supplierTask?.followUpDate).toBe('2026-12-25');
  await row.click(); await expect(panel(page).getByLabel('Wiedervorlagetag (optional)', { exact: true })).toHaveValue('2026-12-25');
  await panel(page).getByRole('button', { name: 'Als Wiedervorlage übernehmen', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Vormerkung speichern', exact: true }).click();
  await expect(panel(page)).toContainText('Vormerkung gespeichert · keine Zahlungs- oder Buchungswirkung');
  await screenshot(page, info, 'supplier-tasks-1440.png');
  await page.setViewportSize({ width: 390, height: 844 }); await screenshot(page, info, 'supplier-tasks-390.png');
  await panel(page).getByLabel('Wiedervorlagetag (optional)', { exact: true }).fill('2026-12-24');
  page.once('dialog', dialog => dialog.dismiss()); await review(page).getByRole('button', { name: 'Neu laden', exact: true }).click();
  await expect(panel(page).getByLabel('Wiedervorlagetag (optional)', { exact: true })).toHaveValue('2026-12-24');
  page.once('dialog', dialog => dialog.accept()); await review(page).getByRole('button', { name: 'Neu laden', exact: true }).click();
  await expect(panel(page).getByLabel('Wiedervorlagetag (optional)', { exact: true })).toHaveValue('2026-11-20');
  await page.keyboard.press('Escape'); await expect(review(page)).toHaveCount(0); await expect(row).toBeFocused();
  const todayResponse = await page.request.get('/api/purchase-documents?taskKind=any'); expect(todayResponse.status()).toBe(200);
  const today = (await todayResponse.json()).supplierTaskToday as string; expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const past = await upload(page, 'PAST'), future = await upload(page, 'FUTURE'), undated = await upload(page, 'UNDATED');
  await setTask(page, past.document, 'PAYMENT_CHECK', '2000-01-01'); await setTask(page, future.document, 'CLARIFY', '9999-12-31'); await setTask(page, undated.document, 'CLARIFY', null);
  await page.getByLabel('Aufgabenart filtern', { exact: true }).selectOption('any');
  await page.getByLabel('Wiedervorlage filtern', { exact: true }).selectOption('due');
  await expect(page.locator(`[data-incoming-document-id="${past.document.id}"]`)).toBeVisible();
  await expect(page.locator(`[data-incoming-document-id="${future.document.id}"]`)).toHaveCount(0); await expect(page.locator(`[data-incoming-document-id="${undated.document.id}"]`)).toHaveCount(0);
  await page.getByLabel('Wiedervorlage filtern', { exact: true }).selectOption('later');
  await expect(page.locator(`[data-incoming-document-id="${future.document.id}"]`)).toBeVisible();
  await page.getByLabel('Wiedervorlage filtern', { exact: true }).selectOption('undated');
  const undatedRow = page.locator(`[data-incoming-document-id="${undated.document.id}"]`); await expect(undatedRow).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 }); await screenshot(page, info, 'supplier-task-inbox-1440.png', page.getByRole('main'));
  await page.setViewportSize({ width: 390, height: 844 }); await screenshot(page, info, 'supplier-task-inbox-390.png', page.getByRole('main'));
  await undatedRow.click(); await expect(panel(page).getByLabel('Wiedervorlagetag (optional)', { exact: true })).toHaveValue('');
  const [download] = await Promise.all([page.waitForEvent('download'), review(page).getByRole('button', { name: 'Original herunterladen', exact: true }).click()]);
  expect(await download.failure()).toBeNull(); expect(await readFile((await download.path())!)).toEqual(undated.bytes);
  await originalUnchanged(page, undated.document, undated.bytes); await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/taskDue=undated/); await expect(page.getByLabel('Wiedervorlage filtern', { exact: true })).toHaveValue('undated'); await expect(undatedRow).toBeFocused();
  await page.goto(`/purchases?document=${source.document.id}`); await expect(panel(page)).toBeVisible();
  await review(page).getByRole('button', { name: 'Beleg verwerfen', exact: true }).click(); await review(page).getByLabel('Warum wird dieser Beleg verworfen?', { exact: true }).fill('Synthetic inactive history');
  await review(page).getByRole('button', { name: 'Verwerfen bestätigen', exact: true }).click(); await expect(panel(page)).toContainText('inaktiv');
  await review(page).getByRole('button', { name: 'Wieder öffnen', exact: true }).click(); await expect(panel(page)).toContainText('Nach dem Wiederöffnen noch inaktiv');
  saved = await detail(page, source.document.id); expect(saved.supplierTask?.confirmationRequired).toBe(true);
  const active = await page.request.get('/api/purchase-documents?taskKind=any'); expect((await active.json()).documents.map((value: IncomingDocument) => value.id)).not.toContain(source.document.id);
  await panel(page).getByRole('button', { name: 'Vormerkung erneut bestätigen', exact: true }).click(); await expect(panel(page)).toContainText('Vormerkung gespeichert · keine Zahlungs- oder Buchungswirkung');
  await panel(page).getByLabel('Aufgabenart', { exact: true }).selectOption(''); await panel(page).getByRole('button', { name: 'Vormerkung entfernen', exact: true }).click();
  await expect(panel(page)).toContainText('Vormerkung gespeichert · keine Zahlungs- oder Buchungswirkung'); expect((await detail(page, source.document.id)).supplierTask).toBeNull();
  await originalUnchanged(page, source.document, source.bytes); expect(await finances(user.id)).toEqual(before);
});

test('two real tabs produce 409, unknown committed response is read before retry, and delayed save preserves newer keyboard edits', async ({ page, context }, info) => {
  test.setTimeout(150_000); await page.setViewportSize({ width: 390, height: 844 });
  const user = await account(page), source = await upload(page, 'CONFLICT'), before = await finances(user.id);
  await page.goto(`/purchases?document=${source.document.id}`); await expect(panel(page)).toBeVisible();
  const other = await context.newPage();
  try {
    await other.goto(`/purchases?document=${source.document.id}`); await expect(panel(other)).toBeVisible();
    await panel(other).getByLabel('Aufgabenart', { exact: true }).selectOption('CLARIFY'); await panel(other).getByRole('button', { name: 'Vormerkung speichern', exact: true }).click();
    await expect(panel(other)).toContainText('Vormerkung gespeichert · keine Zahlungs- oder Buchungswirkung');
    await review(page).getByRole('button', { name: 'Neu laden', exact: true }).click(); await expect(panel(page).getByLabel('Aufgabenart', { exact: true })).toHaveValue('CLARIFY');
    await panel(other).getByLabel('Aufgabenart', { exact: true }).selectOption('DIRECT_DEBIT_WAIT'); await panel(other).getByRole('button', { name: 'Vormerkung speichern', exact: true }).click();
    await expect(panel(other)).toContainText('Vormerkung gespeichert · keine Zahlungs- oder Buchungswirkung');
    await panel(page).getByLabel('Aufgabenart', { exact: true }).selectOption('PAYMENT_CHECK'); await panel(page).getByLabel('Wiedervorlagetag (optional)', { exact: true }).fill('2026-12-01');
    await panel(page).getByRole('button', { name: 'Vormerkung speichern', exact: true }).click();
    await expect(panel(page).getByRole('alert')).toContainText('inzwischen geändert'); await expect(panel(page).getByLabel('Aufgabenart', { exact: true })).toHaveValue('PAYMENT_CHECK');
    await expect(panel(page).getByRole('alert')).toBeFocused(); await screenshot(page, info, 'supplier-tasks-conflict-390.png');
    page.once('dialog', dialog => dialog.accept()); await panel(page).getByRole('button', { name: 'Aktuellen Serverstand laden', exact: true }).click();
    await expect(panel(page).getByLabel('Aufgabenart', { exact: true })).toHaveValue('DIRECT_DEBIT_WAIT');

    const events: string[] = [];
    const observe = (request: import('@playwright/test').Request) => { const url = new URL(request.url()); if (url.pathname === `/api/purchase-documents/${source.document.id}` || url.pathname === `/api/purchase-documents/${source.document.id}/supplier-task`) events.push(`${request.method()} ${url.pathname}`); };
    page.on('request', observe);
    let releaseWait!: () => void, enteredWait!: () => void;
    const waitGate = new Promise<void>(resolve => { releaseWait = resolve; }), waitStarted = new Promise<void>(resolve => { enteredWait = resolve; });
    await page.route(`**/api/purchase-documents/${source.document.id}/supplier-task`, async route => {
      const response = await route.fetch(); expect(response.status()).toBe(200); enteredWait(); await waitGate;
      // Client deliberately aborted its wait after the real server committed.
      await route.fulfill({ response }).catch(() => {});
    }, { times: 1 });
    await panel(page).getByLabel('Aufgabenart', { exact: true }).selectOption('CLARIFY'); await panel(page).getByRole('button', { name: 'Vormerkung speichern', exact: true }).click();
    await waitStarted;
    try {
      await panel(page).getByRole('button', { name: 'Warten abbrechen', exact: true }).focus(); await expect(panel(page).getByRole('button', { name: 'Warten abbrechen', exact: true })).toBeFocused(); await page.keyboard.press('Enter');
      await expect(panel(page).getByRole('alert')).toContainText('kann serverseitig bereits gespeichert sein');
    } finally { releaseWait(); }
    await expect(panel(page).getByRole('alert')).toContainText('Speicherung nicht bestätigt');
    const committed = await detail(page, source.document.id); expect(committed.supplierTask?.kind).toBe('CLARIFY');
    events.length = 0; await panel(page).getByRole('button', { name: 'Status abgleichen / erneut speichern', exact: true }).click();
    await expect(panel(page)).toContainText('Vormerkung gespeichert · keine Zahlungs- oder Buchungswirkung');
    expect(events).toEqual([`GET /api/purchase-documents/${source.document.id}`]); expect((await detail(page, source.document.id)).revision).toBe(committed.revision);
    page.off('request', observe); await page.unroute(`**/api/purchase-documents/${source.document.id}/supplier-task`);

    let release!: () => void, entered!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    await page.route(`**/api/purchase-documents/${source.document.id}/supplier-task`, async route => { const response = await route.fetch(); expect(response.status()).toBe(200); entered(); await gate; await route.fulfill({ response }); }, { times: 1 });
    await panel(page).getByLabel('Aufgabenart', { exact: true }).selectOption('PAYMENT_CHECK'); await panel(page).getByRole('button', { name: 'Vormerkung speichern', exact: true }).click(); await started;
    try { await panel(page).getByLabel('Aufgabenart', { exact: true }).selectOption('CLARIFY'); await panel(page).getByLabel('Wiedervorlagetag (optional)', { exact: true }).fill('2026-12-31'); } finally { release(); }
    await expect(panel(page).getByLabel('Aufgabenart', { exact: true })).toHaveValue('CLARIFY'); await expect(panel(page).getByLabel('Wiedervorlagetag (optional)', { exact: true })).toHaveValue('2026-12-31');
    await expect(panel(page)).toContainText('Ungespeicherte Vormerkung'); await expect(panel(page).getByRole('button', { name: 'Vormerkung speichern', exact: true })).toBeEnabled();
    await panel(page).getByRole('button', { name: 'Vormerkung speichern', exact: true }).click(); await expect(panel(page)).toContainText('Vormerkung gespeichert · keine Zahlungs- oder Buchungswirkung');
    expect((await detail(page, source.document.id)).supplierTask).toEqual({ kind: 'CLARIFY', followUpDate: '2026-12-31', confirmationRequired: false });
    await originalUnchanged(page, source.document, source.bytes); expect(await finances(user.id)).toEqual(before);
  } finally { await other.close(); }
});

test('equal-day tasks paginate in stable server order and no-task originals never become tasks', async ({ page }) => {
  test.setTimeout(240_000); const user = await account(page), before = await finances(user.id);
  const untouched = await upload(page, 'UNMARKED'); const ids: number[] = [];
  for (let index = 0; index < 26; index++) { const source = await upload(page, `PAGE-${index}`); ids.push(source.document.id); await setTask(page, source.document, 'CLARIFY', '9999-12-31'); }
  await page.goto('/purchases?taskKind=CLARIFY&taskDue=later');
  await expect(page.getByRole('list', { name: 'Eingangsbelege', exact: true }).getByRole('listitem')).toHaveCount(25);
  const firstIds = await page.locator('[data-incoming-document-id]').evaluateAll(values => values.map(value => Number(value.getAttribute('data-incoming-document-id'))));
  expect(firstIds).toEqual(ids.slice(0, 25));
  await page.getByRole('button', { name: 'Nächste Belegseite', exact: true }).click(); await expect(page).toHaveURL(/page=2/);
  await expect(page.locator(`[data-incoming-document-id="${ids[25]}"]`)).toBeVisible(); await expect(page.getByRole('button', { name: 'Nächste Belegseite', exact: true })).toBeDisabled();
  await page.locator(`[data-incoming-document-id="${ids[25]}"]`).click(); await expect(panel(page)).toBeVisible(); await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/page=2/); await expect(page.getByLabel('Wiedervorlage filtern', { exact: true })).toHaveValue('later');
  await page.getByRole('button', { name: 'Vorherige Belegseite', exact: true }).click();
  await expect(page.locator('[data-incoming-document-id]')).toHaveCount(25);
  expect(await page.locator('[data-incoming-document-id]').evaluateAll(values => values.map(value => Number(value.getAttribute('data-incoming-document-id'))))).toEqual(firstIds);
  expect((await detail(page, untouched.document.id)).supplierTask).toBeNull(); expect(await finances(user.id)).toEqual(before);
});

test.afterAll(async () => { await prisma.$disconnect(); });
