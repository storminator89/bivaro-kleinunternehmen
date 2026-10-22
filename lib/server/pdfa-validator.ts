import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { foreignVerifierCommand } from './foreign-pdf-validator-confinement';
import { prepareForeignVerifierConfig } from './foreign-pdf-verifier-config';
import { MAX_PDF_INPUT_BYTES } from '@/lib/resource-limits';
export const PDF_A_VERAPDF_VERSION = '1.30.3';
const VERAPDF_TIMEOUT_MS = 30000;
const MAX_VERAPDF_REPORT_BYTES = 2 * 1024 * 1024;
const VERAPDF_JAVA_OPTIONS = [
  '-Xms16m', '-Xmx192m', '-Xss512k', '-XX:+UseSerialGC', '-XX:ActiveProcessorCount=1',
  '-XX:MaxMetaspaceSize=64m', '-XX:CompressedClassSpaceSize=32m', '-XX:ReservedCodeCacheSize=32m',
  '-XX:MaxDirectMemorySize=16m', '-XX:-CreateCoredumpOnCrash', '-XX:ErrorFile=java-error.log',
  '-Djava.awt.headless=true', '-Djava.io.tmpdir=.', '-Duser.home=.',
  '-Djavax.xml.accessExternalDTD=', '-Djavax.xml.accessExternalSchema=', '-Djavax.xml.accessExternalStylesheet=',
].join(' ');
type ValidatorStage = 'unknown' | 'bounds' | 'directory' | 'construction' | 'version-launch' | 'version-result' | 'version-identity' | 'input-write' | 'validation-launch' | 'validation-result' | 'report' | 'cleanup';
type StartupCategory = 'unknown' | 'java-security-config' | 'java-memory-reservation' | 'java-thread-creation' | 'java-main-class' | 'java-options' | 'java-vm-initialization' | 'sandbox-rule' | 'sandbox-landlock-create' | 'sandbox-landlock-add' | 'sandbox-landlock-restrict' | 'sandbox-filter' | 'sandbox-execution';
type ProcessOutcome = 'unknown' | 'launch-error' | 'stream-error' | 'timeout' | 'output-limit' | 'nonzero-exit' | 'signal-sigsys' | 'signal-sigkill' | 'signal-sigabrt' | 'signal-sigsegv' | 'other-signal';
/** Diagnostic hints only, never acceptance evidence. No text is returned or
 * retained here; only static known marker categories may leave the process. */
export function classifyPdfA3StartupText(text: unknown): StartupCategory {
  if (typeof text !== 'string') return 'unknown';
  if (text.includes('Error loading java.security file')) return 'java-security-config';
  if (text.includes('Could not reserve enough space') || text.includes('Native memory allocation (mmap) failed')) return 'java-memory-reservation';
  if (text.includes('unable to create native thread') || text.includes('pthread_create failed')) return 'java-thread-creation';
  if (text.includes('Could not find or load main class org.verapdf.apps.GreenfieldCliWrapper')) return 'java-main-class';
  if (text.includes('Unrecognized VM option') || text.includes('Invalid maximum heap size')) return 'java-options';
  // Static English markers from util-linux v2.41.2; LANG is fixed C.UTF-8.
  // https://github.com/util-linux/util-linux/blob/v2.41.2/sys-utils/setpriv-landlock.c
  if (text.includes('setpriv: landlock_create_ruleset failed')) return 'sandbox-landlock-create';
  if (text.includes('setpriv: adding landlock rule failed')) return 'sandbox-landlock-add';
  if (text.includes('setpriv: landlock_restrict_self failed')) return 'sandbox-landlock-restrict';
  if (['setpriv: landlock', 'setpriv: could not parse landlock fs access', 'setpriv: could not open file for landlock', 'setpriv: invalid landlock rule'].some(marker => text.includes(marker))) return 'sandbox-rule';
  if (text.includes('setpriv: Could not load seccomp filter') || text.includes('setpriv: Seccomp non-functional')) return 'sandbox-filter';
  if (text.includes('setpriv: failed to execute')) return 'sandbox-execution';
  if (text.includes('Error occurred during initialization of VM') || text.includes('Could not create the Java Virtual Machine.')) return 'java-vm-initialization';
  return 'unknown';
}
export class PdfA3ValidationError extends Error {
  readonly status: 422 | 503;
  constructor(readonly kind: 'unsupported' | 'unavailable' = 'unavailable', readonly validatorStage: ValidatorStage = 'unknown', readonly startupCategory: StartupCategory = 'unknown', readonly processOutcome: ProcessOutcome = 'unknown') {
    super(kind === 'unsupported' ? 'Das PDF erfüllt das erforderliche PDF/A-3b-Profil nicht.' : 'Die unabhängige PDF/A-Prüfung ist nicht verfügbar.');
    this.name = 'PdfA3ValidationError';
    this.status = kind === 'unsupported' ? 422 : 503;
  }
}
type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PdfA3ValidationError();
  }
  return value as JsonObject;
}
function requireEqual(actual: unknown, expected: unknown): void {
  if (actual !== expected)
    throw new PdfA3ValidationError();
}
function requirePositiveCount(actual: unknown): void {
  if (typeof actual !== 'number' || !Number.isSafeInteger(actual) || actual < 1) {
    throw new PdfA3ValidationError();
  }
}
/**
 * These are veraPDF 1.30.3's JSON names, not its XML/JAXB attribute names.
 * JsonHandler uses Jackson getters: isCompliant -> compliant,
 * getValidationSummary -> validationSummary, etc. Schema references:
 * https://github.com/veraPDF/veraPDF-library/blob/v1.30.3/core/src/main/java/org/verapdf/processor/JsonHandler.java
 * https://github.com/veraPDF/veraPDF-library/tree/v1.30.3/core/src/main/java/org/verapdf/processor/reports
 * Unknown/missing structures must fail, not fall back to a metadata claim.
 */
