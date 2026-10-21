import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IncomingReviewDraft, IncomingSavedDraft } from '@/components/purchases/incoming-review-draft';
import { SourcePreview } from '@/components/purchases/incoming-document-review';
import { IncomingDocumentRow } from '@/components/purchases/incoming-documents-workspace';
import type { IncomingDocument } from '@/lib/purchase-documents/types';
import { documentIdFromQuery, errorMessage, formatSourceAmount, formatSourceDate, incomingJson, incomingResponseError, isReviewMutationBlocked, reviewLabel, validateIncomingFile } from '@/components/purchases/incoming-document-ui';

function party(name: string) { return { name, email: null, address: null, addressLines: [], zipCode: null, city: null, country: null }; }
function document(overrides: Partial<IncomingDocument> = {}): IncomingDocument {
  return {
    id: 12, direction: 'INCOMING', reviewState: 'REVIEW', reviewStatus: 'REVIEW', parseStatus: 'PARSED', validationStatus: 'NOT_VALIDATED', revision: 2,
    originalRef: { id: 12, fileName: 'eingang.xml', sha256: 'a'.repeat(64), bytes: 100, mediaType: 'application/xml', uploadedAt: '2026-10-20T12:00:00.000Z', downloadUrl: '/api/purchase-documents/12/original' },
    supplierId: null, selectedSupplierSnapshot: null, supplierName: 'Lieferfirma', invoiceNumber: 'RE-42', invoiceDate: '2026-10-01T00:00:00.000Z', currency: 'EUR', totalAmount: '123.45',
    supplierCandidate: party('Lieferfirma'), buyerCandidate: party('Mein Betrieb'), parserWarnings: [{ code: 'NOT_VALIDATED', message: 'Keine Konformitätsprüfung.' }],
    parserVersion: 'preview-v1', parseErrorCode: null, preview: { extractionStatus: 'PARSED', validationStatus: 'NOT_VALIDATED', format: 'UBL', documentType: 'INVOICE', documentTypeCode: '380', currency: 'EUR', invoiceNumber: 'RE-42', invoiceDate: '2026-10-01T00:00:00.000Z', dueDate: null, grossAmount: '123.45', dueAmount: '100', prepaidAmount: '23.45', roundingAmount: null, netAmount: '100', taxAmount: '23.45', sellerInfo: party('Lieferfirma'), buyerInfo: party('Mein Betrieb'), lineItems: [], parserWarnings: [], approvalSupported: false },
    businessDuplicates: [], linkedExpenseId: null, dismissedAt: null, dismissalReason: null, approvalSupported: false, ...overrides,
  };
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('incoming source presentation', () => {
  it('preserves exact decimals and currency without a float or FX conversion', () => {
    expect(formatSourceAmount('9007199254740993.12', 'EUR')).toBe('9.007.199.254.740.993,12 EUR');
    expect(formatSourceAmount('-12.3456', 'USD')).toBe('-12,3456 USD');
    expect(formatSourceAmount('1', 'JPY')).toBe('1,00 JPY');
    expect(formatSourceAmount('123.45', null)).toBe('123,45 Währung unbekannt');
  });
  it.each(['NaN', 'Infinity', '1e3', '<script>', '12,23', '', '9'.repeat(31)])('does not present unsafe amount %s as money', amount => {
    expect(formatSourceAmount(amount, 'EUR')).toBe('Nicht sicher darstellbar');
  });
  it('does not invent a missing amount or invoice date from upload time', () => {
    expect(formatSourceAmount(null, 'EUR')).toBe('Nicht ausgelesen');
    expect(formatSourceDate(null)).toBe('Nicht ausgelesen');
    expect(formatSourceDate('not a date')).toBe('Nicht ausgelesen');
    expect(formatSourceDate('2026-02-30')).toBe('Nicht ausgelesen');
    expect(formatSourceDate('2026-10-01T00:00:00.000Z')).toBe('1.10.2026');
  });
  it('labels photo draft fields and historical work as unposted, never as original extraction or payment attestations', () => {
    const doc = document({ reviewDraft: { supplierName: '<script>draft</script>', invoiceNumber: 'PHOTO-17', invoiceDate: '2026-10-20', paymentDate: '2026-10-21', amount: '0.29', note: 'Draft, not a payment' }, reviewDraftSavedAt: '2026-10-21T10:00:00.000Z' });
    doc.originalRef = { ...doc.originalRef, mediaType: 'image/png' };
    const html = renderToStaticMarkup(createElement(IncomingReviewDraft, { document: doc, onSaved: vi.fn(), onDirtyChange: vi.fn(), onBusyChange: vi.fn() }));
    expect(html).toContain('Prüfentwurf · nicht gebucht'); expect(html).toContain('Erst die abschließende Bestätigung bucht die Ausgabe'); expect(html).toContain('keine automatische Speicherung');
    expect(html).not.toContain('type="checkbox"'); expect(html).not.toContain('<script>draft</script>'); expect(html).toContain('&lt;script&gt;draft&lt;/script&gt;');
    const historical = renderToStaticMarkup(createElement(IncomingSavedDraft, { document: { ...doc, reviewState: 'DISMISSED' } }));
    expect(historical).toContain('keine Buchungsbestätigung'); expect(historical).not.toContain('<input'); expect(historical).toContain('0.29');
    const row = renderToStaticMarkup(createElement(IncomingDocumentRow, { document: { ...doc, supplierName: null, invoiceNumber: null, invoiceDate: null }, onOpen: vi.fn() }));
    expect(row).toContain('Entwurf:'); expect(row).toContain('Prüfentwurf gespeichert'); expect(row).toContain('Entwurfsdatum');
    const source = renderToStaticMarkup(createElement(SourcePreview, { document: { ...doc, preview: null, parseStatus: 'FAILED', approvalSupported: false }, onOpen: vi.fn() }));
    expect(source).toContain('Original und Zahlung bestätigen'); expect(source).not.toContain('korrektes PDF');
  });
  it('locks draft edits/save while dismissal is open and blocks interrupted dirty/in-flight review mutations', () => {
    const clean = { busy: false, draftDirty: false, draftBusy: false, hasPending: false };
    expect(isReviewMutationBlocked(clean)).toBe(false);
    for (const key of ['busy', 'draftDirty', 'draftBusy', 'hasPending'] as const) expect(isReviewMutationBlocked({ ...clean, [key]: true })).toBe(true);
    // Opening confirmation from clean state cannot make a later dirty/save event safe to discard.
    expect(isReviewMutationBlocked({ ...clean, draftDirty: true })).toBe(true);
    expect(isReviewMutationBlocked({ ...clean, draftDirty: true, draftBusy: true })).toBe(true);
    expect(isReviewMutationBlocked({ ...clean, draftBusy: true })).toBe(true);
    expect(isReviewMutationBlocked(clean)).toBe(false); // only after an acknowledged save / deliberate cancellation
    const props = { document: document(), onSaved: vi.fn(), onDirtyChange: vi.fn(), onBusyChange: vi.fn() };
    const locked = renderToStaticMarkup(createElement(IncomingReviewDraft, { ...props, locked: true }));
    expect(locked).toContain('Entwurf vorübergehend gesperrt'); expect(locked).toContain('Beim Verwerfen wird kein Prüfentwurf still gespeichert');
    expect(locked.match(/<input[^>]*disabled=""/g)).toHaveLength(5);
    expect(locked).toMatch(/<textarea[^>]*disabled=""/);
    expect(locked).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Prüfentwurf speichern/);
    const unlocked = renderToStaticMarkup(createElement(IncomingReviewDraft, { ...props, locked: false }));
    expect(unlocked).not.toContain('disabled=""'); expect(unlocked).not.toContain('Entwurf vorübergehend gesperrt');
  });
  it('keeps supplier and buyer in distinct labelled source sections', () => {
    const html = renderToStaticMarkup(createElement(SourcePreview, { document: document(), onOpen: vi.fn() }));
    expect(html).toMatch(/aria-label="Lieferant \/ Verkäufer"[\s\S]*?Lieferfirma/);
    expect(html).toMatch(/aria-label="Empfänger \/ Käufer"[\s\S]*?Mein Betrieb/);
    expect(html).toContain('Ausgelesene Angaben am Original prüfen');
    expect(html).toContain('Bruttobetrag laut Original · ungeprüft');
    expect(html).toContain('Restbetrag laut Original');
    expect(html).toContain('100,00 EUR');
    expect(html).toContain('Nicht validiert');
  });
  it('retains unsupported credit notes and foreign currency visibly, without booking claims or action', () => {
    const doc = document({ currency: 'USD', approvalSupported: false });
    doc.preview = { ...doc.preview!, currency: 'USD', documentType: 'CREDIT_NOTE' };
    const html = renderToStaticMarkup(createElement(SourcePreview, { document: doc, onOpen: vi.fn() }));
    expect(html).toContain('Gutschrift'); expect(html).toContain('123,45 USD');
    expect(html).toContain('Zu prüfen · nicht gebucht');
    expect(html).toContain('Gutschriften und andere Dokumenttypen werden hier nicht gebucht');
    expect(html).not.toContain('Als Ausgabe erfassen');
    expect(html).not.toContain('€');
  });
  it('does not equate parsed, pending or dismissed with a booking', () => {
    expect(reviewLabel(document())).toBe('Zu prüfen · nicht gebucht');
    expect(reviewLabel(document({ reviewState: 'DISMISSED' }))).toBe('Verworfen · nicht gebucht');
    expect(reviewLabel(document({ reviewState: 'BOOKED' }))).toBe('Verknüpfung prüfen');
    expect(reviewLabel(document({ reviewState: 'BOOKED', linkedExpenseId: 7 }))).toBe('Als Ausgabe erfasst');
  });
  it('explains plain PDF extraction failure while preserving the original', () => {
    const html = renderToStaticMarkup(createElement(SourcePreview, { document: document({ parseStatus: 'FAILED', parseErrorCode: 'NO_EMBEDDED_XML', preview: null, totalAmount: null }), onOpen: vi.fn() }));
    expect(html).toContain('Original erhalten');
    expect(html).toContain('manuell prüfen oder KI nutzen');
    expect(html).not.toContain('Kein OCR');
    expect(html).not.toContain('0,00');
  });
  it('escapes source-derived text and provides a labelled review row', () => {
    const html = renderToStaticMarkup(createElement(IncomingDocumentRow, { document: document({ supplierName: '<script>alert(1)</script>' }), onOpen: vi.fn() }));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('eingang.xml'); expect(html).toContain('Prüfen');
    expect(html).toContain('Zu prüfen · nicht gebucht');
  });
  it('treats business matches as hints and links to the separate existing original', () => {
    const doc = document({ businessDuplicates: [{ id: 9, supplierName: 'Lieferfirma', invoiceNumber: 'RE-42', invoiceDate: null, currency: 'EUR', totalAmount: '123.45', reviewState: 'REVIEW', revision: 1, linkedExpenseId: null }] });
    const html = renderToStaticMarkup(createElement(SourcePreview, { document: doc, onOpen: vi.fn() }));
    expect(html).toContain('mögliche Dublette'); expect(html).toContain('Beleg #9');
  });
});

