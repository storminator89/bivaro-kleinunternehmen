/** Browser-safe configuration. Never add credentials or ciphertext to this DTO. */
export type AiProviderSettingsDto = {
  enabled: boolean;
  autoAnalyzeNewUploads: boolean;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  version: number;
  configurationRevision: string;
  encryptionAvailable: boolean;
  configured: boolean;
};
export type AiProviderSettingsInput = {
  enabled: boolean;
  autoAnalyzeNewUploads: boolean;
  baseUrl: string;
  model: string;
  expectedVersion: number;
  keyAction: 'keep' | 'replace' | 'remove';
  apiKey?: string;
};
