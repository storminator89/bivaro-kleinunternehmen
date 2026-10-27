import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserRequestId } from '@/lib/browser-request-id';

afterEach(() => vi.unstubAllGlobals());

describe('browser retry identity on HTTP LAN origins', () => {
  it('uses the native UUID API when available', () => {
    const randomUUID = vi.fn(() => '12345678-1234-4123-8123-123456789abc');
    vi.stubGlobal('crypto', { randomUUID });
    expect(createBrowserRequestId()).toBe('12345678-1234-4123-8123-123456789abc');
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it('sets UUID v4/version and variant bits without requiring randomUUID', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => bytes.fill(255));
    vi.stubGlobal('crypto', { getRandomValues });
    expect(createBrowserRequestId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(getRandomValues.mock.calls[0][0]).toHaveLength(16);
  });

  it('creates distinct valid identities using actual random bytes on the HTTP fallback', () => {
    vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
    const values = Array.from({ length: 100 }, () => createBrowserRequestId());
    expect(new Set(values).size).toBe(values.length);
    for (const value of values) expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('fails explicitly instead of issuing a missing or insecure retry identity', () => {
    vi.stubGlobal('crypto', undefined);
    expect(createBrowserRequestId).toThrow('keine sichere Rechnungskennung');
  });
});