describe('incoming upload and request guards', () => {
  it('accepts only bounded single PDF/XML candidates before server content inspection', () => {
    expect(validateIncomingFile({ name: 'invoice.PDF', size: 25 * 1024 * 1024 })).toBeNull();
    expect(validateIncomingFile({ name: 'invoice.xml', size: 8 * 1024 * 1024 })).toBeNull();
    expect(validateIncomingFile({ name: 'invoice.pdf', size: 25 * 1024 * 1024 + 1 })).toContain('25 MB');
    expect(validateIncomingFile({ name: 'invoice.xml', size: 8 * 1024 * 1024 + 1 })).toContain('8 MB');
    expect(validateIncomingFile({ name: 'invoice.png', size: 20 })).toBeNull();
    expect(validateIncomingFile({ name: 'invoice.jpg', size: 10 * 1024 * 1024 })).toBeNull();
    expect(validateIncomingFile({ name: 'invoice.jpeg', size: 10 * 1024 * 1024 + 1 })).toContain('10 MB');
    expect(validateIncomingFile({ name: 'invoice.heic', size: 20 })).toContain('nicht unterstützt');
    expect(validateIncomingFile({ name: 'invoice.pdf', size: 0 })).toContain('leer');
  });
  it.each(['0', '-1', '1.2', '1e2', 'Infinity', '9007199254740992', '../../9', null])('rejects unsafe deep-link ID %s', value => {
    expect(documentIdFromQuery(value)).toBeNull();
  });
  it('only offers an existing document for an exact 409 duplicate with a safe ID', () => {
    expect(incomingResponseError(409, { code: 'EXACT_FILE_DUPLICATE', existingDocumentId: 2 }).existingDocumentId).toBe(2);
    expect(incomingResponseError(409, { code: 'OTHER', existingDocumentId: 2 }).existingDocumentId).toBeNull();
    expect(incomingResponseError(409, { code: 'EXACT_FILE_DUPLICATE', existingDocumentId: -2 }).existingDocumentId).toBeNull();
    expect(incomingResponseError(500, { code: 'EXACT_FILE_DUPLICATE', existingDocumentId: 2 }).existingDocumentId).toBeNull();
  });
  it('does not reveal raw exception or parser response text', () => {
    const error = incomingResponseError(500, { error: '/private/path/secret.xml <xml>' });
    expect(errorMessage(error)).not.toContain('/private');
    expect(errorMessage(new Error('secret'))).not.toContain('secret');
    expect(incomingResponseError(409, { code: 'ORIGINAL_INTEGRITY' }).message).toContain('Integrität');
    expect(incomingResponseError(401, {}).message).toContain('erneut anmelden');
  });
  it('does not cache tenant preview requests and turns non-JSON errors into a recoverable message', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 503, json: () => Promise.reject(new Error('HTML')) });
    vi.stubGlobal('fetch', fetcher);
    await expect(incomingJson('/api/purchase-documents')).rejects.toThrow('erneut versuchen');
    expect(fetcher).toHaveBeenCalledWith('/api/purchase-documents', expect.objectContaining({ cache: 'no-store', credentials: 'same-origin' }));
  });
  it('keeps intake and source review separate from direct financial mutations and exposes a protected workspace', () => {
    const workspace = readFileSync('components/purchases/incoming-documents-workspace.tsx', 'utf8');
    const review = readFileSync('components/purchases/incoming-document-review.tsx', 'utf8');
    const upload = readFileSync('components/purchases/incoming-upload.tsx', 'utf8');
    const shell = readFileSync('components/app-shell.tsx', 'utf8');
    for (const source of [workspace, review, upload]) {
      expect(source).not.toMatch(/\/api\/(?:invoices|expenses|incomes|customers|cashbook)/);
      expect(source).not.toContain('approve-expense');
    }
    const uploadTransport = readFileSync('components/purchases/incoming-upload-queue.ts', 'utf8');
    expect(uploadTransport).not.toContain('/api/expenses'); expect(uploadTransport).not.toContain('approve-expense');
    expect(uploadTransport).toContain("form.append('uploadRequestId'");
    expect(uploadTransport).toContain('xhr.upload.onprogress'); expect(uploadTransport).toContain('xhr.abort()');
    expect(review).toContain('expectedRevision: document.revision');
    expect(review).toContain('onOpenAutoFocus'); expect(review).toContain('onCloseAutoFocus');
    expect(shell.match(/const publicPaths = ([^;]+)/)?.[1]).not.toContain('/purchases');
    expect(readFileSync('components/navigation/nav-links.tsx', 'utf8')).toContain('href: "/purchases", label: "Belegeingang"');
  });
});
