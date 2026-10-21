import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ row: null as Record<string, unknown> | null }));
vi.mock('@/lib/prisma', () => {
  const provider = {
    findUnique: vi.fn(async () => state.row),
    create: vi.fn(async ({ data }) => { state.row = { keyCiphertext: null, keyIv: null, keyTag: null, version: 1, ...data }; }),
    updateMany: vi.fn(async ({ where, data }) => {
      if (!state.row || where.version !== state.row.version) return { count: 0 };
      state.row = { ...state.row, ...data, version: Number(state.row.version) + 1 }; return { count: 1 };
    }),
  };
  return { prisma: { aiProviderSettings: provider, $transaction: async (work: (tx: unknown) => unknown) => work({ aiProviderSettings: provider }) } };
});
import { getAiProviderSettings, resolveAiProviderConfiguration, saveAiProviderSettings } from '@/lib/ai-provider/settings';
import type { AiProviderSettingsInput } from '@/lib/ai-provider/types';
const initial: AiProviderSettingsInput = { enabled: true, autoAnalyzeNewUploads: false, baseUrl: 'https://provider.example/v1', model: 'synthetic-model', keyAction: 'replace', apiKey: 'synthetic-key-not-real', expectedVersion: 0 };
beforeEach(() => { state.row = null; vi.stubEnv('NEXTAUTH_SECRET', 'synthetic-encryption-material-32-characters-only'); });
afterEach(() => vi.unstubAllEnvs());
describe('tenant provider settings', () => {
  it('is disabled with no automatic processing by default', async () => {
    expect(await getAiProviderSettings('a')).toMatchObject({ enabled: false, autoAnalyzeNewUploads: false, hasKey: false, version: 0, configurationRevision: '' });
    await expect(resolveAiProviderConfiguration('a')).rejects.toMatchObject({ code: 'AI_DISABLED' });
  });
  it('stores ciphertext only, omits all key material from DTO, keeps and removes explicitly', async () => {
    const first = await saveAiProviderSettings('a', initial);
    expect(first).toMatchObject({ enabled: true, hasKey: true, version: 1 });
    expect(JSON.stringify(first)).not.toContain(initial.apiKey);
    expect(Object.keys(first).some(key => /ciphertext|apiKey|keyIv|keyTag/u.test(key))).toBe(false);
    expect(JSON.stringify(state.row)).not.toContain(initial.apiKey);
    await expect(resolveAiProviderConfiguration('a', 1, 'old-revision')).rejects.toMatchObject({ code: 'CONFIG_CONFLICT' });
    const runtime = await resolveAiProviderConfiguration('a', 1, first.configurationRevision); expect(runtime.apiKey).toBe(initial.apiKey);
    const keepInput = { ...initial, keyAction: 'keep' as const, apiKey: undefined, expectedVersion: 1 };
    const second = await saveAiProviderSettings('a', keepInput);
    expect(second.configurationRevision).not.toBe(first.configurationRevision);
    expect((await resolveAiProviderConfiguration('a')).apiKey).toBe(initial.apiKey);
    const removed = await saveAiProviderSettings('a', { ...keepInput, keyAction: 'remove', expectedVersion: 2 });
    expect(removed).toMatchObject({ enabled: false, autoAnalyzeNewUploads: false, hasKey: false, version: 3 });
  });
  it('requires explicit replacement on destination/model change and rejects stale writes', async () => {
    await saveAiProviderSettings('a', initial);
    await expect(saveAiProviderSettings('a', { ...initial, keyAction: 'keep', apiKey: undefined, baseUrl: 'https://other.example/v1', expectedVersion: 1 })).rejects.toMatchObject({ code: 'KEY_REPLACEMENT_REQUIRED' });
    await expect(saveAiProviderSettings('a', { ...initial, expectedVersion: 0 })).rejects.toMatchObject({ code: 'CONFIG_CONFLICT' });
    await expect(resolveAiProviderConfiguration('a', 9)).rejects.toMatchObject({ code: 'CONFIG_CONFLICT' });
  });
  it('fails clearly without encryption and never clears a key on empty replace', async () => {
    vi.stubEnv('NEXTAUTH_SECRET', '');
    await expect(saveAiProviderSettings('a', initial)).rejects.toMatchObject({ code: 'ENCRYPTION_UNAVAILABLE' });
    expect(state.row).toBeNull();
    await expect(saveAiProviderSettings('a', { ...initial, apiKey: '' })).rejects.toMatchObject({ code: 'INVALID_SETTINGS' });
  });
  it('does not allow auto-analysis without enabled complete config', async () => {
    await expect(saveAiProviderSettings('a', { ...initial, enabled: false, autoAnalyzeNewUploads: true })).rejects.toMatchObject({ code: 'AUTO_REQUIRES_ENABLED' });
  });
});
