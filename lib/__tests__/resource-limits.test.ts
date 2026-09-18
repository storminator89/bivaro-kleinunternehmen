import { describe, expect, it } from 'vitest';
import {
  readRequestBodyWithinLimit,
  RequestBodyLimitError,
  requestWithBody,
} from '@/lib/resource-limits';

describe('request resource limits', () => {
  it('counts a chunked request body when Content-Length is absent', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4));
        controller.enqueue(new Uint8Array(4));
        controller.close();
      },
    });
    const request = new Request('http://localhost/upload', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    request.headers.delete('content-length');

    await expect(readRequestBodyWithinLimit(request, 7)).rejects.toBeInstanceOf(RequestBodyLimitError);
  });

  it('recreates a bounded request without changing its content type', async () => {
    const original = new Request('http://localhost/data', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    });
    const body = await readRequestBodyWithinLimit(original, 100);
    const recreated = requestWithBody(original, body);

    expect(recreated.headers.get('content-type')).toBe('application/json');
    await expect(recreated.json()).resolves.toEqual({ ok: true });
  });

  it('does not trust an understated Content-Length', async () => {
    const request = new Request('http://localhost/upload', {
      method: 'POST', headers: { 'content-length': '1' }, body: '12345678',
    });
    await expect(readRequestBodyWithinLimit(request, 4)).rejects.toBeInstanceOf(RequestBodyLimitError);
  });

});
