import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Source-only checks for the next separately authorized hosted unit run.
const workflow = readFileSync('.github/workflows/browser-acceptance.yml', 'utf8');
const eighth = workflow.indexOf('      # Eighth independent partition:');
const acceptedWorkflow = workflow.slice(0, eighth < 0 ? undefined : eighth).trimEnd() + '\n';
const start = workflow.indexOf('      # New sixth partition:');
const original = workflow.slice(0, start).trimEnd() + '\n';
const end = workflow.indexOf('      # Seventh independent partition:', start);
const partition = workflow.slice(start, end < 0 ? undefined : end);
const reports = readFileSync('e2e/financial-reports-redesign.spec.ts', 'utf8');
const records = readFileSync('e2e/records-history-redesign.spec.ts', 'utf8');
const namesIn = (source: string) => [...source.matchAll(/allowed = \{([\s\S]*?)\n\s*\}/g)].flatMap(match => [...match[1].matchAll(/'([^']+\.png)'/g)].map(name => name[1]));

describe('bounded reports and records hosted visual acceptance', () => {
  it('preserves every byte of the accepted 155-image workflow and all existing gates', () => {
    expect(start).toBeGreaterThan(0);
    expect(createHash('sha256').update(original).digest('hex')).toBe('59b555efe0c3ce2119372adcb0f845a619d3ba969439792b4beb288b236b5efe');
    const names = namesIn(original); expect(names).toHaveLength(155); expect(new Set(names).size).toBe(155);
    for (const value of ['timeout-minutes: 45', 'timeout-minutes: 25', '--global-timeout=1200000', '--workers=1', '--retries=0', '--forbid-only', '--trace=off', 'contents: read', 'limit = 10 * 1024 * 1024', 'limit = 2 * 1024 * 1024', 'limit = 4 * 1024 * 1024']) expect(original).toContain(value);
  });
  it('requires all 44 additional exact light/dark desktop/mobile captures with disjoint names', () => {
    const names = namesIn(partition); expect(names).toHaveLength(44); expect(new Set(names).size).toBe(44);
    for (const surface of ['eur', 'gwg']) for (const theme of ['light', 'dark']) for (const width of [1440, 390]) expect(names).toContain(`financial-reports-${surface}-${theme}-${width}.png`);
    for (const surface of ['history-evidence', 'history-empty', 'reminder-queue']) for (const theme of ['light', 'dark']) for (const width of [1440, 390]) expect(names).toContain(`records-history-${surface}-${theme}-${width}.png`);
    for (const surface of ['reminder-confirmation', 'service-ledger', 'statement-selection']) for (const position of ['top', 'bottom']) for (const theme of ['light', 'dark']) for (const width of [1440, 390]) expect(names).toContain(`records-history-${surface}-${position}-${theme}-${width}.png`);
    expect(names.filter(name => namesIn(original).includes(name))).toEqual([]);
    expect(namesIn(acceptedWorkflow)).toHaveLength(209);
  });
  it('retains complete bounded safe reads, all lossless pixel/hash checks and one-day retention', () => {
    for (const value of ['limit = 6 * 1024 * 1024', 'per_file_input_limit = 1 * 1024 * 1024', 'total > 12 * 1024 * 1024', 'actual_input_bytes > 12 * 1024 * 1024', 'timeout-minutes: 6', 'timeout-minutes: 2', 'retention-days: 1', 'reports-records-workspace-synthetic-visuals', '{source.name for source, _ in matches} != allowed', 'len({source.name for source, _ in matches}) != len(matches)', 'os.O_NOFOLLOW | os.O_NONBLOCK', 'stat.S_ISREG', 'source.resolve().is_relative_to(root)', 'current.st_size != expected.st_size', 'handle.read(min(per_file_input_limit, remaining_input) + 1)', 'recompress_png_strong as recompress_png', 'zip(inputs, results, strict=True)', "ProcessPoolExecutor(max_workers=2, mp_context=get_context('fork'))", 'color metadata or full-pixel verification failed']) expect(partition).toContain(value);
  });
  it('authors additional isolated journeys and real scroll/capture proofs without removing real-flow coverage', () => {
    expect([...reports.matchAll(/^test\('/gm)]).toHaveLength(2);
    expect([...records.matchAll(/^    test\('/gm)]).toHaveLength(3);
    expect(records).toContain('for (const width of [1440, 390])'); expect(records).toContain("for (const theme of ['light', 'dark'] as const)");
    for (const source of [reports, records]) {
      for (const value of ['isolateSyntheticLoginIpBudget()', 'e2eDatabasePath()', "route.abort('blockedbyclient')", 'outputPath(', 'png.readUInt32BE(16)', 'png.readUInt32BE(20)', '16 * 1024 * 1024', '1024 * 1024', "createHash('sha256')", 'page.goBack()', 'page.goForward()']) expect(source).toContain(value);
      for (const value of ['test.skip(', 'test.only(', 'force: true', 'route.fetch(']) expect(source).not.toContain(value);
    }
    for (const value of ["['top', 'bottom']", "position === 'bottom' ? node.scrollHeight : 0", 'position, scroll, fullPage: !dialog', 'expect(await businessState(user.id)).toEqual(before)', "path === '/api/reminders/preview'", 'await unchanged()']) expect(records).toContain(value);
    for (const file of ['e2e/eur-2026.spec.ts', 'e2e/reminder-workbench.spec.ts', 'e2e/service-statement.spec.ts', 'e2e/invoice-history.spec.ts']) expect(readFileSync(file, 'utf8')).toContain('prisma.');
  });
});
