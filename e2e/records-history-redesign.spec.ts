import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { prisma } from '../lib/prisma';
import { hashPassword } from '../lib/password';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';

// Source-only acceptance for the existing isolated browser harness. Not executed.
// The harness must supply its fresh synthetic DATABASE_URL; never a real dataset.
async function fixture(page: Page) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  await isolateSyntheticLoginIpBudget();
  const password = 'SyntheticRecordsHistory123!';
  const user = await prisma.user.create({ data: { email: `records-history-${randomUUID()}@example.test`, name: 'Synthetic records/history', password: await hashPassword(password), role: 'USER' } });
  const customer = await prisma.customer.create({ data: { userId: user.id, name: 'Synthetische Leistungsnotizen' } });
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(user.email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  const pdf = await PDFDocument.create(); pdf.addPage();
  const reminderNumber = `SYNTHETIC-RECORDS-${randomUUID().slice(0, 8)}`;
  const created = await page.request.post('/api/invoices', { data: {
    fileName: `${reminderNumber}.pdf`, invoiceNumber: reminderNumber, customerId: customer.id,
    totalAmount: 100, invoiceDate: '2026-09-01', dueDate: '2026-09-15',
    parsedData: { currency: 'EUR', taxMode: 'small-business' }, pdfBytes: await pdf.saveAsBase64(),
  } });
  expect(created.status()).toBe(200);
  const invoice = await created.json() as { id: number };
  expect((await page.request.put('/api/invoices', { data: { id: invoice.id, status: 'SENT' } })).ok()).toBe(true);
  const payment = await page.request.post(`/api/invoices/${invoice.id}/payments`, { data: {
    amount: '40.00', expectedPaidCents: '0', currency: 'EUR', source: 'MANUAL', paidAt: '2026-09-10',
    reference: 'Synthetic fixture only; not a real payment', idempotencyKey: randomUUID(),
  } });
  expect(payment.status()).toBe(201);
  const base = { userId: user.id, customerId: customer.id, serviceDate: new Date('2026-09-01') };
  await prisma.billingNote.create({ data: { ...base, description: 'SYNTHETISCH · Manuelle Dauer', durationMinutes: 90, quantity: 1.5, unit: 'Stunde' } });
  await prisma.billingNote.create({ data: { ...base, description: 'SYNTHETISCH · Menge ohne Dauer', quantity: 2, unit: 'Tag', invoiceId: invoice.id } });
  const before = await businessState(user.id);
  const unexpected: string[] = [];
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || (request.method() === 'POST' && path === '/api/reminders/preview')) return route.continue();
    unexpected.push(`${request.method()} ${path}`);
    await route.abort('blockedbyclient');
  });
  const unchanged = async () => { expect(unexpected).toEqual([]); expect(await businessState(user.id)).toEqual(before); };
  return { invoiceId: invoice.id, reminderNumber, customerId: customer.id, unchanged };
}

async function businessState(userId: string) {
  return {
    notes: await prisma.billingNote.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    invoices: await prisma.invoice.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    reminders: await prisma.reminder.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    payments: await prisma.paymentJournalEvent.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    income: await prisma.income.count({ where: { userId } }), expenses: await prisma.expense.count({ where: { userId } }),
    outbox: await prisma.emailOutbox.count({ where: { userId } }),
    noteAudit: await prisma.auditLog.count({ where: { userId, entityType: 'BillingNote' } }),
  };
}

