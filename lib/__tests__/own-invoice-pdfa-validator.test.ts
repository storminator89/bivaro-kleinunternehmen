import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { MAX_PDF_INPUT_BYTES } from '@/lib/resource-limits';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  mkdtemp: vi.fn(),
  writeFile: vi.fn(),
  rm: vi.fn(),
  directory: '/tmp/bivaro-own-invoice-validator-unit',
  version: 'veraPDF 1.30.3\nBuilt: synthetic unit fixture\n',
  report: '',
  error: null as Error | null,
  manualVersion: false,
  manualValidation: false,
  children: [] as MockChild[],
}));

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('fs/promises', () => ({
  mkdtemp: mocks.mkdtemp,
  writeFile: mocks.writeFile,
  rm: mocks.rm,
}));

import { classifyPdfA3StartupText, PdfA3ValidationError, validatePdfA3 } from '@/lib/server/pdfa-validator';
import { OwnInvoicePdfAValidationError, validateOwnInvoicePdfA3 } from '@/lib/server/own-invoice-pdfa-validator';

const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);

class MockChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly kill = vi.fn(() => true);
  constructor(readonly pid: number) { super(); }
}

const processLimits = [
  '--as=2147483648:2147483648', '--cpu=25:26', '--nofile=64:64', '--fsize=2097152:2097152', '--',
];

const javaOptions = [
  '-Xms16m', '-Xmx192m', '-Xss512k', '-XX:+UseSerialGC', '-XX:ActiveProcessorCount=1',
  '-XX:MaxMetaspaceSize=64m', '-XX:CompressedClassSpaceSize=32m', '-XX:ReservedCodeCacheSize=32m',
  '-XX:MaxDirectMemorySize=16m', '-XX:-CreateCoredumpOnCrash', '-XX:ErrorFile=java-error.log',
  '-Djava.awt.headless=true', '-Djava.io.tmpdir=.', '-Duser.home=.',
  '-Djavax.xml.accessExternalDTD=', '-Djavax.xml.accessExternalSchema=', '-Djavax.xml.accessExternalStylesheet=',
].join(' ');

