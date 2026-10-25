import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/browser-acceptance.yml', 'utf8');
const start = workflow.indexOf('\n      # Independent filtered-list search partition:');
const accepted = workflow.slice(0, start);
const delivery = workflow.indexOf('      - name: Require complete filtered-list record-search visual delivery', start);
const nextStep = workflow.indexOf('\n      - name:', delivery + 1);
const partition = workflow.slice(start, nextStep < 0 ? undefined : nextStep);
const browser = readFileSync('e2e/record-search-filtered-lists.spec.ts', 'utf8');
const namesIn = (source: string) => [...source.matchAll(/allowed = \{([\s\S]*?)\n\s*\}/g)]
  .flatMap(match => [...match[1].matchAll(/'([^']+\.png)'/g)].map(name => name[1]));
const types = ['customer', 'outbound', 'inbound'];
const widths = [1440, 360, 390];

describe('bounded filtered-list record-search hosted visual evidence', () => {
  it('preserves every byte of the accepted 235-image/37 MiB workflow and its full-suite gates', () => {
    expect(start).toBeGreaterThan(0);
    expect(accepted).toHaveLength(86487);
    expect(createHash('sha256').update(accepted).digest('hex')).toBe('47300a7ec9c8c1b295c37b7849c48a55837322515499c9d3ae1860dfa99b493d');
    expect(namesIn(accepted)).toHaveLength(235);
    expect(new Set(namesIn(accepted)).size).toBe(235);
    for (const value of ['total output cap is 37 MiB', 'permissions:\n  contents: read',
      'timeout-minutes: 45', 'npm run test:e2e --', '--headed', '--retries=0',
      '--workers=1', '--forbid-only', '--global-timeout=1200000']) expect(accepted).toContain(value);
  });

  it('adds only nine disjoint required names with independent 1/4/2 MiB bounds and fail-closed delivery', () => {
    expect(delivery).toBeGreaterThan(start);
    expect(namesIn(partition).sort()).toEqual(types.flatMap(type => widths.map(width => `record-search-filtered-${type}-${width}.png`)).sort());
    const owned = namesIn(accepted + partition);
    expect(owned).toHaveLength(244); expect(new Set(owned).size).toBe(244);
    const all = namesIn(workflow);
    expect(new Set(all).size).toBe(all.length);
    for (const value of ['total output cap is 39 MiB', 'limit = 2 * 1024 * 1024',
      'per_file_input_limit = 1 * 1024 * 1024', 'total > 4 * 1024 * 1024',
      'remaining_input = 4 * 1024 * 1024 - actual_input_bytes', 'actual_input_bytes > 4 * 1024 * 1024',
      'all nine exact images are required', 'timeout-minutes: 6', 'timeout-minutes: 2',
      'retention-days: 1', 'if-no-files-found: error', 'include-hidden-files: false',
      'raise SystemExit(1)', 'record-search-filtered-lists-synthetic-visuals',
      "steps.stage-record-search-filtered-lists-visuals.outcome != 'success'",
      "steps.upload-record-search-filtered-lists-visuals.outcome != 'success'",
      'Require complete filtered-list record-search visual delivery']) expect(partition).toContain(value);
    for (const value of ['continue-on-error: true', 'raise SystemExit(0)']) expect(partition).not.toContain(value);
  });

  it('retains exact-set safe bounded regular-path reads and full decoded-pixel/metadata lossless proofs', () => {
    for (const value of ['{source.name for source, _ in matches} != allowed',
      'len({source.name for source, _ in matches}) != len(matches)',
      'root.is_symlink()', 'os.walk(root, followlinks=False)',
      'os.O_NOFOLLOW | os.O_NONBLOCK', 'stat.S_ISREG', 'source.resolve().is_relative_to(root)',
      '(current.st_dev, current.st_ino) != (expected.st_dev, expected.st_ino)',
      'current.st_size != expected.st_size', 'handle.read(min(per_file_input_limit, remaining_input) + 1)',
      'recompress_png_strong as recompress_png', 'recompress_png(data)', 'zip(inputs, results, strict=True)',
      "ProcessPoolExecutor(max_workers=2, mp_context=get_context('fork'))", 'chunksize=1',
      'color metadata or full-pixel verification failed']) expect(partition).toContain(value);
  });

  it('captures each real filtered list in all three existing complete keyboard/privacy journeys before opening a record', () => {
    const journeyStart = browser.indexOf('for (const width of [1440, 360, 390])');
    const journeyEnd = browser.indexOf('\nfor (const group of GROUPS)', journeyStart);
    const journey = browser.slice(journeyStart, journeyEnd);
    expect(journeyStart).toBeGreaterThan(0); expect(journeyEnd).toBeGreaterThan(journeyStart);
    expect(journey.match(/await page\.screenshot\(/g)).toHaveLength(3);
    expect(journey.match(/fullPage: false/g)).toHaveLength(3);
    expect(journey.match(/await clearFilteredListCaptureHeader\(/g)).toHaveLength(3);
    for (const type of types) {
      expect(journey).toContain(`testInfo.outputPath(\`record-search-filtered-${type}-\${width}.png\`)`);
      expect(journey).toContain(`await clearFilteredListCaptureHeader(page, ${type}, data.query)`);
      expect(journey).toContain(`await expect(notice(page, ${type})).toBeFocused()`);
    }
    for (const value of ['aria-activedescendant', 'await expect(notice(page, group)).toBeFocused()',
      'e2eDatabasePath()', 'await signIn(page, owner.email, password)', 'data.foreignIds[group.type]',
      'await assertPrivateTransport(page, data.query, probe)',
      'expect(await snapshot(data.owner.id)).toEqual(before)',
      'expect(await snapshot(data.foreign.id)).toEqual(otherBefore)']) expect(browser).toContain(value);
    for (const value of ['test.skip(', 'test.only(', 'force: true']) expect(browser).not.toContain(value);
    for (const [type, opening] of [['customer', 'await edit.click()'], ['outbound', 'await detailsTrigger.click()'], ['inbound', 'await sourceTrigger.click()']]) {
      const capture = journey.indexOf(`record-search-filtered-${type}-\${width}.png`);
      expect(capture).toBeGreaterThan(0); expect(journey.indexOf(opening)).toBeGreaterThan(capture);
      const captureSetup = journey.slice(journey.indexOf(`await beginList(page, ${type}, data.query)`), capture);
      expect(captureSetup).toContain(`await clearFilteredListCaptureHeader(page, ${type}, data.query)`);
      expect(captureSetup).toContain('toBeInViewport()');
    }
  });

  it('uses native scroll and measured visible sticky-header clearance without changing the query, focus or layout', () => {
    const helperStart = browser.indexOf('async function clearFilteredListCaptureHeader(');
    const helperEnd = browser.indexOf('\nasync function snapshot(', helperStart);
    expect(helperStart).toBeGreaterThan(0); expect(helperEnd).toBeGreaterThan(helperStart);
    const helper = browser.slice(helperStart, helperEnd);
    for (const value of ["page.locator('header.app-topbar').filter({ visible: true })",
      'await expect(topbar).toHaveCount(1)', 'await expect(topbar).toBeVisible()',
      "element.scrollIntoView({ block: 'start' })", 'await topbar.boundingBox()',
      "window.scrollBy({ top: -clearance, behavior: 'instant' })", 'headerBounds!.height + 8',
      'filterNotice.getByText(`Suchtreffer für „${query}“`, { exact: true })',
      'await expect(queryLabel).toBeInViewport({ ratio: 1 })', 'await queryLabel.boundingBox()',
      'expect(queryBounds).not.toBeNull()', 'expect(visibleHeaderBounds).not.toBeNull()',
      'expect(queryBounds!.y).toBeGreaterThanOrEqual(visibleHeaderBounds!.y + visibleHeaderBounds!.height)']) expect(helper).toContain(value);
    for (const value of ['.focus(', '.style', 'setAttribute(', 'innerHTML', 'textContent =']) expect(helper).not.toContain(value);
  });
});
