import { BankImportError, bankImportUuid } from './bank-import-contract';
import { bankMappingProfileRevision, parseBankMappingProfileConfiguration, parseBankMappingProfileDelete, parseBankMappingProfileMutation, type BankMappingProfile, type BankMappingProfileSummary } from './bank-mapping-profile-contract';
async function result(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json();
  if (!response.ok) throw new BankImportError(typeof value?.error === 'string' ? value.error : 'Profilaktion fehlgeschlagen.', response.status);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BankImportError('Profilantwort konnte nicht sicher geprüft werden.', 502);
  return value;
}
function profile(value: unknown): BankMappingProfile {
  try {
    if (!value || typeof value !== 'object') throw new Error('Invalid profile');
    const item = value as BankMappingProfile;
    const revision = bankMappingProfileRevision(item.revision), latestRevision = bankMappingProfileRevision(item.latestRevision);
    if (latestRevision < revision) throw new Error('Invalid revision');
    return { id: bankImportUuid(item.id), revision, latestRevision, configuration: parseBankMappingProfileConfiguration(item.configuration) };
  } catch {
    // A successful HTTP response can follow a committed write. Parser errors
    // here are never a definite 4xx rejection of the original mutation.
    throw new BankImportError('Profilantwort konnte nicht sicher geprüft werden. Dieselbe Aktion erneut prüfen.', 502);
  }
}
export async function loadBankMappingProfiles(signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<BankMappingProfileSummary[]> {
  const value = await result(await fetcher('/api/bank-mapping-profiles', { credentials: 'same-origin', cache: 'no-store', signal }));
  if (!Array.isArray(value.profiles) || value.profiles.length > 100) throw new BankImportError('Ungültige Profilliste.', 502);
  return value.profiles.map((item: BankMappingProfileSummary) => {
    if (typeof item.name !== 'string' || item.name.length > 80 || typeof item.accountAlias !== 'string' || item.accountAlias.length > 80) throw new BankImportError('Ungültige Profilliste.', 502);
    return { id: bankImportUuid(item.id), revision: bankMappingProfileRevision(item.revision), name: item.name, accountAlias: item.accountAlias };
  });
}
export async function loadBankMappingProfile(id: string, revision: number, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<BankMappingProfile> {
  const value = await result(await fetcher(`/api/bank-mapping-profiles?id=${encodeURIComponent(id)}&revision=${revision}`, { credentials: 'same-origin', cache: 'no-store', signal }));
  const loaded = profile(value.profile);
  if (loaded.id !== id || loaded.revision !== revision) throw new BankImportError('Die angefragte Profilrevision stimmt nicht überein.', 502);
  return loaded;
}
/** Callers freeze this exact payload for unknown-outcome retries. Server mutationId is idempotent. */
export async function mutateBankMappingProfile(method: 'POST' | 'DELETE', payload: unknown, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<BankMappingProfile | null> {
  const expected = method === 'POST' ? parseBankMappingProfileMutation(payload) : parseBankMappingProfileDelete(payload);
  const value = await result(await fetcher('/api/bank-mapping-profiles', { method, credentials: 'same-origin', cache: 'no-store', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(expected) }));
  if (method === 'DELETE') {
    if (value.deleted !== true) throw new BankImportError('Löschergebnis unklar.', 502);
    return null;
  }
  const loaded = profile(value.profile);
  const requested = parseBankMappingProfileMutation(expected);
  if (loaded.id !== requested.id || loaded.revision !== requested.expectedRevision + 1 || JSON.stringify(loaded.configuration) !== JSON.stringify(requested.configuration)) throw new BankImportError('Profilantwort passt nicht zur angefragten Aktion. Dieselbe Aktion erneut prüfen.', 502);
  return loaded;
}
