import path from 'node:path';
import * as realFs from 'node:fs';
import { describe, expect, it } from 'vitest';
import EarlyBrowserReceiptReporter, { createReceiptReporter, finalizeReceipt, validReceipt, MAX_FAILURES, MAX_RECEIPT_BYTES } from '../early-browser-receipt.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { addEarlyReceipt, addPublicFragmentDelivery, withoutEarlyReceipt, NEW_REPORTER, EARLY_RECEIPT_STEPS, PUBLIC_FRAGMENT_STEPS } from '../early-browser-workflow-contract.mjs';

function fixture(planned = 1) {
  const files = new Map<string, string>();
  const directories = new Set(['/runner', '/repo']);
  const descriptors = new Map<number, string>();
  const nonregular = new Set<string>();
  const symlinks = new Map<string, string>();
  const warnings: string[] = [];
  const writes: { file: string; flag: string; mode: number }[] = [];
  const opened: number[] = [];
  let serial = 0;
  const env = {
    NODE_ENV: 'test' as const,
    RUNNER_TEMP: '/runner', GITHUB_WORKSPACE: '/repo', GITHUB_OUTPUT: '/actions/output',
    GITHUB_RUN_ID: '12345', GITHUB_RUN_ATTEMPT: '2', BIVARO_BROWSER_RECEIPT_HEAD: 'a'.repeat(40),
    SECRET_ENV: 'NEVER-PUBLISH-SECRET',
  };
  const io = {
    realpathSync(file: string) {
      if (symlinks.has(file)) return symlinks.get(file)!;
      if (!directories.has(file)) throw new Error('NEVER-PUBLISH-SECRET path');
      return file;
    },
    mkdtempSync(prefix: string) {
      const directory = prefix + String(++serial).padStart(6, '0');
      directories.add(directory);
      return directory;
    },
    writeFileSync(file: string, data: string, options: { flag: string; mode: number }) {
      expect(options).toEqual({ flag: 'wx', mode: 0o600 });
      if (files.has(file)) throw new Error('NEVER-PUBLISH-SECRET existing file');
      writes.push({ file, ...options }); files.set(file, data);
    },
    renameSync(from: string, to: string) {
      if (!files.has(from)) throw new Error('NEVER-PUBLISH-SECRET missing temp');
      files.set(to, files.get(from)!); files.delete(from);
    },
    appendFileSync(file: string, data: string) {
      expect(file).toBe(env.GITHUB_OUTPUT);
      files.set(file, (files.get(file) ?? '') + data);
    },
    readFileSync(file: string) {
      if (!files.has(file)) throw new Error('NEVER-PUBLISH-SECRET missing file');
      return files.get(file)!;
    },
    openSync(file: string, flags: number) {
      opened.push(flags);
      if (symlinks.has(file) || !files.has(file)) throw new Error('NEVER-PUBLISH-SECRET unsafe file');
      const fd = 50 + descriptors.size; descriptors.set(fd, file); return fd;
    },
    fstatSync(fd: number) {
      const file = descriptors.get(fd)!;
      return { isFile: () => !nonregular.has(file), size: Buffer.byteLength(files.get(file)!) };
    },
    readSync(fd: number, buffer: Buffer) {
      const data = Buffer.from(files.get(descriptors.get(fd)!)!);
      data.copy(buffer); return Math.min(data.length, buffer.length);
    },
    closeSync(fd: number) { descriptors.delete(fd); },
  };
  const dependencies = { env, io: io as unknown as typeof realFs, warn: () => warnings.push('diagnostic-unavailable') };
  const reporter = createReceiptReporter(dependencies);
  const directory = reporter.onBegin({}, { allTests: () => new Array(planned).fill(null) })!;
  const file = path.join(directory, 'receipt.json');
  const snapshot = () => JSON.parse(files.get(file)!);
  const final = (outcome = 'failure') => {
    const finalEnv = { ...env, BIVARO_BROWSER_RECEIPT_DIRECTORY: directory, BIVARO_BROWSER_SUITE_OUTCOME: outcome };
    const result = finalizeReceipt({ ...dependencies, env: finalEnv });
    const output = files.get(env.GITHUB_OUTPUT)!;
    const target = output.trim().split('\n').filter(line => line.startsWith('early_receipt_directory=')).at(-1)!.split('=')[1];
    return { result, target, receipt: JSON.parse(files.get(path.join(target, 'receipt.json'))!) };
  };
  return { files, env, io, dependencies, reporter, directory, file, snapshot, final, warnings, writes, opened, descriptors, nonregular, symlinks, directories };
}

