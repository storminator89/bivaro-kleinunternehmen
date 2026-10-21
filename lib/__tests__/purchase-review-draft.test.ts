import { describe, expect, it } from 'vitest';
import { EMPTY_REVIEW_DRAFT, parsePurchaseReviewDraft } from '@/lib/purchase-documents/review-draft';

describe('unposted review draft normalization', () => {
  it('allows explicitly saved incomplete work without inventing dates, money or payment evidence', () => {
    expect(parsePurchaseReviewDraft(EMPTY_REVIEW_DRAFT)).toEqual(EMPTY_REVIEW_DRAFT);
    expect(parsePurchaseReviewDraft({ ...EMPTY_REVIEW_DRAFT, supplierName: '  Supplier  ', amount: '0000,29', note: 'Line one\nLine two' })).toEqual({ ...EMPTY_REVIEW_DRAFT, supplierName: 'Supplier', amount: '0.29', note: 'Line one\nLine two' });
    expect(parsePurchaseReviewDraft({ ...EMPTY_REVIEW_DRAFT, amount: '90071992547409.91' }).amount).toBe('90071992547409.91');
  });
  it.each(['1.001', '1e3', '-1', '0', 'NaN', 'Infinity', '90071992547409.92', '1.234,56', '1,234.56'])('rejects unsupported exact draft amount %s', amount => {
    expect(() => parsePurchaseReviewDraft({ ...EMPTY_REVIEW_DRAFT, amount })).toThrow();
  });
  it.each(['2026-02-30', '2026-02-29', '0000-01-01', '2026-1-01', '2026-10-21T00:00:00Z', 'today'])('does not infer or roll over invalid payment date %s', paymentDate => {
    expect(() => parsePurchaseReviewDraft({ ...EMPTY_REVIEW_DRAFT, paymentDate })).toThrow();
  });
  it('accepts a real leap day and bounded text, never unknown/financial/ownership fields', () => {
    expect(parsePurchaseReviewDraft({ ...EMPTY_REVIEW_DRAFT, invoiceDate: '2024-02-29' }).invoiceDate).toBe('2024-02-29');
    for (const field of ['confirmPaymentDate', 'confirmReviewedOriginal', 'expenseId', 'userId', 'reviewStatus', '__proto__', 'constructor']) {
      const data = JSON.parse(JSON.stringify(EMPTY_REVIEW_DRAFT));
      Object.defineProperty(data, field, { value: true, enumerable: true });
      expect(() => parsePurchaseReviewDraft(data)).toThrow(/nicht unterstützte/);
    }
    expect(() => parsePurchaseReviewDraft({ ...EMPTY_REVIEW_DRAFT, supplierName: 'x'.repeat(1001) })).toThrow();
    expect(() => parsePurchaseReviewDraft({ ...EMPTY_REVIEW_DRAFT, note: '\u0000' })).toThrow();
    expect(() => parsePurchaseReviewDraft({ ...EMPTY_REVIEW_DRAFT, note: null })).toThrow();
  });
});
