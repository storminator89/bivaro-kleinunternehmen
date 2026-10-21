import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';

// Runner-owned fixture only: no production accounts, originals, credentials or provider calls.
const password = 'SyntheticQueueOnly123!';
const original = (name: string, marker = name) => ({ name, mimeType: 'application/xml', buffer: Buffer.from(`<SyntheticOriginal>${marker}</SyntheticOriginal>`) });
const region = (page: Page) => page.locator('section[aria-labelledby="incoming-upload-heading"]');
const picker = (page: Page) => page.getByLabel('Foto, PDF- oder XML-Original auswählen', { exact: true });
async function user() {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  return prisma.user.create({ data: { email: `queue-${randomUUID()}@example.test`, name: 'Synthetic queue', password: await hashPassword(password), role: 'USER' } });
}
async function login(page: Page, email: string) {
  await page.goto('/login'); await page.getByLabel('E-Mail').fill(email); await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click(); await expect(page).toHaveURL(/\/dashboard/);
  await page.goto('/purchases'); await expect(picker(page)).toBeVisible();
}
async function noFinancialWrites(userId: string) {
  for (const count of await Promise.all([prisma.expense.count({ where: { userId } }), prisma.income.count({ where: { userId } }), prisma.invoice.count({ where: { userId } }), prisma.cashTransaction.count({ where: { userId } })])) expect(count).toBe(0);
}
function requestKey(body: string) { const key = body.match(/name="uploadRequestId"\r\n\r\n([^\r\n]+)/)?.[1]; expect(key).toMatch(/^[a-f0-9-]{36}$/); return key!; }
test.afterAll(async () => { await prisma.$disconnect(); });

