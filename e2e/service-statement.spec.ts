import { expect, test, type Page, type Locator } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { prisma } from '../lib/prisma';
import { hashPassword } from '../lib/password';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';

async function fixture(page: Page) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  const password = 'SyntheticStatement123!';
  const user = await prisma.user.create({ data: { email: `statement-${randomUUID()}@example.test`, name: 'Synthetic statement', password: await hashPassword(password) } });
  const customer = await prisma.customer.create({ data: { userId: user.id, name: 'Synthetische Aufstellung', internalNote: 'INTERN NICHT AUSGEBEN', noteVisibility: 'BOTH' } });
  const empty = await prisma.customer.create({ data: { userId: user.id, name: 'Synthetisch ohne Leistungen' } });
  const project = await prisma.serviceProject.create({ data: { userId: user.id, customerId: customer.id, name: 'Archivierte Website', archivedAt: new Date() } });
  const invoice = await prisma.invoice.create({ data: { userId: user.id, customerId: customer.id, fileName: 'synthetic.pdf', storedFileName: 'synthetic.pdf', parsedData: {}, issuanceState: 'UNISSUED' } });
  const base = { userId: user.id, customerId: customer.id, serviceDate: new Date('2026-10-20') };
  const timed = await prisma.billingNote.create({ data: { ...base, description: 'SYNTHETISCH · Konzept', durationMinutes: 90, quantity: 1.5, unit: 'Stunde', projectId: project.id } });
  const legacy = await prisma.billingNote.create({ data: { ...base, description: 'SYNTHETISCH · Altnotiz', quantity: 2, unit: 'Tag', invoiceId: invoice.id } });
  await prisma.billingNote.createMany({ data: Array.from({ length: 26 }, (_, index) => ({ ...base, description: `SYNTHETISCH · Weitere ${String(index).padStart(2, '0')}`, quantity: 1, unit: 'Pauschal' })) });
  await page.goto('/login'); await page.getByLabel('E-Mail').fill(user.email); await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click(); await expect(page).toHaveURL(/\/dashboard/);
  return { userId: user.id, customer, empty, project, timed, legacy };
}

async function openWorkbench(page: Page, name: string) {
  await page.goto('/customers');
  await page.getByRole('button', { name: `Leistungsnotizen für ${name}`, exact: true }).click();
  const workbench = page.getByRole('dialog', { name: `Leistungsnotizen: ${name}`, exact: true });
  await expect(workbench.getByRole('button', { name: 'Aufstellung', exact: true })).toBeEnabled();
  return workbench;
}

async function dates(dialog: Locator) {
  await dialog.getByLabel('Aufstellung von', { exact: true }).fill('2026-10-01');
  await dialog.getByLabel('Aufstellung bis', { exact: true }).fill('2026-10-31');
}

async function downloadHash(page: Page, dialog: Locator) {
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('link', { name: 'PDF herunterladen', exact: true }).click()]);
  expect(download.suggestedFilename()).toMatch(/^Leistungsaufstellung-2026-10-01-2026-10-31\.pdf$/);
  const path = await download.path(); expect(path).not.toBeNull();
  const bytes = await readFile(path!); expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  return createHash('sha256').update(bytes).digest('hex');
}

async function untouched(userId: string) {
  return {
    notes: await prisma.billingNote.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    invoices: await prisma.invoice.findMany({ where: { userId } }),
    income: await prisma.income.count({ where: { userId } }), payments: await prisma.paymentJournalEvent.count({ where: { userId } }),
    expenses: await prisma.expense.count({ where: { userId } }), audit: await prisma.auditLog.count({ where: { userId, entityType: 'BillingNote' } }),
  };
}

