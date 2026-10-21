import { createHash } from 'node:crypto';
import { lstat, mkdtemp, open, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ProcessingCapacityError } from '@/lib/processing-limit';
import { PURCHASE_RULES_SHA256, PURCHASE_RULES_VERSION, PURCHASE_VALIDATION_VERSION, PURCHASE_VALIDATOR_SHA256, PURCHASE_VALIDATOR_VERSION, type PurchaseTechnicalReport } from './validation-contract';
import { inspectValidationXml, ValidationXmlError } from './validation-xml';
import { MAX_VALIDATION_REPORT_BYTES, readOfficialValidationReport } from './validation-report-parser';

const RULES_TREE_SHA256 = 'eaa60afa23c735dc9ff21717a0bc586e6c63a6f8ba36fbd46b4b9650ced1a63a';
const SCENARIO_SHA256 = { CII: 'f79b645e9dbe3ad568024861dfcaa2f4d2736be25b6a57e96f39464055b1179e', UBL: '292fdd6b8646f8a36a8ce1edd4e56e866a8085728f5c76c737baa7887b5816ca' };
const WALL_LIMIT_MS = 30_000;
let active = false;
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Complete tree verification detects missing/changed rules, not just a version label. */
export async function verifyValidationAssets(root: string): Promise<void> {
  const jar = path.join(root, 'validator-1.6.3-standalone.jar');
  if (!(await lstat(jar)).isFile() || (await lstat(jar)).isSymbolicLink() || (await lstat(jar)).size !== 10_648_594 || digest(await readFile(jar)) !== PURCHASE_VALIDATOR_SHA256) throw new Error('VALIDATOR_INTEGRITY');
  const rules = path.join(root, 'rules');
  const manifest: Array<{ path: string; sha256: string }> = [];
  let totalBytes = 0;
  async function walk(relative: string) {
    for (const name of await readdir(path.join(rules, relative))) {
      const next = path.posix.join(relative, name);
      const absolute = path.join(rules, next);
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) throw new Error('RULES_INTEGRITY');
      if (stat.isDirectory()) await walk(next);
      else if (stat.isFile()) {
        totalBytes += stat.size;
        if (manifest.length >= 200 || totalBytes > 12 * 1024 * 1024) throw new Error('RULES_INTEGRITY');
        manifest.push({ path: next, sha256: digest(await readFile(absolute)) });
      } else throw new Error('RULES_INTEGRITY');
    }
  }
  await walk('');
  manifest.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (digest(Buffer.from(JSON.stringify(manifest))) !== RULES_TREE_SHA256) throw new Error('RULES_INTEGRITY');
  for (const format of ['CII', 'UBL'] as const) {
    const scenario = path.join(root, `scenarios-${format.toLowerCase()}.xml`);
    if (!(await lstat(scenario)).isFile() || (await lstat(scenario)).isSymbolicLink() || digest(await readFile(scenario)) !== SCENARIO_SHA256[format]) throw new Error('RULES_INTEGRITY');
  }
}

/** No shell, no daemon, no caller-supplied arguments or inherited Java options. */
export async function runValidationProcess(root: string, directory: string, format: 'CII' | 'UBL'): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/prlimit', [
      '--as=2147483648:2147483648', '--cpu=25:26', '--nofile=64:64', '--fsize=2097152:2097152', '--',
      '/usr/bin/java', '-Xms16m', '-Xmx192m', '-Xss512k', '-XX:+UseSerialGC', '-XX:ActiveProcessorCount=1', '-XX:MaxMetaspaceSize=64m', '-XX:CompressedClassSpaceSize=32m', '-XX:ReservedCodeCacheSize=32m', '-XX:MaxDirectMemorySize=16m', '-XX:-CreateCoredumpOnCrash', '-XX:ErrorFile=java-error.log',
      '-Djava.awt.headless=true', '-Djavax.xml.accessExternalDTD=', '-Djavax.xml.accessExternalSchema=file', '-Djavax.xml.accessExternalStylesheet=file',
      '-jar', path.join(root, 'validator-1.6.3-standalone.jar'), '-s', path.join(root, `scenarios-${format.toLowerCase()}.xml`), '-r', path.join(root, 'rules'), '-o', directory, path.join(directory, 'source.xml'),
    ], { cwd: directory, detached: true, env: { NODE_ENV: 'production', PATH: '/usr/bin:/bin', HOME: directory, LANG: 'C.UTF-8', TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let outputBytes = 0;
    let failure: Error | null = null;
    const fail = (code: string) => {
      failure ??= new Error(code);
      // prlimit execs the JVM. A private process group also contains any future
      // descendants, so interruption cannot leave a document-processing child.
      try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); }
      catch { child.kill('SIGKILL'); }
    };
    const timer = setTimeout(() => fail('VALIDATOR_TIMEOUT'), WALL_LIMIT_MS);
    const output = (chunk: Buffer) => { outputBytes += chunk.byteLength; if (outputBytes > 64 * 1024) fail('VALIDATOR_OUTPUT_LIMIT'); };
    child.stdout.on('data', output); child.stderr.on('data', output);
    child.once('error', () => { failure = new Error('VALIDATOR_UNAVAILABLE'); });
    // Wait for close, not error/exit: the process and its output descriptors must be gone before releasing capacity or deleting files.
    child.once('close', code => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code === 0 || code === 1) resolve(code);
      else reject(new Error('VALIDATOR_EXECUTION_FAILED'));
    });
  });
}

