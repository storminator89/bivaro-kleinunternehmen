import path from 'node:path';
import * as realFs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPublicFragmentCollector, finalizePublicFragmentDiagnostics, MAX_PUBLIC_FRAGMENT_BYTES, MAX_PUBLIC_FRAGMENT_INPUT_BYTES, MAX_PUBLIC_FRAGMENT_ENTRIES, MAX_PUBLIC_FRAGMENT_ATTACHMENTS } from '../public-fragment-diagnostics.mjs';

const SECRET = 'NEVER-PUBLISH-SECRET';
const TITLES = {
  'first-workflow': 'returns from cached first-workflow help through the brand and home CTA to exactly one fragment',
  offer: 'returns from cached offer help through the brand and home footer to exactly one fragment',
};
type Label = keyof typeof TITLES;
const caseInfo = (label: Label = 'first-workflow', file = '/repo/e2e/public-help-fragments.spec.ts', project = 'chromium') => ({
  location: { file, line: 23, column: 5 }, parent: { project: () => ({ name: project }) }, title: TITLES[label], expectedStatus: 'passed',
});
function payload(label: Label = 'first-workflow') {
  const id = label === 'offer' ? 'angebot' : 'erste-rechnung-title';
  const fragment = label === 'offer' ? 'angebot' : 'erste-rechnung';
  const geometry = (id: string) => ({
    tag: 'H2', id, text: SECRET,
    rect: { x: 1, y: -2, width: 800, height: 40, top: -2, bottom: 38 },
    display: 'block', visibility: 'visible', position: 'static', scrollMarginTop: '24px',
    ancestors: [{ tag: 'DIV', id: SECRET, hidden: true, ariaHidden: 'true', inert: false, display: 'none', visibility: 'hidden', streamContainer: true }],
  });
  return {
    label, outcome: 'failed',
    navigationEvents: [{ event: 'document-request', url: `http://127.0.0.1:3100/help#${fragment}` }, { event: 'load', url: 'http://127.0.0.1:3100/' }],
    navigationOverflow: false, sessionResponses: [{ status: 200, path: '/api/auth/session' }], sessionOverflow: false, passiveObservationUnavailable: false,
    snapshot: {
      phase: 'after-original-failure', url: `http://127.0.0.1:3100/help#${fragment}`, readyState: 'complete', visibilityState: 'visible', timeOrigin: 1_790_000_000_000,
      navigation: { url: 'http://127.0.0.1:3100/help', type: 'navigate', domContentLoadedEventEnd: 12.5, loadEventEnd: 15, duration: 15 },
      fonts: 'loaded', viewport: { width: 1280, height: 720 }, scroll: { x: 0, y: 42, restoration: 'auto', element: 'HTML', top: 42, height: 7000 },
      target: { id, count: 1, samples: [geometry(id)] }, fragment: { id: fragment, count: 1, samples: [geometry(fragment)] },
    },
  };
}
function result(label: Label = 'first-workflow', status = 'failed', value: unknown = payload(label)) {
  return {
    status, errors: [{ message: SECRET, stack: SECRET }], stdout: [SECRET], stderr: [SECRET],
    attachments: [{ name: `public-${label}-fragment-failure.json`, contentType: 'application/json', body: Buffer.from(JSON.stringify(value)), path: `/private/${SECRET}` }],
  };
}
function fixture(begin = true, tests = [caseInfo(), caseInfo('offer')]) {
  const files = new Map<string, string>();
  const directories = new Set(['/runner', '/repo']);
  const descriptors = new Map<number, string>();
  const nonregular = new Set<string>();
  const symlinks = new Map<string, string>();
  const writes: { file: string; flag: string; mode: number }[] = [];
  const modes: number[] = [];
  const opened: number[] = [];
  const warnings: string[] = [];
  let serial = 0;
  const env = {
    NODE_ENV: 'test' as const, RUNNER_TEMP: '/runner', GITHUB_WORKSPACE: '/repo', GITHUB_OUTPUT: '/actions/output',
    GITHUB_RUN_ID: '12345', GITHUB_RUN_ATTEMPT: '2', BIVARO_BROWSER_RECEIPT_HEAD: 'a'.repeat(40), PRIVATE_VALUE: SECRET,
  };
  const io = {
    realpathSync(file: string) {
      if (symlinks.has(file)) return symlinks.get(file)!;
      if (!directories.has(file)) throw new Error(SECRET);
      return file;
    },
    mkdtempSync(prefix: string) { const directory = prefix + String(++serial).padStart(6, '0'); directories.add(directory); return directory; },
    chmodSync(_file: string, mode: number) { modes.push(mode); },
    writeFileSync(file: string, data: string, options: { flag: string; mode: number }) {
      expect(options).toEqual({ flag: 'wx', mode: 0o600 });
      if (files.has(file)) throw new Error(SECRET);
      files.set(file, data); writes.push({ file, ...options });
    },
    renameSync(from: string, to: string) {
      if (!files.has(from)) throw new Error(SECRET);
      files.set(to, files.get(from)!); files.delete(from);
    },
    appendFileSync(file: string, data: string) {
      expect(file).toBe(env.GITHUB_OUTPUT);
      const directory = data.match(/^public_fragment_directory=(.+)$/m)![1];
      expect(files.has(path.join(directory, 'public-fragments.json'))).toBe(true);
      files.set(file, (files.get(file) ?? '') + data);
    },
    openSync(file: string, flags: number) {
      opened.push(flags);
      if (symlinks.has(file) || !files.has(file)) throw new Error(SECRET);
      const fd = 50 + descriptors.size; descriptors.set(fd, file); return fd;
    },
    fstatSync(fd: number) { const file = descriptors.get(fd)!; return { isFile: () => !nonregular.has(file), size: Buffer.byteLength(files.get(file)!) }; },
    readSync(fd: number, buffer: Buffer) { const value = Buffer.from(files.get(descriptors.get(fd)!)!); value.copy(buffer); return Math.min(value.length, buffer.length); },
    closeSync(fd: number) { descriptors.delete(fd); },
  };
  const dependencies = { env, io: io as unknown as typeof realFs, warn: () => warnings.push('fixed-warning') };
  const collector = createPublicFragmentCollector(dependencies);
  const outputDirectory = () => files.get(env.GITHUB_OUTPUT)?.trim().split('\n').filter(line => line.startsWith('public_fragment_directory=')).at(-1)?.slice('public_fragment_directory='.length);
  if (begin) expect(collector.onBegin({}, { allTests: () => tests })).toBeUndefined();
  const directory = outputDirectory()!;
  const file = directory ? path.join(directory, 'public-fragments.json') : '';
  const snapshot = () => JSON.parse(files.get(file)!);
  const final = (outcome = 'failure', selected = directory) => {
    const finalEnv = { ...env, BIVARO_PUBLIC_FRAGMENT_DIRECTORY: selected, BIVARO_BROWSER_SUITE_OUTCOME: outcome };
    const success = finalizePublicFragmentDiagnostics({ ...dependencies, env: finalEnv });
    const target = outputDirectory()!;
    return { success, target, value: JSON.parse(files.get(path.join(target, 'public-fragments.json'))!) };
  };
  return { env, io, dependencies, collector, directories, files, directory, file, snapshot, final, writes, modes, warnings, descriptors, opened, symlinks, nonregular, outputDirectory };
}
function finish(f: ReturnType<typeof fixture>) {
  f.collector.onTestEnd(caseInfo(), result()); f.collector.onTestEnd(caseInfo('offer'), result('offer'));
  expect(f.collector.onEnd({ status: 'failed' })).toBeUndefined();
}