function expectedSpawnOptions() {
  return {
    cwd: mocks.directory, detached: true, shell: false,
    env: {
      PATH: '/usr/bin:/bin', HOME: mocks.directory, TMPDIR: mocks.directory, XDG_CONFIG_HOME: mocks.directory,
      LANG: 'C.UTF-8', TZ: 'UTC', NODE_ENV: 'production', JAVACMD: '/usr/bin/java', JAVA_OPTS: javaOptions,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

async function startControlledValidation() {
  mocks.manualValidation = true;
  let settled = false;
  const outcome = validateOwnInvoicePdfA3(bytes).then(
    () => { settled = true; return { ok: true, error: undefined }; },
    (error: unknown) => { settled = true; return { ok: false, error }; },
  );
  await flushMicrotasks();
  expect(mocks.children).toHaveLength(2);
  return { child: mocks.children[1], outcome, isSettled: () => settled };
}

// Matches the pinned JsonHandler/Jackson getters, intentionally not XML's
// isCompliant/validationReports/failedToParse attribute spelling.
function compliantReport() {
  return {
    report: {
      jobs: [{
        itemDetails: { name: `${mocks.directory}/final.pdf`, size: bytes.byteLength },
        validationResult: [{
          profileName: 'PDF/A-3B validation profile',
          compliant: true,
          jobEndStatus: 'normal',
          details: { passedRules: 140, failedRules: 0, passedChecks: 2400, failedChecks: 0, ruleSummaries: [] },
        }],
      }],
      batchSummary: {
        totalJobs: 1,
        failedParsingJobs: 0,
        failedEncryptedJobs: 0,
        outOfMemory: 0,
        veraExceptions: 0,
        validationSummary: {
          totalJobCount: 1,
          successfulJobCount: 1,
          compliantPdfaCount: 1,
          nonCompliantPdfaCount: 0,
          failedJobCount: 0,
        },
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  // Mocked lifecycle assertions are independent of the real acceptance gate's
  // administrator-configured runtime inherited by an aggregate test command.
  vi.stubEnv('BIVARO_VERAPDF_BIN', undefined);
  mocks.version = 'veraPDF 1.30.3\nBuilt: synthetic unit fixture\n';
  mocks.report = JSON.stringify(compliantReport());
  mocks.error = null;
  mocks.manualVersion = false;
  mocks.manualValidation = false;
  mocks.children = [];
  mocks.mkdtemp.mockResolvedValue(mocks.directory);
  mocks.writeFile.mockResolvedValue(undefined);
  mocks.rm.mockResolvedValue(undefined);
  vi.spyOn(process, 'kill').mockImplementation(() => true);
  mocks.spawn.mockImplementation((_binary: string, args: string[]) => {
    const child = new MockChild(12_000 + mocks.children.length);
    mocks.children.push(child);
    const isVersion = args.includes('--version');
    if ((isVersion && mocks.manualVersion) || (!isVersion && mocks.manualValidation)) return child;
    queueMicrotask(() => {
      if (mocks.error) {
        child.emit('error', mocks.error);
        child.emit('close', null, null);
      } else {
        child.stdout.emit('data', Buffer.from(isVersion ? mocks.version : mocks.report));
        child.emit('exit', 0, null);
        child.emit('close', 0, null);
      }
    });
    return child;
  });
});

afterEach(() => {
  for (const child of mocks.children) child.emit('close', null, 'SIGKILL');
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('independent final own-invoice PDF/A-3b validation', () => {
  it('checks the pinned runtime and the exact finalized bytes, with bounded process output and cleanup', async () => {
    await expect(validateOwnInvoicePdfA3(bytes)).resolves.toBeUndefined();
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    expect(mocks.spawn.mock.calls[0]).toEqual(['/usr/bin/prlimit', [...processLimits, '/opt/verapdf/verapdf', '--version'], expectedSpawnOptions()]);
    expect(mocks.writeFile).toHaveBeenCalledExactlyOnceWith(`${mocks.directory}/final.pdf`, bytes, { flag: 'wx', mode: 0o600 });
    expect(mocks.spawn.mock.calls[1]).toEqual([
      '/usr/bin/prlimit',
      [...processLimits, '/opt/verapdf/verapdf', '--flavour', '3b', '--format', 'json', '--maxfailuresdisplayed', '10', '--loglevel', '0', `${mocks.directory}/final.pdf`],
      expectedSpawnOptions(),
    ]);
    expect(mocks.mkdtemp.mock.invocationCallOrder[0]).toBeLessThan(mocks.spawn.mock.invocationCallOrder[0]);
    expect(mocks.spawn.mock.invocationCallOrder[0]).toBeLessThan(mocks.writeFile.mock.invocationCallOrder[0]);
    expect(mocks.writeFile.mock.invocationCallOrder[0]).toBeLessThan(mocks.spawn.mock.invocationCallOrder[1]);
    expect(process.kill).toHaveBeenCalledWith(-mocks.children[0].pid, 'SIGKILL');
    expect(process.kill).toHaveBeenCalledWith(-mocks.children[1].pid, 'SIGKILL');
    expect(mocks.rm).toHaveBeenCalledExactlyOnceWith(mocks.directory, { recursive: true, force: true });
  });

  it('uses only the deployment-configured executable, never shell command interpolation', async () => {
    vi.stubEnv('BIVARO_VERAPDF_BIN', '/opt/pinned veraPDF/verapdf');
    await validateOwnInvoicePdfA3(bytes);
    expect(mocks.spawn.mock.calls.every(call => call[0] === '/usr/bin/prlimit')).toBe(true);
    expect(mocks.spawn.mock.calls.every(call => call[1][processLimits.length] === '/opt/pinned veraPDF/verapdf')).toBe(true);
    expect(mocks.spawn.mock.calls.every(call => call[2].shell === false)).toBe(true);
  });

  it('gives both subprocesses only a private directory and fixed bounded Java options, ignoring poisoned inherited environment', async () => {
    vi.stubEnv('JAVA_OPTS', '-Xmx999g -javaagent:/synthetic/untrusted-agent.jar');
    vi.stubEnv('JDK_JAVA_OPTIONS', '-javaagent:/synthetic/untrusted-agent.jar');
    vi.stubEnv('_JAVA_OPTIONS', '-Xmx999g');
    vi.stubEnv('JAVA_TOOL_OPTIONS', '-Xmx999g');
    vi.stubEnv('CLASSPATH', '/synthetic/untrusted-classpath');
    vi.stubEnv('LD_PRELOAD', '/synthetic/untrusted-preload');
    vi.stubEnv('DATABASE_URL', 'synthetic-private-database');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'synthetic-not-a-real-key');
    await validateOwnInvoicePdfA3(bytes);

    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    for (const call of mocks.spawn.mock.calls) {
      expect(call[1].slice(0, processLimits.length)).toEqual(processLimits);
      expect(call[2]).toEqual(expectedSpawnOptions());
      expect(call[2].env.JAVA_OPTS).toBe(javaOptions);
      for (const key of ['JDK_JAVA_OPTIONS', '_JAVA_OPTIONS', 'JAVA_TOOL_OPTIONS', 'CLASSPATH', 'LD_PRELOAD', 'DATABASE_URL', 'AWS_SECRET_ACCESS_KEY']) {
        expect(call[2].env).not.toHaveProperty(key);
      }
    }
  });

  it('refuses a relative executable path before creating files or starting subprocesses', async () => {
    vi.stubEnv('BIVARO_VERAPDF_BIN', 'verapdf');
    await expect(validateOwnInvoicePdfA3(bytes)).rejects.toBeInstanceOf(OwnInvoicePdfAValidationError);
    expect(mocks.mkdtemp).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('snapshots caller bytes before its first asynchronous operation', async () => {
    const supplied = Uint8Array.from(bytes);
    const result = validateOwnInvoicePdfA3(supplied);
    supplied.fill(0);
    await result;
    expect(mocks.writeFile.mock.calls[0][1]).toEqual(bytes);
    expect(mocks.writeFile.mock.calls[0][1]).not.toBe(supplied);
  });

  it.each(['veraPDF 1.28.2', 'veraPDF 1.30.2', 'veraPDF 1.30.30', 'veraPDF 1.30.3-SNAPSHOT', 'another validator 1.30.3', ''])('fails closed for a different/missing pinned runtime (%s)', async version => {
    mocks.version = `${version}\n`;
    await expect(validateOwnInvoicePdfA3(bytes)).rejects.toBeInstanceOf(OwnInvoicePdfAValidationError);
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.rm).toHaveBeenCalledExactlyOnceWith(mocks.directory, { recursive: true, force: true });
  });

  it.each([new Uint8Array(), new Uint8Array(MAX_PDF_INPUT_BYTES + 1)])('rejects empty/oversized output before running a process', async value => {
    await expect(validateOwnInvoicePdfA3(value)).rejects.toBeInstanceOf(OwnInvoicePdfAValidationError);
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.mkdtemp).not.toHaveBeenCalled();
  });

  it.each(['', 'not JSON', '{}', '[]', '{"report":null}', '{"report":{"jobs":[]}}'])('rejects missing/malformed/empty reports (%s)', async report => {
    mocks.report = report;
    await expect(validateOwnInvoicePdfA3(bytes)).rejects.toBeInstanceOf(OwnInvoicePdfAValidationError);
    expect(mocks.rm).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['additional root report', (value: ReturnType<typeof compliantReport>) => Object.assign(value, { anotherReport: {} })],
    ['additional job', (value: ReturnType<typeof compliantReport>) => value.report.jobs.push(value.report.jobs[0])],
    ['additional validation', (value: ReturnType<typeof compliantReport>) => value.report.jobs[0].validationResult.push(value.report.jobs[0].validationResult[0])],
    ['missing validation', (value: ReturnType<typeof compliantReport>) => value.report.jobs[0].validationResult.splice(0)],
    ['different item path', (value: ReturnType<typeof compliantReport>) => { value.report.jobs[0].itemDetails.name = '/tmp/unrelated.pdf'; }],
    ['different item size', (value: ReturnType<typeof compliantReport>) => { value.report.jobs[0].itemDetails.size += 1; }],
    ['noncompliant result', (value: ReturnType<typeof compliantReport>) => { value.report.jobs[0].validationResult[0].compliant = false; }],
    ['wrong profile', (value: ReturnType<typeof compliantReport>) => { value.report.jobs[0].validationResult[0].profileName = 'PDF/A-1B validation profile'; }],
    ['incomplete job', (value: ReturnType<typeof compliantReport>) => { value.report.jobs[0].validationResult[0].jobEndStatus = 'failed'; }],
    ['failed rules', (value: ReturnType<typeof compliantReport>) => { value.report.jobs[0].validationResult[0].details.failedRules = 1; }],
    ['failed checks', (value: ReturnType<typeof compliantReport>) => { value.report.jobs[0].validationResult[0].details.failedChecks = 1; }],
    ['no checked rules', (value: ReturnType<typeof compliantReport>) => { value.report.jobs[0].validationResult[0].details.passedRules = 0; }],
    ['no checked assertions', (value: ReturnType<typeof compliantReport>) => { value.report.jobs[0].validationResult[0].details.passedChecks = 0; }],
    ['parsing failure', (value: ReturnType<typeof compliantReport>) => { value.report.batchSummary.failedParsingJobs = 1; }],
    ['encryption', (value: ReturnType<typeof compliantReport>) => { value.report.batchSummary.failedEncryptedJobs = 1; }],
    ['out of memory', (value: ReturnType<typeof compliantReport>) => { value.report.batchSummary.outOfMemory = 1; }],
    ['engine exception', (value: ReturnType<typeof compliantReport>) => { value.report.batchSummary.veraExceptions = 1; }],
    ['extra total jobs', (value: ReturnType<typeof compliantReport>) => { value.report.batchSummary.totalJobs = 2; }],
    ['no compliant jobs', (value: ReturnType<typeof compliantReport>) => { value.report.batchSummary.validationSummary.compliantPdfaCount = 0; }],
    ['noncompliant summary', (value: ReturnType<typeof compliantReport>) => { value.report.batchSummary.validationSummary.nonCompliantPdfaCount = 1; }],
    ['failed summary', (value: ReturnType<typeof compliantReport>) => { value.report.batchSummary.validationSummary.failedJobCount = 1; }],
    ['missing successful summary', (value: ReturnType<typeof compliantReport>) => { value.report.batchSummary.validationSummary.successfulJobCount = 0; }],
    ['extra validation count', (value: ReturnType<typeof compliantReport>) => { value.report.batchSummary.validationSummary.totalJobCount = 2; }],
    ['reported task exception', (value: ReturnType<typeof compliantReport>) => Object.assign(value.report.jobs[0], { taskException: {} })],
  ] satisfies Array<[string, (value: ReturnType<typeof compliantReport>) => void]>)('rejects inconsistent or unsuccessful outcome: %s', async (_name, change) => {
    const report = compliantReport();
    change(report);
    mocks.report = JSON.stringify(report);
    await expect(validateOwnInvoicePdfA3(bytes)).rejects.toBeInstanceOf(OwnInvoicePdfAValidationError);
    expect(mocks.rm).toHaveBeenCalledExactlyOnceWith(mocks.directory, { recursive: true, force: true });
  });

  it('rejects XML-shaped JSON and coercible string counts/booleans', async () => {
    const report = compliantReport() as unknown as Record<string, unknown>;
    const encoded = JSON.stringify(report).replace('"compliant":true', '"isCompliant":"true"');
    mocks.report = encoded;
    await expect(validateOwnInvoicePdfA3(bytes)).rejects.toBeInstanceOf(OwnInvoicePdfAValidationError);
    mocks.report = JSON.stringify(report).replace('"totalJobs":1', '"totalJobs":"1"');
    await expect(validateOwnInvoicePdfA3(bytes)).rejects.toBeInstanceOf(OwnInvoicePdfAValidationError);
  });

  it('treats process failure, including timeout or missing binary, as fatal without leaking diagnostics', async () => {
    mocks.error = new Error('synthetic timeout; private process path and invoice content');
    await expect(validateOwnInvoicePdfA3(bytes)).rejects.toMatchObject({
      name: 'OwnInvoicePdfAValidationError', status: 500,
      message: 'Die abschließende PDF/A-3b-Prüfung ist fehlgeschlagen. Es wurde keine Rechnungsdatei erstellt.',
    });
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it('cleans on write failure and converts cleanup failures to the same safe error', async () => {
    mocks.writeFile.mockRejectedValue(new Error('synthetic write failure'));
    await expect(validateOwnInvoicePdfA3(bytes)).rejects.toBeInstanceOf(OwnInvoicePdfAValidationError);
    expect(mocks.rm).toHaveBeenCalledTimes(1);
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.rm.mockRejectedValue(new Error('synthetic cleanup path'));
    await expect(validateOwnInvoicePdfA3(bytes)).rejects.toBeInstanceOf(OwnInvoicePdfAValidationError);
  });
});

describe('private veraPDF process-group lifecycle (only mocked children and signals)', () => {
  it('also waits for the version subprocess to close before writing the final PDF or launching validation', async () => {
    mocks.manualVersion = true;
    let settled = false;
    const outcome = validateOwnInvoicePdfA3(bytes).then(
      () => { settled = true; return { ok: true, error: undefined }; },
      (error: unknown) => { settled = true; return { ok: false, error }; },
    );
    await flushMicrotasks();
    expect(mocks.children).toHaveLength(1);
    const child = mocks.children[0];
    child.stdout.emit('data', Buffer.from(mocks.version));
    child.emit('exit', 0, null);
    await flushMicrotasks();

    expect(process.kill).toHaveBeenCalledWith(-child.pid, 'SIGKILL');
    expect(settled).toBe(false);
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(mocks.rm).not.toHaveBeenCalled();
    child.emit('close', 0, null);
    expect(await outcome).toEqual({ ok: true, error: undefined });
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    expect(mocks.rm).toHaveBeenCalledTimes(1);
  });

  it('kills remaining descendants at successful exit but waits for close before returning or deleting private files', async () => {
    const pending = await startControlledValidation();
    pending.child.stdout.emit('data', Buffer.from(mocks.report));
    pending.child.emit('exit', 0, null);
    await flushMicrotasks();

    expect(process.kill).toHaveBeenCalledWith(-pending.child.pid, 'SIGKILL');
    expect(pending.isSettled()).toBe(false);
    expect(mocks.rm).not.toHaveBeenCalled();
    pending.child.emit('close', 0, null);
    expect(await pending.outcome).toEqual({ ok: true, error: undefined });
    expect(mocks.rm).toHaveBeenCalledExactlyOnceWith(mocks.directory, { recursive: true, force: true });
    expect(vi.mocked(process.kill).mock.calls.filter(call => call[0] === -pending.child.pid)).toHaveLength(1);
  });

  it('kills a timed-out private group and does not settle or clean files until its descriptors close', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const pending = await startControlledValidation();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(process.kill).toHaveBeenCalledWith(-pending.child.pid, 'SIGKILL');
    expect(pending.isSettled()).toBe(false);
    expect(mocks.rm).not.toHaveBeenCalled();
    pending.child.emit('exit', null, 'SIGKILL');
    pending.child.emit('close', null, 'SIGKILL');
    const result = await pending.outcome;
    expect(result.ok).toBe(false);
    expect(result.error).toBeInstanceOf(OwnInvoicePdfAValidationError);
    expect(mocks.rm).toHaveBeenCalledTimes(1);
    expect(vi.mocked(process.kill).mock.calls.filter(call => call[0] === -pending.child.pid)).toHaveLength(1);
  });

  it('caps combined stdout and stderr, kills the group, and waits for close before cleanup', async () => {
    const pending = await startControlledValidation();
    pending.child.stdout.emit('data', Buffer.alloc(2 * 1024 * 1024));
    expect(process.kill).not.toHaveBeenCalledWith(-pending.child.pid, 'SIGKILL');
    pending.child.stderr.emit('data', Buffer.from('x'));
    await flushMicrotasks();

    expect(process.kill).toHaveBeenCalledWith(-pending.child.pid, 'SIGKILL');
    expect(pending.isSettled()).toBe(false);
    expect(mocks.rm).not.toHaveBeenCalled();
    pending.child.emit('close', null, 'SIGKILL');
    const result = await pending.outcome;
    expect(result.ok).toBe(false);
    expect(result.error).toBeInstanceOf(OwnInvoicePdfAValidationError);
    expect(mocks.rm).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['nonzero exit', 1, null],
    ['signal exit', null, 'SIGTERM'],
  ] satisfies Array<[string, number | null, string | null]>)('rejects %s despite compliant-looking output, after waiting for close', async (_name, code, signal) => {
    const pending = await startControlledValidation();
    pending.child.stdout.emit('data', Buffer.from(mocks.report));
    pending.child.emit('exit', code, signal);
    await flushMicrotasks();

    expect(process.kill).toHaveBeenCalledWith(-pending.child.pid, 'SIGKILL');
    expect(pending.isSettled()).toBe(false);
    expect(mocks.rm).not.toHaveBeenCalled();
    pending.child.emit('close', code, signal);
    const result = await pending.outcome;
    expect(result.ok).toBe(false);
    expect(result.error).toBeInstanceOf(OwnInvoicePdfAValidationError);
    expect(mocks.rm).toHaveBeenCalledTimes(1);
  });

  it('handles an error event safely, kills descendants once, and rejects only at close', async () => {
    const pending = await startControlledValidation();
    pending.child.emit('error', new Error('synthetic process failure with private details'));
    await flushMicrotasks();

    expect(process.kill).toHaveBeenCalledWith(-pending.child.pid, 'SIGKILL');
    expect(pending.isSettled()).toBe(false);
    expect(mocks.rm).not.toHaveBeenCalled();
    pending.child.emit('exit', 0, null);
    pending.child.emit('close', 0, null);
    const result = await pending.outcome;
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      name: 'OwnInvoicePdfAValidationError', status: 500,
      message: 'Die abschließende PDF/A-3b-Prüfung ist fehlgeschlagen. Es wurde keine Rechnungsdatei erstellt.',
    });
    expect(vi.mocked(process.kill).mock.calls.filter(call => call[0] === -pending.child.pid)).toHaveLength(1);
    expect(mocks.rm).toHaveBeenCalledTimes(1);
  });

  it('falls back to the mocked child kill if a private group signal fails', async () => {
    const pending = await startControlledValidation();
    vi.mocked(process.kill).mockImplementationOnce(() => { throw new Error('synthetic group signal rejection'); });
    pending.child.emit('error', new Error('synthetic process error'));

    expect(pending.child.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
    expect(pending.isSettled()).toBe(false);
    pending.child.emit('close', null, 'SIGKILL');
    expect((await pending.outcome).error).toBeInstanceOf(OwnInvoicePdfAValidationError);
  });

  it.each(['stdout', 'stderr'] as const)('handles a %s pipe error without an uncaught stream event', async pipe => {
    const pending = await startControlledValidation();
    pending.child[pipe].emit('error', new Error('synthetic pipe failure'));
    await flushMicrotasks();
    expect(process.kill).toHaveBeenCalledWith(-pending.child.pid, 'SIGKILL');
    expect(pending.isSettled()).toBe(false);
    expect(mocks.rm).not.toHaveBeenCalled();
    pending.child.emit('close', null, 'SIGKILL');
    expect((await pending.outcome).error).toBeInstanceOf(OwnInvoicePdfAValidationError);
    expect(mocks.rm).toHaveBeenCalledTimes(1);
  });

  it('cleans the private directory when spawn itself throws without creating a child', async () => {
    mocks.spawn.mockImplementationOnce(() => { throw new Error('synthetic prlimit unavailable'); });

    await expect(validateOwnInvoicePdfA3(bytes)).rejects.toBeInstanceOf(OwnInvoicePdfAValidationError);
    expect(mocks.children).toHaveLength(0);
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(process.kill).not.toHaveBeenCalled();
    expect(mocks.rm).toHaveBeenCalledExactlyOnceWith(mocks.directory, { recursive: true, force: true });
  });
});

describe('shared foreign-PDF verifier classification', () => {
  it('accepts the exact already-PDF/A-3b report without normalization', async () => {
    await expect(validatePdfA3(bytes)).resolves.toBeUndefined();
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
  });
  it('classifies only a coherent complete nonconforming report as unsupported, not infrastructure', async () => {
    const report = compliantReport();
    report.report.jobs[0].validationResult[0].compliant = false;
    report.report.jobs[0].validationResult[0].details.failedChecks = 2;
    report.report.jobs[0].validationResult[0].details.failedRules = 1;
    report.report.batchSummary.validationSummary.compliantPdfaCount = 0;
    report.report.batchSummary.validationSummary.nonCompliantPdfaCount = 1;
    mocks.report = JSON.stringify(report);
    await expect(validatePdfA3(bytes)).rejects.toMatchObject({ kind: 'unsupported', status: 422 });
  });
  it.each(['{}', 'not JSON'])('does not mislabel unknown reports as bad user input (%s)', async report => {
    mocks.report = report;
    await expect(validatePdfA3(bytes)).rejects.toMatchObject({ kind: 'unavailable', status: 503 });
  });
  it('keeps the own-invoice 20MiB bound while accepting an explicitly server-owned foreign bound up to 40MiB', async () => {
    const large = new Uint8Array(MAX_PDF_INPUT_BYTES + 1);
    const report = compliantReport(); report.report.jobs[0].itemDetails.size = large.length;
    mocks.report = JSON.stringify(report);
    await expect(validatePdfA3(large, { maxBytes: MAX_PDF_INPUT_BYTES * 2 })).resolves.toBeUndefined();
    await expect(validateOwnInvoicePdfA3(large)).rejects.toMatchObject({status: 500});
  });
  it('rejects an unbounded verifier request before process creation', async () => {
    await expect(validatePdfA3(bytes, { maxBytes: MAX_PDF_INPUT_BYTES * 2 + 1 })).rejects.toBeInstanceOf(PdfA3ValidationError);
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});

// Closed internal diagnostics only; the own-invoice public wrapper above still
// discards these and preserves its exact established status/name/message.
describe('closed validator phase and startup diagnostics (mocked children only)', () => {
  it.each([
    ['java.lang.InternalError: Error loading java.security file', 'java-security-config'],
    ['Could not reserve enough space for object heap', 'java-memory-reservation'],
    ['unable to create native thread', 'java-thread-creation'],
    ['Could not find or load main class org.verapdf.apps.GreenfieldCliWrapper', 'java-main-class'],
    ['Unrecognized VM option', 'java-options'],
    ['Error occurred during initialization of VM', 'java-vm-initialization'],
    ['setpriv: landlock: synthetic', 'sandbox-rule'],
    ['setpriv: Could not load seccomp filter synthetic', 'sandbox-filter'],
    ['setpriv: landlock_create_ruleset failed: synthetic', 'sandbox-landlock-create'],
    ['setpriv: adding landlock rule failed: synthetic', 'sandbox-landlock-add'],
    ['setpriv: landlock_restrict_self failed: synthetic', 'sandbox-landlock-restrict'],
    ['setpriv: failed to execute synthetic', 'sandbox-execution'],
  ])('maps only a known static marker to %s', (text, category) => {
    expect(classifyPdfA3StartupText(text)).toBe(category);
  });
  it.each([undefined, null, {}, 'private unknown document /secret/path', {toString(){throw Error('private coercion');}}].map(value=>({value})))('leaves unknown/non-string startup data unknown without conversion', ({value}) => {
    expect(classifyPdfA3StartupText(value)).toBe('unknown');
  });
  it('distinguishes directory, construction, version identity and report failures without copied error text', async () => {
    mocks.mkdtemp.mockRejectedValueOnce(Error('secret directory'));
    await expect(validatePdfA3(bytes)).rejects.toMatchObject({validatorStage:'directory',kind:'unavailable',status:503});
    vi.stubEnv('BIVARO_VERAPDF_BIN','relative-secret');
    await expect(validatePdfA3(bytes)).rejects.toMatchObject({validatorStage:'construction',kind:'unavailable',status:503});
    vi.stubEnv('BIVARO_VERAPDF_BIN',undefined);
    mocks.version='secret unexpected version';
    const identity=await validatePdfA3(bytes).catch(error=>error);
    expect(identity).toMatchObject({validatorStage:'version-identity',startupCategory:'unknown',processOutcome:'unknown',kind:'unavailable',status:503});
    expect(JSON.stringify(identity)).not.toContain('secret');
    mocks.version='veraPDF 1.30.3\n';mocks.report='secret invalid report';
    const report=await validatePdfA3(bytes).catch(error=>error);
    expect(report).toMatchObject({validatorStage:'report',startupCategory:'unknown',kind:'unavailable',status:503});
    expect(JSON.stringify(report)).not.toContain('secret');
  });
  it('distinguishes asynchronous version launch error and preserves the own-invoice public error contract', async () => {
    mocks.error=Error('secret executable path');
    const error=await validatePdfA3(bytes).catch(error=>error);
    expect(error).toMatchObject({validatorStage:'version-launch',processOutcome:'launch-error',kind:'unavailable',status:503});
    expect(JSON.stringify(error)).not.toContain('secret');
    const own=await validateOwnInvoicePdfA3(bytes).catch(error=>error);
    expect(own).toMatchObject({name:'OwnInvoicePdfAValidationError',status:500,message:'Die abschließende PDF/A-3b-Prüfung ist fehlgeschlagen. Es wurde keine Rechnungsdatei erstellt.'});
    expect(own).not.toHaveProperty('validatorStage');expect(own).not.toHaveProperty('startupCategory');expect(own).not.toHaveProperty('processOutcome');
  });
  it('classifies bounded split stderr markers only after failed version result, without retaining source text in errors', async () => {
    mocks.manualVersion=true;const outcome=validatePdfA3(bytes).catch(error=>error);await flushMicrotasks();
    const child=mocks.children[0];child.stderr.emit('data',Buffer.from('secret /private/file Error loading java.se'));
    child.stderr.emit('data',Buffer.from('curity file secret document'));child.emit('exit',1,null);child.emit('close',1,null);
    const error=await outcome;expect(error).toMatchObject({validatorStage:'version-result',startupCategory:'java-security-config',processOutcome:'nonzero-exit',status:503});
    expect(JSON.stringify(error)).not.toContain('secret');expect(JSON.stringify(error)).not.toContain('/private');
  });
  it.each([true,false])('distinguishes validation launch/result failure (%s) after successful pinned version', async launch => {
    mocks.manualValidation=true;const outcome=validatePdfA3(bytes).catch(error=>error);await flushMicrotasks();
    expect(mocks.children).toHaveLength(2);const child=mocks.children[1];
    if(launch)child.emit('error',Error('secret launch path'));else child.stderr.emit('data',Buffer.from('secret unknown child data'));
    child.emit('exit',1,null);child.emit('close',1,null);const error=await outcome;
    expect(error).toMatchObject({validatorStage:launch?'validation-launch':'validation-result',startupCategory:'unknown',processOutcome:launch?'launch-error':'nonzero-exit',status:503});
    expect(JSON.stringify(error)).not.toContain('secret');
  });
  it('never treats a startup marker as acceptance evidence or changes successful report validation', async () => {
    mocks.version='veraPDF 1.30.3\nError loading java.security file';
    await expect(validatePdfA3(bytes)).resolves.toBeUndefined();
    mocks.report='not a compliant report';
    await expect(validatePdfA3(bytes)).rejects.toMatchObject({validatorStage:'report',kind:'unavailable',status:503});
  });
});
