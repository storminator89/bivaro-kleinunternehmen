import * as fs from 'node:fs';
import path from 'node:path';

export const MAX_PUBLIC_FRAGMENT_BYTES = 32 * 1024;
export const MAX_PUBLIC_FRAGMENT_INPUT_BYTES = 16 * 1024;
export const MAX_PUBLIC_FRAGMENT_ENTRIES = 2;
export const MAX_PUBLIC_FRAGMENT_ATTACHMENTS = 8;
const SCHEMA = 'bivaro-public-fragment-diagnostic-v1';
const FILE = 'public-fragments.json';
const WARNING = '::warning::Bounded public fragment diagnostics unavailable; the original suite result remains authoritative.';
const FAILURES = new Set(['failed', 'timedOut', 'interrupted']);
const STATUSES = ['passed', 'failed', 'timedOut', 'skipped', 'interrupted'];
const END_STATUSES = ['passed', 'failed', 'timedout', 'interrupted', 'unknown'];
const LABELS = { 'first-workflow': 'erste-rechnung-title', offer: 'angebot' };
const ATTACHMENTS = new Map(Object.keys(LABELS).map(label => [`public-${label}-fragment-failure.json`, label]));
const LOCATIONS = new Set(['/', '/help', '/help#angebot', '/help#erste-rechnung']);
const TEST_LABELS = new Map([
  ['returns from cached first-workflow help through the brand and home CTA to exactly one fragment', 'first-workflow'],
  ['returns from cached offer help through the brand and home footer to exactly one fragment', 'offer'],
]);
const FRAGMENTS = new Set(['', 'angebot', 'erste-rechnung']);
const TAGS = new Set(['HTML', 'BODY', 'MAIN', 'HEADER', 'FOOTER', 'NAV', 'SECTION', 'ARTICLE', 'ASIDE', 'DIV', 'SPAN', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'A', 'UL', 'OL', 'LI']);
const DISPLAYS = new Set(['none', 'contents', 'block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'inline-grid', 'flow-root', 'list-item', 'table', 'inline-table', 'table-row', 'table-cell', 'table-row-group', 'table-header-group', 'table-footer-group', 'table-column', 'table-column-group', 'table-caption']);
const VISIBILITIES = new Set(['visible', 'hidden', 'collapse']);
const POSITIONS = new Set(['static', 'relative', 'absolute', 'fixed', 'sticky']);
const EVENTS = new Set(['document-request', 'main-frame-navigation', 'domcontentloaded', 'load']);
const REASONS = new Set(['invalid-attachment', 'attachment-overflow', 'missing-snapshot']);
const COUNT_MAX = 1_000_000;
const noopHooks = () => ({ onBegin() {}, onTestEnd() {}, onEnd() {} });
const defaultWarn = () => console.warn(WARNING);
const count = value => Number.isInteger(value) && value >= 0 && value <= COUNT_MAX;
const number = (value, min = -1e9, max = 1e9) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const boolean = value => typeof value === 'boolean';
const nullable = (value, predicate) => value === null || predicate(value);

function shape(value, required, optional = []) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
function requireValid(valid) { if (!valid) throw new Error('Unavailable bounded diagnostic'); }
function namedMetadata(env) {
  const keys = ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'BIVARO_BROWSER_RECEIPT_HEAD', 'RUNNER_TEMP', 'GITHUB_WORKSPACE', 'GITHUB_OUTPUT'];
  const values = Object.fromEntries(keys.map(key => [key, env[key]]));
  requireValid(keys.every(key => typeof values[key] === 'string' && !/[\r\n\0]/u.test(values[key])) &&
    /^[1-9]\d{0,19}$/u.test(values.GITHUB_RUN_ID) && /^[1-9]\d{0,7}$/u.test(values.GITHUB_RUN_ATTEMPT) &&
    /^[a-f0-9]{40}$/u.test(values.BIVARO_BROWSER_RECEIPT_HEAD) &&
    ['RUNNER_TEMP', 'GITHUB_WORKSPACE', 'GITHUB_OUTPUT'].every(key => path.isAbsolute(values[key])));
  return values;
}
function settings(options) {
  return { env: options.env ?? process.env, io: options.io ?? fs, warn: options.warn ?? defaultWarn };
}
function warning(warn) { try { warn(); } catch { /* Optional reporting cannot alter a suite result. */ } }
function prefix(meta) { return `bivaro-public-fragments-${meta.GITHUB_RUN_ID}-${meta.GITHUB_RUN_ATTEMPT}-`; }
function safeDirectory(io, root, directory, meta) {
  requireValid(typeof root === 'string' && path.isAbsolute(root) && !/[\r\n\0]/u.test(root));
  requireValid(typeof directory === 'string' && !/[\r\n\0]/u.test(directory) && path.dirname(directory) === root &&
    new RegExp('^' + prefix(meta) + '[A-Za-z0-9]{6}$', 'u').test(path.basename(directory)) && io.realpathSync(directory) === directory);
}
function freshDirectory(io, meta) {
  const root = io.realpathSync(meta.RUNNER_TEMP);
  const directory = io.mkdtempSync(path.join(root, prefix(meta)));
  safeDirectory(io, root, directory, meta);
  // mkdtemp creates a fresh 0700 directory; keep its private mode explicit.
  io.chmodSync(directory, 0o700);
  return directory;
}
function atomicWrite(io, directory, data, temporary) {
  requireValid(io.realpathSync(directory) === directory);
  const serialized = JSON.stringify(data) + '\n';
  requireValid(Buffer.byteLength(serialized) <= MAX_PUBLIC_FRAGMENT_BYTES);
  const target = path.join(directory, temporary);
  io.writeFileSync(target, serialized, { flag: 'wx', mode: 0o600 });
  io.renameSync(target, path.join(directory, FILE));
}
function outputs(io, meta, directory) {
  io.appendFileSync(meta.GITHUB_OUTPUT, `public_fragment_directory=${directory}\npublic_fragment_ready=true\n`, 'utf8');
}
function initialState(meta, plannedCases = null) {
  return {
    schema: SCHEMA, runId: meta.GITHUB_RUN_ID, attempt: meta.GITHUB_RUN_ATTEMPT, head: meta.BIVARO_BROWSER_RECEIPT_HEAD,
    acceptanceEvidence: false, onEndObserved: false, endStatus: null, completed: false, incomplete: true,
    plannedCases, counts: { passed: 0, failed: 0, timedOut: 0, skipped: 0, interrupted: 0 },
    reporterUnavailable: false, unavailable: false, overflow: false, noMatchingFailureObserved: true,
    missingAttachments: 0, rejectedAttachments: 0, omittedEntries: 0, entries: [],
  };
}
function isIncomplete(value) {
  return !value.onEndObserved || value.plannedCases === null ||
    Object.values(value.counts).reduce((sum, item) => sum + item, 0) !== value.plannedCases ||
    !['passed', 'failed'].includes(value.endStatus) || value.counts.timedOut > 0 || value.counts.interrupted > 0 ||
    value.reporterUnavailable || value.unavailable || value.overflow;
}
function syncCompleteness(state) {
  state.noMatchingFailureObserved = state.counts.failed + state.counts.timedOut + state.counts.interrupted === 0;
  state.incomplete = isIncomplete(state); state.completed = !state.incomplete;
}
function increment(state, key) { if (state[key] < COUNT_MAX) state[key]++; else state.overflow = true; }
function publicLocation(value, raw) {
  if (!raw) { requireValid(LOCATIONS.has(value)); return value; }
  requireValid(typeof value === 'string' && value.length <= 2048 && !/[\u0000-\u0020\u007f]/u.test(value));
  const url = new URL(value);
  requireValid(url.origin === 'http://127.0.0.1:3100' && !url.username && !url.password && !url.search && LOCATIONS.has(url.pathname + url.hash));
  return url.pathname + url.hash;
}
function ancestors(value, raw) {
  requireValid(Array.isArray(value) && value.length <= 8);
  return value.map(item => {
    requireValid(shape(item, ['tag', 'hidden', 'ariaHidden', 'inert', 'display', 'visibility', 'streamContainer', ...(raw ? ['id'] : [])]) &&
      TAGS.has(item.tag) && boolean(item.hidden) && [null, 'true', 'false'].includes(item.ariaHidden) && boolean(item.inert) &&
      DISPLAYS.has(item.display) && VISIBILITIES.has(item.visibility) && boolean(item.streamContainer) &&
      (!raw || typeof item.id === 'string' && item.id.length <= 100));
    return { tag: item.tag, hidden: item.hidden, ariaHidden: item.ariaHidden, inert: item.inert, display: item.display, visibility: item.visibility, streamContainer: item.streamContainer };
  });
}
function samples(value, expectedId, raw) {
  requireValid(Array.isArray(value) && value.length <= 3);
  return value.map(item => {
    const marginKey = raw ? 'scrollMarginTop' : 'scrollMarginTopPx';
    requireValid(shape(item, ['tag', 'id', 'rect', 'display', 'visibility', 'position', marginKey, 'ancestors'], raw ? ['text'] : []) &&
      TAGS.has(item.tag) && item.id === expectedId && DISPLAYS.has(item.display) && VISIBILITIES.has(item.visibility) && POSITIONS.has(item.position) &&
      (!raw || !Object.hasOwn(item, 'text') || nullable(item.text, value => typeof value === 'string' && value.length <= 100)) &&
      shape(item.rect, ['x', 'y', 'width', 'height', 'top', 'bottom']) &&
      ['x', 'y', 'top', 'bottom'].every(key => number(item.rect[key], -1e7, 1e7)) && ['width', 'height'].every(key => number(item.rect[key], 0, 1e7)));
    if (raw) requireValid(typeof item.scrollMarginTop === 'string' && /^-?\d{1,8}(?:\.\d{1,6})?px$/u.test(item.scrollMarginTop));
    const margin = raw ? Number(item.scrollMarginTop.slice(0, -2)) : item.scrollMarginTopPx;
    requireValid(number(margin, -1e7, 1e7));
    return { tag: item.tag, id: expectedId,
      rect: { x: item.rect.x, y: item.rect.y, width: item.rect.width, height: item.rect.height, top: item.rect.top, bottom: item.rect.bottom },
      display: item.display, visibility: item.visibility, position: item.position, scrollMarginTopPx: margin, ancestors: ancestors(item.ancestors, raw) };
  });
}
function target(value, expectedId, raw) {
  requireValid(shape(value, ['id', 'count', 'samples']) && value.id === expectedId && count(value.count));
  const safeSamples = samples(value.samples, expectedId, raw);
  requireValid(safeSamples.length === Math.min(value.count, 3));
  return { id: expectedId, count: value.count, samples: safeSamples };
}
function snapshot(value, label, raw) {
  const locationKey = raw ? 'url' : 'location';
  requireValid(shape(value, ['phase', locationKey, 'readyState', 'visibilityState', 'timeOrigin', 'navigation', 'fonts', 'viewport', 'scroll', 'target', 'fragment']) &&
    value.phase === 'after-original-failure' && ['loading', 'interactive', 'complete'].includes(value.readyState) &&
    ['visible', 'hidden'].includes(value.visibilityState) && number(value.timeOrigin, 0, 1e15) && ['loading', 'loaded'].includes(value.fonts) &&
    shape(value.viewport, ['width', 'height']) && ['width', 'height'].every(key => number(value.viewport[key], 0, 100_000)) &&
    shape(value.scroll, ['x', 'y', 'restoration', ...(raw ? [] : ['element', 'top', 'height'])], raw ? ['element', 'top', 'height'] : []) &&
    number(value.scroll.x) && number(value.scroll.y) && ['auto', 'manual'].includes(value.scroll.restoration));
  const scroll = { x: value.scroll.x, y: value.scroll.y, restoration: value.scroll.restoration,
    element: value.scroll.element ?? null, top: value.scroll.top ?? null, height: value.scroll.height ?? null };
  requireValid([null, 'HTML', 'BODY'].includes(scroll.element) && nullable(scroll.top, number) && nullable(scroll.height, item => number(item, 0)));
  let navigation = null;
  if (value.navigation !== null) {
    const item = value.navigation;
    requireValid(shape(item, [locationKey, 'type', 'domContentLoadedEventEnd', 'loadEventEnd', 'duration']) &&
      ['navigate', 'reload', 'back_forward', 'prerender'].includes(item.type) && ['domContentLoadedEventEnd', 'loadEventEnd', 'duration'].every(key => number(item[key], 0)));
    navigation = { location: publicLocation(item[locationKey], raw), type: item.type, domContentLoadedEventEnd: item.domContentLoadedEventEnd, loadEventEnd: item.loadEventEnd, duration: item.duration };
  }
  requireValid(FRAGMENTS.has(value.fragment?.id));
  return { phase: 'after-original-failure', location: publicLocation(value[locationKey], raw), readyState: value.readyState,
    visibilityState: value.visibilityState, timeOrigin: value.timeOrigin, navigation, fonts: value.fonts,
    viewport: { width: value.viewport.width, height: value.viewport.height }, scroll,
    target: target(value.target, LABELS[label], raw), fragment: target(value.fragment, value.fragment.id, raw) };
}
function observation(value, label, raw) {
  requireValid(shape(value, ['navigationEvents', 'navigationOverflow', 'sessionResponses', 'sessionOverflow', 'passiveObservationUnavailable', ...(raw ? ['label', 'outcome'] : ['snapshot'])], raw ? ['snapshot'] : []) &&
    (!raw || value.label === label && value.outcome === 'failed') &&
    Array.isArray(value.navigationEvents) && value.navigationEvents.length <= 12 && boolean(value.navigationOverflow) &&
    Array.isArray(value.sessionResponses) && value.sessionResponses.length <= 8 && boolean(value.sessionOverflow) && boolean(value.passiveObservationUnavailable));
  const navigationEvents = value.navigationEvents.map(item => {
    const key = raw ? 'url' : 'location';
    requireValid(shape(item, ['event', key]) && EVENTS.has(item.event));
    return { event: item.event, location: publicLocation(item[key], raw) };
  });
  const sessionResponses = value.sessionResponses.map(item => {
    requireValid(shape(item, ['status', 'path']) && Number.isInteger(item.status) && item.status >= 100 && item.status <= 599 && item.path === '/api/auth/session');
    return { status: item.status, path: '/api/auth/session' };
  });
  return { navigationEvents, navigationOverflow: value.navigationOverflow, sessionResponses, sessionOverflow: value.sessionOverflow,
    passiveObservationUnavailable: value.passiveObservationUnavailable,
    snapshot: raw && (value.snapshot === null || !Object.hasOwn(value, 'snapshot')) ? null : snapshot(value.snapshot, label, raw) };
}
function parseBody(body) {
  requireValid(Buffer.isBuffer(body) && body.length > 0 && body.length <= MAX_PUBLIC_FRAGMENT_INPUT_BYTES);
  const decoded = body.toString('utf8');
  requireValid(Buffer.from(decoded, 'utf8').equals(body));
  return JSON.parse(decoded);
}
function matchingTest(test, workspace) {
  const file = test.location?.file;
  return typeof file === 'string' && file.length <= 4096 && path.relative(workspace, file).split(path.sep).join('/') === 'e2e/public-help-fragments.spec.ts' &&
    test.parent?.project()?.name === 'chromium';
}

/** Passive reporter delegate. Every hook intentionally returns undefined. */
export function createPublicFragmentCollector(options = {}) {
  let env, io, warn;
  try { ({ env, io, warn } = settings(options)); } catch { return noopHooks(); }
  let meta, directory, workspace, state, serial = 0, warned = false, began = false, closed = false;
  const fail = () => {
    if (state) { state.reporterUnavailable = true; state.unavailable = true; syncCompleteness(state); }
    if (!warned) { warned = true; warning(warn); }
  };
  const publish = () => {
    if (!state || !directory) return false;
    try { syncCompleteness(state); atomicWrite(io, directory, state, `.public-fragments-next-${serial++}`); return true; }
    catch { fail(); return false; }
  };
  return {
    onBegin(_config, suite) {
      if (began || closed) return;
      began = true;
      try {
        meta = namedMetadata(env);
        workspace = io.realpathSync(meta.GITHUB_WORKSPACE);
        directory = freshDirectory(io, meta);
        state = initialState(meta);
        try {
          const tests = suite.allTests();
          requireValid(Array.isArray(tests) && tests.length <= 10_000);
          state.plannedCases = tests.filter(test => matchingTest(test, workspace)).length;
        } catch { fail(); }
        if (publish()) outputs(io, meta, directory);
      } catch { fail(); }
    },
    onTestEnd(test, result) {
      if (!state || closed) return;
      try {
        if (!matchingTest(test, workspace)) return;
        const status = result.status;
        requireValid(STATUSES.includes(status));
        if (state.counts[status] < COUNT_MAX) state.counts[status]++; else state.overflow = true;
        if (FAILURES.has(status)) {
          const title = test.title;
          const expectedLabel = typeof title === 'string' && title.length <= 200 ? TEST_LABELS.get(title) : undefined;
          requireValid(expectedLabel);
          const attachments = result.attachments;
          requireValid(Array.isArray(attachments));
          let found = false;
          if (attachments.length > MAX_PUBLIC_FRAGMENT_ATTACHMENTS) { state.overflow = true; state.unavailable = true; }
          // Playwright attachments are already in memory. Never read attachment paths.
          for (const attachment of attachments.slice(0, MAX_PUBLIC_FRAGMENT_ATTACHMENTS)) {
            const name = attachment.name;
            const label = typeof name === 'string' && name.length <= 100 ? ATTACHMENTS.get(name) : undefined;
            if (!label) continue;
            found = true;
            if (state.entries.length >= MAX_PUBLIC_FRAGMENT_ENTRIES || state.entries.some(entry => entry.label === expectedLabel)) {
              state.overflow = true; increment(state, 'omittedEntries'); continue;
            }
            let safe = null, unavailableReason = null;
            try {
              requireValid(label === expectedLabel && attachment.contentType === 'application/json');
              const body = attachment.body;
              if (Buffer.isBuffer(body) && body.length > MAX_PUBLIC_FRAGMENT_INPUT_BYTES) {
                unavailableReason = 'attachment-overflow'; state.overflow = true;
              } else {
                const value = parseBody(body);
                safe = observation(value, expectedLabel, true);
                // A missing snapshot is explicit, never an empty successful observation.
                if (safe.snapshot === null) { unavailableReason = 'missing-snapshot'; safe = null; }
              }
            } catch { unavailableReason = 'invalid-attachment'; }
            if (unavailableReason) { increment(state, 'rejectedAttachments'); state.unavailable = true; }
            if (safe && (safe.navigationOverflow || safe.sessionOverflow)) state.overflow = true;
            if (safe?.passiveObservationUnavailable) state.unavailable = true;
            state.entries.push({ label: expectedLabel, status, unavailableReason, observation: safe });
          }
          if (!found) { increment(state, 'missingAttachments'); state.unavailable = true; }
        }
        publish();
      } catch { fail(); publish(); }
    },
    onEnd(result) {
      if (!state || closed) return;
      closed = true;
      try {
        state.onEndObserved = true;
        state.endStatus = 'unknown';
        const status = result.status;
        state.endStatus = END_STATUSES.includes(status) ? status : 'unknown';
        publish();
      } catch { fail(); publish(); }
    },
  };
}

const STATE_KEYS = ['schema', 'runId', 'attempt', 'head', 'acceptanceEvidence', 'onEndObserved', 'endStatus', 'completed', 'incomplete', 'plannedCases', 'counts', 'reporterUnavailable', 'unavailable', 'overflow', 'noMatchingFailureObserved', 'missingAttachments', 'rejectedAttachments', 'omittedEntries', 'entries'];
function validateState(value, meta) {
  requireValid(shape(value, STATE_KEYS) && value.schema === SCHEMA && value.runId === meta.GITHUB_RUN_ID && value.attempt === meta.GITHUB_RUN_ATTEMPT && value.head === meta.BIVARO_BROWSER_RECEIPT_HEAD &&
    value.acceptanceEvidence === false && boolean(value.onEndObserved) && (value.onEndObserved ? END_STATUSES.includes(value.endStatus) : value.endStatus === null) &&
    boolean(value.completed) && boolean(value.incomplete) && value.completed !== value.incomplete &&
    nullable(value.plannedCases, item => count(item) && item <= 10_000) && shape(value.counts, STATUSES) && Object.values(value.counts).every(count) &&
    ['reporterUnavailable', 'unavailable', 'overflow', 'noMatchingFailureObserved'].every(key => boolean(value[key])) &&
    ['missingAttachments', 'rejectedAttachments', 'omittedEntries'].every(key => count(value[key])) && Array.isArray(value.entries) && value.entries.length <= MAX_PUBLIC_FRAGMENT_ENTRIES);
  const labels = new Set();
  const entries = value.entries.map(entry => {
    requireValid(shape(entry, ['label', 'status', 'unavailableReason', 'observation']) && Object.hasOwn(LABELS, entry.label) && !labels.has(entry.label) && FAILURES.has(entry.status));
    labels.add(entry.label);
    requireValid(entry.unavailableReason === null ? entry.observation !== null : REASONS.has(entry.unavailableReason) && entry.observation === null);
    return { label: entry.label, status: entry.status, unavailableReason: entry.unavailableReason,
      observation: entry.observation === null ? null : observation(entry.observation, entry.label, false) };
  });
  const rejected = entries.filter(entry => entry.unavailableReason !== null).length;
  const failures = value.counts.failed + value.counts.timedOut + value.counts.interrupted;
  requireValid(value.rejectedAttachments === rejected && value.noMatchingFailureObserved === (value.counts.failed + value.counts.timedOut + value.counts.interrupted === 0) &&
    (!(value.missingAttachments || value.rejectedAttachments || value.reporterUnavailable || entries.some(entry => entry.observation?.passiveObservationUnavailable)) || value.unavailable) &&
    (!(value.omittedEntries || entries.some(entry => entry.unavailableReason === 'attachment-overflow' || entry.observation?.navigationOverflow || entry.observation?.sessionOverflow)) || value.overflow) &&
    value.entries.length <= failures && [...FAILURES].every(status => entries.filter(entry => entry.status === status).length <= value.counts[status]) &&
    (value.overflow || value.reporterUnavailable || failures === entries.length + value.missingAttachments) && value.incomplete === isIncomplete(value));
  // Rebuild instead of carrying references to parsed data into the final artifact.
  return { schema: SCHEMA, runId: meta.GITHUB_RUN_ID, attempt: meta.GITHUB_RUN_ATTEMPT, head: meta.BIVARO_BROWSER_RECEIPT_HEAD,
    acceptanceEvidence: false, onEndObserved: value.onEndObserved, endStatus: value.endStatus, completed: value.completed, incomplete: value.incomplete,
    plannedCases: value.plannedCases, counts: Object.fromEntries(STATUSES.map(status => [status, value.counts[status]])),
    reporterUnavailable: value.reporterUnavailable, unavailable: value.unavailable, overflow: value.overflow, noMatchingFailureObserved: value.noMatchingFailureObserved,
    missingAttachments: value.missingAttachments, rejectedAttachments: value.rejectedAttachments, omittedEntries: value.omittedEntries, entries };
}

/** Finalize immediately after the suite, before expensive general artifact staging. */
export function finalizePublicFragmentDiagnostics(options = {}) {
  let io, warn = defaultWarn, fd;
  try {
    const optionsValue = settings(options);
    const env = optionsValue.env; io = optionsValue.io; warn = optionsValue.warn;
    const meta = namedMetadata(env);
    const outcome = env.BIVARO_BROWSER_SUITE_OUTCOME;
    requireValid(['success', 'failure', 'cancelled', 'skipped'].includes(outcome));
    let directory, value;
    try {
      directory = env.BIVARO_PUBLIC_FRAGMENT_DIRECTORY;
      safeDirectory(io, io.realpathSync(meta.RUNNER_TEMP), directory, meta);
      fd = io.openSync(path.join(directory, FILE), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      const info = io.fstatSync(fd);
      requireValid(info.isFile() && Number.isInteger(info.size) && info.size > 0 && info.size <= MAX_PUBLIC_FRAGMENT_BYTES);
      const buffer = Buffer.alloc(MAX_PUBLIC_FRAGMENT_BYTES + 1);
      const length = io.readSync(fd, buffer, 0, buffer.length, 0);
      io.closeSync(fd); fd = undefined;
      requireValid(length === info.size && length <= MAX_PUBLIC_FRAGMENT_BYTES);
      const bytes = buffer.subarray(0, length), decoded = bytes.toString('utf8');
      requireValid(Buffer.from(decoded, 'utf8').equals(bytes));
      value = validateState(JSON.parse(decoded), meta);
    } catch {
      if (fd !== undefined) { try { io.closeSync(fd); } catch { /* Optional cleanup only. */ } fd = undefined; }
      // Never overwrite, copy, or echo rejected input. A fallback has a fresh identity.
      directory = freshDirectory(io, meta);
      value = initialState(meta);
      value.reporterUnavailable = true; value.unavailable = true;
      warning(warn);
    }
    value.functionalStepOutcome = outcome;
    if (['cancelled', 'skipped'].includes(outcome)) { value.incomplete = true; value.completed = false; }
    atomicWrite(io, directory, value, '.public-fragments-final');
    outputs(io, meta, directory);
    return true;
  } catch {
    if (fd !== undefined) { try { io.closeSync(fd); } catch { /* Optional cleanup only. */ } }
    warning(warn);
    return false;
  }
}