function requireSingleCompliantReport(stdout: string, pdfPath: string, pdfSize: number): void {
  const root = object(JSON.parse(stdout) as unknown);
  requireEqual(Object.keys(root).length, 1);
  const report = object(root.report);
  if (!Array.isArray(report.jobs) || report.jobs.length !== 1) {
    throw new PdfA3ValidationError();
  }
  const job = object(report.jobs[0]);
  if ('taskException' in job)
    throw new PdfA3ValidationError();
  const item = object(job.itemDetails);
  requireEqual(item.name, pdfPath);
  requireEqual(item.size, pdfSize);
  if (!Array.isArray(job.validationResult) || job.validationResult.length !== 1) {
    throw new PdfA3ValidationError();
  }
  const validation = object(job.validationResult[0]);
  requireEqual(validation.jobEndStatus, 'normal');
  if (typeof validation.profileName !== 'string' || !/^PDF\/A-3B validation profile$/i.test(validation.profileName)) {
    throw new PdfA3ValidationError();
  }
  if (validation.compliant === false) {
    const summary = object(report.batchSummary);
    const counts = object(summary.validationSummary);
    requireEqual(summary.totalJobs, 1);
    requireEqual(summary.failedParsingJobs, 0);
    requireEqual(summary.failedEncryptedJobs, 0);
    requireEqual(summary.outOfMemory, 0);
    requireEqual(summary.veraExceptions, 0);
    requireEqual(counts.totalJobCount, 1);
    requireEqual(counts.successfulJobCount, 1);
    requireEqual(counts.compliantPdfaCount, 0);
    requireEqual(counts.nonCompliantPdfaCount, 1);
    requireEqual(counts.failedJobCount, 0);
    const failed = object(validation.details);
    if (!Number.isSafeInteger(failed.failedChecks) || (failed.failedChecks as number) < 1 || !Number.isSafeInteger(failed.failedRules) || (failed.failedRules as number) < 1)
      throw new PdfA3ValidationError();
    throw new PdfA3ValidationError('unsupported');
  }
  requireEqual(validation.compliant, true);
  const details = object(validation.details);
  requireEqual(details.failedRules, 0);
  requireEqual(details.failedChecks, 0);
  requirePositiveCount(details.passedRules);
  requirePositiveCount(details.passedChecks);
  const summary = object(report.batchSummary);
  requireEqual(summary.totalJobs, 1);
  requireEqual(summary.failedParsingJobs, 0);
  requireEqual(summary.failedEncryptedJobs, 0);
  requireEqual(summary.outOfMemory, 0);
  requireEqual(summary.veraExceptions, 0);
  const validationSummary = object(summary.validationSummary);
  requireEqual(validationSummary.totalJobCount, 1);
  requireEqual(validationSummary.successfulJobCount, 1);
  requireEqual(validationSummary.compliantPdfaCount, 1);
  requireEqual(validationSummary.nonCompliantPdfaCount, 0);
  requireEqual(validationSummary.failedJobCount, 0);
}
/**
 * The pinned official launcher execs Java, but reads JAVA_OPTS/JAVACMD and
 * classpath overrides from its environment. Never inherit application secrets,
 * Java agents/options, LD_PRELOAD, proxies or classpath inputs.
 * Source: https://github.com/veraPDF/veraPDF-apps/blob/v1.30.3/installer/src/main/scripts/verapdf.sh#L111
 * Linux prlimit and a private process group bound both the launcher and JVM.
 */
