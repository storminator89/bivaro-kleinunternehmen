import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import type { EURExportPreview } from '../types/eur-export';

// Synthetic isolated-fixture identity only; all financial setup and exports use
// authenticated real HTTP routes. No financial API interception or submission.
async function isolatedAccount(page: Page) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  const email = `eur-${randomUUID()}@example.test`;
  const password = 'SyntheticEurPass123!';
  await prisma.user.create({ data: { email, name: 'Synthetic EÜR fixture', password: await hashPassword(password), role: 'USER' } });
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function createIncome(page: Page, year: number, amount: number) {
  const response = await page.request.post('/api/incomes', { data: {
    description: `Synthetic income ${year}`, amount, date: `${year}-01-02`, taxRelevant: true,
  } });
  expect(response.status()).toBe(200);
}

async function seedBothYears(page: Page) {
  // Distinct amounts in both years detect an accidental date-selection fallback.
  for (const year of [2025, 2026]) {
    await createIncome(page, year, year === 2026 ? 2000 : 1000);
    const amounts = year === 2026 ? [100, -20, 200, 120, 30, 40, 10] : [80, -10, 30, 60, 20, 15, 5];
    for (const [index, category] of ['Wareneinkauf', 'Wareneinkauf', 'Personal', 'Ungeklärte Anlageart', 'Unbekannter Fall', 'Miete', 'Telefon'].entries()) {
      const response = await page.request.post('/api/expenses', { data: {
        description: `Synthetic ${year} ${category} ${index}`, category, amount: amounts[index], date: `${year}-01-01`,
        taxRelevant: true, taxDeductiblePercentage: 100, depreciationYears: index === 3 ? 1 : null,
      } });
      expect(response.status()).toBe(200);
    }
  }
}

async function openWorkingPaper(page: Page, year: number) {
  await page.goto('/dashboard?tab=eur');
  const loaded = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/eur-export' && url.searchParams.get('format') === 'json' && url.searchParams.get('year') === '2026';
  });
  await page.getByRole('button', { name: 'EÜR-Übertragungshilfe öffnen', exact: true }).click();
  expect((await loaded).status()).toBe(200);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'CSV herunterladen', exact: true })).toBeEnabled();
  if (year !== 2026) {
    const changed = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/eur-export' && url.searchParams.get('format') === 'json' && url.searchParams.get('year') === String(year);
    });
    await dialog.getByRole('combobox').click();
    await page.getByRole('option', { name: String(year), exact: true }).click();
    expect((await changed).status()).toBe(200);
  }
  await expect(dialog.getByRole('combobox')).toHaveText(String(year));
  await expect(dialog.getByRole('button', { name: 'CSV herunterladen', exact: true })).toBeEnabled();
  return dialog;
}

