import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiJson, aiRequestError, aiStatusLabel } from '@/components/purchases/ai-receipt-ui';
import { AiReceiptSuggestions } from '@/components/purchases/incoming-ai-extraction';
import type { AiExtractionResult } from '@/lib/purchase-documents/ai-types';

const result: AiExtractionResult = {
  schemaVersion: 1, provenance: 'AI_UNREVIEWED', lineItemsComplete: true, supplierName: '<script>untrusted</script>', invoiceNumber: 'SYNTHETIC-17', invoiceDate: null,
  currency: 'EUR', documentType: 'INVOICE', grossAmount: '9007199254740993.12', netAmount: null, taxAmount: null,
  lineItems: [{ description: 'Synthetic only', quantity: '1', unitPrice: '0.29', amount: '0.29', taxRate: null }], warnings: [{ code: 'UNCERTAIN', message: '<img onerror=bad>Unsicher' }],
};
afterEach(() => vi.unstubAllGlobals());

describe('optional AI receipt UI safety', () => {
  it('distinguishes lifecycle status, unposted draft and unknown result', () => {
    expect(aiStatusLabel(null)).toBe('Noch keine KI-Analyse');
    expect(aiStatusLabel('queued')).toContain('vorgemerkt'); expect(aiStatusLabel('running')).toContain('liest');
    expect(aiStatusLabel('completed')).toContain('nicht gebucht'); expect(aiStatusLabel('failed')).toContain('fehlgeschlagen'); expect(aiStatusLabel('unknown')).toContain('unklar');
  });
  it('escapes untrusted suggestions and displays exact decimals without fabricated dates or confidence scores', () => {
    const html = renderToStaticMarkup(createElement(AiReceiptSuggestions, { result }));
    expect(html).toContain('&lt;script&gt;untrusted&lt;/script&gt;'); expect(html).not.toContain('<script>'); expect(html).not.toContain('<img onerror');
    expect(html).toContain('9.007.199.254.740.993,12 EUR'); expect(html).toContain('Nicht ausgelesen');
    expect(html).toContain('Zahlungsdatum wird nicht aus dem Beleg abgeleitet'); expect(html).toContain('AI_UNREVIEWED');
    expect(html).toContain('Positionsvorschläge prüfen'); expect(html).not.toContain('unvollständige Positionsliste'); expect(html).not.toContain('<table'); expect(html).not.toMatch(/\d+\s*% sicher/);
  });
  it('reports model-declared incomplete and unknown line coverage without inventing completeness', () => {
    const incomplete = renderToStaticMarkup(createElement(AiReceiptSuggestions, { result: { ...result, lineItemsComplete: false } }));
    const unknown = renderToStaticMarkup(createElement(AiReceiptSuggestions, { result: { ...result, lineItemsComplete: null } }));
    expect(incomplete).toContain('unvollständige Positionsliste'); expect(unknown).toContain('Vollständigkeit der Positionsliste nicht angegeben');
  });
  it.each(['AI_PDF_LIMIT', 'AI_RENDER_UNAVAILABLE', 'AI_INVALID_RESULT', 'AI_REQUEST_INTERRUPTED', 'UNSAFE_ENDPOINT', 'PROVIDER_TIMEOUT', 'PROVIDER_UNAUTHORIZED', 'PROVIDER_RATE_LIMITED'])('maps %s to static actionable text, ignoring raw bodies', code => {
    const message = aiRequestError(500, { code, error: 'PRIVATE_SECRET and stack trace', apiKey: 'PRIVATE_SECRET' });
    expect(message).not.toContain('PRIVATE_SECRET'); expect(message.length).toBeGreaterThan(25);
  });
  it('does not expose unknown provider bodies or perform a paid automatic retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'UNKNOWN', error: 'PRIVATE_SECRET' }), { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(aiJson('/api/purchase-documents/1/ai-extraction', { method: 'POST' })).rejects.not.toThrow('PRIVATE_SECRET');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', cache: 'no-store', credentials: 'same-origin' });
  });
  it('does not claim an interrupted response was a failed booking or retry automatically', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('sensitive provider error'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(aiJson('/api/purchase-documents/1/ai-extraction')).rejects.toThrow('Gespeicherten Status prüfen');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
