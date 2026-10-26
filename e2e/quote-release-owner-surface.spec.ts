import { expect, test, type Page, type Route } from '@playwright/test';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseOwnerQuoteReleaseCaptureBody } from '../lib/quote-release-owner-contract';
import { parseOwnerQuoteReleaseClientReceipt } from '../lib/quote-release-owner-client';
import { OWNER_DEFAULT_ORIGIN, OWNER_ENABLED_ORIGIN, startOwnerVersionFixture, type OwnerVersionFixture, type OwnerVersionSeed } from './helpers/quote-release-owner-fixture';

// Four serial steps of one bounded journey. The existing focused runner supplies
// core authentication, one completed build and its fresh disposable database.
// No production gate/settings change, public recipient, email, PDF conformance,
// cross-client idempotency or full browser-acceptance claim is made here.
test.describe.configure({ mode: 'serial', retries: 0 });
test.setTimeout(60_000);
let fixture: OwnerVersionFixture, owned: OwnerVersionSeed, foreign: OwnerVersionSeed;
let committedReceipt: ReturnType<typeof parseOwnerQuoteReleaseClientReceipt> | null = null;
const CAPTURE = 'Neue interne Version bewusst speichern';

test.beforeAll(async ({}, info) => {
  fixture = await startOwnerVersionFixture(info);
  try {
    owned = await fixture.seed('SYNTHETIC-OWNER-VERSION');
    foreign = await fixture.seed('SYNTHETIC-FOREIGN-VERSION');
  } catch (error) { await fixture.stop(); throw error; }
});
test.afterAll(async () => { await fixture?.stop(); });

async function openVersions(page: Page) {
  await page.getByRole('button', { name: 'Interne Versionen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Interne Angebotsversionen', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Geprüfter Revisionsstand:/)).toBeVisible();
  return dialog;
}
async function fillDraft(page: Page, reason: string) {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Grund für diese neue interne Version', { exact: true }).fill(reason);
  await dialog.getByLabel('Ablauf der internen Version (Ihre lokale Zeit)', { exact: true }).fill('2098-01-01T12:00');
}
function uncertaintyKey() {
  return `bivaro:quote-release-owner:uncertain:v1:${encodeURIComponent(JSON.stringify(['authenticated', owned.user.id, 'USER', owned.user.sessionVersion]))}:${owned.quote.id}`;
}
async function networkBoundary(page: Page, quotePost?: (route: Route) => Promise<void>, stateRead?: (route: Route) => Promise<void>) {
  const blocked: string[] = [];
  await page.route('**/*', async route => {
    if (new URL(route.request().url()).origin !== OWNER_ENABLED_ORIGIN) { blocked.push('external-origin'); return route.abort('blockedbyclient'); }
    return route.continue();
  });
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== OWNER_ENABLED_ORIGIN) { blocked.push('external-api'); return route.abort('blockedbyclient'); }
    const capturePath = `/api/quotes/${owned.quote.id}/releases`;
    if (url.pathname === capturePath && !url.search) {
      if (request.method() === 'POST' && quotePost) return quotePost(route);
      if (request.method() === 'GET' && stateRead) return stateRead(route);
    }
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.continue();
    // NextAuth client diagnostics are not a business mutation exemption.
    if (request.method() === 'POST' && url.pathname === '/api/auth/_log' && !url.search) return route.continue();
    blocked.push(`${request.method()} ${url.pathname}`); return route.abort('blockedbyclient');
  });
  return blocked;
}
async function noFinanceOrForeignChanges() {
  expect(await fixture.financialCounts(owned.user.id)).toEqual(Array(13).fill(0));
  expect(await fixture.financialCounts(foreign.user.id)).toEqual(Array(13).fill(0));
  await fixture.unchangedSource(owned); await fixture.unchangedSource(foreign);
  const other = await fixture.captureEvidence(foreign);
  expect(other.authorities).toEqual([]); expect(other.releases).toEqual([]); expect(other.responses).toEqual([]); expect(other.audits).toEqual([]);
}