for (const year of [2026, 2025]) {
  test(`shows and downloads the bounded ${year} EÜR working paper with verified year-specific rows`, async ({ page }, testInfo) => {
    await isolatedAccount(page);
    try {
      await seedBothYears(page);
      const response = await page.request.get(`/api/eur-export?year=${year}&format=json`);
      expect(response.status()).toBe(200);
      const body = await response.json() as EURExportPreview;
      const is2026 = year === 2026;
      // Independent source expectations: BMF 01.09.2026 PDF URL v=4, pp.3–6.
      // Legacy 2025 remains a control, not a fresh fiscal certification.
      const expected = is2026 ? [
        { lineNumber: 12, amount: 2000 }, { lineNumber: 29, amount: 80 }, { lineNumber: 31, amount: 200 },
        { lineNumber: 34, amount: 120 }, { lineNumber: 40, amount: 40 }, { lineNumber: 44, amount: 10 },
        { lineNumber: 61, amount: 30 }, { lineNumber: 91, amount: 1520 },
      ] : [
        { lineNumber: 12, amount: 1000 }, { lineNumber: 27, amount: 70 }, { lineNumber: 30, amount: 30 },
        { lineNumber: 33, amount: 60 }, { lineNumber: 39, amount: 15 }, { lineNumber: 43, amount: 5 },
        { lineNumber: 60, amount: 20 }, { lineNumber: 90, amount: 800 },
      ];
      expect(body.data.lines.map(({ lineNumber, amount }) => ({ lineNumber, amount }))).toEqual(expected);
      expect(body.data).toMatchObject({ year, mappingVersion: `anlage-euer-${year}-v1`, exportKind: 'csv-working-paper',
        totalIncome: is2026 ? 2000 : 1000, totalExpense: is2026 ? 480 : 200, profit: is2026 ? 1520 : 800 });
      expect(body.data.controlTotals.correctionCount).toBe(1);
      expect(body.data.corrections[0]).toMatchObject({ amount: is2026 ? -20 : -10, lineNumber: is2026 ? 29 : 27 });
      expect(body.warnings).toContain(`1 Kategorie(n) ohne belastbare Zuordnung; vor Übertragung bitte prüfen (vorläufig Zeile ${is2026 ? 61 : 60}).`);
      expect(body.warnings.some(warning => warning.includes('mangels Anlageart') && warning.includes(`Zeile ${is2026 ? 34 : 33}`))).toBe(true);
      expect(body.warnings.some(warning => warning.includes(`Zeilen ${is2026 ? '93, 96 und 98' : '92, 95 und 97'}`))).toBe(true);
      if (is2026) {
        expect(body.data.sourceReferences[0]).toBe('https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Einkommensteuer/2026-09-01-anlage-EUER-2026.pdf?__blob=publicationFile&v=4');
        expect(body.data.sourceSha256).toBe('03d3033acc5c5a126729e58743128596ae39193759c55b207872da9432b83a8f');
      }
      const dialog = await openWorkingPaper(page, year);
      await expect(dialog).toContainText(body.data.mappingVersion);
      await expect(dialog).toContainText(body.data.sourceVersion);
      await expect(dialog).toContainText(body.data.checkedScope);
      await expect(dialog.getByText(`Vereinfachter Überschuss für Zeile ${is2026 ? 91 : 90}`, { exact: true })).toBeVisible();
      await expect(dialog).toContainText('keine ELSTER-Einreichung');
      for (const line of body.data.lines.filter(line => line.type !== 'result')) {
        const row = dialog.getByRole('row').filter({ has: page.getByRole('cell', { name: line.name, exact: true }) });
        await expect(row.getByRole('cell').first()).toHaveText(String(line.lineNumber));
        await expect(row.getByRole('cell').last()).toContainText(line.amount.toLocaleString('de-DE', { minimumFractionDigits: 2 }));
      }
      if (is2026) {
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: 1000 });
          const result = dialog.getByText('Vereinfachter Überschuss für Zeile 91', { exact: true });
          await dialog.locator('.text-4xl').scrollIntoViewIfNeeded();
          await expect(result).toBeInViewport();
          await expect(dialog.locator('.text-4xl')).toContainText('1.520,00');
          await expect(dialog.getByRole('combobox')).toHaveText('2026');
          await dialog.screenshot({ path: testInfo.outputPath(`eur-2026-working-paper-${width}.png`) });
        }
      }
      const downloading = page.waitForEvent('download');
      await dialog.getByRole('button', { name: 'CSV herunterladen', exact: true }).click();
      const download = await downloading;
      expect(await download.failure()).toBeNull();
      expect(download.suggestedFilename()).toBe(`Anlage-EUER-Uebertragungshilfe-${year}.csv`);
      const csv = await readFile((await download.path())!, 'utf8');
      expect(csv).toContain(`Veranlagungsjahr: ${year}`);
      expect(csv).toContain(`Mappingversion: anlage-euer-${year}-v1`);
      expect(csv).toContain('keine ELSTER-Einreichung');
      for (const line of body.data.lines) expect(csv).toContain(`${line.lineNumber};${line.name};${line.amount.toFixed(2).replace('.', ',')}`);
      if (is2026) expect(csv).not.toMatch(/\n(?:27|28|33|60|90);/);
      await dialog.locator('[data-slot="dialog-footer"]').getByRole('button', { name: 'Schließen', exact: true }).click();
      await expect(dialog).not.toBeVisible();
    } finally { await prisma.$disconnect(); }
  });
}

test('rejects 2027 official rows and opens the real bounded handoff without replacing the selected year', async ({ page }, testInfo) => {
  await isolatedAccount(page);
  try {
    await createIncome(page, 2027, 77);
    await createIncome(page, 2026, 999);
    const rejected = await page.request.get('/api/eur-export?year=2027&format=json');
    expect(rejected.status()).toBe(400);
    const body = await rejected.json();
    expect(body.error).toContain('Für 2027 ist keine amtlich belegte EÜR-Zuordnung hinterlegt.');
    expect(body).not.toHaveProperty('data');
    expect(body.supportedYears).toEqual([2024, 2025, 2026]);
    expect(body.alternativeExport).toMatchObject({ href: '/handoff?year=2027', previewUrl: '/api/accountant-export?year=2027&preview=1' });
    const previewResponse = await page.request.get(body.alternativeExport.previewUrl);
    expect(previewResponse.status()).toBe(200);
    const preview = await previewResponse.json();
    expect(preview.manifest.period).toMatchObject({ from: '2027-01-01', to: '2027-12-31' });
    expect(preview.manifest.counts.incomes).toBe(1);
    await page.goto(body.alternativeExport.href);
    await expect(page.locator('#handoff-year')).toHaveValue('2027');
    await expect(page.getByRole('button', { name: 'ZIP herunterladen', exact: true })).toHaveCount(0);
    const loaded = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/accountant-export' && url.searchParams.get('year') === '2027' && url.searchParams.get('preview') === '1';
    });
    await page.getByRole('button', { name: 'Vorschau laden', exact: true }).click();
    expect((await loaded).status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Paket prüfen und herunterladen', exact: true })).toBeVisible();
    await expect(page.getByText('01.01.2027 bis 31.12.2027 · beide Tage eingeschlossen', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'ZIP herunterladen', exact: true })).toBeDisabled();
    await expect(page).toHaveURL(/\/handoff\?year=2027$/);
    await page.getByRole('button', { name: 'Zeitraum ändern', exact: true }).click();
    await expect(page.locator('#handoff-year')).toHaveValue('2027');
    await page.reload();
    await expect(page.locator('#handoff-year')).toHaveValue('2027');
    await expect(page.getByRole('button', { name: 'Vorschau laden', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.locator('#handoff-year').scrollIntoViewIfNeeded();
    await expect(page.locator('#handoff-year')).toHaveValue('2027');
    await expect(page.locator('#handoff-year')).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('eur-2027-handoff-390.png') });
  } finally { await prisma.$disconnect(); }
});
