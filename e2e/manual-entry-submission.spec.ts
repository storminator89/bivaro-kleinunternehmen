import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { deleteTenantFile } from '../lib/upload-path';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';

// Acceptance source for authorized hosted execution only. Real authenticated
// writes use the standard fresh fixture, never repository/production databases.
type Kind = 'income' | 'expense';
const plural = (kind: Kind) => kind === 'income' ? 'incomes' : 'expenses';
const noun = (kind: Kind) => kind === 'income' ? 'Einnahmen' : 'Ausgaben';
const receipt = { name: 'synthetic-submit-guard.png', mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64') };

async function account(page: Page) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  await isolateSyntheticLoginIpBudget();
  const password = 'SyntheticManualEntry169!';
  const user = await prisma.user.create({ data: { email: `manual-entry-${randomUUID()}@example.test`,
    name: 'Synthetic manual entry guard', password: await hashPassword(password), role: 'USER' } });
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(user.email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return user;
}
async function cleanup(userId: string) {
  const files = await prisma.expense.findMany({ where: { userId }, select: { storedReceiptFileName: true } });
  for (const file of files) if (file.storedReceiptFileName) await deleteTenantFile(userId, file.storedReceiptFileName);
  await prisma.user.delete({ where: { id: userId } });
}
async function count(kind: Kind, userId: string, description: string) {
  const where = { userId, description };
  return kind === 'income' ? prisma.income.count({ where }) : prisma.expense.count({ where });
}
async function fill(entry: Locator, description: string) {
  await entry.getByLabel('Beschreibung', { exact: true }).fill(description);
  await entry.getByLabel('Betrag (€)', { exact: true }).fill('12.34');
}
async function repeatSubmit(form: Locator) {
  await form.evaluate(element => {
    const form = element as HTMLFormElement;
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    submit.click(); submit.click(); form.requestSubmit();
  });
}
function heldRealWrite() {
  let release!: () => void, accepted!: (row: { id: number }) => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const saved = new Promise<{ id: number }>(resolve => { accepted = resolve; });
  const control = { lost: false, clientStopped: false };
  const handle = async (route: Route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    const row = await response.json() as { id: number };
    expect(Number.isSafeInteger(row.id)).toBe(true);
    accepted(row);
    await waiting;
    if (control.lost) {
      // A deliberate stop-waiting already aborted the intercepted browser
      // request. Only that known fixture abort may already be disposed.
      if (control.clientStopped) await route.abort('failed').catch(() => {});
      else await route.abort('failed');
    } else await route.fulfill({ response });
  };
  return { release, saved, control, handle };
}
function track(page: Page, kind: Kind, method: 'POST' | 'PUT') {
  const requests: string[] = [];
  page.on('request', request => {
    if (request.method() === method && new URL(request.url()).pathname === `/api/${plural(kind)}`) requests.push(request.url());
  });
  return requests;
}
async function discardWithoutQueuedReplay(button: Locator, form: Locator) {
  const formId = `synthetic-discard-${randomUUID()}`;
  await form.evaluate((element, id) => { element.id = id; }, formId);
  await button.evaluate((element, id) => {
    const oldForm = document.getElementById(id) as HTMLFormElement;
    (element as HTMLButtonElement).click();
    // A queued native intent targets the old form before/after React commits.
    // Before commit the lease is discarding; afterwards the draft is empty or
    // the editor disconnected. Neither can resend the old financial payload.
    oldForm.requestSubmit();
  }, formId);
}

for (const kind of ['income', 'expense'] as const) {
  test(`new ${kind}: one held POST, definite rejection retry, unknown stop-waiting and discard barrier`, async ({ page }) => {
    test.setTimeout(150_000);
    const user = await account(page);
    let held: ReturnType<typeof heldRealWrite> | undefined;
    try {
      const prefix = `SYNTHETIC-${kind}-${randomUUID()}`;
      await page.goto(`/dashboard?tab=${plural(kind)}&new=1`);
      const entry = page.locator(`#${kind}-entry`), form = entry.locator('form');
      await expect(entry).toBeVisible();
      const description = entry.getByLabel('Beschreibung', { exact: true });
      const writes = track(page, kind, 'POST');
      await fill(entry, `${prefix}-accepted`);
      if (kind === 'expense') await entry.locator('input[type="file"]').setInputFiles(receipt);
      held = heldRealWrite();
      await page.route(`**/api/${plural(kind)}`, held.handle, { times: 1 });
      await repeatSubmit(form);
      await held.saved;
      expect(writes).toHaveLength(1);
      expect(await count(kind, user.id, `${prefix}-accepted`)).toBe(1);
      await expect(form).toHaveAttribute('aria-busy', 'true');
      await expect(description).toBeDisabled();
      await expect(entry.getByRole('button', { name: 'Warten beenden / Liste prüfen', exact: true })).toBeEnabled();

      // The write is already committed, then both list-read attempts fail.
      const failList = (route: Route) => route.fulfill({ status: 503, json: { error: 'Synthetic read refresh failure after accepted write' } });
      await page.route(`**/api/${plural(kind)}?**`, failList);
      held.release();
      const readError = page.getByRole('alert').filter({ hasText: `${noun(kind)} konnten nicht geladen werden.` });
      await expect(readError).toBeVisible();
      await expect(description).toHaveValue('');
      await expect(description).toBeEnabled();
      await expect(entry.getByRole('alert')).toHaveCount(0);
      if (kind === 'expense') expect(await entry.locator('input[type="file"]').evaluate(element => (element as HTMLInputElement).files?.length)).toBe(0);
      expect(writes).toHaveLength(1);
      await page.unroute(`**/api/${plural(kind)}?**`, failList);
      await readError.getByRole('button', { name: 'Erneut laden', exact: true }).click();
      await expect(page.getByRole('button', { name: `${prefix}-accepted bearbeiten`, exact: true })).toBeVisible();

      // A real route validation failure is definite, not a synthetic success.
      await fill(entry, `${prefix}-retry`);
      await page.route(`**/api/${plural(kind)}`, async route => {
        const body = JSON.stringify({ description: `${prefix}-retry`, amount: {}, date: '2026-10-01' });
        const response = await route.fetch({ postData: body, headers: { ...route.request().headers(), 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) } });
        expect(response.status()).toBe(400);
        await route.fulfill({ response });
      }, { times: 1 });
      await form.locator('button[type="submit"]').click();
      await expect(entry.getByRole('alert')).toContainText('Ungültiger Betrag');
      await expect(description).toHaveValue(`${prefix}-retry`);
      await expect(description).toBeEnabled();
      expect(await count(kind, user.id, `${prefix}-retry`)).toBe(0);
      const retried = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/${plural(kind)}`);
      await form.locator('button[type="submit"]').click();
      expect((await retried).status()).toBe(200);
      await expect(description).toHaveValue('');
      expect(await count(kind, user.id, `${prefix}-retry`)).toBe(1);

      await fill(entry, `${prefix}-unknown`);
      if (kind === 'expense') await entry.locator('input[type="file"]').setInputFiles(receipt);
      held = heldRealWrite(); held.control.lost = true;
      await page.route(`**/api/${plural(kind)}`, held.handle, { times: 1 });
      await repeatSubmit(form); await held.saved;
      const beforeDiscard = writes.length;
      held.control.clientStopped = true;
      await entry.getByRole('button', { name: 'Warten beenden / Liste prüfen', exact: true }).click();
      held.release();
      await expect(entry.getByRole('alert')).toContainText('Speicherausgang unklar');
      await expect(entry.getByRole('alert')).toContainText('Nur das Warten im Browser wurde beendet');
      await expect(description).toHaveValue(`${prefix}-unknown`);
      await expect(description).toBeDisabled();
      expect(await count(kind, user.id, `${prefix}-unknown`)).toBe(1);
      const [freshUnknown] = await Promise.all([
        page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === `/api/${plural(kind)}`),
        entry.getByRole('button', { name: 'Liste aktualisieren (nur lesen)', exact: true }).click(),
      ]);
      expect(freshUnknown.status()).toBe(200);
      expect((await freshUnknown.json()).items.some((item: { description: string }) => item.description === `${prefix}-unknown`)).toBe(true);
      await expect(entry.getByRole('button', { name: 'Liste aktualisieren (nur lesen)', exact: true })).toBeEnabled();
      await expect(entry.getByRole('alert')).toContainText('Speicherausgang unklar');
      await form.evaluate(element => (element as HTMLFormElement).requestSubmit());
      await discardWithoutQueuedReplay(entry.getByRole('button', { name: 'Lokalen Entwurf verwerfen', exact: true }), form);
      await expect(description).toHaveValue(''); await expect(description).toBeEnabled();
      if (kind === 'expense') expect(await entry.locator('input[type="file"]').evaluate(element => (element as HTMLInputElement).files?.length)).toBe(0);
      await page.waitForLoadState('networkidle');
      expect(writes).toHaveLength(beforeDiscard);
      expect(await count(kind, user.id, `${prefix}-unknown`)).toBe(1);
      await fill(entry, `${prefix}-intentional-new`);
      await form.locator('button[type="submit"]').click();
      await expect(description).toHaveValue('');
      expect(await count(kind, user.id, `${prefix}-intentional-new`)).toBe(1);
    } finally { held?.release(); await cleanup(user.id); }
  });

  test(`duplicate/edit ${kind}: one real POST and unknown accepted PUT cannot be replayed by old editor`, async ({ page }) => {
    test.setTimeout(120_000);
    const user = await account(page);
    let held: ReturnType<typeof heldRealWrite> | undefined;
    try {
      const sourceDescription = `SYNTHETIC-source-${randomUUID()}`, duplicateDescription = `SYNTHETIC-duplicate-${randomUUID()}`;
      const source = await page.request.post(`/api/${plural(kind)}`, { data: { description: sourceDescription, amount: 12.34, date: '2026-10-01', taxRelevant: true } });
      expect(source.status()).toBe(200);
      await page.goto(`/dashboard?tab=${plural(kind)}`);
      await page.getByRole('button', { name: `${sourceDescription} duplizieren`, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: `${kind === 'income' ? 'Einnahme' : 'Ausgabe'} bearbeiten`, exact: true });
      await dialog.getByLabel('Beschreibung', { exact: true }).fill(duplicateDescription);
      const posts = track(page, kind, 'POST');
      held = heldRealWrite();
      await page.route(`**/api/${plural(kind)}`, held.handle, { times: 1 });
      await repeatSubmit(dialog.locator('form'));
      const duplicate = await held.saved;
      expect(posts).toHaveLength(1);
      expect(await count(kind, user.id, duplicateDescription)).toBe(1);
      await expect(dialog.getByRole('button', { name: 'Abbrechen', exact: true })).toBeDisabled();
      await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
      held.release(); await expect(dialog).toHaveCount(0);
      await page.getByRole('button', { name: `${duplicateDescription} bearbeiten`, exact: true }).click();
      await dialog.getByLabel('Betrag (€)', { exact: true }).fill('15.67');
      const puts = track(page, kind, 'PUT');
      held = heldRealWrite(); held.control.lost = true;
      await page.route(`**/api/${plural(kind)}`, held.handle, { times: 1 });
      await repeatSubmit(dialog.locator('form')); await held.saved;
      held.release();
      await expect(dialog.getByRole('alert')).toContainText('Speicherausgang unklar');
      await expect(dialog.getByLabel('Betrag (€)', { exact: true })).toHaveValue('15.67');
      await expect(dialog.getByLabel('Betrag (€)', { exact: true })).toBeDisabled();
      await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
      const [freshUnknown] = await Promise.all([
        page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === `/api/${plural(kind)}`),
        dialog.getByRole('button', { name: 'Liste aktualisieren (nur lesen)', exact: true }).click(),
      ]);
      expect(freshUnknown.status()).toBe(200);
      expect((await freshUnknown.json()).items.find((item: { id: number }) => item.id === duplicate.id)).toMatchObject({ amount: 15.67 });
      await expect(dialog.getByRole('button', { name: 'Liste aktualisieren (nur lesen)', exact: true })).toBeEnabled();
      await expect(dialog.getByRole('alert')).toContainText('Speicherausgang unklar');
      await discardWithoutQueuedReplay(dialog.getByRole('button', { name: 'Lokalen Entwurf verwerfen', exact: true }), dialog.locator('form'));
      await expect(dialog).toHaveCount(0); await page.waitForLoadState('networkidle');
      expect(puts).toHaveLength(1);
      const row = kind === 'income'
        ? await prisma.income.findUniqueOrThrow({ where: { id: duplicate.id } })
        : await prisma.expense.findUniqueOrThrow({ where: { id: duplicate.id } });
      expect(row.amount).toBe(15.67); expect(row.manualRecordRevision).toBe(1); expect(row.manualRecordState).toBe('RECORDED');
      expect(await count(kind, user.id, sourceDescription)).toBe(1);
    } finally { held?.release(); await cleanup(user.id); }
  });
}
