import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const state = vi.hoisted(() => ({ child: null as unknown, spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: (...args: unknown[]) => state.spawn(...args) }));
import { runValidationProcess, validatePurchaseOriginal } from '@/lib/purchase-documents/validation-runtime';

class SyntheticChild extends EventEmitter {
  pid?: number;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn(() => true);
}
function child() {
  const instance = new SyntheticChild(); state.child = instance; state.spawn.mockReturnValue(instance); return instance;
}
afterEach(() => { vi.useRealTimers(); state.spawn.mockReset(); });
describe('bounded offline subprocess lifecycle', () => {
  it('never starts an engine for namespace-aware schema hints at any depth, including foreign lax UBL extensions and local paths', async () => {
    const original = (await readFile(path.join(import.meta.dirname, 'fixtures/incoming-validation/valid-ubl.xml'))).toString();
    for (const [attribute, value, nested] of [
      ['schemaLocation', 'urn:synthetic:foreign http://127.0.0.1:9/must-not-load.xsd', true],
      ['schemaLocation', 'urn:synthetic:foreign file:///synthetic/LOCAL_CONTENT_MUST_NOT_LEAK.xsd', true],
      ['noNamespaceSchemaLocation', '../synthetic/LOCAL_CONTENT_MUST_NOT_LEAK.xsd', true],
      ['schemaLocation', 'urn:synthetic:foreign jar:file:///synthetic/private.jar!/schema.xsd', false],
      ['noNamespaceSchemaLocation', 'f&#105;le:///synthetic/LOCAL_CONTENT_MUST_NOT_LEAK.xsd', false],
      ['schemaLocation', '', false],
    ] as const) {
      let xml = original.replace('<Invoice ', `<Invoice xmlns:alias="http://www.w3.org/2001/XMLSchema-instance" ${nested ? '' : `alias:${attribute}="${value}" `}`);
      if (nested) xml = xml.replace('<cbc:CustomizationID>', `<ext:UBLExtensions xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"><ext:UBLExtension><ext:ExtensionContent><foreign:probe xmlns:foreign="urn:synthetic:foreign" alias:${attribute}="${value}"/></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions><cbc:CustomizationID>`);
      const bytes = Buffer.from(xml), unchanged = Buffer.from(bytes);
      const expectedSha256 = createHash('sha256').update(bytes).digest('hex');
      const result = await validatePurchaseOriginal({ bytes, expectedSha256, mediaType: 'application/xml' });
      expect(result).toMatchObject({ status: 'UNSUPPORTED', reasonCode: 'XML_SCHEMA_HINTS_UNSUPPORTED', originalSha256: expectedSha256, checks: { xml: 'NOT_RUN', xsd: 'NOT_RUN', schematron: 'NOT_RUN' }, findings: [] });
      expect(JSON.stringify(result)).not.toContain('LOCAL_CONTENT_MUST_NOT_LEAK');
      expect(bytes).toEqual(unchanged);
    }
    expect(state.spawn).not.toHaveBeenCalled();
  });
  it('uses fixed offline CLI arguments, ignores inherited Java injection, and times out with SIGKILL', async () => {
    vi.useFakeTimers();
    const processChild = child();
    const pending = runValidationProcess('/synthetic-assets', '/synthetic-private-directory', 'CII');
    const rejected = expect(pending).rejects.toThrow('VALIDATOR_TIMEOUT');
    const args = state.spawn.mock.calls[0];
    expect(args[0]).toBe('/usr/bin/prlimit');
    expect(args[1]).toContain('--as=2147483648:2147483648'); expect(args[1]).toContain('--cpu=25:26');
    expect(args[1]).toContain('-Djavax.xml.accessExternalDTD='); expect(args[1]).toContain('-Djavax.xml.accessExternalStylesheet=file');
    expect(args[2].env).not.toHaveProperty('JAVA_TOOL_OPTIONS'); expect(args[2].env).not.toHaveProperty('NODE_OPTIONS');
    await vi.advanceTimersByTimeAsync(30_001); expect(processChild.kill).toHaveBeenCalledWith('SIGKILL');
    // Capacity must remain occupied until process + output descriptors actually close.
    let settled = false; void pending.catch(() => { settled = true; }); await Promise.resolve(); expect(settled).toBe(false);
    processChild.emit('close', null, 'SIGKILL'); await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('kills excessive output and classifies process-start failure without exposing stderr', async () => {
    const processChild = child();
    const pending = runValidationProcess('/synthetic-assets', '/synthetic-private-directory', 'UBL');
    const rejected = expect(pending).rejects.toThrow('VALIDATOR_OUTPUT_LIMIT');
    processChild.stderr.emit('data', Buffer.alloc(64 * 1024 + 1)); expect(processChild.kill).toHaveBeenCalledWith('SIGKILL');
    processChild.emit('close', null); await rejected;
    const unavailable = child(); const unavailableRun = runValidationProcess('/synthetic-assets', '/synthetic-private-directory', 'UBL');
    const unavailableRejected = expect(unavailableRun).rejects.toThrow('VALIDATOR_UNAVAILABLE');
    unavailable.emit('error', new Error('sensitive-path-must-not-escape')); unavailable.emit('close', -2); await unavailableRejected;
  });
  it('kills the private process group so descendants cannot survive timeout', async () => {
    vi.useFakeTimers();
    const processChild = child(); processChild.pid = 123456;
    const killGroup = vi.spyOn(process, 'kill').mockReturnValue(true);
    try {
      const pending = runValidationProcess('/synthetic-assets', '/synthetic-private-directory', 'UBL');
      const rejected = expect(pending).rejects.toThrow('VALIDATOR_TIMEOUT');
      await vi.advanceTimersByTimeAsync(30_001); expect(killGroup).toHaveBeenCalledWith(-123456, 'SIGKILL');
      processChild.emit('close', null); await rejected;
    } finally { killGroup.mockRestore(); }
  });
  it.skipIf(!process.env.BIVARO_EINVOICE_TEST_ASSETS)('enforces one process across requests and removes private originals/reports on interruption', async () => {
    const assetsRoot = process.env.BIVARO_EINVOICE_TEST_ASSETS!;
    const before = (await readdir(tmpdir())).filter(name => name.startsWith('bivaro-invoice-check-')).sort();
    const bytes = await readFile(path.join(import.meta.dirname, 'fixtures/incoming-validation/valid-cii.xml'));
    const input = { bytes, expectedSha256: createHash('sha256').update(bytes).digest('hex'), mediaType: 'application/xml' };
    const processChild = child();
    const first = validatePurchaseOriginal(input, { assetsRoot });
    await vi.waitFor(() => expect(state.spawn).toHaveBeenCalledTimes(1));
    await expect(validatePurchaseOriginal(input, { assetsRoot })).rejects.toThrow('ausgelastet');
    processChild.emit('close', null, 'SIGKILL');
    expect(await first).toMatchObject({ status: 'NOT_RUN', reasonCode: 'VALIDATOR_EXECUTION_FAILED', checks: { xsd: 'NOT_RUN', schematron: 'NOT_RUN' } });
    expect((await readdir(tmpdir())).filter(name => name.startsWith('bivaro-invoice-check-')).sort()).toEqual(before);
    const next = child(); const retry = validatePurchaseOriginal(input, { assetsRoot });
    await vi.waitFor(() => expect(state.spawn).toHaveBeenCalledTimes(2)); next.emit('close', 2);
    expect((await retry).status).toBe('NOT_RUN');
  });
});
