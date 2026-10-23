import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/browser-acceptance.yml', 'utf8');
const start = workflow.indexOf('      - name: Stage eight bounded cashflow screenshots separately');
const partition = workflow.slice(start, workflow.indexOf('      - name: Warn if optional evidence could not be delivered'));
const original = workflow.slice(0, start);
describe('explicit bounded cashflow screenshot partition', () => {
  it('keeps all 95 original proofs and their original budgets', () => {
    const names = original.match(/allowed = \{([\s\S]*?)\n\s*\}/)?.[1].match(/'[^']+\.png'/g);
    expect(names).toHaveLength(95);
    expect(original).toContain('limit = 10 * 1024 * 1024');
    expect(original).toContain('total > 16 * 1024 * 1024');
    expect(workflow).toContain('timeout-minutes: 45');
  });
  it('retains exactly eight cashflow views, bounded separately with explicit combined size', () => {
    const names = partition.match(/allowed = \{([\s\S]*?)\n\s*\}/)?.[1].match(/'[^']+\.png'/g);
    expect(names).toHaveLength(8);
    expect(new Set(names).size).toBe(8);
    for (const kind of ['income', 'expense']) for (const theme of ['light', 'dark']) for (const width of [1440, 390]) expect(names).toContain(`'cashflow-${kind}-${theme}-${width}.png'`);
    expect(partition).toContain('limit = 2 * 1024 * 1024');
    expect(partition).toContain('per_file_input_limit = 1 * 1024 * 1024');
    expect(partition).toContain('total > 4 * 1024 * 1024');
    expect(workflow).toContain('max 12 MiB combined output');
    expect(partition).toContain('retention-days: 1');
    expect(partition).toContain('timeout-minutes: 6');
  });
  it('requires complete, unique, safe files and unchanged lossless verification', () => {
    for (const source of ["{source.name for source, _ in matches} != allowed", 'os.O_NOFOLLOW | os.O_NONBLOCK', 'stat.S_ISREG', 'source.resolve().is_relative_to(root)', 'handle.read(min(per_file_input_limit, remaining_input) + 1)', 'actual_input_bytes > 4 * 1024 * 1024', 'current.st_size != expected.st_size', 'recompress_png(data)', "ProcessPoolExecutor(max_workers=2, mp_context=get_context('fork'))", 'zip(inputs, results, strict=True)', 'chunksize=1', 'color metadata or full-pixel verification failed']) expect(partition).toContain(source);
    expect(partition).toContain('cashflow-workspace-synthetic-visuals');
    expect(workflow).toContain('user-workflows-synthetic-visuals');
  });
});