test('owner versions stay hidden and unwritable when the gate is absent', async ({ page }) => {
  await fixture.login(page, owned, OWNER_DEFAULT_ORIGIN);
  await expect(page.getByRole('button', { name: 'Interne Versionen', exact: true })).toHaveCount(0);
  const endpoint = `${OWNER_DEFAULT_ORIGIN}/api/quotes/${owned.quote.id}/releases`;
  expect((await page.request.get(endpoint)).status()).toBe(404);
  // Invalid body cannot accidentally capture even if the absent-gate assertion regresses.
  expect((await page.request.post(endpoint, { headers: { Origin: OWNER_DEFAULT_ORIGIN }, data: {} })).status()).toBe(404);
  const evidence = await fixture.captureEvidence(owned);
  expect(evidence).toEqual({ authorities: [], releases: [], responses: [], audits: [] });
  await noFinanceOrForeignChanges();
});

test('owned quote opens the internal version view without public access', async ({ page }) => {
  await fixture.login(page, owned, OWNER_ENABLED_ORIGIN);
  const blocked = await networkBoundary(page);
  const dialog = await openVersions(page);
  await expect(dialog).toContainText('kein Versand, keine Online-Freigabe und keine Kundenzustimmung');
  await expect(dialog.getByRole('button', { name: CAPTURE, exact: true })).toBeDisabled();
  const state = await page.request.get(`${OWNER_ENABLED_ORIGIN}/api/quotes/${owned.quote.id}/releases`);
  expect(state.status()).toBe(200);
  expect(await state.json()).toMatchObject({ quoteId: owned.quote.id, publicAccessEnabled: false, eligibility: 'RECEIPT_BOUND', totalVersions: 0, history: [] });
  expect((await page.request.get(`${OWNER_ENABLED_ORIGIN}/api/quotes/${foreign.quote.id}/releases`)).status()).toBe(404);
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
  await expect(dialog).not.toBeVisible(); expect(blocked).toEqual([]);
  expect((await fixture.captureEvidence(owned)).releases).toEqual([]);
  await noFinanceOrForeignChanges();
});