describe('failure-only bounded public fragment collector', () => {
  it('does no work until onBegin, creates fresh private checkpoints, and never returns a status override', () => {
    const f = fixture(false);
    expect(f.files.size).toBe(0);
    expect(f.collector.onTestEnd(caseInfo(), result())).toBeUndefined();
    expect(f.collector.onEnd({ status: 'passed' })).toBeUndefined();
    expect(f.collector.onBegin({}, { allTests: () => [caseInfo()] })).toBeUndefined();
    const directory = f.outputDirectory()!;
    expect(directory).toMatch(/^\/runner\/bivaro-public-fragments-12345-2-[A-Za-z0-9]{6}$/);
    expect(directory).not.toMatch(/e2e|fixture/);
    expect(f.modes).toEqual([0o700]);
    expect(f.writes.every(write => write.flag === 'wx' && write.mode === 0o600)).toBe(true);
    expect(JSON.parse(f.files.get(path.join(directory, 'public-fragments.json'))!)).toMatchObject({ incomplete: true, completed: false, acceptanceEvidence: false, noMatchingFailureObserved: true });
  });
  it('persists body-only observations before onEnd and omits private text, ancestor IDs, origins and unrelated result data', () => {
    const f = fixture(); const original = result(); const before = JSON.stringify(original); const exitCode = process.exitCode;
    expect(f.collector.onTestEnd(caseInfo(), original)).toBeUndefined();
    expect(JSON.stringify(original)).toBe(before); expect(process.exitCode).toBe(exitCode);
    const state = f.snapshot();
    expect(state).toMatchObject({ onEndObserved: false, incomplete: true, noMatchingFailureObserved: false, unavailable: false });
    expect(state.entries[0]).toMatchObject({ label: 'first-workflow', status: 'failed', unavailableReason: null, observation: { snapshot: { location: '/help#erste-rechnung', target: { id: 'erste-rechnung-title' }, fragment: { id: 'erste-rechnung' } } } });
    expect(state.entries[0].observation.snapshot.target.samples[0]).toMatchObject({ scrollMarginTopPx: 24, ancestors: [{ hidden: true, streamContainer: true }] });
    expect(f.files.get(f.file)).not.toMatch(/NEVER-PUBLISH-SECRET|127\.0\.0\.1|http:|"text"|"headers"|"cookies"|"body"|"stack"|"errors"|"stdout"|PRIVATE_VALUE/);
    expect(f.files.get(f.file)).not.toContain('"id":"NEVER');
  });
  it.each(['passed', 'skipped'])('never inspects attachments on a %s result', status => {
    const f = fixture();
    const safe = Object.defineProperty({ status }, 'attachments', { get() { throw new Error(SECRET); } });
    expect(() => f.collector.onTestEnd(caseInfo(), safe)).not.toThrow();
    expect(f.snapshot()).toMatchObject({ unavailable: false, reporterUnavailable: false, noMatchingFailureObserved: true });
    expect(f.snapshot().entries).toEqual([]);
  });
  it.each([
    ['/repo/e2e/other.spec.ts', 'chromium'], ['/private/e2e/public-help-fragments.spec.ts', 'chromium'],
    ['/repo/e2e/public-help-fragments.spec.ts.bak', 'chromium'], ['/repo/e2e/public-help-fragments.spec.ts', 'chromium-bootstrap'],
  ])('ignores out-of-scope test %s project %s without reading the result', (file, project) => {
    const f = fixture();
    const unsafe = Object.defineProperty({}, 'status', { get() { throw new Error(SECRET); } });
    f.collector.onTestEnd(caseInfo('offer', file, project), unsafe);
    expect(f.snapshot()).toMatchObject({ reporterUnavailable: false, noMatchingFailureObserved: true });
  });
  it('requires the exact source test title, attachment name, MIME type and corresponding label/target', () => {
    for (const scenario of ['title', 'name', 'mime', 'label', 'target', 'wrong-attachment'] as const) {
      const f = fixture(); const test = caseInfo(); const value = payload(); const current = result();
      if (scenario === 'title') test.title = SECRET;
      if (scenario === 'name') current.attachments[0].name = 'public-first-workflow-fragment-failure.json.bak';
      if (scenario === 'mime') current.attachments[0].contentType = 'application/json; charset=utf-8';
      if (scenario === 'label') value.label = 'offer';
      if (scenario === 'target') value.snapshot.target.id = 'angebot';
      if (scenario === 'wrong-attachment') current.attachments[0].name = 'public-offer-fragment-failure.json';
      current.attachments[0].body = Buffer.from(JSON.stringify(value));
      f.collector.onTestEnd(test, current);
      expect(f.snapshot().unavailable).toBe(true);
      expect(f.files.get(f.file)).not.toContain(SECRET);
      expect(f.snapshot().entries.every((entry: { observation: unknown }) => entry.observation === null)).toBe(true);
    }
  });
  it.each(['failed', 'timedOut', 'interrupted'])('retains original %s result and reports it without suite override', status => {
    const f = fixture(); const original = Object.freeze(result('first-workflow', status));
    const originalError = original.errors[0]; f.collector.onTestEnd(caseInfo(), original);
    expect(f.collector.onEnd({ status: status === 'timedOut' ? 'timedout' : status })).toBeUndefined();
    expect(original.errors[0]).toBe(originalError); expect(original.status).toBe(status);
    expect(f.snapshot().entries[0].status).toBe(status);
    if (status !== 'failed') expect(f.snapshot().incomplete).toBe(true);
  });
  it('distinguishes complete diagnostics from suite acceptance and finalizes the actual step outcome', () => {
    const f = fixture(); finish(f);
    expect(f.snapshot()).toMatchObject({ completed: true, incomplete: false, acceptanceEvidence: false, endStatus: 'failed', onEndObserved: true });
    const final = f.final('failure');
    expect(final.success).toBe(true); expect(final.target).toBe(f.directory);
    expect(final.value).toMatchObject({ completed: true, functionalStepOutcome: 'failure', acceptanceEvidence: false });
    expect(f.opened[0] & realFs.constants.O_NOFOLLOW).not.toBe(0);
    expect(f.opened[0] & realFs.constants.O_NONBLOCK).not.toBe(0);
    expect(f.descriptors.size).toBe(0);
  });
  it('explicitly says no matching failure was observed without inferring suite pass', () => {
    const f = fixture(); f.collector.onTestEnd(caseInfo(), result('first-workflow', 'passed')); f.collector.onTestEnd(caseInfo('offer'), result('offer', 'passed'));
    f.collector.onEnd({ status: 'failed' });
    expect(f.final().value).toMatchObject({ noMatchingFailureObserved: true, acceptanceEvidence: false, endStatus: 'failed', functionalStepOutcome: 'failure', entries: [] });
  });
  it.each(['cancelled', 'skipped'])('retains diagnostics but marks actual %s step incomplete', outcome => {
    const f = fixture(); finish(f); const final = f.final(outcome);
    expect(final.value).toMatchObject({ completed: false, incomplete: true, reporterUnavailable: false, functionalStepOutcome: outcome });
    expect(final.value.entries).toHaveLength(2);
  });
  it('marks a missing attachment and missing snapshot explicitly, including a torn-down page', () => {
    const f = fixture(); f.collector.onTestEnd(caseInfo(), { status: 'failed', attachments: [] });
    const withoutSnapshot = { ...payload('offer'), snapshot: null };
    f.collector.onTestEnd(caseInfo('offer'), result('offer', 'failed', withoutSnapshot)); f.collector.onEnd({ status: 'failed' });
    expect(f.snapshot()).toMatchObject({ missingAttachments: 1, rejectedAttachments: 1, unavailable: true, incomplete: true });
    expect(f.snapshot().entries[0]).toMatchObject({ label: 'offer', unavailableReason: 'missing-snapshot', observation: null });
    expect(f.final().value.reporterUnavailable).toBe(false);
  });
  it.each(['navigationOverflow', 'sessionOverflow', 'passiveObservationUnavailable'] as const)('preserves explicit %s without claiming completeness', flag => {
    const f = fixture(); const value = payload(); value[flag] = true;
    f.collector.onTestEnd(caseInfo(), result('first-workflow', 'failed', value)); f.collector.onTestEnd(caseInfo('offer'), result('offer')); f.collector.onEnd({ status: 'failed' });
    expect(f.snapshot().incomplete).toBe(true);
    expect(f.snapshot().entries[0].observation[flag]).toBe(true);
    expect(f.final().value.reporterUnavailable).toBe(false);
  });
  it('caps entries and duplicates, records overflow and never expands into a general receipt', () => {
    const f = fixture();
    f.collector.onTestEnd(caseInfo(), result()); f.collector.onTestEnd(caseInfo('offer'), result('offer'));
    f.collector.onTestEnd(caseInfo(), result()); f.collector.onTestEnd(caseInfo('offer'), result('offer'));
    f.collector.onEnd({ status: 'failed' });
    expect(f.snapshot()).toMatchObject({ overflow: true, omittedEntries: 2, incomplete: true });
    expect(f.snapshot().entries).toHaveLength(MAX_PUBLIC_FRAGMENT_ENTRIES);
    expect(Buffer.byteLength(f.files.get(f.file)!)).toBeLessThanOrEqual(MAX_PUBLIC_FRAGMENT_BYTES);
  });
  it('bounds attachment metadata inspection and marks an oversized attachment list incomplete', () => {
    const f = fixture(); let reads = 0;
    const ignored = () => Object.defineProperty({}, 'name', { get() { reads++; return 'ignored'; } });
    const attachments = Array.from({ length: MAX_PUBLIC_FRAGMENT_ATTACHMENTS + 100 }, ignored);
    f.collector.onTestEnd(caseInfo(), { status: 'failed', attachments });
    expect(reads).toBe(MAX_PUBLIC_FRAGMENT_ATTACHMENTS);
    expect(f.snapshot()).toMatchObject({ overflow: true, unavailable: true, missingAttachments: 1, incomplete: true });
  });
  it('ignores late and repeated callbacks after onEnd, even after finalization', () => {
    const f = fixture(); finish(f); const final = f.final(); const before = f.files.get(f.file); const outputs = f.files.get(f.env.GITHUB_OUTPUT);
    const poison = Object.defineProperty({}, 'status', { get() { throw new Error(SECRET); } });
    expect(f.collector.onTestEnd(caseInfo(), result())).toBeUndefined();
    expect(f.collector.onEnd(poison)).toBeUndefined();
    expect(f.collector.onBegin({}, { allTests() { throw new Error(SECRET); } })).toBeUndefined();
    expect(f.files.get(f.file)).toBe(before); expect(f.files.get(f.env.GITHUB_OUTPUT)).toBe(outputs);
    expect(final.value.completed).toBe(true); expect(f.warnings).toEqual([]);
  });
  it('uses Buffer UTF-8 bytes, not characters, for the 16 KiB input limit', () => {
    const f = fixture(); const current = result(); const input = '😀'.repeat(MAX_PUBLIC_FRAGMENT_INPUT_BYTES / 3);
    expect(input.length).toBeLessThan(MAX_PUBLIC_FRAGMENT_INPUT_BYTES);
    current.attachments[0].body = Buffer.from(input);
    f.collector.onTestEnd(caseInfo(), current);
    expect(f.snapshot()).toMatchObject({ overflow: true, rejectedAttachments: 1, unavailable: true });
    expect(f.snapshot().entries[0].unavailableReason).toBe('attachment-overflow');
  });
  it('accepts maximal bounded arrays, null navigation and absent optional scrolling element', () => {
    const f = fixture();
    for (const label of ['first-workflow', 'offer'] as const) {
      const value = payload(label);
      value.navigationEvents = Array.from({ length: 12 }, () => value.navigationEvents[0]);
      value.sessionResponses = Array.from({ length: 8 }, () => value.sessionResponses[0]);
      for (const group of [value.snapshot.target, value.snapshot.fragment]) {
        group.count = 3; group.samples = Array.from({ length: 3 }, () => ({ ...group.samples[0], ancestors: Array.from({ length: 8 }, () => group.samples[0].ancestors[0]) }));
      }
      const raw: Record<string, unknown> = value.snapshot;
      raw.navigation = null; raw.scroll = { x: -0.5, y: 10.25, restoration: 'manual' };
      expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThanOrEqual(MAX_PUBLIC_FRAGMENT_INPUT_BYTES);
      f.collector.onTestEnd(caseInfo(label), result(label, 'failed', value));
    }
    f.collector.onEnd({ status: 'failed' });
    expect(f.snapshot().completed).toBe(true);
    expect(f.snapshot().entries[0].observation.snapshot.scroll).toMatchObject({ element: null, top: null, height: null });
    expect(f.final().value.reporterUnavailable).toBe(false);
    expect(Buffer.byteLength(f.files.get(f.file)!)).toBeLessThanOrEqual(MAX_PUBLIC_FRAGMENT_BYTES);
  });
});

