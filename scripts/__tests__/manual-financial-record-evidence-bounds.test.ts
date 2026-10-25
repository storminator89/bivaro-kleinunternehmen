import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Authored source acceptance only; no local execution/rendering is implied.
const workflow = readFileSync('.github/workflows/browser-acceptance.yml', 'utf8');
const marker = '      # Independent manual-financial-record partition:';
const start = workflow.indexOf(marker);
// Deliberately no trim/line-ending normalization: every accepted byte is bound.
const accepted = workflow.slice(0, start);
const partition = workflow.slice(start);
const browser = readFileSync('e2e/manual-financial-records.spec.ts', 'utf8');
const account = readFileSync('e2e/helpers/payment-adjustments.ts', 'utf8');
const codec = readFileSync('scripts/lossless_evidence_png.py', 'utf8');
const namesIn = (source: string) => [...source.matchAll(/allowed = \{([\s\S]*?)\n\s*\}/g)]
  .flatMap(match => [...match[1].matchAll(/'([^']+\.png)'/g)].map(name => name[1]));
const captures = ['income', 'expense'].flatMap(kind => [360, 390, 1440].flatMap(width =>
  ['light', 'dark'].map(theme => `manual-record-${kind}-${width}-${theme}.png`),
));

describe('bounded manual-financial-record hosted viewport evidence', () => {
  it('preserves the complete accepted 235-name/37 MiB workflow byte for byte', () => {
    expect(start).toBeGreaterThan(0); expect(workflow.indexOf(marker, start + marker.length)).toBe(-1);
    expect(createHash('sha256').update(accepted).digest('hex')).toBe('47300a7ec9c8c1b295c37b7849c48a55837322515499c9d3ae1860dfa99b493d');
    expect(namesIn(accepted)).toHaveLength(235); expect(new Set(namesIn(accepted)).size).toBe(235);
    for (const value of ['timeout-minutes: 45', 'contents: read', 'persist-credentials: false', '--retries=0', '--workers=1', '--forbid-only',
      'max 30 MiB total output', '# Independent record-search partition: at most 1 MiB extra output;',
      'Require complete record-search continuation visual delivery', '# README gallery coverage partition:',
      'Require complete README coverage visual delivery']) expect(accepted).toContain(value);
  });
  it('appends exactly twelve disjoint required names with independent 1/6/3 MiB budgets', () => {
    expect(namesIn(partition).sort()).toEqual([...captures].sort());
    expect(new Set(captures).size).toBe(12);
    expect(namesIn(partition).some(name => namesIn(accepted).includes(name))).toBe(false);
    expect(namesIn(workflow)).toHaveLength(247); expect(new Set(namesIn(workflow)).size).toBe(247);
    for (const value of ['all accepted 235 names and 37 MiB remain unchanged',
      'limit = 3 * 1024 * 1024', 'per_file_input_limit = 1 * 1024 * 1024',
      'total > 6 * 1024 * 1024', 'remaining_input = 6 * 1024 * 1024 - actual_input_bytes',
      'actual_input_bytes > 6 * 1024 * 1024', 'sum(map(len, images.values())) > limit',
      'all twelve exact images are required']) expect(partition).toContain(value);
  });
  it('keeps bounded safe regular-file reads and strong complete pixel/color metadata proofs', () => {
    for (const value of ['root.is_symlink()', 'os.walk(root, followlinks=False)',
      'info = source.lstat()', 'stat.S_ISREG(info.st_mode)', 'source.resolve().is_relative_to(root)',
      '{source.name for source, _ in matches} != allowed',
      'len({source.name for source, _ in matches}) != len(matches)',
      'os.O_NOFOLLOW | os.O_NONBLOCK', 'current = os.fstat(handle.fileno())',
      '(current.st_dev, current.st_ino) != (expected.st_dev, expected.st_ino)',
      'current.st_size != expected.st_size', 'handle.read(min(per_file_input_limit, remaining_input) + 1)',
      'len(data) != current.st_size', "struct.unpack_from('>IIBBBBB', data, 16)",
      'height * (width * channels + 1) > 16 * 1024 * 1024',
      '(width, height) != (expected_width, expected_height)',
      "(proof['width'], proof['height']) != (expected_width, expected_height)",
      'recompress_png_strong as recompress_png', 'zip(inputs, results, strict=True)',
      "ProcessPoolExecutor(max_workers=2, mp_context=get_context('fork'))",
      'color metadata or full-pixel verification failed', "json.dumps(proof, sort_keys=True)"]) expect(partition).toContain(value);
    // The unchanged shared codec binds every complete decoded pixel, every
    // retained non-IDAT/color chunk, geometry, hashes and bounded deflate input.
    for (const value of ["'fullPixelSha256'", "'nonIdatSha256'", "'inputSha256'", "'outputSha256'",
      'decoded[3] == pixels', 'decoded[4] == metadata', 'strong PNG equivalence failed',
      'MAX_STRONG_FILTERED_BYTES = 16 * 1024 * 1024', 'expected + 1', 'not inflater.unused_data',
      'not inflater.unconsumed_tail']) expect(codec).toContain(value);
  });
  it('requires always-run exact delivery with two workers, six-minute stage, two-minute upload and one-day retention', () => {
    for (const value of ['if: ${{ always() }}', 'timeout-minutes: 6', 'timeout-minutes: 2',
      'retention-days: 1', 'if-no-files-found: error', 'include-hidden-files: false', 'compression-level: 0',
      'manual-financial-record-synthetic-visuals', 'Require complete manual financial record visual delivery',
      "steps.stage-manual-financial-record-visuals.outcome != 'success'", "steps.upload-manual-financial-record-visuals.outcome != 'success'",
      'raise SystemExit(1)', 'exit 1']) expect(partition).toContain(value);
    for (const value of ['continue-on-error: true', 'raise SystemExit(0)', 'fullPage: true', 'resize(', 'thumbnail(']) expect(partition).not.toContain(value);
  });
  it('captures normal authenticated synthetic viewports with theme, encoded geometry, byte bounds and SHA-256 proof', () => {
    for (const value of ['e2eDatabasePath()', "role: 'USER'", "await page.goto('/login')", "getByLabel('E-Mail').fill(email)", "name: 'Anmelden'"]) expect(account).toContain(value);
    for (const value of ['await isolatedAccount(page)', "for (const kind of ['income', 'expense'] as const)", 'for (const width of [360, 390, 1440])',
      "for (const colorScheme of ['light', 'dark'] as const)", 'await page.emulateMedia({ colorScheme })',
      "await expect(page.locator('html')).toHaveClass", 'expect(page.viewportSize()).toEqual(viewport)',
      'width: window.innerWidth, height: window.innerHeight', 'manual-record-${kind}-${width}-${colorScheme}.png',
      'const png = await page.screenshot(', "fullPage: false, scale: 'css'", "animations: 'disabled'",
      '137, 80, 78, 71, 13, 10, 26, 10', "png.toString('ascii', 12, 16)).toBe('IHDR')",
      'width: png.readUInt32BE(16), height: png.readUInt32BE(20)', 'expect(encodedGeometry).toEqual(viewport)',
      'png.byteLength).toBeLessThanOrEqual(1 * 1024 * 1024)',
      'encodedGeometry.width * encodedGeometry.height * 4).toBeLessThanOrEqual(16 * 1024 * 1024)',
      "encodedSha256: createHash('sha256').update(png).digest('hex')", 'Manual financial record viewport proof:',
      'expect(await unrelatedFinancialState(userId)).toEqual(unrelated)', 'expect(await sums(page)).toEqual(before)',
      "expect(genericPut.status()).toBe(409)", "toBe('FINALIZED_RECORD')"]) expect(browser).toContain(value);
    for (const value of ['test.skip(', 'test.only(', 'force: true', 'await dialog.screenshot(', 'fullPage: true']) expect(browser).not.toContain(value);
  });
});
