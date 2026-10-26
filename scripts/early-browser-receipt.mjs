import * as fs from 'node:fs';
import path from 'node:path';
import { createPublicFragmentCollector } from './public-fragment-diagnostics.mjs';

export const MAX_RECEIPT_BYTES = 64 * 1024;
export const MAX_FAILURES = 64;
const WARNING = '::warning::Bounded early browser receipt unavailable; the original suite result remains authoritative.';
const STATUSES = new Set(['passed', 'failed', 'timedOut', 'skipped', 'interrupted']);
const PROJECTS = new Set(['chromium', 'chromium-bootstrap']);

function hints(errors) {
  const tags = new Set();
  for (const error of Array.isArray(errors) ? errors.slice(0, 8) : []) {
    const text = typeof error?.message === 'string' ? error.message.slice(0, 4096) : '';
    if (/\bP2003\b/u.test(text)) tags.add('PRISMA_P2003');
    if (/\bENOENT\b/u.test(text)) tags.add('ENOENT');
    if (/strict mode violation/u.test(text)) tags.add('STRICT_LOCATOR_DUPLICATE');
    if (/viewport ratio 0/u.test(text)) tags.add('VIEWPORT_RATIO_ZERO');
    if (/\/api\/auth\/_log/u.test(text)) tags.add('AUTH_LOG_TRANSPORT');
  }
  return [...tags];
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 && value <= 1_000_000 ? value : null;
}

function metadataShape(env) {
  const keys = ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'BIVARO_BROWSER_RECEIPT_HEAD', 'RUNNER_TEMP', 'GITHUB_WORKSPACE', 'GITHUB_OUTPUT'];
  return keys.every(key => typeof env[key] === 'string' && !/[\r\n\0]/u.test(env[key])) &&
    /^[1-9]\d{0,19}$/u.test(env.GITHUB_RUN_ID) && /^[1-9]\d{0,7}$/u.test(env.GITHUB_RUN_ATTEMPT) &&
    /^[a-f0-9]{40}$/u.test(env.BIVARO_BROWSER_RECEIPT_HEAD) &&
    [env.RUNNER_TEMP, env.GITHUB_WORKSPACE, env.GITHUB_OUTPUT].every(value => path.isAbsolute(value));
}

function incompleteReceipt(value) {
  const observed = Object.values(value.counts).reduce((sum, count) => sum + count, 0);
  return !value.onEndObserved || value.plannedCases === null || observed !== value.plannedCases ||
    !['passed', 'failed'].includes(value.endStatus) || value.counts.interrupted > 0 || value.counts.timedOut > 0 ||
    value.globalErrors > 0 || value.overflow || value.redactedLocations > 0;
}

