import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNativeMemoryObserver, parseNativeMemorySample } from '../ai-pdf/native-memory-observer.mjs';

// Pure synthetic proc text + EventEmitters only. No native child, proc read,
// kernel probe, filter install or renderer is executed by these unit tests.
const stat = (pid = 42, parent = 11, start = '123') => `${pid} (private-name with ) parens) S ${[parent, ...Array(17).fill(0), start, 0, 0].join(' ')}\n`;
const raw = (pid = 42, parent = 11, uid = 1001, start = '123') => ({
  statBefore: stat(pid, parent, start), statAfter: stat(pid, parent, start),
  status: `Name:\tPRIVATE-TEXT\nTgid:\t${pid}\nPid:\t${pid}\nPPid:\t${parent}\nUid:\t${uid}\t${uid}\t${uid}\t${uid}\nVmPeak:\t1000000 kB\nVmSize:\t999999 kB\nVmHWM:\t75000 kB\nVmRSS:\t70000 kB\n`,
});
function harness() {
  const subscribers = new Set<(message: unknown) => void>();
  const source = { subscribe: vi.fn((callback: (message: unknown) => void) => { subscribers.add(callback); }), unsubscribe: vi.fn((callback: (message: unknown) => void) => { subscribers.delete(callback); }) };
  const reader = { read: vi.fn(async () => raw()), close: vi.fn(async () => undefined) };
  const openSample = vi.fn(async (_pid: number) => reader);
  const observer = createNativeMemoryObserver({ source, openSample, parentPid: 11, uid: 1001 });
  const child = Object.assign(new EventEmitter(), { pid: 42, spawnfile: '/usr/bin/prlimit' });
  const publish = () => { for (const callback of subscribers) callback({ process: child }); };
  return { subscribers, source, reader, openSample, observer, child, publish };
}
const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
afterEach(() => { vi.useRealTimers(); });