/** Shared exact command/resource/environment recipe. The synthetic no-input
 * startup probe uses this exact recipe; no production stream capture is added. */
export function veraPdfSpawnSpecification(binary: string, args: string[], directory: string, confined?: (args: string[]) => string[]) {
  return { binary: '/usr/bin/prlimit', args: [
      '--as=2147483648:2147483648', '--cpu=25:26', '--nofile=64:64', '--fsize=2097152:2097152', '--',
      ...(confined ? confined(args) : [binary, ...args]),
  ], options: {
      cwd: directory,
      detached: true,
      shell: false as const,
      env: {
        PATH: '/usr/bin:/bin', HOME: directory, TMPDIR: directory, XDG_CONFIG_HOME: directory,
        LANG: 'C.UTF-8', TZ: 'UTC', NODE_ENV: 'production' as const, JAVACMD: '/usr/bin/java', JAVA_OPTS: VERAPDF_JAVA_OPTIONS,
      },
      stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'],
  } };
}
function runVeraPdf(binary: string, args: string[], directory: string, confined?: (args: string[]) => string[], expectedReport?: { path: string; bytes: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const spec = veraPdfSpawnSpecification(binary, args, directory, confined);
    const child = spawn(spec.binary, spec.args, spec.options);
    const prefix = args[0] === '--version' ? 'version' : 'validation';
    let launchFailed = false;
    let processOutcome: ProcessOutcome = 'unknown';
    let startupCategory: StartupCategory = 'unknown';
    // Separate bounded tails permit static ASCII markers split across chunks,
    // without retaining full stderr or exposing either stream to the harness.
    const tails = [Buffer.alloc(0), Buffer.alloc(0)];
    let failed = false;
    let eligibleNoncomplianceExit = false;
    let groupKillAttempted = false;
    let totalBytes = 0;
    const stdout: Buffer[] = [];
    const killGroup = () => {
      if (groupKillAttempted)
        return;
      groupKillAttempted = true;
      try {
        if (child.pid)
          process.kill(-child.pid, 'SIGKILL');
        else
          child.kill('SIGKILL');
      }
      catch {
        try {
          child.kill('SIGKILL');
        }
        catch { /* Already reaped or unavailable. */ }
      }
    };
    const fail = (outcome: ProcessOutcome) => {
      if (processOutcome === 'unknown') processOutcome = outcome;
      failed = true;
      killGroup();
    };
    const timer = setTimeout(() => fail('timeout'), VERAPDF_TIMEOUT_MS);
    const consume = (chunk: Buffer, keep: boolean) => {
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_VERAPDF_REPORT_BYTES) {
        fail('output-limit');
        return;
      }
      const channel = keep ? 0 : 1;
      const bounded = Buffer.concat([tails[channel], chunk]);
      tails[channel] = Buffer.from(bounded.subarray(-256));
      const category = classifyPdfA3StartupText(bounded.toString('utf8'));
      if (category !== 'unknown' && (startupCategory === 'unknown' || startupCategory === 'java-vm-initialization')) startupCategory = category;
      if (keep && (!failed || (eligibleNoncomplianceExit && processOutcome === 'unknown')))
        stdout.push(chunk);
    };
    child.stdout.on('data', (chunk: Buffer) => consume(chunk, true));
    child.stderr.on('data', (chunk: Buffer) => consume(chunk, false));
    child.stdout.on('error', () => fail('stream-error'));
    child.stderr.on('error', () => fail('stream-error'));
    child.once('error', () => { launchFailed = true; fail('launch-error'); });
    child.once('exit', (code, signal) => {
      // Pipes may deliver their final buffered JSON after exit but before close.
      // Retain that bounded tail ONLY for this strict foreign-rejection check.
      eligibleNoncomplianceExit = !!expectedReport && prefix === 'validation' && code === 1 && !signal && !failed;
      if (code !== 0 || signal)
        failed = true;
      // The official shell execs Java. Still kill the entire private group on
      // every terminal path so no future descendant can retain output pipes.
      killGroup();
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      killGroup();
      // Wait for close, not error/exit: all output descriptors must be gone
      // before the caller deletes private files or releases processing capacity.
      if (failed || code !== 0 || signal) {
        // Pinned CLI INVALID(1) means coherent noncompliance, but an uncaught
        // exception can also exit1. Only the complete exact-byte/profile report
        // can justify foreign unsupported422. Never accept a nonzero result,
        // reinterpret a version failure or override another lifecycle failure.
        if (expectedReport && prefix === 'validation' && code === 1 && !signal && !launchFailed && processOutcome === 'unknown') {
          try { requireSingleCompliantReport(Buffer.concat(stdout).toString('utf8'), expectedReport.path, expectedReport.bytes); }
          catch (error) {
            if (error instanceof PdfA3ValidationError && error.kind === 'unsupported') {
              reject(new PdfA3ValidationError('unsupported', 'validation-result', startupCategory, 'nonzero-exit'));
              return;
            }
          }
        }
        if (processOutcome === 'unknown') {
          processOutcome = signal === 'SIGSYS' ? 'signal-sigsys' : signal === 'SIGKILL' ? 'signal-sigkill'
            : signal === 'SIGABRT' ? 'signal-sigabrt' : signal === 'SIGSEGV' ? 'signal-sigsegv'
              : signal ? 'other-signal' : 'nonzero-exit';
        }
        reject(new PdfA3ValidationError('unavailable', `${prefix}-${launchFailed ? 'launch' : 'result'}`, startupCategory, processOutcome));
      } else
        resolve(Buffer.concat(stdout).toString('utf8'));
    });
  });
}
/** Validate only the finalized bytes, after attachment and the last PDF save. */
export async function validatePdfA3(bytes: Uint8Array, options: {
  maxBytes?: number;
  temporaryPrefix?: string;
  confined?: boolean;
} = {}): Promise<void> {
  const maxBytes = options.maxBytes ?? MAX_PDF_INPUT_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_PDF_INPUT_BYTES * 2)
    throw new PdfA3ValidationError('unavailable', 'bounds');
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
    throw new PdfA3ValidationError('unavailable', 'bounds');
  }
  // Take a bounded snapshot before the first await so caller mutation cannot
  // change which bytes are written while the version check is in progress.
  const finalBytes = Uint8Array.from(bytes);
  let workDir: string | undefined;
  let validatorStage: ValidatorStage = 'construction';
  try {
    // Deployment configuration only; never a request/source-model property.
    const binary = process.env.BIVARO_VERAPDF_BIN || '/opt/verapdf/verapdf';
    if (process.platform !== 'linux' || !path.isAbsolute(binary))
      throw new PdfA3ValidationError();
    validatorStage = 'directory';
    workDir = await mkdtemp(path.join(tmpdir(), options.temporaryPrefix ?? 'bivaro-own-invoice-pdfa-'));
    validatorStage = 'construction';
    if (options.confined)
      await prepareForeignVerifierConfig(binary, workDir);
    const confinement = options.confined ? await foreignVerifierCommand(binary, workDir) : undefined;
    validatorStage = 'version-launch';
    const version = await runVeraPdf(binary, ['--version'], workDir, confinement);
    validatorStage = 'version-identity';
    requireEqual(version.trim().split(/\r?\n/u)[0], `veraPDF ${PDF_A_VERAPDF_VERSION}`);
    const pdfPath = path.join(workDir, 'final.pdf');
    validatorStage = 'input-write';
    await writeFile(pdfPath, finalBytes, { flag: 'wx', mode: 0o600 });
    validatorStage = 'validation-launch';
    const report = await runVeraPdf(binary, [
      '--flavour', '3b',
      '--format', 'json',
      '--maxfailuresdisplayed', '10',
      '--loglevel', '0',
      pdfPath,
    ], workDir, confinement, options.confined ? { path: pdfPath, bytes: finalBytes.byteLength } : undefined);
    validatorStage = 'report';
    requireSingleCompliantReport(report, pdfPath, finalBytes.byteLength);
  }
  catch (error) {
    if (error instanceof PdfA3ValidationError && error.validatorStage !== 'unknown')
      throw error;
    // No report, document content, temp path or process diagnostics are safe
    // for an API response. Every unavailable/failed/unknown outcome is fatal.
    throw new PdfA3ValidationError(error instanceof PdfA3ValidationError ? error.kind : 'unavailable', validatorStage);
  }
  finally {
    if (workDir) {
      try {
        await rm(workDir, { recursive: true, force: true });
      }
      catch {
        throw new PdfA3ValidationError('unavailable', 'cleanup');
      }
    }
  }
}