test('explicit service statement has a frozen preview, safe retries, pagination, no writes, and responsive keyboard flow', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const { userId, customer, empty, project, timed, legacy } = await fixture(page);
  const before = await untouched(userId);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const workbench = await openWorkbench(page, customer.name);
  const trigger = workbench.getByRole('button', { name: 'Aufstellung', exact: true });
  await trigger.focus(); await page.keyboard.press('Enter');
  const statement = page.getByRole('dialog', { name: 'Leistungsaufstellung', exact: true });
  await expect(statement.getByText(/Keine Rechnung \/ keine Abnahmebestätigung/)).toBeVisible();
  await expect(statement.getByRole('button', { name: 'Vorschau erstellen', exact: true })).toBeDisabled();
  await dates(statement);
  await statement.getByLabel('Aufstellung bis', { exact: true }).fill('2026-09-30');
  await expect(statement.getByRole('alert')).toContainText('Beginn darf nicht nach Ende liegen.');
  await statement.getByLabel('Aufstellung bis', { exact: true }).fill('2026-10-31');
  await expect(statement.getByRole('navigation', { name: 'Seiten der Leistungsauswahl' })).toContainText('Seite 1 / 2');
  await statement.getByRole('button', { name: 'Nächste', exact: true }).click();
  await expect(statement.getByRole('navigation')).toContainText('Seite 2 / 2');
  await statement.getByRole('button', { name: 'Vorherige', exact: true }).click();
  await expect(statement.getByRole('navigation')).toContainText('Seite 1 / 2');
  await statement.getByRole('button', { name: 'Nächste', exact: true }).click();
  await statement.getByRole('checkbox', { name: /SYNTHETISCH · Konzept/ }).check();
  await statement.getByRole('checkbox', { name: /SYNTHETISCH · Altnotiz/ }).check();
  const approval = statement.getByRole('checkbox', { name: /Beschreibungen im PDF übernehmen/ });
  await approval.focus(); await page.keyboard.press('Space');
  await page.route('**/api/billing-notes/statement', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetischer Exportfehler' }) }), { times: 1 });
  await statement.getByRole('button', { name: 'Vorschau erstellen', exact: true }).click();
  await expect(statement.getByRole('alert')).toContainText('Synthetischer Exportfehler');
  await expect(approval).toBeChecked();
  await page.route('**/api/billing-notes/statement', route => route.fulfill({ status: 502, contentType: 'text/html', body: '<html>Synthetic gateway failure</html>' }), { times: 1 });
  await statement.getByRole('button', { name: 'Vorschau erstellen', exact: true }).click();
  await expect(statement.getByRole('alert')).toContainText('Aufstellung konnte nicht erstellt werden. Bitte erneut versuchen.');
  await expect(approval).toBeChecked();
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/billing-notes/statement' && response.ok());
  await statement.getByRole('button', { name: 'Vorschau erstellen', exact: true }).click();
  const result = await (await responsePromise).json();
  expect(result.snapshot.rows.map((row: { id: number }) => row.id)).toEqual([timed.id, legacy.id]);
  expect(result.snapshot.totals).toEqual({ durationMinutes: 90, quantityOnlyCount: 1 });
  expect(JSON.stringify(result.snapshot)).not.toContain('INTERN NICHT AUSGEBEN');
  await expect(statement.getByRole('heading', { name: 'Vorschau bereit' })).toBeFocused();
  await expect(statement.locator('dl')).toContainText('90 Minuten');
  const pdfLink = statement.getByRole('link', { name: 'PDF herunterladen', exact: true });
  const previewLink = statement.getByRole('link', { name: 'Dateivorschau öffnen', exact: true });
  const frozenUrl = await pdfLink.getAttribute('href');
  expect(await previewLink.getAttribute('href')).toBe(frozenUrl);
  const [previewPage] = await Promise.all([page.waitForEvent('popup'), previewLink.click()]);
  await expect.poll(() => previewPage.url()).toBe(frozenUrl);
  await previewPage.close();
  const hash = await downloadHash(page, statement);
  expect(await downloadHash(page, statement)).toBe(hash);
  expect(await untouched(userId)).toEqual(before);
  for (const width of [1440, 360, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await statement.evaluate(element => element.scrollTo({ top: 0, behavior: 'instant' }));
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect.poll(() => statement.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await pdfLink.scrollIntoViewIfNeeded();
    await expect(pdfLink).toBeInViewport();
    await expect(statement.getByRole('heading', { name: 'Vorschau bereit' })).toBeInViewport();
    if (width !== 360) await page.screenshot({ path: testInfo.outputPath(`service-statement-preview-${width}.png`), fullPage: false });
  }
  // A real source update never changes the already reviewed/downloaded file.
  await prisma.billingNote.update({ where: { id: timed.id }, data: { description: 'SYNTHETISCH · Neues Konzept' } });
  expect(await downloadHash(page, statement)).toBe(hash);
  await statement.getByRole('button', { name: 'Auswahl ändern', exact: true }).click();
  await expect(statement.getByRole('button', { name: 'Vorschau erstellen', exact: true })).toBeDisabled();
  await statement.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(trigger).toBeFocused();
  await workbench.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
  await expect(workbench.getByRole('heading', { name: 'SYNTHETISCH · Neues Konzept', exact: true })).toBeVisible();
  await trigger.click(); await dates(statement);
  await statement.getByLabel('Projekt der Aufstellung', { exact: true }).selectOption(String(project.id));
  await statement.getByRole('checkbox', { name: /SYNTHETISCH · Neues Konzept/ }).check();
  await approval.check();
  await statement.getByRole('button', { name: 'Vorschau erstellen', exact: true }).click();
  await expect(statement.getByText(/Archivierte Website · archiviert/)).toBeVisible();
  expect(await downloadHash(page, statement)).not.toBe(hash);
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await page.reload();
  await page.getByRole('button', { name: `Leistungsnotizen für ${empty.name}`, exact: true }).click();
  const emptyWorkbench = page.getByRole('dialog', { name: `Leistungsnotizen: ${empty.name}`, exact: true });
  await emptyWorkbench.getByRole('button', { name: 'Aufstellung', exact: true }).click();
  await dates(statement);
  await expect(statement.getByText('Keine passenden Leistungen. Bitte Filter anpassen.', { exact: true })).toBeVisible();
  await expect(statement.getByRole('button', { name: 'Vorschau erstellen', exact: true })).toBeDisabled();
  await statement.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  const after = await untouched(userId);
  expect(after).toEqual({ ...before, notes: before.notes.map(note => note.id === timed.id ? { ...note, description: 'SYNTHETISCH · Neues Konzept', updatedAt: after.notes.find(row => row.id === timed.id)!.updatedAt } : note) });
});
