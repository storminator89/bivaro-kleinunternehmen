import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ status: 200, body: '', options: null as unknown, url: '', calls: 0, error: false, encoding: '' }));
vi.mock('@/lib/ai-provider/url-policy', () => ({ resolveAiTarget: vi.fn(async () => ({ url: new URL('https://provider.example/v1/chat/completions'), address: '8.8.8.8', family: 4 })) }));
vi.mock('node:https', () => ({ request: vi.fn((url, options, callback) => {
  state.options = options; state.url = url.href; state.calls++;
  const req = new EventEmitter() as EventEmitter & { end: () => void };
  req.end = () => queueMicrotask(() => {
    if (state.error) { req.emit('error', new Error('synthetic-key-must-not-escape')); return; }
    const response = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string>; destroy: () => void };
    response.statusCode = state.status;
    response.headers = state.encoding ? { 'content-encoding': state.encoding } : {};
    response.destroy = vi.fn();
    callback(response);
    response.emit('data', Buffer.from(state.body));
    response.emit('end');
  });
  return req;
}) }));
import { requestAiCompletion } from '@/lib/ai-provider/transport';
import { resolveAiTarget } from '@/lib/ai-provider/url-policy';
const config = { baseUrl: 'https://provider.example/v1', model: 'synthetic-vision-model', apiKey: 'synthetic-key-must-not-escape', version: 1, configurationRevision: 'synthetic-revision', autoAnalyzeNewUploads: false };
const input = { messages: [{ role: 'user' as const, content: 'synthetic receipt text' }] };
beforeEach(() => { state.status = 200; state.body = JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"total":"1.00"}' } }] }); state.calls = 0; state.error = false; state.encoding = ''; vi.clearAllMocks(); });
describe('single-attempt bounded AI transport', () => {
  it('returns only assistant content and pins original host to validated address', async () => {
    await expect(requestAiCompletion(config, input)).resolves.toBe('{"total":"1.00"}');
    expect(state.calls).toBe(1);
    expect(state.url).toBe('https://provider.example/v1/chat/completions');
    const options = state.options as { lookup: (host: string, options: { all?: boolean }, cb: (...args: unknown[]) => void) => void; agent: boolean; headers: Record<string, string> };
    const callback = vi.fn(); options.lookup('provider.example', {}, callback);
    expect(callback).toHaveBeenCalledWith(null, '8.8.8.8', 4);
    expect(options.agent).toBe(false);
    expect(options.headers.authorization).toBe(`Bearer ${config.apiKey}`);
  });
  it.each([301, 302, 307, 401, 429, 500])('never follows redirect or retries provider status %s', async status => {
    state.status = status; state.body = config.apiKey;
    const error = await requestAiCompletion(config, input).catch(error => error);
    expect(error).toMatchObject({ code: status === 401 ? 'PROVIDER_UNAUTHORIZED' : status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_REJECTED', requestMayHaveBeenSent: true });
    expect(error.message).not.toContain(config.apiKey);
    expect(state.calls).toBe(1);
  });
  it('redacts network errors and declares charging uncertainty', async () => {
    state.error = true;
    const error = await requestAiCompletion(config, input).catch(error => error);
    expect(error).toMatchObject({ code: 'REQUEST_FAILED', requestMayHaveBeenSent: true });
    expect(JSON.stringify(error)).not.toContain(config.apiKey);
    expect(error.message).not.toContain(config.apiKey);
    expect(state.calls).toBe(1);
  });
  it.each([
    { choices: [{ finish_reason: 'length', message: { content: '{}' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: '{}', tool_calls: [{}] } }] },
    { choices: [{ finish_reason: 'stop', message: { content: '{}', refusal: 'secret' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: 'a'.repeat(32769) } }] },
  ])('rejects truncated, tool, refusal or oversized assistant content', async body => {
    state.body = JSON.stringify(body);
    await expect(requestAiCompletion(config, input)).rejects.toMatchObject({ code: 'RESPONSE_INVALID', requestMayHaveBeenSent: true });
  });
  it('caps response bytes and refuses compressed response', async () => {
    state.body = 'x'.repeat(65537);
    await expect(requestAiCompletion(config, input)).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
    state.encoding = 'gzip'; state.body = '';
    await expect(requestAiCompletion(config, input)).rejects.toMatchObject({ code: 'RESPONSE_INVALID' });
  });
  it('refuses external image URLs and oversized requests before DNS/network', async () => {
    await expect(requestAiCompletion(config, { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://metadata.invalid/original.png' } }] }] })).rejects.toMatchObject({ code: 'INVALID_REQUEST', requestMayHaveBeenSent: false });
    await expect(requestAiCompletion(config, { messages: [{ role: 'user', content: 'x'.repeat(12 * 1024 * 1024) }] })).rejects.toMatchObject({ code: 'REQUEST_TOO_LARGE', requestMayHaveBeenSent: false });
    expect(resolveAiTarget).not.toHaveBeenCalled(); expect(state.calls).toBe(0);
  });
  it('honors cancelled requests before dispatch', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(requestAiCompletion(config, input, controller.signal)).rejects.toMatchObject({ code: 'CANCELLED', requestMayHaveBeenSent: false });
    expect(state.calls).toBe(0);
  });
});
