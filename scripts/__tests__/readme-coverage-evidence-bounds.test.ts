import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/browser-acceptance.yml', 'utf8');
const start = workflow.indexOf('\n      # README gallery coverage partition:');
const accepted = workflow.slice(0, start);
const delivery = workflow.indexOf('      - name: Require complete README coverage visual delivery', start);
const nextStep = workflow.indexOf('\n      - name:', delivery + 1);
const partition = workflow.slice(start, nextStep < 0 ? undefined : nextStep);
const namesIn = (source: string) => [...source.matchAll(/allowed = \{([\s\S]*?)\n\s*\}/g)]
  .flatMap(match => [...match[1].matchAll(/'([^']+\.png)'/g)].map(name => name[1]));

const names = [
  'invoice-editor-1440.png', 'quote-editor-1440.png', 'invoice-details-375.png',
  'cashbook-1440.png', 'users-1440.png', 'api-keys-1440.png', 'api-docs-1440.png',
  'audit-1440.png', 'procedures-1440.png', 'home-pilot-390.png', 'help-pilot-390.png',
  'access-help-1440.png', 'login-public.png', 'register-public.png', 'tax-studio-1440.png',
];

describe('bounded existing README-area hosted captures', () => {
  it('preserves the exact 220-image baseline and adds only fifteen disjoint owned names', () => {
    expect(start).toBeGreaterThan(0);
    expect(delivery).toBeGreaterThan(start);
    expect(createHash('sha256').update(accepted).digest('hex')).toBe('7977e7caf672538ac542976446a417d3aa191e3a8d1338c1c61ecab634df7091');
    expect(namesIn(accepted)).toHaveLength(220);
    expect(namesIn(partition).sort()).toEqual([...names].sort());
    const owned = namesIn(accepted + partition);
    expect(owned).toHaveLength(235); expect(new Set(owned).size).toBe(235);
    const all = namesIn(workflow);
    expect(new Set(all).size).toBe(all.length);
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).toContain('timeout-minutes: 45');
    expect(workflow).toContain('--retries=0');
  });

  it('requires bounded 5/12/6 MiB lossless native originals and fail-closed delivery', () => {
    for (const value of ['limit = 6 * 1024 * 1024', 'per_file_input_limit = 5 * 1024 * 1024',
      'total > 12 * 1024 * 1024', 'actual_input_bytes > 12 * 1024 * 1024',
      'retention-days: 1', 'if-no-files-found: error', 'raise SystemExit(1)',
      'readme-coverage-synthetic-visuals', 'timeout-minutes: 6', 'timeout-minutes: 2',
      '{source.name for source, _ in matches} != allowed',
      'len({source.name for source, _ in matches}) != len(matches)',
      'os.O_NOFOLLOW | os.O_NONBLOCK', 'stat.S_ISREG', 'source.resolve().is_relative_to(root)',
      '(current.st_dev, current.st_ino) != (expected.st_dev, expected.st_ino)',
      'current.st_size != expected.st_size', 'handle.read(min(per_file_input_limit, remaining_input) + 1)',
      'recompress_png_strong as recompress_png', 'zip(inputs, results, strict=True)',
      "ProcessPoolExecutor(max_workers=2, mp_context=get_context('fork'))",
      'color metadata or full-pixel verification failed']) expect(partition).toContain(value);
    for (const value of ['continue-on-error: true', 'raise SystemExit(0)']) expect(partition).not.toContain(value);
  });
});