describe('strict observation allowlist', () => {
  const invalid: [string, (value: ReturnType<typeof payload>) => void][] = [
    ['unknown top key', value => Object.assign(value, { headers: SECRET })],
    ['unknown snapshot key', value => Object.assign(value.snapshot, { error: SECRET })],
    ['unknown rect key', value => Object.assign(value.snapshot.target.samples[0].rect, { token: SECRET })],
    ['unknown ancestor key', value => Object.assign(value.snapshot.target.samples[0].ancestors[0], { cookie: SECRET })],
    ['unknown session key', value => Object.assign(value.sessionResponses[0], { body: SECRET })],
    ['unknown navigation key', value => Object.assign(value.navigationEvents[0], { message: SECRET })],
    ['unknown outcome', value => { value.outcome = SECRET; }],
    ['unknown phase', value => { value.snapshot.phase = SECRET; }],
    ['unknown fragment', value => { value.snapshot.fragment.id = SECRET; }],
    ['origin-less raw URL', value => { value.snapshot.url = '/help#angebot'; }],
    ['foreign origin', value => { value.snapshot.url = `https://${SECRET}.invalid/help#angebot`; }],
    ['query', value => { value.snapshot.url = `http://127.0.0.1:3100/help?token=${SECRET}#angebot`; }],
    ['private path', value => { value.navigationEvents[0].url = 'http://127.0.0.1:3100/dashboard'; }],
    ['userinfo', value => { value.snapshot.url = `http://${SECRET}@127.0.0.1:3100/help#angebot`; }],
    ['unknown event', value => { value.navigationEvents[0].event = SECRET; }],
    ['bad session path', value => { value.sessionResponses[0].path = `/api/${SECRET}`; }],
    ['bad session status', value => { value.sessionResponses[0].status = 0; }],
    ['non-finite geometry', value => { value.snapshot.target.samples[0].rect.x = Infinity; }],
    ['unbounded geometry', value => { value.snapshot.target.samples[0].rect.width = 1e12; }],
    ['negative count', value => { value.snapshot.target.count = -1; }],
    ['count mismatch', value => { value.snapshot.target.count = 0; }],
    ['unknown tag', value => { value.snapshot.target.samples[0].tag = SECRET; }],
    ['unknown CSS', value => { value.snapshot.target.samples[0].display = SECRET; }],
    ['CSS injection', value => { value.snapshot.target.samples[0].scrollMarginTop = `url(${SECRET})`; }],
    ['unknown aria', value => { value.snapshot.target.samples[0].ancestors[0].ariaHidden = SECRET; }],
    ['too many navigations', value => { value.navigationEvents = Array.from({ length: 13 }, () => value.navigationEvents[0]); }],
    ['too many sessions', value => { value.sessionResponses = Array.from({ length: 9 }, () => value.sessionResponses[0]); }],
    ['too many samples', value => { value.snapshot.target.samples = Array.from({ length: 4 }, () => value.snapshot.target.samples[0]); }],
    ['too many ancestors', value => { value.snapshot.target.samples[0].ancestors = Array.from({ length: 9 }, () => value.snapshot.target.samples[0].ancestors[0]); }],
  ];
  it.each(invalid)('rejects %s without copying raw data', (_name, mutate) => {
    const f = fixture(); const value = payload(); mutate(value); f.collector.onTestEnd(caseInfo(), result('first-workflow', 'failed', value));
    expect(f.snapshot()).toMatchObject({ unavailable: true, rejectedAttachments: 1, incomplete: true });
    expect(f.snapshot().entries[0]).toMatchObject({ unavailableReason: 'invalid-attachment', observation: null });
    expect(f.files.get(f.file)).not.toContain(SECRET);
    expect(f.final().value.reporterUnavailable).toBe(false);
  });
  it.each([Buffer.from(`{"private":"${SECRET}"`), Buffer.from([0xff]), Buffer.alloc(0)])('rejects malformed/non-UTF8/empty JSON buffers', body => {
    const f = fixture(); const current = result(); current.attachments[0].body = body; f.collector.onTestEnd(caseInfo(), current);
    expect(f.snapshot().entries[0].unavailableReason).toBe('invalid-attachment');
  });
  it('never follows a path-only attachment', () => {
    const f = fixture(); const current = result();
    const attachment: Record<string, unknown> = current.attachments[0]; delete attachment.body;
    f.collector.onTestEnd(caseInfo(), current);
    expect(f.snapshot().entries[0].unavailableReason).toBe('invalid-attachment');
    expect(f.opened).toEqual([]);
  });
});

