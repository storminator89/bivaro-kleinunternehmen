import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/browser-acceptance.yml', 'utf8');
const marker = '\n      # Independent issue #47 PDF/UI evidence;';
const start = workflow.indexOf(marker), baseline = workflow.slice(0, start), added = workflow.slice(start);
const script = readFileSync('scripts/stage-reminder-pdf-evidence.py', 'utf8');
const browser = readFileSync('e2e/reminder-pdf-download.spec.ts', 'utf8');
const container = readFileSync('.github/workflows/container-runtime.yml', 'utf8');

describe('independent synthetic reminder PDF/UI evidence contract', () => {
  it('preserves the complete accepted 235-image workflow byte-for-byte', () => {
    expect(start).toBeGreaterThan(0);
    expect(createHash('sha256').update(baseline).digest('hex')).toBe('47300a7ec9c8c1b295c37b7849c48a55837322515499c9d3ae1860dfa99b493d');
    expect([...baseline.matchAll(/allowed = \{([\s\S]*?)\n\s*\}/g)].flatMap(match => [...match[1].matchAll(/'([^']+\.png)'/g)])).toHaveLength(235);
    for (const source of ['contents: read', '--workers=1', '--retries=0', '--forbid-only', 'timeout-minutes: 45', 'Require both real final-byte browser cases and render all their PDF pages']) expect(baseline).toContain(source);
  });
  it('requires the independent artifact without changing existing retention, budgets or invoice PDF/A gates', () => {
    for (const source of ['stage-reminder-pdf-evidence', 'upload-reminder-pdf-evidence', 'reminder-pdf-synthetic-evidence', 'retention-days: 1', 'if-no-files-found: error', 'timeout-minutes: 4', 'timeout-minutes: 2', 'Require complete reminder PDF and UI evidence delivery', 'exit 1']) expect(added).toContain(source);
    expect(added).not.toContain('continue-on-error'); expect(added).not.toContain('npm run test');
  });
  it('adds only exact relevant native-container triggers and preserves every pre-existing job/permission/condition', () => {
    let original = container;
    for (const source of ['lib/reminder-pdf.ts', 'app/api/reminders/download-pdf/**', 'e2e/reminder-pdf-download.spec.ts']) {
      const line = `      - '${source}'\n`;
      expect(original.split(line)).toHaveLength(3);
      original = original.replaceAll(line, '');
    }
    expect(createHash('sha256').update(original).digest('hex')).toBe('0f89b67650e451d4af42208b3f135dca1eb14533f801d12faedd7855fd6d3d28');
  });
  it('bounds exact case/file sets, regular-file reads, actual PDF rendering and lossless full-pixel evidence', () => {
    for (const source of ['MAX_INPUT_BYTES = 14 * MIB', 'MAX_OUTPUT_BYTES = 8 * MIB', 'MAX_PDF_BYTES = 1 * MIB', 'MAX_UI_BYTES = 3 * MIB', 'MAX_PAGES = 8', 'WIDTHS = (1440, 390)', 'len(matches) == 1', '== EXPECTED', 'os.O_NOFOLLOW | os.O_NONBLOCK', 'stat.S_ISREG', 'expected.st_nlink == 1', 'is_relative_to(root)', 'handle.read(limit + 1)', 'recompress_png_strong', '"pdftoppm"', '"1600"', 'check=True, timeout=60', 'len(pages) == proof["pages"]', 'hashlib.sha256(files["reminder.pdf"])', 'proof.get("downloadsChangedFinancialState") is False', 'proof.get("emailRequests") == []']) expect(script).toContain(source);
    expect(script).not.toContain('shell=True'); expect(script).not.toContain('SystemExit(0)');
  });
  it('covers actual authenticated keyboard/download/cancel/stale/settled behavior and original-file identity without mocked routes', () => {
    for (const source of ['e2eDatabasePath()', "role: 'USER'", 'isolateSyntheticLoginIpBudget()', 'await page.keyboard.press(\'Escape\')', 'await expect(trigger).toBeFocused()', "await page.keyboard.press('Space')", "page.waitForEvent('download')", 'sha256(await response.body())', 'expect(await snapshot(userId)).toEqual(before)', 'REMINDER_PREVIEW_EXPIRED', 'Zahlungsstand hat sich geändert', 'Zahlbetrag: 70,00 €', 'expect(settled.outbox).toEqual([])', 'expect(settled.reminders).toEqual([])', "path.join(evidence, 'review.png')", "path.join(evidence, 'actions.png')", "path.join(evidence, 'reminder.pdf')"]) expect(browser).toContain(source);
    for (const source of ['test.only(', 'test.skip(', 'route.fulfill(', 'force: true']) expect(browser).not.toContain(source);
  });
});