/** The injected IO is for pure contract tests; production reads only named CI metadata. */
export function createReceiptReporter({ env = process.env, io = fs, warn = () => console.warn(WARNING), emitOutputs = true } = {}) {
  let unavailable = false;
  let directory;
  let workspace;
  let state;
  const fail = () => {
    if (!unavailable) { unavailable = true; try { warn(); } catch { /* Optional diagnostics only. */ } }
  };
  const publish = () => {
    if (unavailable || !state || !directory) return false;
    try {
      if (io.realpathSync(directory) !== directory) throw new Error('Unsafe receipt directory');
      state.incomplete = incompleteReceipt(state);
      state.completed = !state.incomplete;
      let data = JSON.stringify(state) + '\n';
      while (Buffer.byteLength(data) > MAX_RECEIPT_BYTES && state.failures.length) {
        state.failures.pop();
        state.overflow = true;
        state.incomplete = true;
        state.completed = false;
        if (state.omittedFailures < 1_000_000) state.omittedFailures++;
        data = JSON.stringify(state) + '\n';
      }
      if (Buffer.byteLength(data) > MAX_RECEIPT_BYTES) throw new Error('Receipt exceeds bound');
      // The directory is freshly owned and private. wx refuses a pre-existing
      // temporary path; rename never follows a destination symlink.
      const temporary = path.join(directory, '.receipt-next');
      io.writeFileSync(temporary, data, { flag: 'wx', mode: 0o600 });
      io.renameSync(temporary, path.join(directory, 'receipt.json'));
      return true;
    } catch { fail(); return false; }
  };
  return {
    onBegin(_config, suite) {
      try {
        const runId = env.GITHUB_RUN_ID;
        const attempt = env.GITHUB_RUN_ATTEMPT;
        const head = env.BIVARO_BROWSER_RECEIPT_HEAD;
        if (!metadataShape(env)) throw new Error('Missing trusted receipt metadata');
        const root = io.realpathSync(env.RUNNER_TEMP);
        workspace = io.realpathSync(env.GITHUB_WORKSPACE);
        // Independent of run-e2e's temporary DB directory and always fresh,
        // including reruns and multiple reporter constructions in one job.
        const prefix = 'bivaro-browser-receipt-' + runId + '-' + attempt + '-';
        directory = io.mkdtempSync(path.join(root, prefix));
        if (path.dirname(directory) !== root || !path.basename(directory).startsWith(prefix) ||
          io.realpathSync(directory) !== directory) throw new Error('Unsafe fresh receipt directory');
        const planned = suite.allTests().length;
        state = {
          schema: 'bivaro-browser-early-receipt-v1',
          runId, attempt, head,
          acceptanceEvidence: false,
          hintsAreNotDiagnoses: true,
          onEndObserved: false,
          incomplete: true,
          completed: false,
          endStatus: null,
          plannedCases: Number.isInteger(planned) && planned >= 0 && planned <= 10_000 ? planned : null,
          counts: { passed: 0, failed: 0, timedOut: 0, skipped: 0, interrupted: 0 },
          globalErrors: 0,
          overflow: false,
          omittedFailures: 0,
          redactedLocations: 0,
          failures: [],
        };
        if (publish()) {
          // Emit a path only after this invocation has created and written its
          // own fresh receipt. A stale earlier path can never select an upload.
          if (emitOutputs) io.appendFileSync(env.GITHUB_OUTPUT, 'early_receipt_directory=' + directory + '\nearly_receipt_ready=true\n', 'utf8');
          return directory;
        }
      } catch { fail(); }
    },
    onTestEnd(test, result) {
      if (unavailable || !state) return;
      try {
        const status = STATUSES.has(result.status) ? result.status : 'interrupted';
        if (state.counts[status] < 1_000_000) state.counts[status]++;
        else state.overflow = true;
        if (status !== 'passed' && status !== 'skipped') {
          if (state.failures.length >= MAX_FAILURES) {
            state.overflow = true;
            if (state.omittedFailures < 1_000_000) state.omittedFailures++;
          } else {
            const relative = path.relative(workspace, test.location.file).split(path.sep).join('/');
            const file = /^e2e\/[A-Za-z0-9_./-]+\.spec\.tsx?$/u.test(relative) &&
              !relative.split('/').includes('..') && relative.length <= 200 ? relative : 'unknown';
            const projectName = test.parent?.project()?.name;
            const tags = hints(result.errors);
            if (file === 'unknown' || !PROJECTS.has(projectName) || positiveInteger(test.location.line) === null ||
              positiveInteger(test.location.column) === null) state.redactedLocations++;
            state.failures.push({
              file,
              line: positiveInteger(test.location.line),
              column: positiveInteger(test.location.column),
              project: PROJECTS.has(projectName) ? projectName : 'other',
              status,
              expectedFailure: test.expectedStatus === status,
              hintTags: tags,
              unclassifiedError: tags.length === 0,
            });
          }
        }
        publish();
      } catch { fail(); }
    },
    onError() {
      if (unavailable || !state) return;
      try {
        if (state.globalErrors < 1_000_000) state.globalErrors++;
        else state.overflow = true;
        publish();
      } catch { fail(); }
    },
    onEnd(result) {
      if (unavailable || !state) return;
      try {
        state.onEndObserved = true;
        state.endStatus = ['passed', 'failed', 'timedout', 'interrupted'].includes(result.status) ? result.status : 'unknown';
        publish();
      } catch { fail(); }
    },
  };
}