describe('bounded fail-open finalizer', () => {
  it.each(['startup', 'missing-output', 'cancelled'])('writes a NEW unavailable fallback after %s', scenario => {
    const f = fixture(); const final = f.final(scenario === 'cancelled' ? 'cancelled' : 'failure', scenario === 'missing-output' ? '' : '/runner/not-this-invocation');
    expect(final.success).toBe(true); expect(final.target).not.toBe(f.directory);
    expect(final.value).toMatchObject({ schema: 'bivaro-public-fragment-diagnostic-v1', acceptanceEvidence: false, reporterUnavailable: true, unavailable: true, incomplete: true, completed: false, plannedCases: null, noMatchingFailureObserved: true, entries: [] });
    expect(final.value.functionalStepOutcome).toBe(scenario === 'cancelled' ? 'cancelled' : 'failure');
  });
  it.each(['head', 'run', 'attempt', 'unknown-key', 'malformed', 'oversized', 'nonregular', 'symlink', 'directory-symlink', 'forged-complete', 'unsafe-observation', 'wrong-count', 'missing-failure-entry', 'wrong-entry-status', 'wrong-schema'])('rejects %s on disk, closes descriptors, and never republishes it', scenario => {
    const f = fixture(); finish(f); const value = f.snapshot();
    if (scenario === 'head') value.head = 'b'.repeat(40);
    if (scenario === 'run') value.runId = '12346';
    if (scenario === 'attempt') value.attempt = '1';
    if (scenario === 'unknown-key') value.error = SECRET;
    if (scenario === 'forged-complete') { value.onEndObserved = false; value.endStatus = null; }
    if (scenario === 'unsafe-observation') value.entries[0].observation.snapshot.target.samples[0].text = SECRET;
    if (scenario === 'wrong-count') value.counts.failed = 0;
    if (scenario === 'missing-failure-entry') value.entries.pop();
    if (scenario === 'wrong-entry-status') value.entries[0].status = 'timedOut';
    if (scenario === 'wrong-schema') value.schema = SECRET;
    f.files.set(f.file, scenario === 'malformed' ? `{"${SECRET}":` : scenario === 'oversized' ? SECRET.repeat(MAX_PUBLIC_FRAGMENT_BYTES) : JSON.stringify(value));
    if (scenario === 'nonregular') f.nonregular.add(f.file);
    if (scenario === 'symlink') f.symlinks.set(f.file, `/private/${SECRET}`);
    if (scenario === 'directory-symlink') f.symlinks.set(f.directory, `/private/${SECRET}`);
    const rejected = f.files.get(f.file); const final = f.final();
    expect(final.success).toBe(true); expect(final.target).not.toBe(f.directory);
    expect(final.value).toMatchObject({ reporterUnavailable: true, incomplete: true, entries: [] });
    expect(JSON.stringify(final.value)).not.toContain(SECRET);
    expect(f.files.get(f.file)).toBe(rejected); expect(f.descriptors.size).toBe(0);
    expect(Buffer.byteLength(f.files.get(path.join(final.target, 'public-fragments.json'))!)).toBeLessThanOrEqual(MAX_PUBLIC_FRAGMENT_BYTES);
  });
  it('accepts canonical real RUNNER_TEMP rather than trusting its unresolved spelling', () => {
    const f = fixture(false); f.symlinks.set('/alias-runner', '/runner');
    const env = { ...f.env, RUNNER_TEMP: '/alias-runner' }; const collector = createPublicFragmentCollector({ ...f.dependencies, env });
    collector.onBegin({}, { allTests: () => [] });
    expect(f.outputDirectory()).toMatch(/^\/runner\/bivaro-public-fragments-/);
  });
  it.each([
    { GITHUB_RUN_ID: '0' }, { GITHUB_RUN_ATTEMPT: '../2' }, { BIVARO_BROWSER_RECEIPT_HEAD: SECRET },
    { RUNNER_TEMP: 'relative' }, { GITHUB_WORKSPACE: 'relative' }, { GITHUB_OUTPUT: `/actions/output\n${SECRET}=x` },
  ])('rejects invalid named metadata %j without IO or raw warnings', invalid => {
    const f = fixture(false); const env = { ...f.env, ...invalid, BIVARO_BROWSER_SUITE_OUTCOME: 'failure' };
    const collector = createPublicFragmentCollector({ ...f.dependencies, env });
    expect(() => collector.onBegin({}, { allTests: () => [] })).not.toThrow();
    expect(finalizePublicFragmentDiagnostics({ ...f.dependencies, env })).toBe(false);
    expect(f.files.size).toBe(0); expect(f.warnings.every(message => message === 'fixed-warning')).toBe(true);
  });
  it('rejects a canonical root containing output-injection characters', () => {
    const f = fixture(false); f.symlinks.set('/runner', '/private\nINJECTED=true');
    const collector = createPublicFragmentCollector(f.dependencies);
    expect(collector.onBegin({}, { allTests: () => [] })).toBeUndefined();
    expect(f.files.has(f.env.GITHUB_OUTPUT)).toBe(false);
    expect(finalizePublicFragmentDiagnostics({ ...f.dependencies, env: { ...f.env, BIVARO_BROWSER_SUITE_OUTCOME: 'failure' } })).toBe(false);
  });
  it('reads only named CI metadata, never arbitrary environment values', () => {
    const f = fixture(false); const accessed: string[] = [];
    const env = new Proxy(f.env, { get(target, key: keyof typeof f.env) { accessed.push(String(key)); if (key === 'PRIVATE_VALUE') throw new Error(SECRET); return target[key]; } });
    const collector = createPublicFragmentCollector({ ...f.dependencies, env }); collector.onBegin({}, { allTests: () => [] });
    expect(accessed).not.toContain('PRIVATE_VALUE'); expect(f.outputDirectory()).toBeTruthy();
  });
  it('swallows poisoned env, options, suite, test, result, attachment, IO and warning getters/errors', () => {
    const f = fixture(); const before = process.exitCode;
    const poison = () => { throw new Error(SECRET); };
    const poisonedOptions = Object.defineProperty({}, 'env', { get: poison });
    expect(createPublicFragmentCollector(poisonedOptions).onBegin({}, {})).toBeUndefined();
    expect(finalizePublicFragmentDiagnostics(poisonedOptions)).toBe(false);
    const poisonedEnv = Object.defineProperty({ ...f.env }, 'GITHUB_RUN_ID', { get: poison });
    expect(createPublicFragmentCollector({ ...f.dependencies, env: poisonedEnv }).onBegin({}, {})).toBeUndefined();
    expect(finalizePublicFragmentDiagnostics({ ...f.dependencies, env: poisonedEnv })).toBe(false);
    const collector = createPublicFragmentCollector(f.dependencies);
    expect(() => collector.onBegin({}, Object.defineProperty({}, 'allTests', { get: poison }))).not.toThrow();
    for (const [test, current] of [
      [Object.defineProperty({}, 'location', { get: poison }), result()],
      [caseInfo(), Object.defineProperty({}, 'status', { get: poison })],
      [caseInfo(), { status: 'failed', attachments: [Object.defineProperty({}, 'name', { get: poison })] }],
      [caseInfo(), { status: 'failed', attachments: [Object.defineProperty({ name: 'public-first-workflow-fragment-failure.json', contentType: 'application/json' }, 'body', { get: poison })] }],
    ]) expect(() => f.collector.onTestEnd(test, current)).not.toThrow();
    expect(() => f.collector.onEnd(Object.defineProperty({}, 'status', { get: poison }))).not.toThrow();
    const broken = { ...f.io, writeFileSync: poison };
    const brokenCollector = createPublicFragmentCollector({ ...f.dependencies, io: broken as unknown as typeof realFs, warn: poison });
    expect(() => brokenCollector.onBegin({}, { allTests: () => [] })).not.toThrow();
    expect(finalizePublicFragmentDiagnostics({ ...f.dependencies, io: broken as unknown as typeof realFs, warn: poison, env: { ...f.env, BIVARO_BROWSER_SUITE_OUTCOME: 'failure' } })).toBe(false);
    expect(process.exitCode).toBe(before);
  });
  it('does not publish readiness if the initial atomic write fails', () => {
    const f = fixture(false); const broken = { ...f.io, renameSync() { throw new Error(SECRET); } };
    const collector = createPublicFragmentCollector({ ...f.dependencies, io: broken as unknown as typeof realFs });
    expect(collector.onBegin({}, { allTests: () => [] })).toBeUndefined();
    expect(f.files.has(f.env.GITHUB_OUTPUT)).toBe(false);
  });
  it('rejects a short/changing read and safely ignores close failures', () => {
    const f = fixture(); finish(f);
    const broken = { ...f.io, readSync() { return 1; }, closeSync(fd: number) { f.descriptors.delete(fd); throw new Error(SECRET); } };
    expect(finalizePublicFragmentDiagnostics({ ...f.dependencies, io: broken as unknown as typeof realFs,
      env: { ...f.env, BIVARO_PUBLIC_FRAGMENT_DIRECTORY: f.directory, BIVARO_BROWSER_SUITE_OUTCOME: 'failure' } })).toBe(true);
    expect(f.outputDirectory()).not.toBe(f.directory); expect(f.descriptors.size).toBe(0);
  });
});
