import 'server-only';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import type { RequestOptions } from 'node:https';
import type { LookupFunction } from 'node:net';
import { AiProviderError } from './errors';
import { resolveAiTarget } from './url-policy';
import type { AiProviderRuntimeConfiguration } from './settings';

export type AiChatMessage = { role: 'system' | 'user'; content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }> };
export const AI_REQUEST_TIMEOUT_MS = 30_000;
export const AI_MAX_REQUEST_BYTES = 12 * 1024 * 1024;
export const AI_MAX_RESPONSE_BYTES = 64 * 1024;
function failure(code: string, message: string, sent: boolean, status = 502): AiProviderError {
  return new AiProviderError(code, message, status, sent);
}
/** Single attempt only. A timeout/network error may still be billed; NEVER retry automatically. */
export async function requestAiCompletion(config: AiProviderRuntimeConfiguration, input: { messages: AiChatMessage[]; maxTokens?: number }, signal?: AbortSignal): Promise<string> {
  if (!Array.isArray(input.messages) || !input.messages.length || input.messages.length > 8) throw failure('INVALID_REQUEST', 'Ungültige KI-Anfrage.', false, 400);
  for (const message of input.messages) {
    if (!['system', 'user'].includes(message.role)) throw failure('INVALID_REQUEST', 'Ungültige KI-Anfrage.', false, 400);
    if (Array.isArray(message.content)) for (const part of message.content) {
      if (part.type === 'image_url' && !/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+=*$/u.test(part.image_url.url)) throw failure('INVALID_REQUEST', 'KI-Bilder müssen aus geprüften lokalen Bilddaten stammen.', false, 400);
      if (!['text', 'image_url'].includes(part.type)) throw failure('INVALID_REQUEST', 'Ungültige KI-Anfrage.', false, 400);
    }
  }
  const maxTokens = input.maxTokens ?? 8192;
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 8192) throw failure('INVALID_REQUEST', 'Ungültiges KI-Ausgabelimit.', false, 400);
  const body = Buffer.from(JSON.stringify({ model: config.model, messages: input.messages, max_tokens: maxTokens, stream: false, store: false }));
  if (body.byteLength > AI_MAX_REQUEST_BYTES) throw failure('REQUEST_TOO_LARGE', 'KI-Anfrage überschreitet das Größenlimit.', false, 413);
  const deadline = AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let sent = false;
  const abortError = () => failure(deadline.aborted ? 'TIMEOUT' : 'CANCELLED', deadline.aborted ? 'KI-Anfrage hat das Zeitlimit überschritten. Kosten können bereits entstanden sein.' : 'KI-Anfrage wurde abgebrochen. Kosten können bereits entstanden sein.', sent, 504);
  const target = await new Promise<Awaited<ReturnType<typeof resolveAiTarget>>>((resolve, reject) => {
    const abort = () => reject(abortError());
    if (combined.aborted) return abort();
    combined.addEventListener('abort', abort, { once: true });
    resolveAiTarget(config.baseUrl).then(resolve, reject).finally(() => combined.removeEventListener('abort', abort));
  });
  if (combined.aborted) throw abortError();
  return new Promise<string>((resolve, reject) => {
    // Fixed lookup prevents a second DNS resolution/rebinding between validation and connect.
    const pinnedLookup = ((_hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
      if (options.all) callback(null, [{ address: target.address, family: target.family }]);
      else callback(null, target.address, target.family);
    }) as LookupFunction;
    const options: RequestOptions = {
      method: 'POST', agent: false, lookup: pinnedLookup, signal: combined,
      maxHeaderSize: 16 * 1024,
      headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json', 'content-length': body.byteLength, 'accept-encoding': 'identity', accept: 'application/json' },
    };
    const send = target.url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = send(target.url, options, response => {
      // Node does not follow redirects. Do not read/log provider error bodies.
      if (response.statusCode !== 200) {
        response.destroy();
        const code = response.statusCode === 401 || response.statusCode === 403 ? 'PROVIDER_UNAUTHORIZED' : response.statusCode === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_REJECTED';
        const message = code === 'PROVIDER_UNAUTHORIZED' ? 'KI-Anbieter hat den Schlüssel oder Modellzugriff abgelehnt. Zugangsdaten prüfen.' : code === 'PROVIDER_RATE_LIMITED' ? 'KI-Anbieter meldet ein Limit. Keine automatische Wiederholung; Anbieter-Kontingent prüfen.' : 'KI-Anbieter hat die Anfrage abgelehnt. Keine automatische Wiederholung; Kosten können entstanden sein.';
        reject(failure(code, message, true));
        return;
      }
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
        response.destroy(); reject(failure('RESPONSE_INVALID', 'KI-Anbieter lieferte ein nicht unterstütztes Antwortformat.', true)); return;
      }
      let size = 0;
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > AI_MAX_RESPONSE_BYTES) { response.destroy(); reject(failure('RESPONSE_TOO_LARGE', 'KI-Antwort überschreitet das Größenlimit.', true)); }
        else chunks.push(chunk);
      });
      response.on('error', () => reject(combined.aborted ? abortError() : failure('REQUEST_FAILED', 'KI-Verbindung unterbrochen. Keine automatische Wiederholung; Kosten können entstanden sein.', true)));
      response.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const choice = data?.choices?.[0];
          if (!choice || choice.finish_reason !== 'stop' || choice.message?.refusal || choice.message?.tool_calls || typeof choice.message?.content !== 'string' || !choice.message.content || Buffer.byteLength(choice.message.content) > 32 * 1024) throw new Error();
          resolve(choice.message.content);
        } catch { reject(failure('RESPONSE_INVALID', 'KI-Antwort ist unvollständig oder ungültig. Keine automatische Wiederholung; Kosten können entstanden sein.', true)); }
      });
    });
    req.on('error', () => reject(combined.aborted ? abortError() : failure('REQUEST_FAILED', 'KI-Verbindung fehlgeschlagen. Keine automatische Wiederholung; Kosten können entstanden sein.', sent)));
    sent = true; // Conservative: once end starts, delivery/charging cannot be ruled out.
    req.end(body);
  });
}