async function settled(page: Page) {
  await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
  expect(await page.evaluate(() => document.fonts.check('400 14px Inter'))).toBe(true);
}
async function fits(page: Page) {
  await settled(page);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const dialog of await page.getByRole('dialog').all()) {
    await expect.poll(() => dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
}

async function capture(page: Page, name: string, theme: 'light' | 'dark', dialog?: Locator, bottomControl?: Locator) {
  const info = test.info(); expect(info.retry).toBe(0);
  await expect.poll(() => page.locator('html').evaluate((node, expected) => node.classList.contains(expected), theme)).toBe(true);
  await fits(page);
  const width = page.viewportSize()!.width;
  // Full-page screenshots cannot see hidden modal scroll content. Capture the
  // actual modal top and bottom explicitly and log every internal scroll offset.
  for (const position of dialog ? ['top', 'bottom'] as const : [null]) {
    if (dialog) await dialog.evaluate((root, position) => {
      for (const node of [root, ...root.querySelectorAll('*')]) {
        if (node instanceof HTMLElement && /auto|scroll/u.test(getComputedStyle(node).overflowY)) node.scrollTop = position === 'bottom' ? node.scrollHeight : 0;
      }
    }, position);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })); await settled(page);
    const surface = await page.evaluate(fullPage => ({ width: innerWidth, height: fullPage ? Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) : innerHeight, scrollY }), !dialog);
    const scroll = dialog ? await dialog.evaluate(root => [root, ...root.querySelectorAll('*')].filter(node => node instanceof HTMLElement && /auto|scroll/u.test(getComputedStyle(node).overflowY)).map(node => ({ top: node.scrollTop, height: node.clientHeight, scrollHeight: node.scrollHeight }))) : [];
    if (dialog) {
      expect(scroll.length).toBeGreaterThan(0);
      for (const item of scroll) expect(Math.abs(item.top - (position === 'bottom' ? item.scrollHeight - item.height : 0))).toBeLessThanOrEqual(1);
      const rootScroll = await dialog.evaluate(root => ({ top: root.scrollTop, height: root.clientHeight, scrollHeight: root.scrollHeight }));
      if (width === 390) {
        expect(rootScroll.scrollHeight).toBeGreaterThan(rootScroll.height);
        if (position === 'bottom') expect(rootScroll.top).toBeGreaterThan(0);
      }
      const anchor = position === 'top' ? dialog.getByRole('heading').first() : bottomControl!;
      await expect(anchor).toBeInViewport({ ratio: 1 });
      expect(await anchor.evaluate(node => {
        const box = node.getBoundingClientRect(), hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return hit !== null && (hit === node || node.contains(hit));
      })).toBe(true);
    }
    expect(surface.width * surface.height * 4).toBeLessThanOrEqual(16 * 1024 * 1024);
    const filename = `records-history-${name}${position ? `-${position}` : ''}-${theme}-${width}.png`;
    const png = await page.screenshot({ path: info.outputPath(filename), fullPage: !dialog, animations: 'disabled' });
    expect(png.length).toBeLessThanOrEqual(1024 * 1024);
    expect(png.readUInt32BE(16)).toBe(surface.width); expect(png.readUInt32BE(20)).toBe(surface.height);
    process.stdout.write(`Records history capture proof: ${JSON.stringify({ name: filename, ...surface, viewport: page.viewportSize(), position, scroll, fullPage: !dialog, pngWidth: png.readUInt32BE(16), pngHeight: png.readUInt32BE(20), encodedBytes: png.length, sha256: createHash('sha256').update(png).digest('hex') })}\n`);
  }
}

