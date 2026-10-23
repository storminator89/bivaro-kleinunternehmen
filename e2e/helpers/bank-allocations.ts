import { expect, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../../lib/password';
import { prisma } from '../../lib/prisma';
import { e2eDatabasePath } from '../../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './synthetic-login';
import { readPaymentAdjustmentPreflight } from '../../lib/payment-adjustment-form';
import { readBankAllocationRowEnvelope } from '../../lib/bank-allocation-client';

// Hosted acceptance only. Seed synthetic identity/master data, not payment
// successes or issued invoices. Documents and money use the real UI/routes.
export async function bankAllocationAccount(page: Page) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  await isolateSyntheticLoginIpBudget();
  const password = 'SyntheticBankAllocation123!';
  const user = await prisma.user.create({ data: {
    email: `bank-allocation-${randomUUID()}@example.test`,
    name: 'SYNTHETISCH · Bankzuordnung', role: 'USER', password: await hashPassword(password),
  } });
  await prisma.settings.create({ data: {
    userId: user.id, companyName: 'SYNTHETISCH · QA Dienstleistungen',
    companyAddress: 'Teststraße 1\n10115 Berlin', email: 'issuer@example.test',
    telephone: '+49 000 000', taxNumber: '123/456/78901',
    iban: 'DE89370400440532013000', bic: 'COBADEFFXXX', bankName: 'Synthetische Testbank',
    fiscalTaxRegime: 'SMALL_BUSINESS', fiscalEffectiveFrom: '2020-01-01',
    fiscalConfirmedAt: new Date('2026-01-01T12:00:00Z'),
  } });
  const customer = await prisma.customer.create({ data: {
    userId: user.id, name: 'SYNTHETISCH · Auftraggeber', address: 'Kundenweg 2',
    zipCode: '10115', city: 'Berlin', email: 'buyer@example.test',
  } });
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(user.email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/u);
  return { userId: user.id, customerId: customer.id };
}

