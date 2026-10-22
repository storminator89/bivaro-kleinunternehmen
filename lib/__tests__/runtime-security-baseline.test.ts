import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));

describe('October 2026 patched runtime baseline', () => {
  it('aligns both Docker stages, development and CI with the patched Node 22 release', () => {
    const stages = read('Dockerfile').match(/^FROM node:[^\n]+/gm);
    expect(stages).toEqual([
      'FROM node:22.23.4-bookworm-slim AS base',
      'FROM node:22.23.4-bookworm-slim AS runner',
    ]);
    expect(read('.nvmrc').trim()).toBe('22.23.4');
    expect(read('.github/workflows/ci.yml')).toContain("NODE_VERSION: '22.23.4'");
    expect(read('.github/workflows/browser-acceptance.yml')).toContain("node-version: '22.23.4'");
  });

  it('declares patched supported LTS lines, without allowing EOL Node 23', () => {
    expect(pkg.engines.node).toBe('>=22.23.4 <23 || >=24.22.1 <25');
    expect(lock.packages[''].engines.node).toBe(pkg.engines.node);
  });

  it('locks the framework and its eslint integration to the security release', () => {
    expect(pkg.dependencies.next).toBe('16.4.1');
    expect(pkg.devDependencies['eslint-config-next']).toBe('16.4.1');
    for (const name of ['next', '@next/env', 'eslint-config-next', '@next/eslint-plugin-next']) {
      expect(lock.packages[`node_modules/${name}`].version).toBe('16.4.1');
    }
  });

  it('retains the documented sharp workaround and upgraded Vitest mocker', () => {
    expect(pkg.overrides.next.sharp).toBe('0.35.5');
    expect(lock.packages['node_modules/sharp'].version).toBe('0.35.5');
    expect(pkg.devDependencies.vitest).toBe('4.1.12');
    for (const name of ['vitest', '@vitest/mocker', '@vitest/runner', '@vitest/expect']) {
      expect(lock.packages[`node_modules/${name}`].version).toBe('4.1.12');
    }
  });

  it('keeps production audit enforcement without suppressing known findings', () => {
    expect(pkg.scripts['audit:security']).toBe('npm audit --omit=dev --audit-level=moderate');
    expect(pkg.overrides.braces).toBeUndefined();
  });
});