for (const width of [1440, 390]) for (const theme of ['light', 'dark'] as const) {
  test.describe(`${width}px ${theme} records/history`, () => {
    test.use({ viewport: { width, height: width === 1440 ? 1000 : 844 }, colorScheme: theme });
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    });

    test('history separates evidence and keeps URL filters and Back/Forward', async ({ page }) => {
      const { invoiceId, unchanged } = await fixture(page);
      await page.goto(`/history?invoiceId=${encodeURIComponent(String(invoiceId))}`);
      await expect(page.getByRole('heading', { name: 'Original und Korrektur', exact: true })).toBeVisible();
      await expect(page.getByText('Storno bedeutet nicht zurückgezahlt.', { exact: true })).toBeVisible();
      await expect(page.getByRole('list', { name: 'Dokumentbeziehungen', exact: true })).toBeVisible();
      await capture(page, 'history-evidence', theme);
      await page.getByLabel('Protokolliert ab (UTC)', { exact: true }).fill('2026-01-01');
      await page.getByRole('button', { name: 'Filter anwenden', exact: true }).click();
      await expect(page).toHaveURL(/from=2026-01-01/);
      await page.goBack();
      await expect(page.getByLabel('Protokolliert ab (UTC)', { exact: true })).toHaveValue('');
      await page.goForward();
      await expect(page.getByLabel('Protokolliert ab (UTC)', { exact: true })).toHaveValue('2026-01-01');
      await page.getByRole('button', { name: 'Filter zurücksetzen', exact: true }).click();
      await page.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Aktualisieren', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Original und Korrektur', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Alle Dokumente', exact: true }).click();
      await page.getByLabel('Rechnungs- oder Gutschriftnummer', { exact: true }).fill('NO-MATCH-HOSTED-ACCEPTANCE');
      await page.getByRole('button', { name: 'Suchen', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Keine passenden Dokumente', exact: true })).toBeVisible();
      await capture(page, 'history-empty', theme);
      await page.getByRole('button', { name: 'Suche zurücksetzen', exact: true }).click();
      await expect(page.getByLabel('Rechnungs- oder Gutschriftnummer', { exact: true })).toHaveValue('');
      await unchanged();
    });

    test('reminder review cancels, reopens and invalidates the confirmation on edit', async ({ page }) => {
      const { reminderNumber, unchanged } = await fixture(page);
      await page.goto('/dashboard/reminders');
      await expect(page.getByRole('heading', { name: 'Mahnwesen', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Hilfe zum Mahnwesen', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Die 4 Mahnstufen', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Hilfe zum Mahnwesen', exact: true }).click();
      const record = page.locator('article:visible, tr:visible').filter({ hasText: reminderNumber }).first();
      await expect(record).toBeVisible();
      await capture(page, 'reminder-queue', theme);
      const prepare = record.getByRole('button', { name: /Restbetrag prüfen|Zahlungserinnerung|Mahnung/ }).first();
      await prepare.click();
      let dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('button', { name: 'Mahnung intern erfassen', exact: true })).toBeDisabled();
      await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await prepare.click();
      dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Aktuellen Restbetrag prüfen und Entwurf laden', exact: true }).click();
      await expect(dialog.getByRole('region', { name: 'Geprüfter Mahnentwurf', exact: true })).toBeVisible();
      await dialog.getByRole('checkbox').check();
      await expect(dialog.getByRole('button', { name: 'Mahnung intern erfassen', exact: true })).toBeEnabled();
      await capture(page, 'reminder-confirmation', theme, dialog, dialog.getByRole('button', { name: 'Mahnung intern erfassen', exact: true }));
      await dialog.getByLabel('Hinweis im Entwurf (optional)', { exact: true }).fill('Synthetic review only; not sent or saved.');
      await expect(dialog.getByRole('region', { name: 'Geprüfter Mahnentwurf', exact: true })).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: 'Mahnung intern erfassen', exact: true })).toBeDisabled();
      await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await fits(page); await unchanged();
    });

    test('service ledger and explicit statement selection dismiss without mutation', async ({ page }) => {
      const { customerId, unchanged } = await fixture(page);
      await page.goto('/customers');
      const opener = page.locator(`[data-service-workbench-return="${customerId}"]:visible`).first();
      await opener.click();
      let dialog = page.getByRole('dialog', { name: /^Leistungsnotizen:/ });
      await expect(dialog.getByRole('heading', { name: 'Leistungsverlauf', exact: true })).toBeVisible();
      await expect(dialog.getByLabel('Summen der gefilterten Leistungen', { exact: true })).toBeVisible();
      await capture(page, 'service-ledger', theme, dialog, dialog.getByRole('link', { name: 'Im Rechnungseditor auswählen →', exact: true }));
      await dialog.getByLabel('Status', { exact: true }).selectOption('open');
      await dialog.getByRole('button', { name: 'Filter zurücksetzen', exact: true }).click();
      await dialog.getByRole('button', { name: 'Aufstellung', exact: true }).click();
      const statement = page.getByRole('dialog', { name: 'Leistungsaufstellung', exact: true });
      await expect(statement.getByRole('button', { name: 'Vorschau erstellen', exact: true })).toBeDisabled();
      await capture(page, 'statement-selection', theme, statement, statement.getByRole('button', { name: 'Abbrechen', exact: true }));
      await statement.getByRole('button', { name: 'Abbrechen', exact: true }).click();
      await expect(statement).toHaveCount(0);
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
      await opener.click();
      dialog = page.getByRole('dialog', { name: /^Leistungsnotizen:/ });
      await expect(dialog.getByLabel('Beschreibung', { exact: true })).toHaveValue('');
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await fits(page); await unchanged();
    });
  });
}