const RECEIPT_KEYS = ['schema', 'runId', 'attempt', 'head', 'acceptanceEvidence', 'hintsAreNotDiagnoses', 'completed', 'endStatus',
  'plannedCases', 'counts', 'globalErrors', 'overflow', 'omittedFailures', 'failures', 'onEndObserved', 'incomplete', 'redactedLocations'].sort();
const HINTS = new Set(['PRISMA_P2003', 'ENOENT', 'STRICT_LOCATOR_DUPLICATE', 'VIEWPORT_RATIO_ZERO', 'AUTH_LOG_TRANSPORT']);
const boundedCount = value => Number.isInteger(value) && value >= 0 && value <= 1_000_000;
const safeFile = value => value === 'unknown' || typeof value === 'string' && value.length <= 200 &&
  /^e2e\/[A-Za-z0-9_./-]+\.spec\.tsx?$/u.test(value) && !value.split('/').includes('..');
function exactKeys(object, keys) {
  return object && typeof object === 'object' && !Array.isArray(object) &&
    JSON.stringify(Object.keys(object).sort()) === JSON.stringify([...keys].sort());
}

/** Reject, rather than echo, any unknown values injected into an on-disk receipt. */
export function validReceipt(value, env) {
  return metadataShape(env) && exactKeys(value, RECEIPT_KEYS) && value.schema === 'bivaro-browser-early-receipt-v1' &&
    value.runId === env.GITHUB_RUN_ID && value.attempt === env.GITHUB_RUN_ATTEMPT && value.head === env.BIVARO_BROWSER_RECEIPT_HEAD &&
    value.acceptanceEvidence === false && value.hintsAreNotDiagnoses === true &&
    typeof value.completed === 'boolean' && typeof value.incomplete === 'boolean' && value.completed !== value.incomplete &&
    typeof value.onEndObserved === 'boolean' &&
    (value.onEndObserved ? ['passed', 'failed', 'timedout', 'interrupted', 'unknown'].includes(value.endStatus) : value.endStatus === null) &&
    (value.plannedCases === null || boundedCount(value.plannedCases) && value.plannedCases <= 10_000) &&
    exactKeys(value.counts, [...STATUSES]) && Object.values(value.counts).every(boundedCount) &&
    boundedCount(value.globalErrors) && typeof value.overflow === 'boolean' && boundedCount(value.omittedFailures) && boundedCount(value.redactedLocations) &&
    Array.isArray(value.failures) && value.failures.length <= MAX_FAILURES &&
    value.failures.every(entry => exactKeys(entry, ['file', 'line', 'column', 'project', 'status', 'expectedFailure', 'hintTags', 'unclassifiedError']) &&
      safeFile(entry.file) && (entry.line === null || positiveInteger(entry.line) !== null) &&
      (entry.column === null || positiveInteger(entry.column) !== null) &&
      (PROJECTS.has(entry.project) || entry.project === 'other') &&
      ['failed', 'timedOut', 'interrupted'].includes(entry.status) && typeof entry.expectedFailure === 'boolean' &&
      typeof entry.unclassifiedError === 'boolean' && Array.isArray(entry.hintTags) &&
      entry.hintTags.length <= HINTS.size && new Set(entry.hintTags).size === entry.hintTags.length &&
      entry.hintTags.every(tag => HINTS.has(tag))) &&
    value.incomplete === incompleteReceipt(value);
}

