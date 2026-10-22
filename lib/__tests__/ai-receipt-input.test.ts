import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFile, access, rm, symlink } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import path from 'node:path';

const state = vi.hoisted(() => ({ exitCode: 0, stdout: '', stderr: '', exitSignal: null as string | null, pages: 2, fail: '', directory: '', args: [] as string[], options: {} as Record<string, unknown>, manifest: true, extra: false, symlink: false, hang: false, child: undefined as EventEmitter | undefined }));
vi.mock('node:module', () => ({ createRequire: () => ({ resolve: (name: string) => path.join('/runtime/node_modules', name) }) }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, realpath: async (file: string) => file };
});
vi.mock('node:child_process', () => ({ spawn: vi.fn((_file: string, args: string[], options: Record<string, unknown>) => {
  state.args = args; state.options = options; state.directory = String(options.cwd);
  const child = Object.assign(new EventEmitter(), { pid: 123456, stdout: new PassThrough(), stderr: new PassThrough() });
  state.child = child;
  queueMicrotask(() => {
    if (state.hang) return;
    void (async () => {
      if (state.exitCode) { child.stdout.write(state.stdout); child.stderr.write(state.stderr); child.emit('close', state.exitCode, state.exitSignal); return; }
      if (state.fail) {
        child.emit('error', Object.assign(new Error('private renderer error'), { code: state.fail }));
        child.emit('close', -2); return;
      }
      for (let page = 1; page <= Math.min(state.pages, 4); page++) await writeFile(path.join(state.directory, `page-${page}.jpg`), Buffer.from([255, 216, 255, page, 255, 217]), { flag: 'r+' });
      if (state.manifest) await writeFile(path.join(state.directory, 'complete.json'), JSON.stringify({ version: 1, pages: state.pages }), { flag: 'r+' });
      if (state.extra) await writeFile(path.join(state.directory, 'unexpected'), 'must reject');
      if (state.symlink) { await rm(path.join(state.directory, 'page-1.jpg')); await symlink(path.join(state.directory, '..', 'original.pdf'), path.join(state.directory, 'page-1.jpg')); }
      child.emit('close', 0);
    })().catch(error => { child.emit('error', error); child.emit('close', 1); });
  });
  return child;
}) }));
import { prepareAiReceiptImages, AI_MAX_INPUT_BYTES } from '@/lib/purchase-documents/ai-input';

