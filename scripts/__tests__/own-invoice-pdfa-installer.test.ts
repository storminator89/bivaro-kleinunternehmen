import { describe, expect, it, vi } from 'vitest';
import { automatedInstallation, downloadArchive, requirePinnedArchive, VERAPDF_ASSET } from '../own-invoice-pdfa/install-runtime.mjs';

describe('official own-invoice verifier asset contract (no download or child process)', () => {
  it('pins the official stable archive and its signature-reviewed digest', () => {
    expect(VERAPDF_ASSET.version).toBe('1.30.3');
    expect(VERAPDF_ASSET.url).toBe('https://software.verapdf.org/releases/1.30/verapdf-greenfield-1.30.3-installer.zip');
    expect(VERAPDF_ASSET.sha256).toBe('b512bf24945503a33fc10738ecffc1f2dccaaf8593a448e94ee9ac86a9559a59');
    expect(() => requirePinnedArchive(Buffer.from('ordinary invalid archive'))).toThrow('integrity');
  });

  it('escapes the trusted destination and installs CLI/documentation without GUI/plugins', () => {
    const xml = automatedInstallation('/tmp/synthetic & <destination>');
    expect(xml).toContain('/tmp/synthetic &amp; &lt;destination&gt;');
    expect(xml).toContain('name="veraPDF CLI" selected="true"');
    expect(xml).toContain('name="veraPDF GUI" selected="false"');
    expect(xml).toContain('name="veraPDF Sample Plugins" selected="false"');
  });

  it('fails closed on missing, differently sized or corrupt download responses', async () => {
    const unavailable = vi.fn(async () => new Response('unavailable', { status: 503 }));
    await expect(downloadArchive(unavailable)).rejects.toThrow('unavailable');
    const differentSize = vi.fn(async () => new Response('ordinary invalid archive', { headers: { 'content-length': '24' } }));
    await expect(downloadArchive(differentSize)).rejects.toThrow('size');
    const corrupt = vi.fn(async () => new Response('ordinary invalid archive'));
    await expect(downloadArchive(corrupt)).rejects.toThrow('integrity');
    expect(corrupt).toHaveBeenCalledWith(VERAPDF_ASSET.url, expect.objectContaining({ redirect: 'error', credentials: 'omit' }));
  });
});
