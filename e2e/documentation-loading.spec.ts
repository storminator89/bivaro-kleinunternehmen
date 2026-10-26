import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createEmptyDocumentation, getAppVersion } from '../lib/gobd-template';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';

// Authored acceptance coverage; run only through the supported isolated-fixture
// runner when authorized. Delivery failures are synthetic, not auth-policy proof.
async function signInWithDocumentation(page: Page) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  await isolateSyntheticLoginIpBudget();
  const password = 'SyntheticDocumentationRead123!';
  const user = await prisma.user.create({ data: {
    email: `documentation-read-${randomUUID()}@example.test`,
    name: 'Synthetic documentation read', password: await hashPassword(password),
  } });
  const content = createEmptyDocumentation();
  content.companyName = `Synthetic saved company ${randomUUID()}`;
  const serialized = JSON.stringify(content);
  const document = await prisma.documentation.create({ data: {
    userId: user.id, version: getAppVersion(), title: 'Synthetic documentation', content: serialized,
  } });
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(user.email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return { document, content, serialized };
}

test.afterAll(async () => { await prisma.$disconnect(); });

for (const width of [1440, 360, 390]) {
  test(`documentation keeps its frame at ${width}px through held reads, failure and explicit retry without losing a failed-save draft`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { document, content, serialized } = await signInWithDocumentation(page);
    await page.addInitScript(() => {
      window.print = () => { window.document.documentElement.dataset.syntheticPrintCalled = 'true'; };
    });
    let releaseFailure!: () => void;
    let releaseRecovery!: () => void;
    const failureGate = new Promise<void>(resolve => { releaseFailure = resolve; });
    const recoveryGate = new Promise<void>(resolve => { releaseRecovery = resolve; });
    let recover = false;
    let readRequests = 0;
    const submittedDrafts: unknown[] = [];
    await page.route('**/api/documentation', async route => {
      if (route.request().method() === 'POST') {
        submittedDrafts.push(route.request().postDataJSON());
        return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Synthetic save interruption"}' });
      }
      expect(route.request().method()).toBe('GET');
      readRequests++;
      if (!recover) {
        await failureGate;
        return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Synthetic read interruption"}' });
      }
      await recoveryGate;
      return route.continue(); // Recover genuine owner-scoped fixture data, never a fabricated template.
    });

    await page.goto('/settings/documentation');
    const main = page.getByRole('main');
    const heading = main.getByRole('heading', { name: 'Dokumentation', exact: true });
    const back = main.getByRole('link', { name: 'Zurück zu Einstellungen', exact: true });
    const save = main.getByRole('button', { name: 'Speichern', exact: true });
    const print = main.getByRole('button', { name: 'Drucken/PDF', exact: true });
    const region = main.getByRole('region', { name: 'Dokumentationsinhalt', exact: true });
    await expect(heading).toBeVisible();
    await expect(back).toBeVisible();
    await expect(back).toHaveAttribute('href', '/settings');
    await expect(region).toHaveAttribute('aria-busy', 'true');
    await expect(region.getByRole('status')).toHaveText('Dokumentation wird geladen…');
    await expect(save).toBeDisabled();
    await expect(print).toBeDisabled();
    await expect(region.getByRole('textbox')).toHaveCount(0);
    const positions = await Promise.all([heading, back, save, print].map(locator => locator.boundingBox()));
    async function expectStableFrame() {
      for (const [index, locator] of [heading, back, save, print].entries()) {
        await expect(locator).toBeVisible();
        const box = await locator.boundingBox();
        expect(box).not.toBeNull();
        expect(positions[index]).not.toBeNull();
        expect(Math.abs(box!.x - positions[index]!.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(box!.y - positions[index]!.y)).toBeLessThanOrEqual(1);
      }
      expect(await main.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    // Native disabled actions must not print or send a write during the held GET.
    await save.evaluate(button => (button as HTMLButtonElement).click());
    await print.evaluate(button => (button as HTMLButtonElement).click());
    expect(submittedDrafts).toEqual([]);
    await expect(page.locator('html')).not.toHaveAttribute('data-synthetic-print-called', 'true');
    await expect.poll(() => readRequests).toBeGreaterThan(0);
    releaseFailure();

    await expect(region.getByRole('alert')).toHaveText('Die Dokumentation konnte nicht geladen werden.');
    await expect(region).toHaveAttribute('aria-busy', 'false');
    await expect(region.getByRole('textbox')).toHaveCount(0);
    await expect(save).toBeDisabled();
    await expect(print).toBeDisabled();
    await expectStableFrame();
    recover = true;
    await region.getByRole('button', { name: 'Erneut versuchen', exact: true }).click();
    await expect(region).toHaveAttribute('aria-busy', 'true');
    await expect(region.getByRole('status')).toBeVisible();
    await expect(region.getByRole('button', { name: 'Erneut versuchen', exact: true })).toHaveCount(0);
    await expect(save).toBeDisabled();
    await expect(print).toBeDisabled();
    await expectStableFrame();
    releaseRecovery();

    await expect(main.getByLabel('Unternehmensname', { exact: true })).toHaveValue(content.companyName);
    await expect(region).toHaveAttribute('aria-busy', 'false');
    await expect(region.getByRole('alert')).toHaveCount(0);
    await expect(save).toBeEnabled();
    await expect(print).toBeEnabled();
    await expectStableFrame();
    await print.click();
    await expect(page.locator('html')).toHaveAttribute('data-synthetic-print-called', 'true');

    const editedCompany = `Unsaved draft ${randomUUID()}`;
    const section = content.sections.find(candidate => !candidate.isAutoGenerated)!;
    const editedSection = `Unsaved section ${randomUUID()}`;
    await main.getByLabel('Unternehmensname', { exact: true }).fill(editedCompany);
    await page.locator(`#gobd-${section.id} [data-slot="collapsible-trigger"]`).click();
    const sectionEditor = main.getByRole('textbox', { name: `${section.title} bearbeiten`, exact: true });
    await sectionEditor.fill(editedSection);
    const readsBeforeSave = readRequests;
    await save.click();
    await expect(region.getByRole('alert')).toHaveText('Fehler beim Speichern');
    await expect(main.getByLabel('Unternehmensname', { exact: true })).toHaveValue(editedCompany);
    await expect(sectionEditor).toHaveValue(editedSection);
    await expect(save).toBeEnabled();
    await expect(main.getByRole('button', { name: 'Gespeichert', exact: true })).toHaveCount(0);
    await expect(region.getByRole('button', { name: 'Erneut versuchen', exact: true })).toHaveCount(0);
    expect(readRequests).toBe(readsBeforeSave);
    expect(submittedDrafts).toEqual([expect.objectContaining({ content: expect.objectContaining({
      companyName: editedCompany,
      sections: expect.arrayContaining([expect.objectContaining({ id: section.id, content: editedSection })]),
    }) })]);
    expect((await prisma.documentation.findUniqueOrThrow({ where: { id: document.id } })).content).toBe(serialized);
  });
}

for (const status of [401, 403]) {
  test(`documentation read delivery status ${status} never restores private fields or offers a generic retry`, async ({ page }) => {
    const { content, document, serialized } = await signInWithDocumentation(page);
    await page.goto('/settings/documentation');
    await expect(page.getByLabel('Unternehmensname', { exact: true })).toHaveValue(content.companyName);
    await page.route('**/api/documentation', route => route.fulfill({
      status, contentType: 'application/json', body: '{"error":"Synthetic denied read delivery"}',
    }));
    await page.reload();
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Dokumentation', exact: true })).toBeVisible();
    await expect(main.getByRole('link', { name: 'Zurück zu Einstellungen', exact: true })).toBeVisible();
    await expect(main.getByRole('alert')).toHaveText(status === 401
      ? 'Bitte erneut anmelden, um die Dokumentation zu laden.'
      : 'Du hast keine Berechtigung, die Dokumentation zu laden.');
    await expect(main.getByRole('textbox')).toHaveCount(0);
    await expect(main.getByText(content.companyName, { exact: true })).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled();
    await expect(main.getByRole('button', { name: 'Drucken/PDF', exact: true })).toBeDisabled();
    await expect(main.getByRole('button', { name: 'Erneut versuchen', exact: true })).toHaveCount(0);
    if (status === 401) await expect(main.getByRole('link', { name: 'Erneut anmelden', exact: true })).toHaveAttribute('href', '/login');
    expect((await prisma.documentation.findUniqueOrThrow({ where: { id: document.id } })).content).toBe(serialized);
  });
}

test('malformed successful documentation responses stay unavailable until explicit read recovery and never fabricate save success', async ({ page }) => {
  const { document, content } = await signInWithDocumentation(page);
  // Legitimate absent optional metadata and unknown extra fields survive a real
  // owner-scoped GET; only malformed consumed fields should be rejected.
  const optionalContent = { ...content, systemInfo: null, extraMetadata: { preserved: true },
    sections: content.sections.map(section => ({ ...section, isAutoGenerated: section.isAutoGenerated ?? null })),
  };
  const serialized = JSON.stringify(optionalContent);
  await prisma.documentation.update({ where: { id: document.id }, data: { content: serialized } });
  const response = { ...document, content: optionalContent, createdAt: document.createdAt.toISOString(), updatedAt: document.updatedAt.toISOString() };
  const malformed: unknown[] = [
    null,
    { ...response, id: 'not-an-id' },
    { ...response, updatedAt: 'not-a-timestamp' },
    { ...response, content: { ...content, sections: null } },
    { ...response, content: { ...content, systemInfo: { softwareName: {} } } },
  ];
  let reads = 0;
  await page.route('**/api/documentation', route => {
    if (route.request().method() === 'POST') return route.fulfill({ status: 200, json: null });
    const body = malformed[reads++];
    if (reads <= malformed.length) return route.fulfill({ status: 200, json: body });
    return route.continue();
  });
  await page.goto('/settings/documentation');
  const main = page.getByRole('main');
  const region = main.getByRole('region', { name: 'Dokumentationsinhalt', exact: true });
  for (let index = 0; index < malformed.length; index++) {
    await expect.poll(() => reads).toBe(index + 1);
    await expect(region.getByRole('alert')).toHaveText('Die Dokumentation konnte nicht geladen werden.');
    await expect(region).toHaveAttribute('aria-busy', 'false');
    await expect(region.getByRole('textbox')).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled();
    await expect(main.getByRole('button', { name: 'Drucken/PDF', exact: true })).toBeDisabled();
    const nextRead = page.waitForResponse(candidate => candidate.request().method() === 'GET'
      && new URL(candidate.url()).pathname === '/api/documentation');
    await region.getByRole('button', { name: 'Erneut versuchen', exact: true }).click();
    await (await nextRead).finished();
  }
  await expect(main.getByLabel('Unternehmensname', { exact: true })).toHaveValue(content.companyName);
  await expect(main.getByRole('button', { name: 'Drucken/PDF', exact: true })).toBeEnabled();
  const editedCompany = `Unsaved malformed-response draft ${randomUUID()}`;
  await main.getByLabel('Unternehmensname', { exact: true }).fill(editedCompany);
  await main.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(region.getByRole('alert')).toHaveText('Fehler beim Speichern');
  await expect(main.getByLabel('Unternehmensname', { exact: true })).toHaveValue(editedCompany);
  await expect(main.getByRole('button', { name: 'Gespeichert', exact: true })).toHaveCount(0);
  await expect(main.getByRole('button', { name: 'Speichern', exact: true })).toBeEnabled();
  await expect(region.getByRole('button', { name: 'Erneut versuchen', exact: true })).toHaveCount(0);
  expect(reads).toBe(malformed.length + 1);
  expect((await prisma.documentation.findUniqueOrThrow({ where: { id: document.id } })).content).toBe(serialized);
});
