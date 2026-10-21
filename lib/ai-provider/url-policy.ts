import 'server-only';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { AiProviderError } from './errors';

const blockedV4 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blockedV4.addSubnet(network, prefix, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const blockedV6 = new BlockList();
for (const [network, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) blockedV6.addSubnet(network, prefix, 'ipv6');

export function isPublicAiAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedV4.check(address, 'ipv4');
  return family === 6 && globalV6.check(address, 'ipv6') && !blockedV6.check(address, 'ipv6');
}
function invalidUrl(): never {
  throw new AiProviderError('INVALID_BASE_URL', 'Base URL muss eine gültige HTTPS-API-Adresse ohne Zugangsdaten, Query oder Fragment sein.');
}
function normalizeUrl(input: string, allowHttp: boolean): string {
  if (!input || input.length > 2048 || /[\s\\\u0000-\u001f\u007f]/u.test(input)) invalidUrl();
  let url: URL;
  try { url = new URL(input); } catch { return invalidUrl(); }
  if ((url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) || !url.hostname || url.username || url.password || url.search || url.hash) invalidUrl();
  // A path must be a plain API prefix, not encoded routing/query characters.
  if (!/^\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]*$/u.test(url.pathname)) invalidUrl();
  url.pathname = url.pathname.replace(/\/+$/u, '');
  return url.href.replace(/\/$/u, '');
}
export function normalizeAiBaseUrl(input: string): string {
  const normalized = normalizeUrl(input, true);
  if (new URL(normalized).protocol !== 'https:' && !privateEndpointAllowed(normalized)) invalidUrl();
  return normalized;
}
function privateEndpointAllowed(baseUrl: string): boolean {
  const raw = process.env.BIVARO_AI_PRIVATE_BASE_URLS;
  if (!raw) return false;
  try {
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values) || values.length > 50 || !values.every(value => typeof value === 'string')) throw new Error();
    return values.some(value => normalizeUrl(value, true) === baseUrl);
  } catch {
    throw new AiProviderError('OPERATOR_POLICY_INVALID', 'Die KI-Endpunktfreigabe ist fehlerhaft. Betreiber kontaktieren.', 503);
  }
}
export async function resolveAiTarget(baseUrl: string): Promise<{ url: URL; address: string; family: number }> {
  const normalized = normalizeAiBaseUrl(baseUrl);
  const url = new URL(`${normalized}/chat/completions`);
  const hostname = url.hostname.replace(/^\[|\]$/gu, '');
  const allowPrivate = privateEndpointAllowed(normalized);
  if (!allowPrivate && /(?:^localhost$|\.(?:localhost|local|internal|home|test|invalid)$)/iu.test(hostname)) {
    throw new AiProviderError('UNSAFE_ENDPOINT', 'Privater KI-Endpunkt benötigt eine ausdrückliche Betreiberfreigabe.');
  }
  let addresses: Array<{ address: string; family: number }>;
  try { addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname, { all: true, verbatim: true }); }
  catch { throw new AiProviderError('DNS_FAILED', 'KI-Endpunkt konnte nicht sicher aufgelöst werden.', 502); }
  if (!addresses.length || addresses.length > 32 || addresses.some(value => !isIP(value.address) || (!allowPrivate && !isPublicAiAddress(value.address)))) {
    throw new AiProviderError('UNSAFE_ENDPOINT', 'Privater oder spezieller KI-Endpunkt benötigt eine ausdrückliche Betreiberfreigabe.');
  }
  return { url, ...addresses[0] };
}
