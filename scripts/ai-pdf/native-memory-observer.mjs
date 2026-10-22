/** Test-only observation of the exact real renderer child. Never imported by
 * production ai-input/render. No syscall/filter probe or child permission grant.
 */
import { channel as diagnosticsChannel } from 'node:diagnostics_channel';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';

const MAX_PROC_BYTES = 16 * 1024;
const INTERVAL_MS = 20, MAX_SAMPLES = 1000, MAX_DURATION_MS = 20_000;
const memoryKeys = ['VmPeak', 'VmSize', 'VmHWM', 'VmRSS'];
const integer = value => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 0x7fffffff;
function statIdentity(text) {
  if (typeof text !== 'string' || text.length > MAX_PROC_BYTES) return null;
  const separator = text.lastIndexOf(') '), pid = Number(text.slice(0, text.indexOf(' ')));
  if (!integer(pid) || separator < 3) return null;
  const fields = text.slice(separator + 2).trim().split(/\s+/);
  if (fields.length < 20 || !/^[0-9]{1,20}$/.test(fields[19])) return null;
  return { pid, parentPid: Number(fields[1]), startTicks: fields[19] };
}
/** Pure parser: only numeric memory metrics plus private, non-emitted identity.
 * Read stat on both sides of status, and retain the first start time, to reject
 * identity changes. Open proc-file handles further pin the original proc inode.
 */
export function parseNativeMemorySample(sample, expected) {
  if (!sample || !expected || !integer(expected.pid) || !integer(expected.parentPid) || !integer(expected.uid)) return null;
  const before = statIdentity(sample.statBefore), after = statIdentity(sample.statAfter);
  if (!before || !after || before.pid !== expected.pid || before.parentPid !== expected.parentPid || after.pid !== before.pid || after.parentPid !== before.parentPid || after.startTicks !== before.startTicks || (expected.startTicks !== undefined && before.startTicks !== expected.startTicks)) return null;
  if (typeof sample.status !== 'string' || sample.status.length > MAX_PROC_BYTES) return null;
  const fields = new Map();
  for (const line of sample.status.split('\n')) {
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator);
    if (!['Pid', 'Tgid', 'PPid', 'Uid', ...memoryKeys].includes(key)) continue;
    if (fields.has(key)) return null;
    fields.set(key, line.slice(separator + 1).trim());
  }
  for (const key of ['Pid', 'Tgid', 'PPid']) if (!/^[0-9]{1,10}$/.test(fields.get(key) ?? '')) return null;
  if (Number(fields.get('Pid')) !== expected.pid || Number(fields.get('Tgid')) !== expected.pid || Number(fields.get('PPid')) !== expected.parentPid) return null;
  const uid = (fields.get('Uid') ?? '').split(/\s+/);
  if (uid.length !== 4 || uid.some(value => !/^[0-9]{1,10}$/.test(value) || Number(value) !== expected.uid)) return null;
  const values = {};
  for (const key of memoryKeys) {
    const match = /^([0-9]{1,12})\s+kB$/.exec(fields.get(key) ?? '');
    const value = match ? Number(match[1]) : NaN;
    if (!Number.isSafeInteger(value) || value < 0 || value > 1024 * 1024 * 1024) return null;
    values[key] = value;
  }
  if (values.VmPeak < values.VmSize || values.VmHWM < values.VmRSS) return null;
  return { startTicks: before.startTicks, values };
}
async function openProcSample(pid) {
  let stat, status;
  const boundedRead = async handle => {
    const buffer = Buffer.alloc(MAX_PROC_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_PROC_BYTES) throw new Error('Proc sample unavailable');
    return buffer.toString('ascii', 0, bytesRead);
  };
  try {
    stat = await open(`/proc/${pid}/stat`, constants.O_RDONLY | constants.O_NOFOLLOW);
    status = await open(`/proc/${pid}/status`, constants.O_RDONLY | constants.O_NOFOLLOW);
    return {
      read: async () => ({ statBefore: await boundedRead(stat), status: await boundedRead(status), statAfter: await boundedRead(stat) }),
      close: async () => { await Promise.allSettled([stat.close(), status.close()]); },
    };
  } catch {
    await Promise.allSettled([stat?.close(), status?.close()]);
    throw new Error('Proc sample unavailable');
  }
}

/** Dependency injection is for pure tests only. Real smoke uses Node's supported
 * diagnostics channel, not a spawn mock/wrapper. No commandline/env/path is
 * recorded. Numeric PID/UID/starttime stay private and are never emitted.
 */