const caseInfo = (file = '/repo/e2e/public-help-fragments.spec.ts', project = 'chromium') => ({
  location: { file, line: 23, column: 5 }, parent: { project: () => ({ name: project }) }, expectedStatus: 'passed',
  title: 'NEVER-PUBLISH-SECRET TITLE',
});
const result = (status = 'failed', message = 'Received: viewport ratio 0') => ({
  status, errors: [{ message, stack: 'NEVER-PUBLISH-SECRET STACK' }], stdout: ['NEVER-PUBLISH-SECRET STDOUT'],
});

describe('bounded early synthetic browser receipt', () => {
  it('imports the protocol without work and never returns a suite-status override', () => {
    const reporter = new EarlyBrowserReceiptReporter();
    expect(reporter.printsToStdio()).toBe(false);
    expect(reporter.onEnd({ status: 'passed' })).toBeUndefined();
    expect(reporter.onError(new Error('NEVER-PUBLISH-SECRET'))).toBeUndefined();
    const f = fixture();
    reporter.reporter = f.reporter;
    reporter.onTestEnd(caseInfo(), result());
    expect(reporter.onEnd({ status: 'failed' })).toBeUndefined();
    expect(f.snapshot()).toMatchObject({ completed: true, endStatus: 'failed', acceptanceEvidence: false });
  });
  it('checkpoints before onEnd outside the runner-owned database fixture, with only allowlisted hints', () => {
    const f = fixture();
    expect(f.directory).toMatch(/^\/runner\/bivaro-browser-receipt-12345-2-/);
    expect(f.snapshot()).toMatchObject({ completed: false, incomplete: true, onEndObserved: false, acceptanceEvidence: false });
    f.reporter.onTestEnd(caseInfo(), result('failed', 'P2003 ENOENT strict mode violation viewport ratio 0 /api/auth/_log https://secret.invalid?token=NEVER-PUBLISH-SECRET'));
    const data = f.files.get(f.file)!;
    expect(data).not.toMatch(/NEVER-PUBLISH-SECRET|secret\.invalid|token=|STACK|STDOUT|TITLE/);
    expect(f.snapshot().failures[0].hintTags).toEqual(['PRISMA_P2003', 'ENOENT', 'STRICT_LOCATOR_DUPLICATE', 'VIEWPORT_RATIO_ZERO', 'AUTH_LOG_TRANSPORT']);
    expect(f.snapshot().hintsAreNotDiagnoses).toBe(true);
    expect(f.snapshot().incomplete).toBe(true);
    expect(f.writes.every(write => write.flag === 'wx' && write.mode === 0o600)).toBe(true);
  });
  it('keeps complete execution distinct from passing acceptance and preserves failed-then-cancelled cases', () => {
    const f = fixture();
    f.reporter.onTestEnd(caseInfo(), result());
    expect(f.reporter.onEnd({ status: 'failed' })).toBeUndefined();
    expect(f.snapshot()).toMatchObject({ completed: true, incomplete: false, onEndObserved: true, endStatus: 'failed', acceptanceEvidence: false });
    const final = f.final('cancelled');
    expect(final.result).toBe(true);
    expect(final.receipt).toMatchObject({ functionalStepOutcome: 'cancelled', completed: false, incomplete: true, reporterUnavailable: false });
    expect(final.receipt.failures).toHaveLength(1);
    expect(f.opened[0] & realFs.constants.O_NOFOLLOW).not.toBe(0);
    expect(f.opened[0] & realFs.constants.O_NONBLOCK).not.toBe(0);
    expect(f.descriptors.size).toBe(0);
  });
  it.each(['interrupted', 'timedout', 'unknown'])('never calls an %s terminal hook complete execution', status => {
    const f = fixture(2); f.reporter.onTestEnd(caseInfo(), result('passed'));
    f.reporter.onEnd({ status });
    expect(f.snapshot()).toMatchObject({ completed: false, incomplete: true, onEndObserved: true });
  });
  it('marks redacted outside paths/projects as incomplete, without serializing their values', () => {
    const f = fixture(); f.reporter.onTestEnd(caseInfo('/private/NEVER-PUBLISH-SECRET.spec.ts', 'NEVER-PUBLISH-SECRET'), result());
    f.reporter.onEnd({ status: 'failed' });
    expect(f.snapshot()).toMatchObject({ completed: false, incomplete: true, redactedLocations: 1 });
    expect(f.snapshot().failures[0]).toMatchObject({ file: 'unknown', project: 'other' });
    expect(f.files.get(f.file)).not.toContain('NEVER-PUBLISH-SECRET');
  });
  it('bounds records and error-prefix inspection with explicit overflow', () => {
    const f = fixture(MAX_FAILURES + 6);
    for (let index = 0; index < MAX_FAILURES + 6; index++) f.reporter.onTestEnd(caseInfo(), result('failed', 'x'.repeat(4096) + 'P2003'));
    f.reporter.onEnd({ status: 'failed' });
    expect(f.snapshot()).toMatchObject({ overflow: true, omittedFailures: 6, completed: false, incomplete: true });
    expect(f.snapshot().failures).toHaveLength(MAX_FAILURES);
    expect(f.snapshot().failures.every((entry: { hintTags: unknown[] }) => entry.hintTags.length === 0)).toBe(true);
    expect(Buffer.byteLength(f.files.get(f.file)!)).toBeLessThanOrEqual(MAX_RECEIPT_BYTES);
  });
  it('creates a fresh unavailable fallback for startup failure without reporter output', () => {
    const f = fixture();
    const final = finalizeReceipt({ ...f.dependencies, env: { ...f.env, BIVARO_BROWSER_SUITE_OUTCOME: 'failure', BIVARO_BROWSER_RECEIPT_DIRECTORY: '' } });
    expect(final).toBe(true);
    const directories = [...f.directories].filter(value => value.includes('bivaro-browser-receipt-'));
    expect(directories).toHaveLength(2);
    const receipt = JSON.parse(f.files.get(path.join(directories[1], 'receipt.json'))!);
    expect(receipt).toMatchObject({ reporterUnavailable: true, completed: false, incomplete: true, plannedCases: null, functionalStepOutcome: 'failure' });
    expect(receipt.failures).toEqual([]);
  });
  it.each(['stale-head', 'stale-attempt', 'malformed', 'oversized', 'nonregular', 'symlink', 'unknown-key', 'forged-complete', 'mismatched-count'])('rejects %s input without re-publishing raw untrusted content', scenario => {
    const f = fixture();
    const value = f.snapshot();
    if (scenario === 'stale-head') value.head = 'b'.repeat(40);
    if (scenario === 'stale-attempt') value.attempt = '1';
    if (scenario === 'unknown-key') value.privateError = 'NEVER-PUBLISH-SECRET';
    if (scenario === 'forged-complete') { value.completed = true; value.incomplete = false; }
    if (scenario === 'mismatched-count') {
      value.completed = true; value.incomplete = false; value.onEndObserved = true; value.endStatus = 'passed';
      value.plannedCases = 2; value.counts.passed = 1;
    }
    f.files.set(f.file, scenario === 'malformed' ? '{"NEVER-PUBLISH-SECRET":' : scenario === 'oversized' ? 'x'.repeat(MAX_RECEIPT_BYTES + 1) : JSON.stringify(value));
    if (scenario === 'nonregular') f.nonregular.add(f.file);
    if (scenario === 'symlink') f.symlinks.set(f.file, '/private/NEVER-PUBLISH-SECRET');
    const final = f.final();
    expect(final.result).toBe(true); expect(final.target).not.toBe(f.directory);
    expect(final.receipt).toMatchObject({ reporterUnavailable: true, incomplete: true, completed: false, head: f.env.BIVARO_BROWSER_RECEIPT_HEAD });
    expect(JSON.stringify(final.receipt)).not.toContain('NEVER-PUBLISH-SECRET');
    expect(f.descriptors.size).toBe(0);
  });
  it('rejects invalid metadata at both generation and finalization, with no raw warning or IO exception', () => {
    const f = fixture();
    for (const env of [
      { ...f.env, GITHUB_RUN_ID: '0' }, { ...f.env, GITHUB_RUN_ATTEMPT: '../x' }, { ...f.env, BIVARO_BROWSER_RECEIPT_HEAD: 'secret' },
      { ...f.env, RUNNER_TEMP: 'relative' }, { ...f.env, GITHUB_OUTPUT: '/actions/output\nSECRET=x' },
    ]) {
      expect(createReceiptReporter({ ...f.dependencies, env }).onBegin({}, { allTests: () => [] })).toBeUndefined();
      expect(validReceipt(f.snapshot(), env)).toBe(false);
      expect(finalizeReceipt({ ...f.dependencies, env: { ...env, BIVARO_BROWSER_SUITE_OUTCOME: 'failure' } })).toBe(false);
    }
    expect(f.warnings.every(message => message === 'diagnostic-unavailable')).toBe(true);
  });
  it('swallows poisoned event/getter/write errors and does not modify process exit state', () => {
    const f = fixture(); const before = process.exitCode;
    const poisoned = Object.defineProperty({}, 'status', { get() { throw new Error('NEVER-PUBLISH-SECRET'); } });
    expect(() => f.reporter.onEnd(poisoned)).not.toThrow();
    expect(process.exitCode).toBe(before);
    const broken = { ...f.io, writeFileSync() { throw new Error('NEVER-PUBLISH-SECRET write'); } };
    const reporter = createReceiptReporter({ ...f.dependencies, io: broken as unknown as typeof realFs, warn: () => { throw new Error('NEVER-PUBLISH-SECRET warn'); } });
    expect(() => reporter.onBegin({}, { allTests: () => [] })).not.toThrow();
    expect(process.exitCode).toBe(before);
  });
});

