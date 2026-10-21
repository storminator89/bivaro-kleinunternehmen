import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { hasServiceBillingDraftMarker, isUnrenderedServiceBillingDraft, readServiceBillingDraftSeed } from '@/lib/service-billing';

function nativeDraft() {
  return {
    id: 1, userId: 'synthetic-owner', customerId: 1, type: 'INVOICE', status: 'DRAFT', issuanceState: 'UNISSUED',
    fileName: 'Serviceentwurf synthetic', storedFileName: '', invoiceNumber: null, invoiceDate: null, dueDate: null, paidAt: null,
    validUntil: null, originalInvoiceId: null, convertedFromQuoteId: null, cancellationReason: null, quoteFollowUpOn: null, quoteResponseNote: null,
    totalAmount: 119, parsedData: {
      _serviceBillingDraft: { version: 1, planStableKey: 'b7724bdc-df02-4995-911a-5c9f57ed2a22', periodIndex: 0, periodStart: '2026-01-31', periodEnd: '2026-02-27', taxMode: 'standard',
        items: [{ description: 'Support', quantity: 1, unitPrice: 100, unit: 'Pauschale', taxRate: 19 }], customerAddress: 'Synthetic customer', notes: 'Private planning only' },
      currency: 'EUR', documentType: 'INVOICE', netAmount: 100, taxAmount: 19, grossAmount: 119, totalAmount: 119,
      lineItems: [{ description: 'Support', quantity: 1, unitPrice: 100, unit: 'Pauschale', taxRate: 19, positionNumber: '1', amount: 100 }],
    },
  };
}

describe('canonical no-file service planning shape', () => {
  it('accepts the exact current native Invoice scalar set, including legitimate nullable quote fields', () => {
    const draft = { ...nativeDraft(), uploadedAt: new Date('2026-10-21T10:00:00.000Z') };
    const invoiceModel = Prisma.dmmf.datamodel.models.find(model => model.name === 'Invoice')!;
    const scalarFields = invoiceModel.fields.filter(field => field.kind !== 'object').map(field => field.name).sort();
    expect(Object.keys(draft).sort()).toEqual(scalarFields);
    expect(isUnrenderedServiceBillingDraft(draft)).toBe(true);
    expect(isUnrenderedServiceBillingDraft({ ...draft, futureSourceEvidence: null })).toBe(false);
  });
  it('recognizes only the native canonical data, independently of JSON key order', () => {
    const draft = nativeDraft();
    expect(isUnrenderedServiceBillingDraft(draft)).toBe(true);
    const reorder = (value: unknown): unknown => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)])) : value;
    expect(isUnrenderedServiceBillingDraft({ ...draft, parsedData: reorder(draft.parsedData) })).toBe(true);
  });
  it.each([
    ['rawXml', '<Invoice><ID>ISSUED-ORIGINAL</ID><IssueDate>2026-10-21</IssueDate></Invoice>'],
    ['invoiceNumber', 'ISSUED-ORIGINAL'], ['invoiceDate', '2026-10-21'], ['dueDate', '2026-11-21'],
    ['_uploadRequest', { id: 'original-upload' }], ['_quoteConversion', { id: 2 }], ['extractionStatus', 'PARSED'],
  ])('rejects contradictory parsedData.%s instead of treating it as a new unissued planning seed', (field, value) => {
    const draft = nativeDraft(); Object.assign(draft.parsedData, { [field]: value });
    expect(readServiceBillingDraftSeed(draft.parsedData)).toBeNull();
    expect(isUnrenderedServiceBillingDraft(draft)).toBe(false);
  });
  it('recognizes legacy JSON-string markers only for fail-closed guards, never as canonical no-file seeds', () => {
    const draft = nativeDraft(); const parsedData = JSON.stringify(draft.parsedData);
    expect(hasServiceBillingDraftMarker(parsedData)).toBe(true);
    expect(hasServiceBillingDraftMarker(JSON.stringify({ _serviceBillingDraft: null }))).toBe(true);
    expect(hasServiceBillingDraftMarker('{\"_serviceBillingDraft\":')).toBe(false);
    expect(hasServiceBillingDraftMarker(JSON.stringify({ description: '_serviceBillingDraft' }))).toBe(false);
    expect(readServiceBillingDraftSeed(parsedData)).toBeNull();
    expect(isUnrenderedServiceBillingDraft({ ...draft, parsedData })).toBe(false);
  });
  it('rejects extra marker and item evidence rather than silently canonicalizing it away', () => {
    const marker = nativeDraft(); Object.assign(marker.parsedData._serviceBillingDraft, { autoIssue: true });
    expect(readServiceBillingDraftSeed(marker.parsedData)).toBeNull();
    expect(isUnrenderedServiceBillingDraft(marker)).toBe(false);
    const item = nativeDraft(); Object.assign(item.parsedData._serviceBillingDraft.items[0], { rawXml: 'source evidence' });
    expect(readServiceBillingDraftSeed(item.parsedData)).toBeNull();
    expect(isUnrenderedServiceBillingDraft(item)).toBe(false);
  });
  it.each([
    ['originalInvoiceId', 2], ['convertedFromQuoteId', 2], ['cancellationReason', 'Previously cancelled'], ['validUntil', '2026-11-21'],
    ['quoteFollowUpOn', '2026-11-21'], ['quoteResponseNote', 'Original quote response'],
    ['originalInvoice', { id: 2 }], ['convertedFromQuote', { id: 2 }], ['convertedInvoice', { id: 2 }],
    ['creditNotes', [{ id: 2 }]], ['reminders', [{ id: 2 }]], ['billingNotes', [{ id: 2 }]],
    ['incomes', [{ id: 2 }]], ['paymentJournalEvents', [{ id: 2 }]],
    ['rawXml', '<Invoice/>'], ['_uploadRequest', { id: 'original-upload' }], ['issuedAt', '2026-10-21'],
    ['customer', { id: 2, userId: 'synthetic-owner' }], ['customer', { id: 1, userId: 'other-owner' }],
  ])('rejects available nonplanning row evidence %s', (field, value) => {
    expect(isUnrenderedServiceBillingDraft({ ...nativeDraft(), [field]: value })).toBe(false);
  });
  it('checks owner, invoice, period and plan relations whenever they are available', () => {
    const draft = nativeDraft();
    const receipt = { id: 'receipt', userId: draft.userId, invoiceId: draft.id, planId: 'plan', action: 'GENERATED', periodIndex: 0, periodStart: '2026-01-31', periodEnd: '2026-02-27',
      plan: { id: 'plan', userId: draft.userId, stableKey: draft.parsedData._serviceBillingDraft.planStableKey } };
    expect(isUnrenderedServiceBillingDraft({ ...draft, serviceBillingPeriod: receipt, creditNotes: [], reminders: [], billingNotes: [], incomes: [], paymentJournalEvents: [] })).toBe(true);
    for (const broken of [{ ...receipt, invoiceId: 2 }, { ...receipt, userId: 'other-owner' }, { ...receipt, periodIndex: 1 }, { ...receipt, periodEnd: '2026-02-28' }, { ...receipt, action: 'SKIPPED' }, { ...receipt, plan: { ...receipt.plan, userId: 'other-owner' } }, { ...receipt, plan: { ...receipt.plan, stableKey: 'other-plan' } }]) {
      expect(isUnrenderedServiceBillingDraft({ ...draft, serviceBillingPeriod: broken })).toBe(false);
    }
  });
});