/** Runs immediately after the functional step, even for startup/cancellation failures. */
export function finalizeReceipt({ env = process.env, io = fs, warn = () => console.warn(WARNING) } = {}) {
  let fd;
  try {
    if (!metadataShape(env)) throw new Error('Missing trusted receipt metadata');
    const outcome = env.BIVARO_BROWSER_SUITE_OUTCOME;
    if (!['success', 'failure', 'cancelled', 'skipped'].includes(outcome)) throw new Error('Missing suite outcome');
    let directory = env.BIVARO_BROWSER_RECEIPT_DIRECTORY;
    let receipt;
    let reporterUnavailable = false;
    try {
      const root = io.realpathSync(env.RUNNER_TEMP);
      const prefix = 'bivaro-browser-receipt-' + env.GITHUB_RUN_ID + '-' + env.GITHUB_RUN_ATTEMPT + '-';
      if (!directory || path.dirname(directory) !== root || !path.basename(directory).startsWith(prefix) ||
        io.realpathSync(directory) !== directory) throw new Error('Untrusted receipt path');
      fd = io.openSync(path.join(directory, 'receipt.json'), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      const info = io.fstatSync(fd);
      if (!info.isFile() || info.size <= 0 || info.size > MAX_RECEIPT_BYTES) throw new Error('Unbounded receipt');
      const buffer = Buffer.alloc(MAX_RECEIPT_BYTES + 1);
      const length = io.readSync(fd, buffer, 0, buffer.length, 0);
      io.closeSync(fd); fd = undefined;
      if (length !== info.size || length > MAX_RECEIPT_BYTES) throw new Error('Receipt changed during read');
      receipt = JSON.parse(buffer.subarray(0, length).toString('utf8'));
      if (!validReceipt(receipt, env)) throw new Error('Untrusted receipt contents');
    } catch {
      if (fd !== undefined) { io.closeSync(fd); fd = undefined; }
      reporterUnavailable = true;
      // Missing/startup/invalid receipts become a NEW schema-safe incomplete
      // receipt; no stale/unknown input or raw error is copied into it.
      directory = createReceiptReporter({ env, io, warn, emitOutputs: false }).onBegin({}, { allTests: () => [] });
      if (!directory) return false;
      receipt = JSON.parse(io.readFileSync(path.join(directory, 'receipt.json'), 'utf8'));
      if (!validReceipt(receipt, env)) throw new Error('Invalid fresh receipt');
      receipt.plannedCases = null;
    }
    receipt.functionalStepOutcome = outcome;
    receipt.reporterUnavailable = reporterUnavailable;
    if (reporterUnavailable || ['cancelled', 'skipped'].includes(outcome)) { receipt.incomplete = true; receipt.completed = false; }
    const data = JSON.stringify(receipt) + '\n';
    if (Buffer.byteLength(data) > MAX_RECEIPT_BYTES) throw new Error('Final receipt exceeds bound');
    const temporary = path.join(directory, '.receipt-final');
    io.writeFileSync(temporary, data, { flag: 'wx', mode: 0o600 });
    io.renameSync(temporary, path.join(directory, 'receipt.json'));
    io.appendFileSync(env.GITHUB_OUTPUT, 'early_receipt_directory=' + directory + '\nearly_receipt_ready=true\n', 'utf8');
    return true;
  } catch {
    if (fd !== undefined) { try { io.closeSync(fd); } catch { /* Optional cleanup only. */ } }
    try { warn(); } catch { /* Never change the original functional result. */ }
    return false;
  }
}

export default class EarlyBrowserReceiptReporter {
  constructor() { this.reporter = createReceiptReporter(); this.fragments = createPublicFragmentCollector(); }
  printsToStdio() { return false; }
  onBegin(config, suite) { this.reporter.onBegin(config, suite); this.fragments.onBegin(config, suite); }
  onTestEnd(test, result) { this.reporter.onTestEnd(test, result); this.fragments.onTestEnd(test, result); }
  onError(error) { this.reporter.onError(error); }
  onEnd(result) { this.reporter.onEnd(result); this.fragments.onEnd(result); }
}