describe('strict additive early-receipt workflow contract', () => {
  const raw = readFileSync('.github/workflows/browser-acceptance.yml', 'utf8');
  it('restores the complete accepted workflow with every original byte/hash and all raw gates intact', () => {
    const restored = withoutEarlyReceipt(raw);
    expect(createHash('sha256').update(restored).digest('hex')).toBe('18f4700c90176f53ce97257fda3b05e8332a30c57ae68c7b2841d4551d3b0249');
    expect(addPublicFragmentDelivery(addEarlyReceipt(restored))).toBe(raw);
    expect(raw).toContain(NEW_REPORTER);
    expect(raw).toContain(EARLY_RECEIPT_STEPS);
    expect(raw.match(/allowed = \{/g)).toHaveLength(12);
    expect(raw.match(/recompress_png_strong as recompress_png/g)).toHaveLength(12);
    expect(raw).toContain('--workers=1\n          --retries=0\n          --forbid-only');
    expect(raw).toContain('--trace=off');
    expect(raw).toContain('timeout-minutes: 45');
    expect(raw).not.toContain('!cancelled()');
  });
  it('uploads a single bounded current receipt before all expensive rendering/screenshots, even after failure', () => {
    expect(createHash('sha256').update(EARLY_RECEIPT_STEPS).digest('hex')).toBe('88b9efaf6a4b3027c5b346bece7c3a7a19d600490191830b1ebb4945e2aa68fd');
    expect(raw.indexOf(EARLY_RECEIPT_STEPS)).toBeLessThan(raw.indexOf('      - name: Require both real final-byte browser cases'));
    expect(EARLY_RECEIPT_STEPS).toContain('/receipt.json');
    expect(EARLY_RECEIPT_STEPS).toContain('retention-days: 1');
    expect(EARLY_RECEIPT_STEPS).toContain('continue-on-error: true');
    expect(EARLY_RECEIPT_STEPS).toContain('steps.functional-suite.outcome');
    expect(EARLY_RECEIPT_STEPS).not.toMatch(/env\s*$|secrets\.|DATABASE_URL|uploads|test-results|\.\/|always\(\).*success/u);
    expect(raw).toContain('id: functional-suite');
    expect(raw).toContain('BIVARO_BROWSER_RECEIPT_HEAD:');
  });
  it('refuses partial/duplicate/tampered reviewed insertions instead of hiding arbitrary workflow changes', () => {
    expect(() => withoutEarlyReceipt(raw.replace(NEW_REPORTER, NEW_REPORTER + NEW_REPORTER))).toThrow();
    expect(() => withoutEarlyReceipt(raw.replace(EARLY_RECEIPT_STEPS, ''))).toThrow();
    expect(() => withoutEarlyReceipt(raw.replace('browser-early-functional-receipt', 'different-artifact'))).toThrow();
  });
  it('delivers only a separate bounded public diagnostic file before the unchanged required evidence gates', () => {
    expect(createHash('sha256').update(PUBLIC_FRAGMENT_STEPS).digest('hex')).toBe('f1e5a532504defc5c5d9982020afca8202ddd685aa01c2230a7d27bf8c36fd92');
    expect(raw.indexOf(PUBLIC_FRAGMENT_STEPS)).toBeGreaterThan(raw.indexOf(EARLY_RECEIPT_STEPS));
    expect(raw.indexOf(PUBLIC_FRAGMENT_STEPS)).toBeLessThan(raw.indexOf('      - name: Require both real final-byte browser cases'));
    expect(PUBLIC_FRAGMENT_STEPS).toContain('/public-fragments.json');
    expect(PUBLIC_FRAGMENT_STEPS).toContain('steps.functional-suite.outcome');
    expect(PUBLIC_FRAGMENT_STEPS.match(/timeout-minutes: 1/g)).toHaveLength(2);
    expect(PUBLIC_FRAGMENT_STEPS).not.toMatch(/secrets\.|DATABASE_URL|uploads|test-results|\*|trace|\.log/u);
    expect(() => withoutEarlyReceipt(raw.replace(PUBLIC_FRAGMENT_STEPS, PUBLIC_FRAGMENT_STEPS + PUBLIC_FRAGMENT_STEPS))).toThrow();
    expect(() => withoutEarlyReceipt(raw.replace('public-fragment-failure-diagnostics', 'unreviewed-artifact'))).toThrow();
  });
});
