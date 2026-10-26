import { withoutEarlyReceipt } from '../early-browser-workflow-contract.mjs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const fullWorkflow = readFileSync('.github/workflows/browser-acceptance.yml', 'utf8');
// Independently appended feature partitions do not redefine accepted legacy proofs.
const appended = ['      # Eighth independent partition:', '      # Independent record-search partition:']
  .map(marker => fullWorkflow.indexOf(marker)).filter(index => index >= 0);
const workflow = fullWorkflow.slice(0, appended.length ? Math.min(...appended) : undefined);
const start = workflow.indexOf('      # Seventh independent partition:');
const original = workflow.slice(0, start).trimEnd() + '\n';
const partition = workflow.slice(start);
const browser = readFileSync('e2e/sidebar-flat-icons.spec.ts', 'utf8');
const namesIn = (source: string) => [...source.matchAll(/allowed = \{([\s\S]*?)\n\s*\}/g)]
  .flatMap(match => [...match[1].matchAll(/'([^']+\.png)'/g)].map(name => name[1]));

describe('required bounded hosted flat-sidebar evidence', () => {
  it('retains the exact accepted workflow prefix and all 199 existing screenshot names and budgets', () => {
    expect(start).toBeGreaterThan(0);
    expect(createHash('sha256').update(withoutEarlyReceipt(original)).digest('hex')).toBe('a60892ca4e8950a834273ac50984a0ac21469bcfaf24b07a69517330be6804f7');
    const names = namesIn(original);
    expect(names).toHaveLength(199); expect(new Set(names).size).toBe(199);
    for (const value of ['timeout-minutes: 45', 'contents: read', '--retries=0',
      'limit = 10 * 1024 * 1024', 'limit = 2 * 1024 * 1024', 'limit = 4 * 1024 * 1024',
      'max 20 MiB total output', 'all 125 image proofs stay unchanged',
      'limit = 6 * 1024 * 1024', 'max 26 MiB total output', 'all 155 image proofs stay unchanged']) expect(original).toContain(value);
  });

  it('requires ten unique light/dark element screenshots within independent 1/4/2 MiB limits', () => {
    const names = namesIn(partition);
    expect(names).toHaveLength(10); expect(new Set(names).size).toBe(10);
    for (const theme of ['light', 'dark']) {
      for (const surface of ['expanded-top', 'expanded-bottom', 'collapsed']) expect(names).toContain(`sidebar-flat-${surface}-${theme}-1440.png`);
      for (const surface of ['mobile-top', 'mobile-bottom']) expect(names).toContain(`sidebar-flat-${surface}-${theme}-375.png`);
    }
    for (const value of ['limit = 2 * 1024 * 1024', 'per_file_input_limit = 1 * 1024 * 1024',
      'total > 4 * 1024 * 1024', 'actual_input_bytes > 4 * 1024 * 1024',
      'timeout-minutes: 6', 'timeout-minutes: 2', 'retention-days: 1',
      'sidebar-flat-icons-synthetic-visuals', 'if-no-files-found: error',
      'Require complete sidebar visual delivery', 'raise SystemExit(1)']) expect(partition).toContain(value);
    expect(partition).not.toContain('continue-on-error: true');
    expect(partition).not.toContain('raise SystemExit(0)');
    const allNames = namesIn(workflow);
    expect(allNames).toHaveLength(209); expect(new Set(allNames).size).toBe(209);
    expect(names.filter(name => namesIn(original).includes(name))).toEqual([]);
  });

  it('retains complete regular-path, bounded-read and lossless metadata/full-pixel proof guards', () => {
    for (const value of ['{source.name for source, _ in matches} != allowed',
      'len({source.name for source, _ in matches}) != len(matches)',
      'os.O_NOFOLLOW | os.O_NONBLOCK', 'stat.S_ISREG', 'source.resolve().is_relative_to(root)',
      '(current.st_dev, current.st_ino) != (expected.st_dev, expected.st_ino)',
      'current.st_size != expected.st_size', 'handle.read(min(per_file_input_limit, remaining_input) + 1)',
      'recompress_png_strong as recompress_png', 'zip(inputs, results, strict=True)',
      "ProcessPoolExecutor(max_workers=2, mp_context=get_context('fork'))",
      'color metadata or full-pixel verification failed']) expect(partition).toContain(value);
  });

  it('requires real rendered mask decoding, exact isolated admin fixture and complete top/bottom symbol unions', () => {
    for (const value of ['e2eDatabasePath()', "role: 'ADMIN'", 'expect(nav).toHaveCount(17)',
      'expect(sources.size).toBe(15)', 'mask: style.maskImage', 'expect(icon.ink).toBe(icon.color)',
      "expect(icon.mode).toBe('alpha')", 'await image.decode()', 'context.getImageData',
      "response.headers()['content-type']", "route.abort('blockedbyclient')", 'await page.reload()',
      "localStorage.getItem('sidebar-collapsed')", "page.goBack()", 'surface.screenshot(',
      "scale: 'css'", 'png.readUInt32BE(16)', 'png.readUInt32BE(20)',
      'prisma.user.deleteMany({ where: { id: user.id, email: user.email } })',
      "expect([...new Set([...top, ...bottom].filter(name => name?.startsWith('nav-')))].sort()).toEqual(navigationNames)",
      "expect([...new Set([...mobileTop, ...mobileBottom].filter(name => name?.startsWith('nav-')))].sort()).toEqual(navigationNames)"])
      expect(browser).toContain(value);
    for (const value of ['test.skip(', 'test.only(', 'force: true', 'page.screenshot(']) expect(browser).not.toContain(value);
  });
});
