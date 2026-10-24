import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/browser-acceptance.yml', 'utf8');
const start = workflow.indexOf('      # New fifth partition:');
const original = workflow.slice(0, start).trimEnd() + '\n';
const partition = workflow.slice(start);
const browser = readFileSync('e2e/bank-billing-redesign.spec.ts', 'utf8');
const namesIn = (source: string) => [...source.matchAll(/allowed = \{([\s\S]*?)\n\s*\}/g)].flatMap(match => [...match[1].matchAll(/'([^']+\.png)'/g)].map(name => name[1]));

describe('bounded hosted bank and billing redesign acceptance', () => {
  it('preserves the exact accepted workflow, all 125 existing images and prior budgets', () => {
    expect(start).toBeGreaterThan(0);
    expect(createHash('sha256').update(original).digest('hex')).toBe('fd492ff1d816adbea6a329fa81d3e6c540886c5fef92fe94e5f6886487a6a407');
    const names = namesIn(original); expect(names).toHaveLength(125); expect(new Set(names).size).toBe(125);
    for (const value of ['timeout-minutes: 45', 'limit = 10 * 1024 * 1024', 'limit = 2 * 1024 * 1024', 'contents: read', '--retries=0']) expect(original).toContain(value);
  });
  it('requires all 28 unique 1440/390 light/dark captures in a separate bounded lossless partition', () => {
    const names = namesIn(partition); expect(names).toHaveLength(28); expect(new Set(names).size).toBe(28);
    for (const surface of ['bank-preview', 'bank-history', 'bank-allocation', 'service-plans', 'service-editor', 'today', 'today-compact']) for (const theme of ['light', 'dark']) for (const width of [1440, 390]) expect(names).toContain(`bank-billing-${surface}-${theme}-${width}.png`);
    for (const value of ['limit = 4 * 1024 * 1024', 'per_file_input_limit = 1 * 1024 * 1024', 'total > 8 * 1024 * 1024', 'actual_input_bytes > 8 * 1024 * 1024', 'timeout-minutes: 6', 'retention-days: 1', 'bank-billing-workspace-synthetic-visuals', '{source.name for source, _ in matches} != allowed', 'os.O_NOFOLLOW | os.O_NONBLOCK', 'stat.S_ISREG', 'source.resolve().is_relative_to(root)', 'current.st_size != expected.st_size', 'recompress_png_strong as recompress_png', 'zip(inputs, results, strict=True)', 'color metadata or full-pixel verification failed']) expect(partition).toContain(value);
  });
  it('adds four presentation cases without replacing genuine mutation coverage or weakening screenshot proofs', () => {
    expect([...browser.matchAll(/^test\('/gm)]).toHaveLength(4);
    for (const value of ['e2eDatabasePath()', 'noBusinessWrites', "route.abort('blockedbyclient')", "route.abort('connectionreset')", 'expect(payloads[0]).toEqual(payloads[1])', 'history.failHistory(true)', "getByText('Importverlauf laden…'", 'gridTemplateColumns', '16 * 1024 * 1024', 'fullPage: true', 'png.readUInt32BE(16)', 'png.readUInt32BE(20)', "page.goBack()", 'page.goForward()']) expect(browser).toContain(value);
    for (const value of ['test.skip(', 'test.only(', 'force: true', 'route.fetch(']) expect(browser).not.toContain(value);
    for (const file of ['e2e/bank-allocation.spec.ts', 'e2e/bank-import-receipt.spec.ts', 'e2e/service-billing.spec.ts']) expect(readFileSync(file, 'utf8')).toContain('prisma.');
  });
});
