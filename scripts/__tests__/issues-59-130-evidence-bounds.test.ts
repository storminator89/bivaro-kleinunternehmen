import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Explicit opt-in policy header changed; all manual-suite body gates remain intact.
const workflow = readFileSync('.github/workflows/browser-acceptance.yml', 'utf8');
const start = workflow.indexOf('      # Eighth independent partition:');
const accepted = workflow.slice(0, start).trimEnd() + '\n';
const delivery = workflow.indexOf('      - name: Require complete supplier-task and simulation visual delivery', start);
const nextStep = workflow.indexOf('\n      - name:', delivery + 1);
// Scope this guard to its own partition, not subsequently appended evidence.
const partition = workflow.slice(start, nextStep < 0 ? undefined : nextStep);
const namesIn = (source: string) => [...source.matchAll(/allowed = \{([\s\S]*?)\n\s*\}/g)]
  .flatMap(match => [...match[1].matchAll(/'([^']+\.png)'/g)].map(name => name[1]));

describe('bounded reconstructed issue59/130 hosted evidence', () => {
  it('preserves every byte of accepted main workflow and its209 exact names and28 MiB budget', () => {
    expect(start).toBeGreaterThan(0);
    expect(createHash('sha256').update(accepted).digest('hex')).toBe('01f108c37c955be960f4732f0e6d4a2edd490abee0ecd733d9b97ae53f7dad71');
    expect(namesIn(accepted)).toHaveLength(209);
    expect(new Set(namesIn(accepted)).size).toBe(209);
    expect(accepted).toContain('max 28 MiB total output');
    expect(accepted).toContain('timeout-minutes: 45');
    expect(accepted).toContain('--retries=0');
  });
  it('requires eight disjoint exact captures with independent 1/4/2 MiB bounds and fail-closed delivery', () => {
    expect(namesIn(partition).sort()).toEqual([
      'supplier-tasks-1440.png', 'supplier-tasks-390.png', 'supplier-tasks-conflict-390.png',
      'supplier-task-inbox-1440.png', 'supplier-task-inbox-390.png',
      'simulation-transparency-1440.png', 'simulation-transparency-390.png', 'simulation-transparency-error-390.png',
    ].sort());
    expect(delivery).toBeGreaterThan(start);
    const owned = namesIn(accepted + partition);
    expect(owned).toHaveLength(217); expect(new Set(owned).size).toBe(217);
    const all = namesIn(workflow);
    expect(new Set(all).size).toBe(all.length);
    for (const value of ['limit = 2 * 1024 * 1024', 'per_file_input_limit = 1 * 1024 * 1024',
      'total > 4 * 1024 * 1024', 'actual_input_bytes > 4 * 1024 * 1024',
      'retention-days: 1', 'if-no-files-found: error', 'raise SystemExit(1)',
      'issues-59-130-synthetic-visuals', 'Require complete supplier-task and simulation visual delivery']) expect(partition).toContain(value);
    for (const value of ['continue-on-error: true', 'raise SystemExit(0)']) expect(partition).not.toContain(value);
  });
  it('retains safe regular-path bounded reads and full pixel/metadata lossless proofs', () => {
    for (const value of ['{source.name for source, _ in matches} != allowed',
      'len({source.name for source, _ in matches}) != len(matches)',
      'os.O_NOFOLLOW | os.O_NONBLOCK', 'stat.S_ISREG', 'source.resolve().is_relative_to(root)',
      '(current.st_dev, current.st_ino) != (expected.st_dev, expected.st_ino)',
      'current.st_size != expected.st_size', 'handle.read(min(per_file_input_limit, remaining_input) + 1)',
      'recompress_png_strong as recompress_png', 'zip(inputs, results, strict=True)',
      "ProcessPoolExecutor(max_workers=2, mp_context=get_context('fork'))",
      'color metadata or full-pixel verification failed']) expect(partition).toContain(value);
  });
});