test('bounded mixed selection, exact duplicate, unknown committed response and deliberate stable retry stay unposted', async ({ page }, testInfo) => {
  const owner = await user(); await page.setViewportSize({ width: 1440, height: 1000 }); await login(page, owner.email);
  const requests: Array<{ key: string; body: string }> = []; let dropped = false;
  await page.route('**/api/purchase-documents', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    const body = route.request().postDataBuffer()!.toString('utf8'); requests.push({ key: requestKey(body), body });
    expect(body).toContain('name="analysisMode"\r\n\r\nmanual');
    if (body.includes('interrupted.xml') && !dropped) {
      dropped = true; const response = await route.fetch(); expect(response.status()).toBe(201);
      await route.abort('failed'); // Commit happened; the browser intentionally never receives success.
    } else await route.continue();
  });
  const shared = original('first.xml', 'same exact synthetic bytes');
  await picker(page).setInputFiles([shared, { name: 'invalid.zip', mimeType: 'application/zip', buffer: Buffer.from('synthetic unsupported') }, { ...shared, name: 'renamed.xml' }, original('interrupted.xml'), original('remaining-after-unknown.xml')]);
  const queue = region(page).getByRole('list', { name: 'Upload-Warteschlange' });
  await expect(queue.getByRole('listitem')).toHaveCount(5); await expect(queue).toContainText('ZIP'); expect(requests).toHaveLength(0);
  await region(page).getByRole('button', { name: 'Auswahl hochladen', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(queue).toContainText('Ausgang unklar'); await expect(queue).toContainText('Bereits vorhanden');
  await expect(region(page).getByRole('button', { name: 'Verbleibende Originale hochladen', exact: true })).toBeEnabled();
  expect(requests).toHaveLength(3); expect(await prisma.purchaseDocument.count({ where: { userId: owner.id } })).toBe(2);
  await expect(page.getByRole('dialog')).toHaveCount(0); // A batch does not interrupt itself with review dialogs.
  const uncertain = queue.getByRole('listitem').filter({ hasText: 'interrupted.xml' });
  await uncertain.getByRole('button', { name: /Mit gleicher Anfrage abgleichen/ }).focus(); await page.keyboard.press('Enter');
  await expect(uncertain).toContainText('Bereits vorhanden'); await expect(uncertain).toBeFocused(); expect(requests).toHaveLength(4); expect(requests[3].key).toBe(requests[2].key);
  expect(await prisma.purchaseDocument.count({ where: { userId: owner.id } })).toBe(2);
  // Reconciliation did not start the waiting row. Continuing it is a separate explicit click.
  await region(page).getByRole('button', { name: 'Auswahl hochladen', exact: true }).click();
  await expect(queue.getByRole('listitem').filter({ hasText: 'remaining-after-unknown.xml' })).toContainText('Gespeichert');
  expect(requests).toHaveLength(5); expect(await prisma.purchaseDocument.count({ where: { userId: owner.id } })).toBe(3); await noFinancialWrites(owner.id);
  await page.setViewportSize({ width: 360, height: 800 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'light' });
  await region(page).scrollIntoViewIfNeeded(); await page.screenshot({ path: testInfo.outputPath('incoming-queue-mobile-390.png'), animations: 'disabled' });
  await region(page).getByRole('button', { name: 'Gespeicherte Belege prüfen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Offene Prüfung', exact: true })).toBeFocused();
  await queue.getByRole('button', { name: 'Gespeicherten Beleg prüfen', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(queue.getByRole('button', { name: 'Gespeicherten Beleg prüfen', exact: true }).first()).toBeFocused();
  // Selecting a new local queue never sends it; reload drops unsent bytes, not archived originals.
  await picker(page).setInputFiles([original('local-only.xml'), original('other-local.xml')]); expect(requests).toHaveLength(5);
  expect(await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => value.includes('local-only.xml')))).toBe(false);
  await page.reload(); await expect(region(page).getByRole('list', { name: 'Upload-Warteschlange' })).toHaveCount(0);
  await expect(region(page)).toContainText('Nach Neuladen ungesendete Dateien erneut auswählen');
  expect(await prisma.purchaseDocument.count({ where: { userId: owner.id } })).toBe(3); await noFinancialWrites(owner.id);
  // Bounds are evaluated before HTTP or content parsing. All fixtures are synthetic.
  await picker(page).setInputFiles(Array.from({ length: 21 }, (_, i) => original(`limit-${i}.xml`)));
  await expect(region(page).getByRole('alert')).toContainText('20'); expect(requests).toHaveLength(5);
  // Native Blob references share one synthetic 21 MiB backing store: no 105 MiB
  // base64 transport or HTTP body is created just to prove aggregate rejection.
  await picker(page).evaluate(node => {
    const bytes = new Uint8Array(21 * 1024 * 1024); bytes.set(new TextEncoder().encode('%PDF-1.4'));
    const blob = new Blob([bytes], { type: 'application/pdf' }); const files = new DataTransfer();
    for (let i = 0; i < 5; i++) files.items.add(new File([blob], `size-${i}.pdf`, { type: 'application/pdf' }));
    (node as HTMLInputElement).files = files.files; node.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(region(page).getByRole('alert')).toContainText('100 MiB'); expect(requests).toHaveLength(5);
  await expect(region(page).getByRole('button', { name: 'Original hochladen', exact: true })).toBeDisabled();
});

test('cancel after server commit stops later originals, ignores late response and reconciles without a second original', async ({ page }) => {
  const owner = await user(); await page.setViewportSize({ width: 1440, height: 1000 }); await login(page, owner.email);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let committed = false;
  const keys: string[] = [];
  await page.route('**/api/purchase-documents', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    keys.push(requestKey(route.request().postDataBuffer()!.toString('utf8')));
    if (keys.length !== 1) { await route.continue(); return; }
    const response = await route.fetch(); expect(response.status()).toBe(201); committed = true;
    await gate;
    try { await route.fulfill({ response }); } catch { /* The client deliberately aborted after durable commit. */ }
  });
  await picker(page).setInputFiles([original('committed-before-cancel.xml'), original('must-not-start.xml')]);
  await region(page).getByRole('button', { name: 'Auswahl hochladen', exact: true }).click(); await expect.poll(() => committed).toBe(true);
  await region(page).getByRole('button', { name: 'Abbrechen', exact: true }).focus(); await page.keyboard.press('Enter');
  release(); const queue = region(page).getByRole('list', { name: 'Upload-Warteschlange' });
  await expect(queue).toContainText('Ausgang unklar'); await expect(queue).toContainText('Abgebrochen · nicht gestartet');
  expect(keys).toHaveLength(1); expect(await prisma.purchaseDocument.count({ where: { userId: owner.id } })).toBe(1);
  await queue.getByRole('button', { name: /Mit gleicher Anfrage abgleichen/ }).click(); await expect(queue).toContainText('Bereits vorhanden');
  expect(keys).toHaveLength(2); expect(keys[1]).toBe(keys[0]);
  expect(await prisma.purchaseDocument.count({ where: { userId: owner.id } })).toBe(1); await noFinancialWrites(owner.id);
  await region(page).getByRole('button', { name: 'Auswahl leeren', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(picker(page)).toBeFocused(); await expect(queue).toHaveCount(0);
});

test('session expiry after two successes clears queue details and account change never exposes the old selection', async ({ page }) => {
  const owner = await user(), other = await user(); await page.setViewportSize({ width: 1440, height: 1000 }); await login(page, owner.email);
  let posts = 0;
  await page.route('**/api/purchase-documents', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    posts++;
    if (posts === 3) await route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }); else await route.continue();
  });
  await picker(page).setInputFiles(['one', 'two', 'expired', 'never'].map(name => original(`private-${name}.xml`)));
  await region(page).getByRole('button', { name: 'Auswahl hochladen', exact: true }).click();
  await expect(region(page).getByRole('alert')).toContainText('Sitzung ist abgelaufen');
  await expect(region(page).getByRole('list', { name: 'Upload-Warteschlange' })).toHaveCount(0); expect(posts).toBe(3);
  expect(await prisma.purchaseDocument.count({ where: { userId: owner.id } })).toBe(2); await noFinancialWrites(owner.id);
  await picker(page).setInputFiles([original('private-local-name.xml'), original('second-local.xml')]);
  await page.getByRole('button', { name: 'Benutzermenü öffnen', exact: true }).click(); await page.getByRole('menuitem', { name: 'Abmelden', exact: true }).click();
  await expect(page).not.toHaveURL(/\/purchases/); await login(page, other.email);
  await expect(region(page).getByRole('list', { name: 'Upload-Warteschlange' })).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Eingangsbelege', exact: true })).toHaveCount(0);
  await expect(page.getByText('private-local-name.xml', { exact: true })).toHaveCount(0);
  expect(await prisma.purchaseDocument.count({ where: { userId: other.id } })).toBe(0); await noFinancialWrites(other.id);
});
