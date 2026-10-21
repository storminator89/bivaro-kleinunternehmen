import 'server-only';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { aiEncryptionAvailable, decryptAiKey, encryptAiKey } from './crypto';
import { AiProviderError } from './errors';
import { normalizeAiBaseUrl } from './url-policy';
import type { AiProviderSettingsDto, AiProviderSettingsInput } from './types';

export type AiProviderRuntimeConfiguration = {
  baseUrl: string; model: string; apiKey: string; version: number;
  configurationRevision: string; autoAnalyzeNewUploads: boolean;
};
function dto(row: {
  enabled: boolean; autoAnalyzeNewUploads: boolean; baseUrl: string; model: string;
  keyCiphertext: string | null; keyIv: string | null; keyTag: string | null;
  version: number; configurationRevision: string;
} | null): AiProviderSettingsDto {
  const hasKey = Boolean(row?.keyCiphertext && row.keyIv && row.keyTag);
  return {
    enabled: row?.enabled ?? false, autoAnalyzeNewUploads: row?.autoAnalyzeNewUploads ?? false,
    baseUrl: row?.baseUrl ?? '', model: row?.model ?? '', hasKey, version: row?.version ?? 0,
    configurationRevision: row?.configurationRevision ?? '', encryptionAvailable: aiEncryptionAvailable(),
    configured: Boolean(row?.baseUrl && row.model && hasKey && aiEncryptionAvailable()),
  };
}
export async function getAiProviderSettings(userId: string): Promise<AiProviderSettingsDto> {
  return dto(await prisma.aiProviderSettings.findUnique({ where: { userId } }));
}
function invalid(): never { throw new AiProviderError('INVALID_SETTINGS', 'Ungültige KI-Einstellungen.'); }
export function validateAiProviderSettingsInput(value: unknown): AiProviderSettingsInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some(key => !['enabled', 'autoAnalyzeNewUploads', 'baseUrl', 'model', 'expectedVersion', 'keyAction', 'apiKey'].includes(key))) invalid();
  if (typeof data.enabled !== 'boolean' || typeof data.autoAnalyzeNewUploads !== 'boolean' || typeof data.baseUrl !== 'string' || typeof data.model !== 'string' || !Number.isSafeInteger(data.expectedVersion) || (data.expectedVersion as number) < 0 || !['keep', 'replace', 'remove'].includes(String(data.keyAction))) invalid();
  if (data.apiKey !== undefined && typeof data.apiKey !== 'string') invalid();
  if (data.keyAction === 'replace') {
    if (typeof data.apiKey !== 'string' || !data.apiKey || data.apiKey.length > 4096 || /[\s\u0000-\u001f\u007f]/u.test(data.apiKey)) invalid();
  } else if (data.apiKey !== undefined) invalid();
  const model = data.model.trim();
  if (model.length > 200 || (model && !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(model))) invalid();
  const baseUrl = data.baseUrl ? normalizeAiBaseUrl(data.baseUrl.trim()) : '';
  return { ...data, model, baseUrl } as AiProviderSettingsInput;
}
export async function saveAiProviderSettings(userId: string, raw: AiProviderSettingsInput): Promise<AiProviderSettingsDto> {
  const input = validateAiProviderSettingsInput(raw);
  const encrypted = input.keyAction === 'replace' ? encryptAiKey(userId, input.apiKey!) : null;
  return prisma.$transaction(async tx => {
    const existing = await tx.aiProviderSettings.findUnique({ where: { userId } });
    if ((existing?.version ?? 0) !== input.expectedVersion) throw new AiProviderError('CONFIG_CONFLICT', 'KI-Einstellungen wurden geändert. Bitte neu laden.', 409);
    if (existing?.keyCiphertext && input.keyAction === 'keep' && (existing.baseUrl !== input.baseUrl || existing.model !== input.model)) {
      throw new AiProviderError('KEY_REPLACEMENT_REQUIRED', 'Bei geändertem Anbieter oder Modell den Schlüssel ausdrücklich ersetzen oder entfernen.');
    }
    const keyFields = input.keyAction === 'remove' ? { keyCiphertext: null, keyIv: null, keyTag: null } : encrypted;
    const hasKey = input.keyAction === 'remove' ? false : Boolean(encrypted || existing?.keyCiphertext);
    const enabled = input.keyAction === 'remove' ? false : input.enabled;
    const autoAnalyzeNewUploads = enabled && input.keyAction !== 'remove' && input.autoAnalyzeNewUploads;
    if (enabled && (!input.baseUrl || !input.model || !hasKey)) throw new AiProviderError('CONFIG_INCOMPLETE', 'Base URL, Modell und Schlüssel sind zum Aktivieren erforderlich.');
    if (enabled && !aiEncryptionAvailable()) throw new AiProviderError('ENCRYPTION_UNAVAILABLE', 'KI-Schlüsselspeicherung ist nicht verfügbar. Betreiber kontaktieren.', 503);
    if (input.autoAnalyzeNewUploads && !enabled && input.keyAction !== 'remove') throw new AiProviderError('AUTO_REQUIRES_ENABLED', 'Automatische Analyse benötigt aktivierte KI-Einstellungen.');
    const data = { baseUrl: input.baseUrl, model: input.model, enabled, autoAnalyzeNewUploads, configurationRevision: randomUUID(), ...keyFields };
    if (existing) {
      const updated = await tx.aiProviderSettings.updateMany({ where: { userId, version: existing.version }, data: { ...data, version: { increment: 1 } } });
      if (updated.count !== 1) throw new AiProviderError('CONFIG_CONFLICT', 'KI-Einstellungen wurden geändert. Bitte neu laden.', 409);
    } else {
      await tx.aiProviderSettings.create({ data: { userId, ...data } });
    }
    return dto(await tx.aiProviderSettings.findUnique({ where: { userId } }));
  });
}
export async function resolveAiProviderConfiguration(userId: string, expectedVersion?: number, expectedConfigRevision?: string): Promise<AiProviderRuntimeConfiguration> {
  const row = await prisma.aiProviderSettings.findUnique({ where: { userId } });
  if (!row || !row.enabled) throw new AiProviderError('AI_DISABLED', 'KI-Beleganalyse ist nicht aktiviert.', 409);
  if (expectedConfigRevision !== undefined && row.configurationRevision !== expectedConfigRevision) throw new AiProviderError('CONFIG_CONFLICT', 'KI-Einstellungen wurden geändert. Bitte neu laden.', 409);
  if (expectedVersion !== undefined && row.version !== expectedVersion) throw new AiProviderError('CONFIG_CONFLICT', 'KI-Einstellungen wurden geändert. Bitte neu laden.', 409);
  if (!row.baseUrl || !row.model || !row.keyCiphertext) throw new AiProviderError('CONFIG_INCOMPLETE', 'KI-Einstellungen sind unvollständig.', 409);
  return { baseUrl: normalizeAiBaseUrl(row.baseUrl), model: row.model, apiKey: decryptAiKey(userId, row), version: row.version, configurationRevision: row.configurationRevision, autoAnalyzeNewUploads: row.autoAnalyzeNewUploads };
}
