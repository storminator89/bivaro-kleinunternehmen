import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
import { lookup } from 'node:dns/promises';
import { normalizeAiBaseUrl, isPublicAiAddress, resolveAiTarget } from '@/lib/ai-provider/url-policy';
import { aiEncryptionAvailable, encryptAiKey, decryptAiKey } from '@/lib/ai-provider/crypto';

afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
describe('AI encrypted credentials', () => {
  it('fails closed without strong runtime encryption configuration', () => {
    vi.stubEnv('NEXTAUTH_SECRET', '');
    expect(aiEncryptionAvailable()).toBe(false);
    expect(() => encryptAiKey('tenant-a', 'synthetic-not-a-real-key')).toThrow(/NEXTAUTH_SECRET/u);
  });
  it('uses authenticated randomized ciphertext bound to the tenant', () => {
    vi.stubEnv('NEXTAUTH_SECRET', 'synthetic-encryption-material-32-characters-only');
    const first = encryptAiKey('tenant-a', 'synthetic-not-a-real-key');
    const second = encryptAiKey('tenant-a', 'synthetic-not-a-real-key');
    expect(JSON.stringify(first)).not.toContain('synthetic-not-a-real-key');
    expect(first.keyCiphertext).not.toBe(second.keyCiphertext);
    expect(decryptAiKey('tenant-a', first)).toBe('synthetic-not-a-real-key');
    expect(() => decryptAiKey('tenant-b', first)).toThrow(/erneut/u);
    expect(() => decryptAiKey('tenant-a', { ...first, keyTag: Buffer.alloc(16).toString('base64') })).toThrow(/erneut/u);
    vi.stubEnv('NEXTAUTH_SECRET', 'different-synthetic-encryption-material-32-only');
    expect(() => decryptAiKey('tenant-a', first)).toThrow(/erneut/u);
  });
});
describe('AI endpoint SSRF policy', () => {
  it.each(['http://api.example.com/v1', 'https://user:pass@api.example.com/v1', 'https://api.example.com/v1?q=x', 'https://api.example.com/v1#x', 'https://api.example.com/v1%2fsecret', 'https://api.example.com/v1\\secret'])('rejects unsafe syntax %s', value => {
    expect(() => normalizeAiBaseUrl(value)).toThrow();
  });
  it.each(['0.0.0.0', '10.1.2.3', '127.0.0.1', '100.64.0.1', '169.254.169.254', '172.16.1.2', '192.168.1.1', '198.18.1.1', '224.0.0.1', '255.255.255.255', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1', '2002:7f00:1::'])('rejects special IP %s', value => expect(isPublicAiAddress(value)).toBe(false));
  it('allows public IPv4/IPv6 and normalizes exact API prefixes', () => {
    expect(isPublicAiAddress('8.8.8.8')).toBe(true);
    expect(isPublicAiAddress('2606:4700:4700::1111')).toBe(true);
    expect(normalizeAiBaseUrl('https://api.example.com/v1/')).toBe('https://api.example.com/v1');
  });
  it('rejects mixed DNS results and never performs secondary lookups', async () => {
    vi.mocked(lookup).mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }] as never);
    await expect(resolveAiTarget('https://api.example.com/v1')).rejects.toMatchObject({ code: 'UNSAFE_ENDPOINT', requestMayHaveBeenSent: false });
    expect(lookup).toHaveBeenCalledTimes(1);
  });
  it('supports exact operator-approved internal HTTP URL only', async () => {
    vi.stubEnv('BIVARO_AI_PRIVATE_BASE_URLS', JSON.stringify(['http://127.0.0.1:8080/v1']));
    expect(normalizeAiBaseUrl('http://127.0.0.1:8080/v1/')).toBe('http://127.0.0.1:8080/v1');
    expect(() => normalizeAiBaseUrl('http://127.0.0.1:8081/v1')).toThrow();
    expect(() => normalizeAiBaseUrl('http://127.0.0.1:8080/other')).toThrow();
    await expect(resolveAiTarget('http://127.0.0.1:8080/v1')).resolves.toMatchObject({ address: '127.0.0.1', family: 4 });
    expect(lookup).not.toHaveBeenCalled();
  });
  it('rejects IPv6 private literals unless exact operator-approved', async () => {
    await expect(resolveAiTarget('https://[::1]:8443/v1')).rejects.toMatchObject({ code: 'UNSAFE_ENDPOINT' });
    vi.stubEnv('BIVARO_AI_PRIVATE_BASE_URLS', JSON.stringify(['https://[::1]:8443/v1']));
    await expect(resolveAiTarget('https://[::1]:8443/v1')).resolves.toMatchObject({ address: '::1', family: 6 });
  });
});