test('unobserved committed capture stays blocked after close reopen and reload', async ({ page }) => {
  await fixture.login(page, owned, OWNER_ENABLED_ORIGIN);
  let posts = 0;
  const blocked = await networkBoundary(page, async route => {
    expect(++posts).toBe(1);
    const body = parseOwnerQuoteReleaseCaptureBody(route.request().postDataJSON());
    const real = await route.fetch({ maxRedirects: 0 });
    expect(real.status()).toBe(200);
    committedReceipt = parseOwnerQuoteReleaseClientReceipt(await real.json(), body);
    // The authenticated application really committed; only its reply is lost.
    await route.fulfill({ status: 500, json: { error: 'Synthetic lost reply after committed capture', code: 'OUTCOME_UNKNOWN' } });
  });
  let dialog = await openVersions(page);
  await fillDraft(page, 'Explicit synthetic internal capture');
  await expect(dialog.getByRole('button', { name: CAPTURE, exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: CAPTURE, exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Ausgang des Speicherversuchs ist unklar');
  expect(committedReceipt).not.toBeNull(); expect(posts).toBe(1);
  await expect(dialog.getByRole('button', { name: CAPTURE, exact: true })).toBeDisabled();
  expect(await page.evaluate(key => sessionStorage.getItem(key), uncertaintyKey())).toBe('1');
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
  dialog = await openVersions(page); await fillDraft(page, 'Uncertainty must survive dialog reopening');
  await expect(dialog.getByRole('checkbox')).toBeDisabled();
  await expect(dialog.getByRole('button', { name: CAPTURE, exact: true })).toBeDisabled();
  await page.goto(`${OWNER_ENABLED_ORIGIN}/dashboard?tab=invoices`);
  await page.goto(`${OWNER_ENABLED_ORIGIN}/dashboard?tab=quotes`);
  dialog = await openVersions(page); await fillDraft(page, 'Uncertainty must survive tab navigation');
  await expect(dialog.getByRole('button', { name: CAPTURE, exact: true })).toBeDisabled();
  await page.reload(); dialog = await openVersions(page); await fillDraft(page, 'Uncertainty must survive full reload');
  await expect(dialog.getByRole('button', { name: CAPTURE, exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Stand ausdrücklich neu laden', exact: true }).click();
  await expect(dialog.getByRole('checkbox')).toBeEnabled();
  await expect(dialog.getByText(/Version 1 · aktueller interner Stand/)).toBeVisible();
  await dialog.getByRole('checkbox').check();
  await expect(dialog.getByRole('button', { name: CAPTURE, exact: true })).toBeEnabled();
  // Deliberate review is proven by an enabled button, never a second write.
  expect(posts).toBe(1); expect(blocked).toEqual([]);
  expect(await page.evaluate(key => sessionStorage.getItem(key), uncertaintyKey())).toBe('1');
  const evidence = await fixture.captureEvidence(owned);
  expect(evidence.authorities).toHaveLength(1); expect(evidence.releases).toHaveLength(1); expect(evidence.responses).toEqual([]);
  expect(evidence.authorities[0]).toMatchObject({ sourceUserId: owned.user.id, sourceInvoiceId: owned.quote.id, revision: 1, currentReleaseId: committedReceipt!.releaseId });
  expect(evidence.releases[0]).toMatchObject({ id: committedReceipt!.releaseId, authorityId: committedReceipt!.authorityId, generation: 1, restoredAccessDisabled: 0, originalSha256: owned.pdfSha });
  expect(evidence.audits.map(row => JSON.parse(row.metadata!).operation)).toEqual(['quote.release.authority.preflight', 'quote.release.capture']);
  const archive = path.join(owned.tenant, evidence.releases[0].originalArchiveName);
  expect(evidence.releases[0].originalArchiveName).toMatch(/^[a-f0-9-]{36}\.pdf$/u);
  expect(lstatSync(archive).isFile() && !lstatSync(archive).isSymbolicLink()).toBe(true);
  expect(archive).not.toBe(owned.source); expect(lstatSync(archive).mode & 0o777).toBe(0o400);
  expect(createHash('sha256').update(readFileSync(archive)).digest('hex')).toBe(owned.pdfSha);
  await noFinanceOrForeignChanges();
});

test('owner version 401 removes private draft and history immediately', async ({ page }) => {
  // This serial case reuses the prior genuine retained history, not another POST.
  expect(committedReceipt).not.toBeNull();
  await fixture.login(page, owned, OWNER_ENABLED_ORIGIN);
  let expire = false;
  const blocked = await networkBoundary(page, undefined, async route => {
    if (expire) return route.fulfill({ status: 401, json: { error: 'Synthetic owner-view expiry' } });
    return route.continue();
  });
  const dialog = await openVersions(page);
  await dialog.getByText('Gespeicherte Versionen (1) anzeigen', { exact: true }).click();
  await expect(dialog.getByText(/Version 1 · aktueller interner Stand/)).toBeVisible();
  const privateDraft = 'PRIVATE SYNTHETIC REASON MUST DISAPPEAR';
  await fillDraft(page, privateDraft); await expect(dialog).toContainText(owned.quote.invoiceNumber!);
  await expect(dialog.getByLabel('Grund für diese neue interne Version', { exact: true })).toHaveValue(privateDraft);
  expire = true;
  await dialog.getByRole('button', { name: 'Stand neu laden', exact: true }).click();
  await expect(dialog).toContainText('Anmeldung erforderlich');
  await expect(dialog).not.toContainText(owned.quote.invoiceNumber!);
  await expect(dialog).not.toContainText(privateDraft);
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  await expect(dialog.getByLabel('Ablauf der internen Version (Ihre lokale Zeit)', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText(/Version 1 · aktueller interner Stand/)).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: CAPTURE, exact: true })).toHaveCount(0);
  // Session endpoint intentionally remains authenticated: suppression must not
  // wait for useSession to change. No claim of actual session revocation here.
  expect((await (await page.request.get(`${OWNER_ENABLED_ORIGIN}/api/auth/session`)).json()).user.id).toBe(owned.user.id);
  expect((await fixture.captureEvidence(owned)).releases).toHaveLength(1);
  expect(blocked).toEqual([]); await noFinanceOrForeignChanges();
});
