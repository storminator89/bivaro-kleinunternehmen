import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { AiProviderError } from './errors';

const CONTEXT = 'bivaro:ai-provider-key:aes-256-gcm:v1';
export function aiEncryptionAvailable(): boolean {
  return Boolean(process.env.NEXTAUTH_SECRET && process.env.NEXTAUTH_SECRET.trim().length >= 32);
}
function encryptionKey(): Buffer {
  if (!aiEncryptionAvailable()) throw new AiProviderError('ENCRYPTION_UNAVAILABLE', 'KI-Schlüsselspeicherung benötigt ein sicher konfiguriertes NEXTAUTH_SECRET (mindestens 32 Zeichen). Betreiber kontaktieren.', 503);
  return createHash('sha256').update(CONTEXT).update('\0').update(process.env.NEXTAUTH_SECRET!).digest();
}
export function encryptAiKey(userId: string, key: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`${CONTEXT}\0${userId}`));
  const encrypted = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()]);
  return { keyCiphertext: encrypted.toString('base64'), keyIv: iv.toString('base64'), keyTag: cipher.getAuthTag().toString('base64') };
}
export function decryptAiKey(userId: string, value: { keyCiphertext: string | null; keyIv: string | null; keyTag: string | null }): string {
  const key = encryptionKey();
  try {
    if (!value.keyCiphertext || !value.keyIv || !value.keyTag) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.keyIv, 'base64'));
    decipher.setAAD(Buffer.from(`${CONTEXT}\0${userId}`));
    decipher.setAuthTag(Buffer.from(value.keyTag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(value.keyCiphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new AiProviderError('RECONNECT_REQUIRED', 'Gespeicherter KI-Schlüssel ist nicht verfügbar. Schlüssel erneut eingeben.', 409);
  }
}