/** Pure technical check of immutable bytes. Never reads a DB or creates a booking. */
export async function validatePurchaseOriginal(input: { bytes: Uint8Array; expectedSha256: string; mediaType: string }, options: { assetsRoot?: string; now?: Date } = {}): Promise<PurchaseTechnicalReport> {
  const report: PurchaseTechnicalReport = { reportVersion: 1, originalSha256: input.expectedSha256,
    checkerVersion: PURCHASE_VALIDATION_VERSION, validatorVersion: PURCHASE_VALIDATOR_VERSION, rulesVersion: PURCHASE_RULES_VERSION, rulesSha256: PURCHASE_RULES_SHA256,
    checkedAt: (options.now ?? new Date()).toISOString(), status: 'NOT_RUN', reasonCode: 'VALIDATOR_UNAVAILABLE', format: null, profile: null,
    checks: { xml: 'NOT_RUN', xsd: 'NOT_RUN', schematron: 'NOT_RUN' }, findings: [], findingsTruncated: false, accountingApproval: 'NOT_PERFORMED' };
  if (!/^[a-f0-9]{64}$/.test(input.expectedSha256) || digest(input.bytes) !== input.expectedSha256) return { ...report, status: 'FAILED', reasonCode: 'ORIGINAL_HASH_MISMATCH' };
  if (input.mediaType !== 'application/xml') return { ...report, status: 'UNSUPPORTED', reasonCode: 'STANDALONE_XML_ONLY' };
  try {
    const identity = inspectValidationXml(input.bytes);
    report.format = identity.format; report.profile = identity.profile; report.checks.xml = 'PASSED';
    if (!identity.supported) return { ...report, status: 'UNSUPPORTED', reasonCode: 'PROFILE_UNSUPPORTED' };
  } catch (error) {
    if (error instanceof ValidationXmlError && error.code === 'XML_SCHEMA_HINTS_UNSUPPORTED') return { ...report, status: 'UNSUPPORTED', reasonCode: error.code };
    return { ...report, status: 'FAILED', reasonCode: error instanceof ValidationXmlError ? error.code : 'XML_SYNTAX', checks: { ...report.checks, xml: 'FAILED' } };
  }
  if (active) throw new ProcessingCapacityError();
  active = true;
  let directory: string | null = null;
  try {
    const root = path.resolve(options.assetsRoot ?? process.env.BIVARO_EINVOICE_ASSETS ?? '/opt/bivaro/einvoice');
    try { await verifyValidationAssets(root); }
    catch { return { ...report, reasonCode: 'VALIDATOR_RULES_UNAVAILABLE' }; }
    directory = await mkdtemp(path.join(tmpdir(), 'bivaro-invoice-check-'));
    await writeFile(path.join(directory, 'source.xml'), input.bytes, { mode: 0o600, flag: 'wx' });
    if (!report.format) throw new Error('VALIDATOR_PROFILE');
    const exitCode = await runValidationProcess(root, directory, report.format);
    const handle = await open(path.join(directory, 'source-report.xml'), constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes: Buffer;
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size < 1 || stat.size > MAX_VALIDATION_REPORT_BYTES) throw new Error('VALIDATOR_REPORT_LIMIT');
      bytes = await handle.readFile();
    } finally { await handle.close(); }
    const result = readOfficialValidationReport(bytes, report.originalSha256);
    if ((exitCode === 0) !== (result.status !== 'FAILED')) throw new Error('VALIDATOR_REPORT_INCONSISTENT');
    return { ...report, ...result, reasonCode: result.status === 'FAILED' ? 'RULE_VIOLATIONS' : result.status === 'WARNINGS' ? 'RULE_WARNINGS' : 'SUPPORTED_RULES_PASSED' };
  } catch (error) {
    const allowed = ['VALIDATOR_TIMEOUT', 'VALIDATOR_OUTPUT_LIMIT', 'VALIDATOR_UNAVAILABLE', 'VALIDATOR_EXECUTION_FAILED', 'VALIDATOR_REPORT_LIMIT'];
    const reasonCode = error instanceof Error && allowed.includes(error.message) ? error.message : 'VALIDATOR_REPORT_UNAVAILABLE';
    return { ...report, reasonCode };
  } finally {
    try { if (directory) await rm(directory, { recursive: true, force: true }); }
    finally { active = false; }
  }
}
