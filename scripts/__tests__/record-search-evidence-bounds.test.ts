import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/browser-acceptance.yml', 'utf8');
const start = workflow.indexOf('      # Independent record-search partition:');
const accepted = workflow.slice(0, start).trimEnd() + '\n';
const delivery = workflow.indexOf('      - name: Require complete record-search continuation visual delivery', start);
const nextStep = workflow.indexOf('\n      - name:', delivery + 1);
const partition = workflow.slice(start, nextStep < 0 ? undefined : nextStep);
const browser = readFileSync('e2e/record-search.spec.ts', 'utf8');
const namesIn = (source: string) => [...source.matchAll(/allowed = \{([\s\S]*?)\n\s*\}/g)]
  .flatMap(match => [...match[1].matchAll(/'([^']+\.png)'/g)].map(name => name[1]));

describe('bounded record-search continuation hosted visual evidence', () => {
  it('preserves the entire accepted 217-image/30 MiB workflow and its authentication/budget gates', () => {
    expect(start).toBeGreaterThan(0);
    expect(createHash('sha256').update(accepted).digest('hex')).toBe('d73cf8910e667ba4a047b4b88115f31437bbaf6ca2e57955e7170cefe03c1625');
    expect(namesIn(accepted)).toHaveLength(217); expect(new Set(namesIn(accepted)).size).toBe(217);
    for (const value of ['max 30 MiB total output', 'timeout-minutes: 45', 'contents: read', '--retries=0', '--workers=1', '--forbid-only']) expect(accepted).toContain(value);
  });
  it('adds exactly three disjoint required captures with independent 1/2/1 MiB bounds and fail-closed delivery', () => {
    expect(namesIn(partition).sort()).toEqual([360, 390, 1440].map(width => `record-search-continuation-${width}.png`).sort());
    expect(delivery).toBeGreaterThan(start);
    const owned = namesIn(accepted + partition);
    expect(owned).toHaveLength(220); expect(new Set(owned).size).toBe(220);
    const all = namesIn(workflow);
    expect(new Set(all).size).toBe(all.length);
    expect(namesIn(partition).some(name => namesIn(accepted).includes(name))).toBe(false);
    for (const value of ['limit = 1 * 1024 * 1024', 'per_file_input_limit = 1 * 1024 * 1024',
      'total > 2 * 1024 * 1024', 'actual_input_bytes > 2 * 1024 * 1024',
      'timeout-minutes: 6', 'timeout-minutes: 2', 'retention-days: 1', 'if-no-files-found: error',
      'raise SystemExit(1)', 'record-search-continuation-synthetic-visuals', 'Require complete record-search continuation visual delivery']) expect(partition).toContain(value);
    for (const value of ['continue-on-error: true', 'raise SystemExit(0)']) expect(partition).not.toContain(value);
  });
  it('retains safe bounded regular-path reads and full decoded-pixel/metadata lossless proofs', () => {
    for (const value of ['{source.name for source, _ in matches} != allowed',
      'len({source.name for source, _ in matches}) != len(matches)',
      'os.O_NOFOLLOW | os.O_NONBLOCK', 'stat.S_ISREG', 'source.resolve().is_relative_to(root)',
      '(current.st_dev, current.st_ino) != (expected.st_dev, expected.st_ino)',
      'current.st_size != expected.st_size', 'handle.read(min(per_file_input_limit, remaining_input) + 1)',
      'recompress_png_strong as recompress_png', 'zip(inputs, results, strict=True)',
      "ProcessPoolExecutor(max_workers=2, mp_context=get_context('fork'))",
      'color metadata or full-pixel verification failed']) expect(partition).toContain(value);
  });
  it('retains authenticated synthetic owner/isolation assertions and real selection/mobile captures', () => {
    for (const value of ['e2eDatabasePath()', "role: 'USER'", 'await signIn(page, owner.email, password)',
      'foreignCustomer.id', 'foreignInvoice.id', 'foreignReceipt.id', 'aria-activedescendant',
      'toBeInViewport()', 'record-search-continuation-${width}.png', 'await page.screenshot(',
      'STALE-CONTINUATION-PRIVATE', 'Keine Treffer auf diesen Seiten', 'expect(await snapshot(owner.id)).toEqual(before)']) expect(browser).toContain(value);
    for (const value of ['test.skip(', 'test.only(', 'force: true']) expect(browser).not.toContain(value);
  });
});
