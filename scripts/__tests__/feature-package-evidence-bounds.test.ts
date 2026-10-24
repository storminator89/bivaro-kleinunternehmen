import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const workflow = readFileSync('.github/workflows/browser-acceptance.yml', 'utf8');
const start = workflow.indexOf('      - name: Stage bounded profile and numbering screenshots separately');
const original = workflow.slice(0, start), partition = workflow.slice(start);
const namesIn = (text: string) => [...text.matchAll(/allowed = \{([\s\S]*?)\n\s*\}/g)].flatMap(match => [...match[1].matchAll(/'([^']+\.png)'/g)].map(name => name[1]));
describe('bounded feature profile and numbering evidence partition', () => {
  it('preserves every prior image and budget without raising the functional job timeout or permissions', () => {
    expect(start).toBeGreaterThan(0);
    const names = namesIn(original); expect(names).toHaveLength(117); expect(new Set(names).size).toBe(117);
    expect(createHash('sha256').update(names.sort().join('\n')).digest('hex')).toBe('953e78ba2abeacda69acd96041eaf48c47a863222ac13b25316587b41383cf2f');
    for (const value of ['limit = 10 * 1024 * 1024', 'limit = 2 * 1024 * 1024', 'timeout-minutes: 45', 'contents: read', 'catalog-inbox-workspace-synthetic-visuals']) expect(original).toContain(value);
    expect(workflow).toContain('max 16 MiB total output; prior 14 MiB and all 117 image proofs stay unchanged');
  });
  it('requires all eight exact real mobile/desktop light/dark feature captures within a separate 2 MiB partition', () => {
    const names = namesIn(partition); expect(names).toHaveLength(8); expect(new Set(names).size).toBe(8);
    for (const surface of ['profiles', 'numbering']) for (const theme of ['light', 'dark']) for (const width of [1440, 390]) expect(names).toContain(`feature-${surface}-${theme}-${width}.png`);
    for (const value of ['limit = 2 * 1024 * 1024', 'per_file_input_limit = 1 * 1024 * 1024', 'total > 4 * 1024 * 1024', 'timeout-minutes: 6', 'timeout-minutes: 2', 'retention-days: 1', 'feature-package-synthetic-visuals']) expect(partition).toContain(value);
  });
  it('keeps complete unique safe reads and lossless metadata/pixel verification mandatory', () => {
    for (const value of ['{source.name for source, _ in matches} != allowed', 'len({source.name for source, _ in matches}) != len(matches)', 'os.O_NOFOLLOW | os.O_NONBLOCK', 'stat.S_ISREG', 'source.resolve().is_relative_to(root)', 'current.st_size != expected.st_size', 'handle.read(min(per_file_input_limit, remaining_input) + 1)', 'actual_input_bytes > 4 * 1024 * 1024', 'recompress_png_strong as recompress_png', 'zip(inputs, results, strict=True)', "ProcessPoolExecutor(max_workers=2, mp_context=get_context('fork'))", 'color metadata or full-pixel verification failed']) expect(partition).toContain(value);
  });
});
