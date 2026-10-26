// AUTHORING ONLY: run solely in the existing authorized hosted, fresh-fixture suite.
// No browser, real API, database fixture or original-file probe was run locally.
import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { prisma } from '../lib/prisma';
import { hashPassword } from '../lib/password';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';
import { EMPTY_REVIEW_DRAFT } from '../lib/purchase-documents/review-draft';
import type { IncomingDocument } from '../lib/purchase-documents/types';
import { purchaseListSearchInput } from '../lib/record-search/list-contract';
import { recordSearchPages, recordSearchQuery } from '../lib/record-search/contract';

type Owner = { id: string; role: string; sessionVersion: number };
async function sessionNavigation(page: Page, destination: string, action: () => Promise<unknown>, owner: Owner | null) {
  // Own the request synchronously at destination-document start, not in an
  // asynchronous response predicate after a previous document lost its body.
  const session = page.waitForRequest(request => request.method() === 'GET'
    && new URL(request.url()).pathname === '/api/auth/session' && new URL(page.url()).pathname === destination);
  await action(); const response = await (await session).response();
  expect(response).not.toBeNull(); expect(response!.status()).toBe(200); expect(await response!.finished()).toBeNull();
  const body = await response!.json();
  if (owner) expect({ id: body.user?.id, role: body.user?.role, sessionVersion: body.user?.sessionVersion }).toEqual(owner);
  else expect(body).toEqual({});
}

async function snapshot(ownerIds: string[]) {
  const where = { userId: { in: ownerIds } }, orderBy = { id: 'asc' as const };
  return prisma.$transaction([
    prisma.user.findMany({ where: { id: { in: ownerIds } }, orderBy }), prisma.purchaseDocument.findMany({ where, orderBy }),
    prisma.invoice.findMany({ where, orderBy }), prisma.income.findMany({ where, orderBy }), prisma.expense.findMany({ where, orderBy }),
    prisma.cashTransaction.findMany({ where, orderBy }), prisma.paymentJournalEvent.findMany({ where, orderBy }),
    prisma.paymentOperation.findMany({ where, orderBy }), prisma.paymentAdjustment.findMany({ where, orderBy }), prisma.paymentAllocationChange.findMany({ where, orderBy }),
    prisma.invoiceNumberCounter.findMany({ where, orderBy: [{ userId: 'asc' }, { type: 'asc' }, { year: 'asc' }] }), prisma.documentNumberingPolicy.findMany({ where, orderBy: [{ userId: 'asc' }, { type: 'asc' }, { revision: 'asc' }] }), prisma.emailOutbox.findMany({ where, orderBy }), prisma.auditLog.findMany({ where, orderBy }),
  ]);
}
async function upload(page: Page, prefix: string, label: string, day: string | null) {
  let xml = (await readFile('lib/__tests__/fixtures/incoming-validation/valid-ubl.xml', 'utf8')).replace('SYNTHETIC-UBL-001', `${prefix}-${label}`);
  xml = day ? xml.replace('<cbc:IssueDate>2026-10-20</cbc:IssueDate>', `<cbc:IssueDate>${day}</cbc:IssueDate>`) : xml.replace('<cbc:IssueDate>2026-10-20</cbc:IssueDate>', '');
  const response = await page.request.post('/api/purchase-documents', { multipart: { file: { name: `${prefix}-${label}.xml`, mimeType: 'application/xml', buffer: Buffer.from(xml) }, uploadRequestId: randomUUID(), analysisMode: 'manual' } });
  expect(response.status(), await response.text()).toBe(201);
  const document = (await response.json()).document as IncomingDocument;
  expect(document.invoiceDate).toBe(day ? `${day}T00:00:00.000Z` : null);
  return document;
}