describe('pure native-memory observation data and lifecycle', () => {
  it('accepts only expected pid/parent/uid/starttime and emits numeric memory fields', () => {
    const parsed = parseNativeMemorySample(raw(), { pid: 42, parentPid: 11, uid: 1001 });
    expect(parsed).toEqual({ startTicks: '123', values: { VmPeak: 1000000, VmSize: 999999, VmHWM: 75000, VmRSS: 70000 } });
    expect(JSON.stringify(parsed)).not.toMatch(/PRIVATE|private-name|parens/);
  });
  it.each([
    { pid: 43, parentPid: 11, uid: 1001 }, { pid: 42, parentPid: 12, uid: 1001 },
    { pid: 42, parentPid: 11, uid: 1002 }, { pid: 42, parentPid: 11, uid: 1001, startTicks: '124' },
  ])('rejects ownership or saved-starttime mismatch: %j', expected => {
    expect(parseNativeMemorySample(raw(), expected)).toBeNull();
  });
  it('rejects identity change across status reads and malformed/duplicate/oversize fields', () => {
    const expected = { pid: 42, parentPid: 11, uid: 1001 };
    expect(parseNativeMemorySample({ ...raw(), statAfter: stat(42, 11, '124') }, expected)).toBeNull();
    for (const status of [raw().status + 'VmRSS: 1 kB\n', raw().status.replace('70000 kB', '999999999999 kB'), raw().status.replace('1000000 kB', '2 kB'), raw().status.replace('75000 kB', '2 kB'), raw().status.replace('70000 kB', 'private'), 'x'.repeat(16385)]) expect(parseNativeMemorySample({ ...raw(), status }, expected)).toBeNull();
  });
  it('cleans subscription/deadline even if no spawn occurs; close is idempotent', async () => {
    vi.useFakeTimers(); const h = harness();
    const first = h.observer.close(); expect(h.observer.close()).toBe(first);
    expect(await first).toMatchObject({ status: 'unavailable', samples: 0 });
    expect(h.subscribers.size).toBe(0); expect(vi.getTimerCount()).toBe(0); expect(h.openSample).not.toHaveBeenCalled();
  });
  it('observes only the real expected child and stops/closes on exit without emitting identity', async () => {
    vi.useFakeTimers(); const h = harness(); h.publish(); h.child.emit('spawn'); await flush();
    expect(h.openSample).toHaveBeenCalledExactlyOnceWith(42);
    expect(h.subscribers.size).toBe(0);
    h.child.emit('exit', 1); await flush();
    const report = await h.observer.close();
    expect(report).toEqual({ kind: 'sampled-renderer-memory-lower-bounds', status: 'measured', samples: 1, maxVmPeakKiB: 1000000, maxVmSizeKiB: 999999, maxVmHwmKiB: 75000, maxVmRssKiB: 70000 });
    expect(JSON.stringify(report)).not.toMatch(/pid|uid|123|private|path|command|environment/i);
    expect(h.reader.close).toHaveBeenCalledOnce(); expect(h.child.eventNames()).toHaveLength(0); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['exit', 'close', 'error'])('cleans on child %s while a proc open is still pending', async event => {
    vi.useFakeTimers(); const h = harness();
    let release!: (value: typeof h.reader) => void;
    h.openSample.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    h.publish(); h.child.emit('spawn'); h.child.emit(event); const closed = h.observer.close();
    release(h.reader); const report = await closed;
    expect(report.samples).toBe(0); expect(h.reader.read).not.toHaveBeenCalled(); expect(h.reader.close).toHaveBeenCalledOnce();
    expect(h.subscribers.size).toBe(0); expect(h.child.eventNames()).toHaveLength(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('ignores unrelated executable and invalid pid without proc access', async () => {
    vi.useFakeTimers(); const h = harness(); h.child.spawnfile = '/usr/bin/java'; h.publish(); h.child.emit('spawn');
    await h.observer.close(); expect(h.openSample).not.toHaveBeenCalled(); expect(h.child.eventNames()).toHaveLength(0);
    const invalid = harness(); invalid.child.pid = -1; invalid.publish(); invalid.child.emit('spawn'); await invalid.observer.close(); expect(invalid.openSample).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects a different owner rather than accepting its memory', async () => {
    vi.useFakeTimers(); const h = harness(); h.reader.read.mockResolvedValue(raw(43)); h.publish(); h.child.emit('spawn'); await flush();
    expect(await h.observer.close()).toMatchObject({ status: 'ownership-rejected', samples: 0, maxVmPeakKiB: 0 });
    expect(h.reader.close).toHaveBeenCalledOnce(); expect(h.subscribers.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('turns proc failures into a fixed unavailable report and closes every handle', async () => {
    vi.useFakeTimers(); const h = harness(); h.reader.read.mockRejectedValue(new Error('PRIVATE /private/path')); h.publish(); h.child.emit('spawn'); await flush();
    const report = await h.observer.close(); expect(report).toMatchObject({ status: 'unavailable', samples: 0 }); expect(JSON.stringify(report)).not.toMatch(/PRIVATE|private/);
    expect(h.reader.close).toHaveBeenCalledOnce(); expect(h.subscribers.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('labels a later failed sample partial without erasing valid lower-bound metrics', async () => {
    vi.useFakeTimers(); const h = harness(); h.publish(); h.child.emit('spawn'); await flush();
    h.reader.read.mockRejectedValue(new Error('PRIVATE later process read failure'));
    await vi.advanceTimersByTimeAsync(20); const report = await h.observer.close();
    expect(report).toMatchObject({ status: 'partial', samples: 1, maxVmPeakKiB: 1000000, maxVmRssKiB: 70000 });
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE|failure/); expect(h.reader.close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it('preserves existing production child listeners and hides observer close failures', async () => {
    vi.useFakeTimers(); const h = harness(); const productionExit = vi.fn();
    h.child.on('exit', productionExit); h.reader.close.mockRejectedValue(new Error('PRIVATE close failure'));
    h.publish(); h.child.emit('spawn'); await flush(); h.child.emit('exit', 1); await flush();
    const report = await h.observer.close();
    expect(productionExit).toHaveBeenCalledExactlyOnceWith(1);
    expect(h.child.listenerCount('exit')).toBe(1);
    expect(report.status).toBe('unavailable'); expect(JSON.stringify(report)).not.toMatch(/PRIVATE|close failure/);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cleans a failed initial open without leaking arbitrary errors or subscriptions', async () => {
    vi.useFakeTimers(); const h = harness(); h.openSample.mockRejectedValue(new Error('PRIVATE open failure'));
    h.publish(); h.child.emit('spawn'); await flush(); const report = await h.observer.close();
    expect(report).toMatchObject({ status: 'unavailable', samples: 0 }); expect(JSON.stringify(report)).not.toMatch(/PRIVATE|open failure/);
    expect(h.reader.close).not.toHaveBeenCalled(); expect(h.child.eventNames()).toHaveLength(0); expect(h.subscribers.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds sampling/count/duration and closes automatically even before caller finally', async () => {
    vi.useFakeTimers(); const h = harness(); h.publish(); h.child.emit('spawn'); await flush();
    await vi.advanceTimersByTimeAsync(20000); await flush();
    const count = h.reader.read.mock.calls.length;
    expect(count).toBeLessThanOrEqual(1000); expect(count).toBeGreaterThan(0);
    expect(h.reader.close).toHaveBeenCalledOnce(); expect(h.subscribers.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(20000); expect(h.reader.read).toHaveBeenCalledTimes(count);
    expect(await h.observer.close()).toMatchObject({ status: 'limited', samples: count });
  });
});
