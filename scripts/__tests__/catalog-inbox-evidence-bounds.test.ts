import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/browser-acceptance.yml', 'utf8');
const start = workflow.indexOf('      - name: Stage bounded catalog and inbox screenshots separately');
const original = workflow.slice(0, start);
const partition = workflow.slice(start);
const namesIn = (text: string) => [...text.matchAll(/allowed = \{([\s\S]*?)\n\s*\}/g)]
  .flatMap(match => [...match[1].matchAll(/'([^']+\.png)'/g)].map(name => name[1]));

describe('explicit bounded catalog and inbox screenshot partition', () => {
  it('preserves the exact 103 existing image names and both prior budgets', () => {
    expect(start).toBeGreaterThan(0);
    const names = namesIn(original);
    expect(names).toHaveLength(103);
    expect(new Set(names).size).toBe(103);
    // Fingerprint of the original 95 general + 8 cashflow allowlisted names.
    expect(createHash('sha256').update(names.sort().join('\n')).digest('hex'))
      .toBe('76536853de21ca55d7c7f56c1bb439ffc04f3200d35887668d958f194bdecea6');
    for (const source of ['limit = 10 * 1024 * 1024', 'total > 16 * 1024 * 1024',
      'limit = 2 * 1024 * 1024', 'total > 4 * 1024 * 1024',
      'user-workflows-synthetic-visuals', 'cashflow-workspace-synthetic-visuals',
      'timeout-minutes: 45']) expect(original).toContain(source);
  });

  it('requires exactly fourteen separately bounded catalog, receipt and expense captures', () => {
    const names = namesIn(partition);
    expect(names).toHaveLength(14);
    expect(new Set(names).size).toBe(14);
    for (const surface of ['articles', 'receipts', 'expense']) {
      for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
        expect(names).toContain(`catalog-inbox-${surface}-${theme}-${width}.png`);
      }
    }
    expect(names).toContain('catalog-inbox-upload-open-light-390.png');
    expect(names).toContain('catalog-inbox-upload-busy-dark-1440.png');
    for (const source of ['limit = 2 * 1024 * 1024', 'per_file_input_limit = 1 * 1024 * 1024',
      'total > 4 * 1024 * 1024', 'timeout-minutes: 6', 'timeout-minutes: 2',
      'retention-days: 1', 'catalog-inbox-workspace-synthetic-visuals']) expect(partition).toContain(source);
    expect(workflow).toContain('max 14 MiB total output across all three artifacts');
  });

  it('keeps complete unique safe-file reads and full lossless verification mandatory', () => {
    for (const source of ['{source.name for source, _ in matches} != allowed',
      'len({source.name for source, _ in matches}) != len(matches)',
      'os.O_NOFOLLOW | os.O_NONBLOCK', 'stat.S_ISREG', 'source.resolve().is_relative_to(root)',
      'current.st_size != expected.st_size', 'handle.read(min(per_file_input_limit, remaining_input) + 1)',
      'actual_input_bytes > 4 * 1024 * 1024', 'recompress_png_strong as recompress_png',
      'recompress_png(data)', "ProcessPoolExecutor(max_workers=2, mp_context=get_context('fork'))",
      'zip(inputs, results, strict=True)', 'chunksize=1', 'color metadata or full-pixel verification failed']) {
      expect(partition).toContain(source);
    }
  });
});
