import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { MAX_PDF_INPUT_BYTES } from '@/lib/resource-limits';

export const OWN_INVOICE_VERAPDF_VERSION = '1.30.3';

const VERAPDF_TIMEOUT_MS = 30_000;
const MAX_VERAPDF_REPORT_BYTES = 2 * 1024 * 1024;
const VERAPDF_JAVA_OPTIONS = [
  '-Xms16m', '-Xmx192m', '-Xss512k', '-XX:+UseSerialGC', '-XX:ActiveProcessorCount=1',
  '-XX:MaxMetaspaceSize=64m', '-XX:CompressedClassSpaceSize=32m', '-XX:ReservedCodeCacheSize=32m',
  '-XX:MaxDirectMemorySize=16m', '-XX:-CreateCoredumpOnCrash', '-XX:ErrorFile=java-error.log',
  '-Djava.awt.headless=true', '-Djava.io.tmpdir=.', '-Duser.home=.',
  '-Djavax.xml.accessExternalDTD=', '-Djavax.xml.accessExternalSchema=', '-Djavax.xml.accessExternalStylesheet=',
].join(' ');
const PUBLIC_VALIDATION_ERROR = 'Die abschließende PDF/A-3b-Prüfung ist fehlgeschlagen. Es wurde keine Rechnungsdatei erstellt.';

export class OwnInvoicePdfAValidationError extends Error {
  readonly status = 500;

  constructor() {
    super(PUBLIC_VALIDATION_ERROR);
    this.name = 'OwnInvoicePdfAValidationError';
  }
}

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new OwnInvoicePdfAValidationError();
  }
  return value as JsonObject;
}

function requireEqual(actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new OwnInvoicePdfAValidationError();
}

function requirePositiveCount(actual: unknown): void {
  if (typeof actual !== 'number' || !Number.isSafeInteger(actual) || actual < 1) {
    throw new OwnInvoicePdfAValidationError();
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
    throw new OwnInvoicePdfAValidationError();
  }
  const job = object(report.jobs[0]);
  if ('taskException' in job) throw new OwnInvoicePdfAValidationError();
  const item = object(job.itemDetails);
  requireEqual(item.name, pdfPath);
  requireEqual(item.size, pdfSize);

  if (!Array.isArray(job.validationResult) || job.validationResult.length !== 1) {
    throw new OwnInvoicePdfAValidationError();
  }
  const validation = object(job.validationResult[0]);
  requireEqual(validation.compliant, true);
  requireEqual(validation.jobEndStatus, 'normal');
  if (typeof validation.profileName !== 'string' || !/^PDF\/A-3B validation profile$/i.test(validation.profileName)) {
    throw new OwnInvoicePdfAValidationError();
  }
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
function runVeraPdf(binary: string, args: string[], directory: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/prlimit', [
      '--as=2147483648:2147483648', '--cpu=25:26', '--nofile=64:64', '--fsize=2097152:2097152', '--',
      binary, ...args,
    ], {
      cwd: directory,
      detached: true,
      shell: false,
      env: {
        PATH: '/usr/bin:/bin', HOME: directory, TMPDIR: directory, XDG_CONFIG_HOME: directory,
        LANG: 'C.UTF-8', TZ: 'UTC', NODE_ENV: 'production', JAVACMD: '/usr/bin/java', JAVA_OPTS: VERAPDF_JAVA_OPTIONS,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let failed = false;
    let groupKillAttempted = false;
    let totalBytes = 0;
    const stdout: Buffer[] = [];
    const killGroup = () => {
      if (groupKillAttempted) return;
      groupKillAttempted = true;
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        try { child.kill('SIGKILL'); } catch { /* Already reaped or unavailable. */ }
      }
    };
    const fail = () => {
      failed = true;
      killGroup();
    };
    const timer = setTimeout(fail, VERAPDF_TIMEOUT_MS);
    const consume = (chunk: Buffer, keep: boolean) => {
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_VERAPDF_REPORT_BYTES) { fail(); return; }
      if (keep && !failed) stdout.push(chunk);
    };
    child.stdout.on('data', (chunk: Buffer) => consume(chunk, true));
    child.stderr.on('data', (chunk: Buffer) => consume(chunk, false));
    child.stdout.on('error', fail);
    child.stderr.on('error', fail);
    child.once('error', fail);
    child.once('exit', (code, signal) => {
      if (code !== 0 || signal) failed = true;
      // The official shell execs Java. Still kill the entire private group on
      // every terminal path so no future descendant can retain output pipes.
      killGroup();
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      killGroup();
      // Wait for close, not error/exit: all output descriptors must be gone
      // before the caller deletes private files or releases processing capacity.
      if (failed || code !== 0 || signal) reject(new OwnInvoicePdfAValidationError());
      else resolve(Buffer.concat(stdout).toString('utf8'));
    });
  });
}

/** Validate only the finalized bytes, after attachment and the last PDF save. */
export async function validateOwnInvoicePdfA3(bytes: Uint8Array): Promise<void> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PDF_INPUT_BYTES) {
    throw new OwnInvoicePdfAValidationError();
  }

  // Take a bounded snapshot before the first await so caller mutation cannot
  // change which bytes are written while the version check is in progress.
  const finalBytes = Uint8Array.from(bytes);
  let workDir: string | undefined;
  try {
    // Deployment configuration only; never a request/source-model property.
    const binary = process.env.BIVARO_VERAPDF_BIN || '/opt/verapdf/verapdf';
    if (process.platform !== 'linux' || !path.isAbsolute(binary)) throw new OwnInvoicePdfAValidationError();
    workDir = await mkdtemp(path.join(tmpdir(), 'bivaro-own-invoice-pdfa-'));
    const version = await runVeraPdf(binary, ['--version'], workDir);
    requireEqual(version.trim().split(/\r?\n/u)[0], `veraPDF ${OWN_INVOICE_VERAPDF_VERSION}`);

    const pdfPath = path.join(workDir, 'final.pdf');
    await writeFile(pdfPath, finalBytes, { flag: 'wx', mode: 0o600 });
    const report = await runVeraPdf(binary, [
      '--flavour', '3b',
      '--format', 'json',
      '--maxfailuresdisplayed', '10',
      '--loglevel', '0',
      pdfPath,
    ], workDir);
    requireSingleCompliantReport(report, pdfPath, finalBytes.byteLength);
  } catch {
    // No report, document content, temp path or process diagnostics are safe
    // for an API response. Every unavailable/failed/unknown outcome is fatal.
    throw new OwnInvoicePdfAValidationError();
  } finally {
    if (workDir) {
      try { await rm(workDir, { recursive: true, force: true }); }
      catch { throw new OwnInvoicePdfAValidationError(); }
    }
  }
}
