import { expect, test, type Page, type Locator } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';

async function expectUnobscuredService(node: Locator, textOnly = false) {
  await expect.poll(() => node.evaluate((element, textOnly) => {
    const range = window.document.createRange(); range.selectNodeContents(element);
    const rect = textOnly ? range.getBoundingClientRect() : element.getBoundingClientRect();
    const dialog = element.closest('[role="dialog"]')?.getBoundingClientRect();
    const visibleHeaderBottom = Math.max(0, ...Array.from(window.document.querySelectorAll('.app-topbar')).map(header => header.getBoundingClientRect()).filter(header => header.width > 0 && header.height > 0).map(header => header.bottom));
    const top = dialog ? Math.max(0, dialog.top) + 8 : visibleHeaderBottom + 8;
    const bottom = dialog ? Math.min(window.innerHeight, dialog.bottom) - 8 : window.innerHeight - 8;
    const left = dialog ? Math.max(0, dialog.left) + 8 : 8;
    const right = dialog ? Math.min(window.innerWidth, dialog.right) - 8 : window.innerWidth - 8;
    if (rect.width <= 0 || rect.height <= 0 || rect.top < top || rect.bottom > bottom || rect.left < left || rect.right > right) return false;
    const insetX = Math.min(8, rect.width / 4), insetY = Math.min(8, rect.height / 4);
    const points = [[rect.left + insetX, rect.top + insetY], [rect.right - insetX, rect.top + insetY], [rect.left + insetX, rect.bottom - insetY], [rect.right - insetX, rect.bottom - insetY], [rect.left + rect.width / 2, rect.top + rect.height / 2]];
    return points.every(([x, y]) => {
      const hit = window.document.elementFromPoint(x, y);
      return hit !== null && (hit === element || element.contains(hit));
    });
  }, textOnly)).toBe(true);
}