beforeEach(() => {
  Object.assign(state, { exitCode: 0, stdout: '', stderr: '', exitSignal: null, pages: 2, fail: '', directory: '', manifest: true, extra: false, symlink: false, hang: false, child: undefined });
  vi.spyOn(process, 'kill').mockImplementation(() => true);
  vi.spyOn(process, 'getuid').mockReturnValue(1001);
  vi.spyOn(process, 'geteuid').mockReturnValue(1001);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('bounded original input preparation', () => {
  it('retains original photo bytes and never sends file/remote URLs', async () => {
    const result = await prepareAiReceiptImages('image/png', Buffer.from('synthetic'));
    expect(result[0].image_url.url).toBe('data:image/png;base64,c3ludGhldGlj');
    await expect(prepareAiReceiptImages('image/png', Buffer.alloc(AI_MAX_INPUT_BYTES + 1))).rejects.toMatchObject({ code: 'AI_UNSUPPORTED_FILE' });
    await expect(prepareAiReceiptImages('image/png', Buffer.alloc(0))).rejects.toMatchObject({ code: 'AI_UNSUPPORTED_FILE' });
    await expect(prepareAiReceiptImages('application/xml', Buffer.from('<Invoice/>'))).rejects.toMatchObject({ code: 'AI_UNSUPPORTED_FILE' });
  });
  it('requires kernel confinement, ordered complete pages, sanitized environment and whole-group cleanup', async () => {
    vi.stubEnv('BIVARO_AI_CHILD_SECRET', 'synthetic-never-inherited');
    vi.stubEnv('NODE_OPTIONS', '--inspect=0');
    const original = Buffer.from('%PDF-synthetic'), before = Buffer.from(original);
    const result = await prepareAiReceiptImages('application/pdf', original);
    expect(original.equals(before)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0].image_url.url).not.toBe(result[1].image_url.url);
    expect(state.args).toEqual(expect.arrayContaining(['--as=1073741824:1073741824', '--cpu=15:15', '--fsize=2097152:2097152', '--nofile=64:64', '--core=0:0', '/usr/bin/setpriv', '--no-new-privs', '--landlock-access', 'fs', '--seccomp-filter', '--permission', '--allow-addons', '--disallow-code-generation-from-strings']));
    expect(state.args).not.toEqual(expect.arrayContaining(['gs', '--allow-child-process', '--allow-worker', '--allow-fs-read=*']));
    expect(state.args).not.toContain(`path-beneath:read-file,read-dir,write-file,make-reg:${state.directory}`);
    expect(state.options).toMatchObject({ detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    expect(state.options.env).toEqual({ LANG: 'C', HOME: state.directory, TMPDIR: state.directory, NODE_ENV: 'production', UV_THREADPOOL_SIZE: '1', RAYON_NUM_THREADS: '1', DISABLE_SYSTEM_FONTS_LOAD: '1' });
    expect(process.kill).toHaveBeenCalledWith(-123456, 'SIGKILL');
    await expect(access(state.directory)).rejects.toThrow();
  });
  it.each([0, 5])('rejects invalid page counts (%s) instead of truncating', async pages => {
    state.pages = pages;
    await expect(prepareAiReceiptImages('application/pdf', Buffer.from('%PDF-synthetic'))).rejects.toMatchObject({ code: 'AI_RENDER_FAILED' });
    await expect(access(state.directory)).rejects.toThrow();
  });
  it('explicitly rejects the child page-limit exit without accepting any partial pages', async () => {
    state.exitCode = 65;
    await expect(prepareAiReceiptImages('application/pdf', Buffer.from('%PDF-synthetic'))).rejects.toMatchObject({ code: 'AI_PDF_LIMIT' });
    await expect(access(state.directory)).rejects.toThrow();
  });
  it('exposes only fixed diagnostic tokens, never raw child output or paths', async () => {
    Object.assign(state, { exitCode: 1, stdout: 'BIVARO_AI_RENDER_STAGE canvas-import\nBIVARO_AI_RENDER_STAGE PRIVATE-TEXT\nBIVARO_AI_RENDER_REASON module-load\n', stderr: 'private document text; /private/provider-key; arbitrary stack', exitSignal: 'PRIVATE-TEXT' });
    const error = await prepareAiReceiptImages('application/pdf', Buffer.from('%PDF-synthetic')).catch(error => error as Error);
    if (!(error instanceof Error)) throw new Error('Expected renderer rejection');
    expect(error).toMatchObject({ code: 'AI_RENDER_FAILED', cause: { stage: 'canvas-import', reason: 'module-load', exitCode: 1, signal: null, failure: null } });
    expect(JSON.stringify(error)).not.toMatch(/PRIVATE|private|provider-key|arbitrary/);
    expect(JSON.stringify(error.cause)).not.toMatch(/PRIVATE|private|provider-key|arbitrary/);
    await expect(access(state.directory)).rejects.toThrow();
  });
  it.each([
    ['OpenSSL configuration error: Permission denied: /private/openssl.cnf', 'openssl-config'],
    ['Error [ERR_ACCESS_DENIED]: /private/file', 'node-permission'],
    ['Warning: Detected unsettled top-level await at /private/file', 'unsettled-await'],
  ])('classifies startup errors without exposing their source: %s', async (stderr, reason) => {
    Object.assign(state, { exitCode: 13, stderr });
    const error = await prepareAiReceiptImages('application/pdf', Buffer.from('%PDF-synthetic')).catch(error => error as Error);
    if (!(error instanceof Error)) throw new Error('Expected renderer rejection');
    expect(error).toMatchObject({ code: 'AI_RENDER_FAILED', cause: { stage: 'launcher', reason, exitCode: 13, signal: null } });
    expect(JSON.stringify(error.cause)).not.toMatch(/private|file|cnf/);
  });
  it('identifies libuv pipe initialization only by a fixed diagnostic class', async () => {
    Object.assign(state, { exitCode: 13, stderr: 'Error: EPERM: operation not permitted, uv_pipe_open; private stack /private/document.pdf' });
    const error = await prepareAiReceiptImages('application/pdf', Buffer.from('%PDF-synthetic')).catch(error => error as Error);
    if (!(error instanceof Error)) throw new Error('Expected renderer rejection');
    expect(error).toMatchObject({ code: 'AI_RENDER_FAILED', cause: { stage: 'launcher', reason: 'stdio-setup', exitCode: 13, signal: null } });
    expect(JSON.stringify(error.cause)).not.toMatch(/private|document|stack/);
  });
  it('classifies a native memory startup error without retaining raw details', async () => {
    Object.assign(state, { exitCode: 134, stderr: 'FATAL ERROR: Allocation failed - /private/document.pdf; private contents', exitSignal: 'SIGABRT' });
    const error = await prepareAiReceiptImages('application/pdf', Buffer.from('%PDF-synthetic')).catch(error => error as Error);
    if (!(error instanceof Error)) throw new Error('Expected renderer rejection');
    expect(error).toMatchObject({ code: 'AI_RENDER_FAILED', cause: { stage: 'launcher', reason: 'memory', exitCode: 134, signal: 'SIGABRT' } });
    expect(JSON.stringify(error.cause)).not.toContain('private');
  });
  it('requires a successful final completion manifest', async () => {
    state.manifest = false;
    await expect(prepareAiReceiptImages('application/pdf', Buffer.from('%PDF-synthetic'))).rejects.toMatchObject({ code: 'AI_RENDER_FAILED' });
  });
  it.each(['extra', 'symlink'] as const)('rejects unexpected output: %s', async key => {
    state[key] = true;
    await expect(prepareAiReceiptImages('application/pdf', Buffer.from('%PDF-synthetic'))).rejects.toMatchObject({ code: 'AI_RENDER_FAILED' });
    await expect(access(state.directory)).rejects.toThrow();
  });
  it.each([['ENOENT', 'AI_RENDER_UNAVAILABLE'], ['ETIMEDOUT', 'AI_RENDER_FAILED']])('fails closed for child error %s before provider dispatch', async (fail, code) => {
    state.fail = fail;
    await expect(prepareAiReceiptImages('application/pdf', Buffer.from('%PDF-synthetic'))).rejects.toMatchObject({ code });
    await expect(access(state.directory)).rejects.toThrow();
  });
  it('kills and waits for a running child on overall cancellation', async () => {
    state.hang = true;
    const controller = new AbortController();
    const preparation = prepareAiReceiptImages('application/pdf', Buffer.from('%PDF-synthetic'), controller.signal);
    const result = expect(preparation).rejects.toMatchObject({ code: 'AI_REQUEST_INTERRUPTED' });
    await vi.waitFor(() => expect(state.child).toBeDefined());
    controller.abort();
    expect(process.kill).toHaveBeenCalledWith(-123456, 'SIGKILL');
    state.child!.emit('close', null);
    await result;
    await expect(access(state.directory)).rejects.toThrow();
  });
  it('rejects an already-aborted deadline before any native work', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(prepareAiReceiptImages('application/pdf', Buffer.from('%PDF-synthetic'), controller.signal)).rejects.toMatchObject({ code: 'AI_REQUEST_INTERRUPTED' });
    expect(state.directory).toBe('');
  });
  it('rejects invalid signatures and byte limits before any native work', async () => {
    await expect(prepareAiReceiptImages('application/pdf', Buffer.from('not PDF'))).rejects.toMatchObject({ code: 'AI_PDF_LIMIT' });
    await expect(prepareAiReceiptImages('application/pdf', Buffer.alloc(AI_MAX_INPUT_BYTES + 1))).rejects.toMatchObject({ code: 'AI_PDF_LIMIT' });
    expect(state.directory).toBe('');
  });
});
