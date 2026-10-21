import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PurchaseExpenseApproval, ApprovalSummary } from '@/components/purchases/purchase-expense-approval';
import { ExpenseRecord } from '@/components/purchases/expense-detail';
import { SupplierContactPanel } from '@/components/purchases/supplier-contact-panel';
import { approvalAmount, approvalBlockedReason, approvalIdentityKey, approvalIdentityPrefix, hasApprovalIdentity, storedApprovalId, validBusinessShare, validPaymentDate } from '@/components/purchases/purchase-expense-ui';
import type { IncomingDocument, PurchaseExpenseApprovalInput } from '@/lib/purchase-documents/types';

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'tenant-test' } } }) }));

const supplier = { id: 3, revision: 1, name: 'Lieferfirma', address: 'Lieferstraße 2', postalCode: '12345', city: 'Berlin', country: 'DE', email: null, phone: null, taxId: null, vatId: null };
function document(overrides: Partial<IncomingDocument> = {}): IncomingDocument {
  return { id: 12, direction: 'INCOMING', reviewState: 'REVIEW', reviewStatus: 'REVIEW', parseStatus: 'PARSED', validationStatus: 'NOT_VALIDATED', revision: 2,
    originalRef: { id: 12, fileName: 'original.xml', sha256: 'a'.repeat(64), bytes: 300, mediaType: 'application/xml', uploadedAt: '2026-10-20T12:00:00.000Z', downloadUrl: '/api/purchase-documents/12/original' },
    supplierName: 'Originalverkäufer', invoiceNumber: 'R-42', invoiceDate: '2026-10-01T00:00:00.000Z', currency: 'EUR', totalAmount: '123.45', supplierId: 3, selectedSupplierSnapshot: supplier,
    supplierCandidate: null, buyerCandidate: null, parserWarnings: [], parserVersion: 'v1', parseErrorCode: null,
    preview: { extractionStatus: 'PARSED', validationStatus: 'NOT_VALIDATED', format: 'UBL', documentType: 'INVOICE', documentTypeCode: '380', currency: 'EUR', invoiceNumber: 'R-42', invoiceDate: '2026-10-01', dueDate: null, grossAmount: '123.45', dueAmount: '123.45', prepaidAmount: null, roundingAmount: null, netAmount: null, taxAmount: null, sellerInfo: { name: 'Originalverkäufer', email: null, address: null, addressLines: [], zipCode: null, city: null, country: null }, buyerInfo: { name: 'Käuferbetrieb', email: null, address: null, addressLines: [], zipCode: null, city: null, country: null }, lineItems: [], parserWarnings: [], approvalSupported: true },
    businessDuplicates: [], linkedExpenseId: null, dismissedAt: null, dismissalReason: null, approvalSupported: true, ...overrides };
}
const input: PurchaseExpenseApprovalInput = { approvalRequestId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', expectedRevision: 2, description: 'Bewusst bestätigt', amount: '123.45', expenseDate: '2026-10-19', category: 'Bürobedarf', taxRelevant: false, taxDeductiblePercentage: '37.5', depreciationYears: null, confirmPaymentDate: true, confirmReviewedOriginal: true, confirmBuyerBelongsToBusiness: true, acknowledgedDuplicates: [{ id: 8, revision: 3 }] };

describe('deliberate purchase expense input', () => {
  it('starts payment date, tax choice, category and business share empty, never inferred from invoice or today', () => {
    const html = renderToStaticMarkup(createElement(PurchaseExpenseApproval, { document: document(), onApproved: vi.fn(), onBack: vi.fn(), onReload: vi.fn(), onOpenDuplicate: vi.fn(), onBusyChange: vi.fn(), onPendingChange: vi.fn() }));
    for (const id of ['purchase-expense-date', 'purchase-expense-category', 'purchase-expense-share']) expect(html).toMatch(new RegExp(`id="${id}"[^>]*value=""`));
    expect(html).toContain('<option value="" selected="">Bitte ausdrücklich wählen</option>');
    expect(html).toContain('keine Bestätigung der rechtlichen Abziehbarkeit'); expect(html).toContain('Noch nicht bezahlt?');
    expect(html).not.toContain('value="100"');
  });
  it('shows the actual confirmed payment date and share in the final summary', () => {
    const html = renderToStaticMarkup(createElement(ApprovalSummary, { input }));
    expect(html).toContain('19.10.2026'); expect(html).toContain('37.5 %'); expect(html).toContain('Nein, ausdrücklich gewählt'); expect(html).toContain('123,45 EUR');
    expect(html).not.toContain('1.10.2026');
  });
  it.each(['', '0000-01-01', '2026-02-30', '2026-10-19T00:00:00Z', '19.10.2026', '2026-13-01'])('rejects inferred or invalid payment date %s', value => expect(validPaymentDate(value)).toBe(false));
  it.each(['2026-10-19', '2024-02-29'])('accepts real calendar date %s', value => expect(validPaymentDate(value)).toBe(true));
  it.each(['', '-1', '100.01', '1e2', 'NaN', '12.345'])('requires an explicit valid 0–100 business share, rejects %s', value => expect(validBusinessShare(value)).toBe(false));
  it.each(['0', '100', '12,5', '37.50'])('allows deliberate share %s without assuming legal eligibility', value => expect(validBusinessShare(value)).toBe(true));
  it('requires structured supported EUR invoice and explicit selected contact', () => {
    expect(approvalBlockedReason(document())).toBeNull();
    expect(approvalBlockedReason(document({ supplierId: null, selectedSupplierSnapshot: null }))).toContain('ausdrücklich auswählen');
    expect(approvalBlockedReason(document({ currency: 'USD' }))).toContain('Nur EUR');
    expect(approvalBlockedReason(document({ approvalSupported: false }))).toContain('Teilzahlungen');
    expect(approvalBlockedReason(document({ parseStatus: 'FAILED' }))).toContain('strukturierte Rechnungsdaten');
    expect(approvalBlockedReason(document({ reviewState: 'DISMISSED' }))).toContain('wieder öffnen');
    const credit = document(); credit.preview = { ...credit.preview!, documentType: 'CREDIT_NOTE' };
    expect(approvalBlockedReason(credit)).toContain('Gutschriften');
  });
  it('persists only an opaque UUID keyed by tenant, document and SHA-256 of exact deliberate payload', async () => {
    const { approvalRequestId, ...payload } = input;
    const key = await approvalIdentityKey('tenant-a', 12, payload);
    expect(key).toMatch(/^bivaro-purchase-approval:tenant-a:12:[0-9a-f]{64}$/);
    expect(key).not.toContain(input.description); expect(key).not.toContain(input.expenseDate); expect(key).not.toContain(input.category);
    expect(await approvalIdentityKey('tenant-a', 12, { ...payload })).toBe(key);
    expect(await approvalIdentityKey('tenant-b', 12, payload)).not.toBe(key);
    expect(await approvalIdentityKey('tenant-a', 13, payload)).not.toBe(key);
    expect(await approvalIdentityKey('tenant-a', 12, { ...payload, expenseDate: '2026-10-18' })).not.toBe(key);
    expect(approvalIdentityPrefix('tenant-a', 12)).toBe('bivaro-purchase-approval:tenant-a:12:');
    expect(storedApprovalId(approvalRequestId)).toBe(approvalRequestId);
    expect(storedApprovalId('broken')).toBeNull(); expect(storedApprovalId(null)).toBeNull();
    const values = new Map([[key, approvalRequestId]]);
    const storage = { get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null, getItem: (name: string) => values.get(name) ?? null } as Storage;
    expect(hasApprovalIdentity(storage, 'tenant-a', 12)).toBe(true);
    expect(hasApprovalIdentity(storage, 'tenant-b', 12)).toBe(false);
  });
  it('normalizes only exact cents without rounding original amount or using floating point', () => {
    expect(approvalAmount('123.4500')).toBe('123.45'); expect(approvalAmount('123.456')).toBe(''); expect(approvalAmount(null)).toBe('');
  });
  it('persists before sending and confines booking to the approval route, never generic financial endpoints', () => {
    const source = readFileSync('components/purchases/purchase-expense-approval.tsx', 'utf8');
    expect(source.indexOf('sessionStorage.setItem')).toBeLessThan(source.indexOf('await incomingJson'));
    expect(source).toContain('storedApprovalId(sessionStorage.getItem(key)) ?? crypto.randomUUID()');
    expect(source).toContain('sessionStorage.setItem(key, request.approvalRequestId)');
    expect(source).not.toContain('setItem(key, JSON.stringify');
    expect(source).toContain('lock.current'); expect(source).toContain('onPendingChange(true)');
    expect(source).not.toMatch(/\/api\/(?:expenses|incomes|invoices|customers|cashbook)/);
    expect(source).toContain('acknowledgedDuplicates: document.businessDuplicates');
    expect(source).toContain('confirmationsValid');
  });
});
describe('contact and actual saved expense presentation', () => {
  it('offers only explicit contact creation and selection with no automatic identity match or deletion action', () => {
    const html = renderToStaticMarkup(createElement(SupplierContactPanel, { document: document(), onSelected: vi.fn(), onBack: vi.fn() }));
    expect(html).toContain('keinen automatischen Abgleich'); expect(html).toContain('Kontakt neu anlegen');
    expect(html).not.toContain('Löschen');
    const source = readFileSync('components/purchases/supplier-contact-panel.tsx', 'utf8');
    expect(source).toContain('expectedRevision: document.revision');
    expect(source).toContain('Zum Beleg wird er erst');
    expect(source).not.toContain("method: 'DELETE'");
  });
  it('renders actual persisted date/amount/category and linked original, not source invoice-date as payment date', () => {
    const html = renderToStaticMarkup(createElement(ExpenseRecord, { data: { expense: { id: 77, description: '<script>saved</script>', amount: 123.45, date: '2026-10-19T00:00:00.000Z', category: 'Bürobedarf', taxRelevant: false, taxDeductiblePercentage: 37.5, depreciationYears: null, receiptFileName: 'original.xml' }, source: { id: 12, originalFileName: 'original.xml', originalSha256: 'a'.repeat(64), mediaType: 'application/xml', originalUrl: '/api/purchase-documents/12/original', supplierId: 3, selectedSupplierSnapshot: supplier, invoiceNumber: 'R-42', invoiceDate: '2026-10-01', approvedAt: '2026-10-20T12:00:00.000Z' } } }));
    expect(html).toContain('Gespeicherte Ausgabe #77'); expect(html).toContain('19.10.2026'); expect(html).toContain('1.10.2026'); expect(html).toContain('37,5 %'); expect(html).toContain('Bürobedarf');
    expect(html).toContain('href="/api/purchase-documents/12/original"'); expect(html).toContain('href="/purchases?document=12"');
    expect(html).not.toContain('<script>'); expect(html).toContain('&lt;script&gt;');
  });
});