// Authored acceptance only. Use the supported isolated hosted runner; never run
// against a real tenant or the repository database. No mail provider is needed.
async function account(page: Page) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  const password = 'SyntheticServicePlan123!';
  const user = await prisma.user.create({ data: { email: `service-plan-${randomUUID()}@example.test`, name: 'Synthetic service planning', password: await hashPassword(password) } });
  const customer = await prisma.customer.create({ data: { userId: user.id, name: 'Synthetische Servicekundin', address: 'Testweg 1', zipCode: '00123', city: 'Musterstadt' } });
  await page.goto('/login'); await page.getByLabel('E-Mail').fill(user.email); await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click(); await expect(page).toHaveURL(/\/dashboard/);
  return { userId: user.id, customerId: customer.id };
}
async function cleanup(userId: string) {
  await prisma.serviceBillingPeriod.deleteMany({ where: { userId } }); await prisma.serviceBillingPlan.deleteMany({ where: { userId } });
  await prisma.invoice.deleteMany({ where: { userId } }); await prisma.serviceArticle.deleteMany({ where: { userId } });
  await prisma.auditLog.deleteMany({ where: { userId } }); await prisma.settings.deleteMany({ where: { userId } });
  await prisma.customer.deleteMany({ where: { userId } }); await prisma.user.delete({ where: { id: userId } });
}
async function noFinancialSideEffects(userId: string, invoiceCount: number) {
  expect(await prisma.invoice.count({ where: { userId } })).toBe(invoiceCount);
  expect(await prisma.invoice.count({ where: { userId, OR: [{ status: { not: 'DRAFT' } }, { issuanceState: { not: 'UNISSUED' } }, { invoiceNumber: { not: null } }, { paidAt: { not: null } }] } })).toBe(0);
  expect(await prisma.income.count({ where: { userId } })).toBe(0);
  expect(await prisma.expense.count({ where: { userId } })).toBe(0);
  expect(await prisma.paymentJournalEvent.count({ where: { userId } })).toBe(0);
  expect(await prisma.auditLog.count({ where: { userId, action: { in: ['EMAIL_SENT', 'PAYMENT_RECEIVED'] } } })).toBe(0);
}
async function viewport(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  expect(await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))).toEqual({ width, height });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('reviews one recurring period, recovers lost responses, edits the same draft and never issues or books', async ({ page }, testInfo) => {
  test.setTimeout(120_000); const { userId, customerId } = await account(page);
  try {
    await prisma.serviceArticle.create({ data: { userId, name: 'Synthetische IT-Betreuung', nameKey: 'synthetische it-betreuung', description: 'Synthetischer Wartungsservice', unit: 'Stunde', unitPriceCents: '4500', sourcePriceCents: '4500', sourcePriceBasis: 'NET', taxRate: '19' } });
    await viewport(page, 390, 844); await page.goto('/dashboard?tab=invoices');
    const servicePlanEntry = page.getByRole('link', { name: 'Servicepläne öffnen', exact: true });
    await expect(servicePlanEntry).toHaveAttribute('href', '/service-billing');
    await servicePlanEntry.click(); await expect(page).toHaveURL(/\/service-billing$/);
    await expect(page.getByRole('heading', { name: 'Wiederkehrende Leistungen einmal vorbereiten', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Ersten Serviceplan anlegen', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Neuer Serviceplan', exact: true });
    await form.getByLabel('Planname', { exact: true }).fill('SYNTHETISCH · IT-Betreuung monatlich');
    await form.getByLabel('Kunde', { exact: true }).selectOption(String(customerId));
    await form.getByLabel('Beginn des ersten Zeitraums', { exact: true }).fill('2000-01-31');
    await form.getByLabel('Steuer-Modus des Plans', { exact: true }).selectOption('standard');
    await form.getByRole('button', { name: 'Aus Artikelkatalog übernehmen', exact: true }).click();
    await form.getByRole('button', { name: 'Synthetische IT-Betreuung als Position übernehmen', exact: true }).click();
    await expect(form.getByLabel('Leistungsbeschreibung 1', { exact: true })).toHaveValue('Synthetischer Wartungsservice');
    await form.getByLabel('Menge 1', { exact: true }).fill('2');
    await expect(form.getByLabel('Netto-Preis 1 (€)', { exact: true })).toHaveValue('45.00');
    let createLost = false;
    await page.route('**/api/service-billing', async route => {
      if (route.request().method() === 'POST' && !createLost) { createLost = true; await route.fetch(); await route.abort('failed'); }
      else await route.continue();
    });
    await form.getByRole('button', { name: 'Serviceplan speichern', exact: true }).click();
    await expect(form.getByRole('alert')).toBeVisible();
    expect(await prisma.serviceBillingPlan.count({ where: { userId } })).toBe(1);
    await expect(form.getByLabel('Planname', { exact: true })).toHaveValue('SYNTHETISCH · IT-Betreuung monatlich');
    await form.getByRole('button', { name: 'Serviceplan speichern', exact: true }).click(); await expect(form).toBeHidden();
    expect(await prisma.serviceBillingPlan.count({ where: { userId } })).toBe(1); await noFinancialSideEffects(userId, 0);
    const stored = await prisma.serviceBillingPlan.findFirstOrThrow({ where: { userId } });
    const card = page.getByRole('article', { name: 'Serviceplan SYNTHETISCH · IT-Betreuung monatlich', exact: true });
    await expect(card.getByText('31.01.2000 – 28.02.2000', { exact: true })).toBeVisible();
    await expect(card).toContainText('Keine automatische Nachholung.');
    await card.getByRole('button', { name: 'Entwurf vorbereiten', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Einen Rechnungsentwurf vorbereiten?', exact: true });
    await expect(review.getByRole('button', { name: 'Nur diesen Entwurf anlegen', exact: true })).toBeDisabled();
    await review.getByRole('button', { name: 'Abbrechen', exact: true }).click(); await expect(review).toBeHidden();
    await noFinancialSideEffects(userId, 0);
    await card.getByRole('button', { name: 'Entwurf vorbereiten', exact: true }).click();
    await expect(review).toContainText('Ohne Rechnungsnummer, Versand, Zahlung oder Einnahme.');
    await review.getByRole('checkbox').check(); await viewport(page, 390, 844);
    await review.evaluate(node => node.scrollTo({ top: 0, behavior: 'instant' }));
    await expectUnobscuredService(review.getByRole('heading', { name: 'Einen Rechnungsentwurf vorbereiten?', exact: true }), true);
    const reviewedPlan = review.getByText('SYNTHETISCH · IT-Betreuung monatlich', { exact: true });
    const reviewCore = reviewedPlan.locator('..');
    await reviewCore.evaluate(node => {
      const dialog = node.closest('[role="dialog"]');
      if (!dialog) throw new Error('Expected service review dialog');
      dialog.scrollBy({ top: node.getBoundingClientRect().top - dialog.getBoundingClientRect().top - 24, behavior: 'instant' });
    });
    // A normal viewport captures the reviewed period/amount and no-financial-effect warning.
    for (const value of [reviewedPlan, review.getByText('Synthetische Servicekundin', { exact: true }), review.getByText('31.01.2000 – 28.02.2000', { exact: true }), review.locator('p.tabular-nums').filter({ hasText: '107,10 €' }), review.locator('p').filter({ hasText: /^Ohne Rechnungsnummer, Versand, Zahlung oder Einnahme\./ })]) await expectUnobscuredService(value, true);
    await page.screenshot({ path: testInfo.outputPath('service-plan-review-mobile-390.png'), fullPage: false });
    // Long review content is checked by real scrolling, never hidden or resized for capture.
    for (const control of [review.getByRole('checkbox'), review.getByRole('button', { name: 'Nur diesen Entwurf anlegen', exact: true }), review.getByRole('button', { name: 'Abbrechen', exact: true })]) {
      await control.scrollIntoViewIfNeeded(); await expectUnobscuredService(control);
    }
    let generationLost = false;
    await page.route('**/api/service-billing/period', async route => {
      if (route.request().method() === 'POST' && !generationLost) { generationLost = true; await route.fetch(); await route.abort('failed'); }
      else await route.continue();
    });
    await review.getByRole('button', { name: 'Nur diesen Entwurf anlegen', exact: true }).click(); await expect(review.getByRole('alert')).toBeVisible();
    await noFinancialSideEffects(userId, 1);
    await review.getByRole('button', { name: 'Nur diesen Entwurf anlegen', exact: true }).focus(); await page.keyboard.press('Enter'); await expect(review).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'es wurde nichts doppelt erzeugt' })).toBeVisible();
    const period = await prisma.serviceBillingPeriod.findUniqueOrThrow({ where: { planId_periodIndex: { planId: stored.id, periodIndex: 0 } } });
    expect(period.invoiceId).not.toBeNull(); expect(await prisma.serviceBillingPeriod.count({ where: { userId } })).toBe(1);
    expect((await prisma.serviceBillingPlan.findUniqueOrThrow({ where: { id: stored.id } })).nextPeriod).toBe(1);
    const draftId = period.invoiceId!;
    await page.getByRole('link', { name: 'Vorhandenen Entwurf bearbeiten', exact: true }).click(); await expect(page).toHaveURL(new RegExp(`/dashboard/invoices/new\\?draftId=${draftId}$`));
    await expect(page.locator('#invoice-item-description-0')).toHaveValue('Synthetischer Wartungsservice');
    await expect(page.getByRole('note').filter({hasText:'Leistungsnotizen können in Serviceentwürfen nicht übernommen werden'})).toBeVisible();
    await expect(page.getByText('Leistungsnotizen übernehmen',{exact:true})).toHaveCount(0);
    await page.locator('#invoice-item-description-0').fill('Synthetisch geprüft und im selben Entwurf bearbeitet');
    await page.getByRole('button', { name: 'Entwurf speichern', exact: true }).click();
    await expect(page.getByText('Entwurf gespeichert. Keine Rechnungsdatei erstellt oder versendet.', { exact: true })).toBeVisible();
    await page.reload(); await expect(page.locator('#invoice-item-description-0')).toHaveValue('Synthetisch geprüft und im selben Entwurf bearbeitet');
    await noFinancialSideEffects(userId, 1);
    const savedDraft = await prisma.invoice.findUniqueOrThrow({ where: { id: draftId } });
    expect(savedDraft.storedFileName).toBe(''); expect(savedDraft.invoiceDate).toBeNull();
    await page.goto('/dashboard?tab=invoices');
    await page.getByRole('button', { name: `Weitere Aktionen fuer Rechnung ${draftId}`, exact: true }).filter({ visible: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Entwurf bearbeiten', exact: true })).toHaveAttribute('href', `/dashboard/invoices/new?draftId=${draftId}`);
    await expect(page.getByRole('menuitem', { name: 'Per E-Mail senden', exact: true })).toBeDisabled();
    await expect(page.getByRole('menuitem', { name: 'Rechnung stornieren', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.goto('/service-billing');
    await card.getByRole('button', { name: 'Plan pausieren', exact: true }).click(); await expect(card.getByRole('button', { name: 'Plan fortsetzen', exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Entwurf vorbereiten', exact: true })).toBeDisabled();
    await page.reload(); await expect(card.getByText('Pausiert', { exact: true })).toBeVisible(); await noFinancialSideEffects(userId, 1);
    expect((await prisma.serviceBillingPlan.findUniqueOrThrow({ where: { id: stored.id } })).nextPeriod).toBe(1);
    await card.getByRole('button', { name: 'Plan fortsetzen', exact: true }).click(); await expect(card.getByRole('button', { name: 'Entwurf vorbereiten', exact: true })).toBeEnabled();
    await noFinancialSideEffects(userId, 1);
    await card.getByRole('button', { name: 'Zeitraum überspringen', exact: true }).click();
    const skipping = page.getByRole('dialog', { name: 'Diesen Zeitraum überspringen?', exact: true });
    await skipping.getByRole('checkbox').check(); await skipping.getByRole('button', { name: 'Nur diesen Zeitraum überspringen', exact: true }).click(); await expect(skipping).toBeHidden();
    expect((await prisma.serviceBillingPlan.findUniqueOrThrow({ where: { id: stored.id } })).nextPeriod).toBe(2);
    expect(await prisma.serviceBillingPeriod.count({ where: { userId } })).toBe(2); await noFinancialSideEffects(userId, 1);
    await card.getByRole('button', { name: 'Plan bearbeiten', exact: true }).click();
    const editing = page.getByRole('dialog', { name: 'Serviceplan bearbeiten', exact: true });
    await expect(editing.getByLabel('Rhythmus', { exact: true })).toHaveCount(0);
    await editing.getByLabel('Netto-Preis 1 (€)', { exact: true }).fill('99.00');
    await editing.getByRole('button', { name: 'Serviceplan speichern', exact: true }).click(); await expect(editing).toBeHidden();
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: draftId } })).parsedData).toEqual(savedDraft.parsedData);
    await card.locator('summary').click(); await viewport(page, 1440, 1000);
    const existingDraftLink = card.getByRole('link', { name: 'Entwurf bearbeiten', exact: true });
    await expect(existingDraftLink).toHaveAttribute('href', `/dashboard/invoices/new?draftId=${draftId}`);
    await card.evaluate(node => {
      const headerBottom = Math.max(0, ...Array.from(window.document.querySelectorAll('.app-topbar')).map(header => header.getBoundingClientRect()).filter(header => header.width > 0 && header.height > 0).map(header => header.bottom));
      window.scrollTo({ top: window.scrollY + node.getBoundingClientRect().top - headerBottom - 24, behavior: 'instant' });
    });
    for (const value of [card.getByRole('heading', { name: 'SYNTHETISCH · IT-Betreuung monatlich', exact: true }), card.locator('p.tabular-nums').filter({ hasText: '235,62 €' }), card.getByText('31.03.2000 – 29.04.2000', { exact: true }), card.getByText('Bewusst übersprungen · keine Rechnung', { exact: true })]) await expectUnobscuredService(value, true);
    for (const control of [card.getByRole('button', { name: 'Entwurf vorbereiten', exact: true }), card.getByRole('button', { name: 'Plan bearbeiten', exact: true }), card.getByRole('button', { name: 'Plan pausieren', exact: true }), existingDraftLink]) await expectUnobscuredService(control);
    await page.screenshot({ path: testInfo.outputPath('service-plan-workspace-desktop-1440.png'), fullPage: false });
    expect((await prisma.settings.findUnique({ where: { userId } }))?.fiscalTaxRegime ?? 'UNSET').toBe('UNSET');
    await noFinancialSideEffects(userId, 1);
  } finally { await cleanup(userId); }
});

test('keeps error inputs, rejects stale edits and leaves future periods read-only', async ({ page }) => {
  test.setTimeout(90_000); const { userId, customerId } = await account(page);
  try {
    const created = await page.request.post('/api/service-billing', { data: { requestId: randomUUID(), name: 'SYNTHETISCH · Jahreswartung', customerId, cadence: 'YEARLY', anchorDate: '9998-02-28', taxMode: 'small-business', items: [{ description: 'Synthetische Jahreswartung', quantity: 1, unitPrice: 12.34, unit: 'Pauschal', taxRate: 0, taxCategory: 'E' }] } });
    expect(created.status()).toBe(201); const { id } = await created.json();
    await viewport(page, 390, 844); await page.goto('/service-billing');
    const card = page.getByRole('article', { name: 'Serviceplan SYNTHETISCH · Jahreswartung', exact: true });
    await expect(card.getByRole('button', { name: 'Entwurf vorbereiten', exact: true })).toBeDisabled();
    await expect(card).toContainText('Der Zeitraum beginnt in der Zukunft.');
    await card.getByRole('button', { name: 'Plan bearbeiten', exact: true }).click();
    const editing = page.getByRole('dialog', { name: 'Serviceplan bearbeiten', exact: true });
    await editing.getByLabel('Planname', { exact: true }).fill('Unbestätigte synthetische Änderung'); await page.keyboard.press('Escape'); await expect(editing).toBeHidden();
    await card.getByRole('button', { name: 'Plan bearbeiten', exact: true }).click();
    await expect(editing.getByLabel('Planname', { exact: true })).toHaveValue('SYNTHETISCH · Jahreswartung');
    const current = await prisma.serviceBillingPlan.findUniqueOrThrow({ where: { id } });
    expect((await page.request.patch('/api/service-billing', { data: { id, revision: current.revision, name: 'SYNTHETISCH · Anderer Editor' } })).status()).toBe(200);
    await editing.getByLabel('Planname', { exact: true }).fill('Synthetische veraltete Änderung');
    await editing.getByRole('button', { name: 'Serviceplan speichern', exact: true }).click(); await expect(editing.getByRole('alert')).toContainText('Plan wurde geändert');
    await expect(editing.getByLabel('Planname', { exact: true })).toHaveValue('Synthetische veraltete Änderung');
    await editing.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    await page.route('**/api/service-billing', async route => { if (route.request().method() === 'GET') await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetische Ladeunterbrechung' }) }); else await route.continue(); }, { times: 1 });
    await page.getByRole('button', { name: 'Aktualisieren', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('Synthetische Ladeunterbrechung');
    await expect(page.getByRole('button', { name: 'Entwurf vorbereiten', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Aktuellen Stand erneut laden', exact: true }).click();
    await expect(page.getByRole('article', { name: 'Serviceplan SYNTHETISCH · Anderer Editor', exact: true })).toBeVisible();
    await noFinancialSideEffects(userId, 0);
  } finally { await cleanup(userId); }
});
