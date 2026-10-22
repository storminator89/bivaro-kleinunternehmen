import { afterEach, describe, expect, it, vi } from 'vitest';
import { automatedInstallation, downloadArchive, probeInstalledVersion, requirePinnedArchive, VERAPDF_ASSET } from '../own-invoice-pdfa/install-runtime.mjs';

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


describe('bounded build-only veraPDF version probe (injected executor; no child process)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('checks the exact pinned version with fixed process/output/JVM bounds and no inherited environment', async () => {
    vi.stubEnv('BIVARO_PROBE_SHOULD_NOT_LEAK', 'synthetic-value');
    vi.stubEnv('JAVA_OPTS', '-Xmx8g');
    vi.stubEnv('JAVA_TOOL_OPTIONS', '-Dsynthetic.injected=true');
    vi.stubEnv('_JAVA_OPTIONS', '-Dsynthetic.injected=true');
    vi.stubEnv('JDK_JAVA_OPTIONS', '-Dsynthetic.injected=true');
    const executor = vi.fn(async () => ({ stdout: 'veraPDF 1.30.3\r\nAdditional synthetic version details\r\n', stderr: '' }));
    await expect(probeInstalledVersion('/synthetic/runtime/verapdf', '/synthetic/build-temp', executor)).resolves.toBeUndefined();
    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor).toHaveBeenCalledWith('/synthetic/runtime/verapdf', ['--version'], {
      cwd: '/synthetic/build-temp', timeout: 120_000, killSignal: 'SIGKILL', maxBuffer: 32 * 1024,
      env: {
        PATH: '/usr/bin:/bin', HOME: '/synthetic/build-temp', TMPDIR: '/synthetic/build-temp',
        LANG: 'C.UTF-8', TZ: 'UTC', NODE_ENV: 'production', JAVACMD: '/usr/bin/java',
        JAVA_OPTS: '-Xms16m -Xmx192m -XX:+UseSerialGC -XX:ActiveProcessorCount=1 -Djava.awt.headless=true -Duser.home=.',
      },
    });
  });

  it.each(['veraPDF 1.30.2', 'veraPDF 1.30.30', 'unknown version', ''])('rejects a mismatched version without retry: %j', async stdout => {
    const executor = vi.fn(async () => ({ stdout, stderr: '' }));
    await expect(probeInstalledVersion('/synthetic/runtime/verapdf', '/synthetic/build-temp', executor)).rejects.toThrow('Installed veraPDF version mismatch.');
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it.each([
    { code: null, killed: true, signal: 'SIGKILL', stdout: '', stderr: '' },
    { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', stdout: 'synthetic bounded output', stderr: '' },
  ])('propagates the original execution failure without retry: $code', async details => {
    const failure = Object.assign(new Error('Synthetic executor failure'), details);
    const executor = vi.fn(async () => { throw failure; });
    await expect(probeInstalledVersion('/synthetic/runtime/verapdf', '/synthetic/build-temp', executor)).rejects.toBe(failure);
    expect(executor).toHaveBeenCalledTimes(1);
  });
});