export async function issueAllocationInvoice(page: Page, userId: string, customerId: number, number: string) {
  const nextNumber = page.waitForResponse(response => new URL(response.url()).pathname === '/api/invoices/next-number');
  await page.goto('/dashboard/invoices/new');
  expect((await nextNumber).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Neue Rechnung', exact: true })).toBeVisible();
  await page.getByLabel('Gespeicherten Kunden auswählen', { exact: true }).selectOption(String(customerId));
  await page.locator('#invoice-number').fill(number);
  await page.getByLabel('Rechnungsdatum', { exact: true }).fill('2026-01-01');
  await page.locator('#due-date').fill('2026-01-15');
  await page.locator('#delivery-date').fill('2026-01-01');
  await expect(page.getByLabel('Umsatzsteuer', { exact: true })).toHaveValue('small-business');
  await page.locator('#invoice-item-description-0').fill('Synthetische Leistung für die Zuordnungsprüfung');
  await page.locator('#invoice-item-quantity-0').fill('1');
  await page.locator('#invoice-item-price-0').fill('120.00');
  await expect(page.getByRole('complementary', { name: 'Rechnungsübersicht' })).toContainText('120,00');
  const rendered = page.waitForResponse(response => new URL(response.url()).pathname === '/api/invoices/render' && response.request().method() === 'POST' && response.request().postDataJSON().preview === false, { timeout: 90_000 });
  const uploaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/invoices/upload' && response.request().method() === 'POST', { timeout: 100_000 });
  const downloaded = page.waitForEvent('download', { timeout: 110_000 });
  void uploaded.catch(() => undefined); void downloaded.catch(() => undefined);
  await page.getByRole('button', { name: 'PDF erstellen', exact: true }).click();
  const final = await rendered;
  expect(final.status(), final.ok() ? '' : await final.text()).toBe(200);
  const upload = await uploaded;
  expect(upload.status(), upload.ok() ? '' : await upload.text()).toBe(200);
  const saved = await upload.json() as { id: number };
  expect(await (await downloaded).failure()).toBeNull();
  // A generated/uploaded PDF is not automatically an issued invoice. Complete
  // the real dashboard lifecycle; never patch status or issuance in the fixture.
  await expect(page).toHaveURL(/\/dashboard\?tab=invoices/u);
  await page.locator(`button[data-invoice-payment-return="${saved.id}"]:visible`).click();
  const sent = page.waitForResponse(response => new URL(response.url()).pathname === '/api/invoices' && response.request().method() === 'PUT');
  await page.getByRole('menuitem', { name: 'Gesendet', exact: true }).click();
  expect((await sent).status()).toBe(200);
  await expect.poll(() => prisma.invoice.count({ where: { userId, invoiceNumber: number, issuanceState: 'ISSUED' } })).toBe(1);
  const invoice = await prisma.invoice.findFirstOrThrow({ where: { userId, invoiceNumber: number } });
  expect(invoice).toMatchObject({ id: saved.id, customerId, status: 'SENT', issuanceState: 'ISSUED', totalAmount: 120 });
  return invoice;
}

export async function saveAllocationRow(page: Page, userId: string, reference: string) {
  await page.goto('/bank-csv');
  const csv = `Datum;Betrag;Währung;Gegenpartei;Verwendungszweck;Umsatz-ID\n01.02.2026;40,00;EUR;SYNTHETISCH;${reference};${randomUUID()}`;
  await page.getByLabel('Bank-CSV auswählen', { exact: true }).setInputFiles({
    name: 'synthetic-bank-allocation.csv', mimeType: 'text/csv', buffer: Buffer.from(csv),
  });
  await page.getByLabel('Kontoalias *', { exact: true }).fill('Synthetisches QA-Konto');
  await page.getByRole('button', { name: 'Vorschau prüfen', exact: true }).click();
  await page.getByLabel(/Ich habe Kontoalias, Spalten, Vorzeichen und Kontrollsummen geprüft/u).check();
  await page.getByRole('button', { name: 'Geprüfte Umsätze speichern', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Gespeicherte Quittung', exact: true })).toBeVisible();
  expect(await prisma.paymentJournalEvent.count({ where: { userId } })).toBe(0);
  expect(await prisma.income.count({ where: { userId } })).toBe(0);
  return prisma.bankImportRow.findFirstOrThrow({ where: { userId } });
}

export async function allocationJournal(page: Page, invoiceId: number) {
  const response = await page.request.get(`/api/invoices/${invoiceId}/payments`, {
    headers: { 'X-Bivaro-Payment-Contract': '3' },
  });
  expect(response.status(), await response.text()).toBe(200);
  const body: unknown = await response.json();
  const checked = readPaymentAdjustmentPreflight(body, invoiceId);
  if (checked.ledger.version !== 3) throw new Error('Expected checked allocation journal contract 3.');
  return { ...checked, ledger: checked.ledger };
}

export async function openAllocationReceipt(page: Page) {
  await page.getByRole('button', { name: 'Quittung öffnen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Importquittung', exact: true })).toBeVisible();
  return page.getByRole('article', { name: /^Gespeicherte Bankzeile /u });
}

export async function chooseAllocationInvoice(dialog: Locator, invoiceId: number, invoiceNumber: string, moving = false) {
  await dialog.getByLabel('Rechnung suchen', { exact: true }).fill(invoiceNumber);
  await dialog.getByRole('button', { name: 'Suchen', exact: true }).click();
  const select = dialog.getByRole('combobox', { name: 'Rechnung', exact: true });
  await expect(select.locator(`option[value="${invoiceId}"]`)).toHaveCount(1);
  await expect(select).toBeEnabled();
  await select.selectOption(String(invoiceId));
  await expect(dialog.locator('dl')).toContainText('80,00');
  if (moving) {
    await dialog.getByLabel('Entdeckungsdatum', { exact: true }).fill('2026-02-02');
    await dialog.getByLabel('Grund', { exact: true }).fill('SYNTHETISCH · Zahlung gehört vollständig zur anderen Rechnung; kein neuer Geldfluss.');
  }
  await dialog.getByRole('checkbox', { name: moving ? /Ich habe beide Rechnungen geprüft/u : /Dieser Betrag ist am gespeicherten Datum tatsächlich eingegangen/u }).check();
  await expect(dialog.getByRole('button', { name: moving ? 'Zuordnung ändern' : 'Zahlung zuordnen', exact: true })).toBeEnabled();
}

export async function allocationRowState(page: Page, rowStableKey: string) {
  const response = await page.request.get(`/api/bank-imports/rows/${rowStableKey}/allocation`, { headers: { 'X-Bivaro-Payment-Contract': '3' } });
  expect(response.status()).toBe(200);
  const body = await response.json() as { row: unknown };
  return readBankAllocationRowEnvelope(body.row, rowStableKey);
}

export async function allocationSnapshot(userId: string) {
  const orderBy = { id: 'asc' as const };
  return {
    invoices: await prisma.invoice.findMany({ where: { userId }, orderBy, select: { id: true, status: true, issuanceState: true, paidAt: true, totalAmount: true } }),
    payments: await prisma.paymentJournalEvent.findMany({ where: { userId }, orderBy }),
    incomes: await prisma.income.findMany({ where: { userId }, orderBy }),
    expenses: await prisma.expense.findMany({ where: { userId }, orderBy }),
    cash: await prisma.cashTransaction.findMany({ where: { userId }, orderBy }),
    adjustments: await prisma.paymentAdjustment.findMany({ where: { userId }, orderBy }),
    operations: await prisma.paymentOperation.findMany({ where: { userId }, orderBy }),
    bindings: await prisma.bankPaymentBinding.findMany({ where: { userId }, orderBy }),
    changes: await prisma.paymentAllocationChange.findMany({ where: { userId }, orderBy }),
    batches: await prisma.bankImportBatch.findMany({ where: { userId }, orderBy }),
    rows: await prisma.bankImportRow.findMany({ where: { userId }, orderBy }),
  };
}

export async function noAllocationOverflow(page: Page, dialog?: Locator) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (dialog) expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
}