test('mobile source-date filters keep boundaries, unknown dates, detail/reload/history and palette continuation read-only', async ({ page, baseURL }) => {
  test.setTimeout(150_000);
  expect(process.env.GITHUB_ACTIONS).toBe('true');
  expect(baseURL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  await isolateSyntheticLoginIpBudget(); await page.setViewportSize({ width: 360, height: 800 });
  const password = 'SyntheticInvoiceDates123!', prefix = `SYN-DATE-${randomUUID().slice(0, 8)}`;
  const owner = await prisma.user.create({ data: { email: `invoice-dates-${randomUUID()}@example.test`, name: 'Synthetic date filter owner', password: await hashPassword(password), role: 'USER' } });
  const foreign = await prisma.user.create({ data: { email: `invoice-dates-other-${randomUUID()}@example.test`, name: 'Synthetic other date owner', password: 'unused-synthetic-hash', role: 'USER' } });
  const sessionOwner: Owner = { id: owner.id, role: owner.role, sessionVersion: owner.sessionVersion };
  await sessionNavigation(page, '/login', () => page.goto('/login'), null);
  await page.getByLabel('E-Mail').fill(owner.email); await page.getByLabel('Passwort', { exact: true }).fill(password);
  await sessionNavigation(page, '/dashboard', () => page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click(), sessionOwner);
  await expect(page).toHaveURL(/\/dashboard/);
  const lower = await upload(page, prefix, 'LOWER', '2026-01-01'), upper = await upload(page, prefix, 'UPPER', '2026-01-31');
  const outside = await upload(page, prefix, 'OUTSIDE', '2025-12-31'), missing = await upload(page, prefix, 'MISSING', null);
  const draft = await page.request.post(`/api/purchase-documents/${missing.id}/review-draft`, { data: { expectedRevision: missing.revision, draft: { ...EMPTY_REVIEW_DRAFT, invoiceDate: '2026-01-15', note: 'This saved draft date must not become the source date.' } } });
  expect(draft.status(), await draft.text()).toBe(200);
  // Setup-only synthetic metadata makes both alternative dates fall in range.
  await prisma.purchaseDocument.update({ where: { id: missing.id }, data: { uploadedAt: new Date('2026-01-20T12:00:00.000Z') } });
  const foreignDocument = await prisma.purchaseDocument.create({ data: { userId: foreign.id, invoiceNumber: `${prefix}-FOREIGN`, originalFileName: `${prefix}-FOREIGN.xml`, storedFileName: 'synthetic-unopened-foreign.xml', originalSha256: 'f'.repeat(64), originalByteCount: 12, mediaType: 'application/xml', uploadRequestId: randomUUID(), invoiceDate: new Date('2026-01-15T00:00:00.000Z') } });
  const baseline = await snapshot([owner.id, foreign.id]), blocked: string[] = [], paletteReads: Record<string, unknown>[] = [], authDiagnostics: string[] = [];
  page.on('console', message => {
    const diagnostic = /^\[next-auth\]\[(error|warn|debug)\]\[([A-Z_0-9]{1,64})\]/.exec(message.text());
    if (diagnostic && authDiagnostics.length <= 32) authDiagnostics.push(authDiagnostics.length === 32 ? 'AUTH_DIAGNOSTIC_OVERFLOW' : `${diagnostic[1]}:${diagnostic[2]}`);
  });
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (url.origin !== baseURL) { blocked.push(`${request.method()} external-request`); await route.abort('blockedbyclient'); return; }
    if (['GET', 'HEAD'].includes(request.method())) { await route.continue(); return; }
    if (request.method() === 'POST' && ['/api/record-search', '/api/purchase-documents/search'].includes(path)) {
      expect(url.search).toBe(''); expect(request.headers()['content-type']).toMatch(/^application\/json(?:;|$)/);
      expect(request.postDataBuffer()!.byteLength).toBeLessThanOrEqual(path === '/api/record-search' ? 1024 : 2048);
      const body = request.postDataJSON() as Record<string, unknown>;
      if (path === '/api/record-search') {
        expect(Object.keys(body).sort()).toEqual(['pages', 'query']);
        expect(recordSearchQuery(body.query)).toBe(prefix); recordSearchPages(body.pages);
      } else { expect(purchaseListSearchInput(body).query).toBe(prefix); paletteReads.push(body); }
      await route.continue(); return;
    }
    blocked.push(`${request.method()} ${path}`); await route.abort('blockedbyclient');
  });
  const row = (id: number) => page.locator(`[data-incoming-document-id="${id}"]`);
  const form = page.getByRole('form', { name: 'Nach Rechnungsdatum filtern', exact: true });
  await sessionNavigation(page, '/purchases', () => page.goto('/purchases?reviewStatus=ALL'), sessionOwner);
  const from = page.getByLabel('Rechnungsdatum von', { exact: true }), to = page.getByLabel('Rechnungsdatum bis (einschließlich)', { exact: true });
  await expect(row(missing.id)).toBeVisible(); await from.fill('2026-01-01'); await to.fill('2026-01-31');
  const apply = form.getByRole('button', { name: 'Datumsfilter anwenden', exact: true }); await apply.focus(); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/invoiceDateFrom=2026-01-01&invoiceDateTo=2026-01-31/);
  await expect(page.locator('[data-incoming-document-id]')).toHaveCount(2); await expect(row(lower.id)).toBeVisible(); await expect(row(upper.id)).toBeVisible();
  await expect(row(outside.id)).toHaveCount(0); await expect(row(missing.id)).toHaveCount(0); await expect(row(foreignDocument.id)).toHaveCount(0);
  const filteredUrl = page.url();
  await row(lower.id).click(); await expect(page.getByRole('dialog', { name: 'Eingangsbeleg prüfen', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page).toHaveURL(filteredUrl); await expect(row(lower.id)).toBeFocused();
  await sessionNavigation(page, '/purchases', () => page.reload(), sessionOwner);
  await expect(from).toHaveValue('2026-01-01'); await expect(to).toHaveValue('2026-01-31'); await expect(page.locator('[data-incoming-document-id]')).toHaveCount(2);
  await sessionNavigation(page, '/customers', () => page.goto('/customers'), sessionOwner);
  await sessionNavigation(page, '/purchases', () => page.goBack(), sessionOwner); await expect(page).toHaveURL(filteredUrl); await expect(from).toHaveValue('2026-01-01');
  await from.fill('2026-02-01'); await apply.click(); await expect(form.getByRole('alert')).toContainText('Von-Datum darf nicht nach'); await expect(form.getByRole('alert')).toBeFocused(); await expect(page).toHaveURL(filteredUrl);
  await form.getByLabel('Nur ohne ausgelesenes Rechnungsdatum', { exact: true }).check(); await expect(from).toBeDisabled(); await expect(to).toBeDisabled(); await apply.click();
  await expect(page).toHaveURL(/invoiceDateMissing=only/); expect(new URL(page.url()).searchParams.has('invoiceDateFrom')).toBe(false);
  await expect(page.locator('[data-incoming-document-id]')).toHaveCount(1); await expect(row(missing.id)).toBeVisible(); await expect(row(missing.id)).toContainText('Entwurfsdatum');
  await form.getByRole('button', { name: 'Datumsfilter zurücksetzen', exact: true }).click(); await expect(page).toHaveURL(/\/purchases\?reviewStatus=ALL$/); await expect(page.locator('[data-incoming-document-id]')).toHaveCount(4);
  await page.keyboard.press('Control+k'); const palette = page.getByRole('dialog', { name: 'Befehlspalette', exact: true }); await expect(palette).toBeVisible();
  await palette.getByRole('combobox').fill(prefix); await palette.getByRole('option', { name: 'Passende Liste öffnen · Eingangsbelege', exact: true }).click(); await expect(palette).toBeHidden();
  await expect(page.getByRole('region', { name: 'Suchfilter · Eingangsbelege', exact: true })).toContainText(prefix);
  await from.fill('2026-01-01'); await to.fill('2026-01-31'); await apply.click(); await expect(page.locator('[data-incoming-document-id]')).toHaveCount(2);
  expect(paletteReads.some(body => body.query === prefix && body.invoiceDateFrom === '2026-01-01' && body.invoiceDateTo === '2026-01-31')).toBe(true);
  expect(page.url()).not.toContain(prefix); expect(blocked).toEqual([]); expect(authDiagnostics).toEqual([]); expect(await snapshot([owner.id, foreign.id])).toEqual(baseline);
});