export function createNativeMemoryObserver(options = {}) {
  const source = options.source ?? diagnosticsChannel('child_process');
  const openSample = options.openSample ?? openProcSample;
  const parentPid = options.parentPid ?? process.pid, uid = options.uid ?? process.getuid?.();
  const now = options.now ?? Date.now;
  const summary = { kind: 'sampled-renderer-memory-lower-bounds', status: 'unavailable', samples: 0, maxVmPeakKiB: 0, maxVmSizeKiB: 0, maxVmHwmKiB: 0, maxVmRssKiB: 0 };
  const pendingChildren = new Map();
  let stopped = false, subscribed = false, claimed = false, reader, expected, pending = Promise.resolve(), timer, deadline, shutdown;
  const createdAt = now();
  const detach = () => {
    if (subscribed) { try { source.unsubscribe(subscriber); } catch { summary.status = 'unavailable'; } subscribed = false; }
    for (const [child, handlers] of pendingChildren) for (const [event, listener] of handlers) child.removeListener(event, listener);
    pendingChildren.clear();
  };
  const stop = () => {
    if (stopped) return;
    stopped = true; clearTimeout(timer); clearTimeout(deadline); detach();
    shutdown = Promise.resolve().then(() => pending).then(async () => {
      try { await reader?.close(); } catch { summary.status = 'unavailable'; }
    });
  };
  const sample = async () => {
    if (stopped) return;
    if (summary.samples >= MAX_SAMPLES || now() - expected.startedAt >= MAX_DURATION_MS) { summary.status = 'limited'; stop(); return; }
    try {
      reader ??= await openSample(expected.pid);
      if (stopped) return;
      const raw = await reader.read();
      if (stopped) return;
      const parsed = parseNativeMemorySample(raw, expected);
      if (!parsed) { summary.status = 'ownership-rejected'; stop(); return; }
      expected.startTicks ??= parsed.startTicks;
      summary.samples++;
      summary.status = 'measured';
      summary.maxVmPeakKiB = Math.max(summary.maxVmPeakKiB, parsed.values.VmPeak);
      summary.maxVmSizeKiB = Math.max(summary.maxVmSizeKiB, parsed.values.VmSize);
      summary.maxVmHwmKiB = Math.max(summary.maxVmHwmKiB, parsed.values.VmHWM);
      summary.maxVmRssKiB = Math.max(summary.maxVmRssKiB, parsed.values.VmRSS);
    } catch { summary.status = 'unavailable'; stop(); }
    if (!stopped) { timer = setTimeout(() => { pending = sample(); }, INTERVAL_MS); timer.unref?.(); }
  };
  const subscriber = message => {
    if (stopped || !message?.process || pendingChildren.size >= 4) return;
    const child = message.process;
    if (typeof child.once !== 'function' || typeof child.removeListener !== 'function') return;
    if (pendingChildren.has(child)) return;
    const onSpawn = () => {
      if (stopped || claimed || child.spawnfile !== '/usr/bin/prlimit' || !integer(child.pid) || !integer(parentPid) || !integer(uid)) {
        for (const [event, listener] of pendingChildren.get(child) ?? []) child.removeListener(event, listener);
        pendingChildren.delete(child); return;
      }
      claimed = true;
      // This is the only prlimit child launched by one synthetic preparation.
      // Unsubscribe now; retain only this actual child's exit/error/close hooks.
      if (subscribed) { try { source.unsubscribe(subscriber); } catch { summary.status = 'unavailable'; } subscribed = false; }
      for (const [other, handlers] of pendingChildren) if (other !== child) { for (const [event, listener] of handlers) other.removeListener(event, listener); pendingChildren.delete(other); }
      expected = { pid: child.pid, parentPid, uid, startedAt: createdAt };
      pending = sample();
    };
    const onEnd = () => { if (claimed && expected?.pid === child.pid) stop(); else { for (const [event, listener] of pendingChildren.get(child) ?? []) child.removeListener(event, listener); pendingChildren.delete(child); } };
    const handlers = [['spawn', onSpawn], ['exit', onEnd], ['error', onEnd], ['close', onEnd]];
    pendingChildren.set(child, handlers);
    for (const [event, listener] of handlers) child.once(event, listener);
  };
  try { source.subscribe(subscriber); subscribed = true; } catch { stop(); }
  if (!stopped) { deadline = setTimeout(() => { summary.status = 'limited'; stop(); }, MAX_DURATION_MS); deadline.unref?.(); }
  let closed;
  return {
    close() {
      closed ??= (async () => { stop(); await shutdown; return Object.freeze({ ...summary }); })();
      return closed;
    },
  };
}
