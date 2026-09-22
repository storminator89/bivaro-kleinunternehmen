import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestDatabase } from './helpers/database';
import {
  extractPriceHistoryEntries,
  filterPriceHistoryEntries,
  isPriceHistoryInvoiceFromTenant,
  type PriceHistoryInvoice,
} from '@/lib/price-history';
import { parseEInvoiceXml } from '@/lib/e-invoice-parser';
import { generateZugferdXml, SMALL_BUSINESS_EXEMPTION_REASON, type ZugferdData } from '@/lib/zugferd-generator';

const state = vi.hoisted(() => ({ client: null as PrismaClient | null, userId: 'price-owner' }));

it('rejects contradictory seller identifiers even when company names match', () => {
  const tenant = { companyName: 'My Company', email: 'me@example.test', taxNumber: '123' };
  const invoice = (sellerInfo: Record<string, string>) => ({ parsedData: { sellerInfo } });
  expect(isPriceHistoryInvoiceFromTenant(invoice({ name: tenant.companyName }), tenant)).toBe(true);
  expect(isPriceHistoryInvoiceFromTenant(invoice({ name: tenant.companyName, email: 'supplier@example.test' }), tenant)).toBe(false);
  expect(isPriceHistoryInvoiceFromTenant(invoice({ name: tenant.companyName, taxNumber: '456' }), tenant)).toBe(false);
});
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => {
  class TestUnauthorizedError extends Error {
    constructor() { super('Unauthorized'); this.name = 'UnauthorizedError'; }
  }
  return {
    requireUserId: vi.fn(async () => state.userId),
    UnauthorizedError: TestUnauthorizedError,
    unauthorizedResponse: () => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
  };
});

import { GET as getPriceHistory } from '@/app/api/customers/[id]/price-history/route';

function sourceInvoice(overrides: Partial<PriceHistoryInvoice> = {}): PriceHistoryInvoice {
  return {
    id: 10,
    invoiceNumber: 'RE-10',
    invoiceDate: '2026-05-01T00:00:00.000Z',
    uploadedAt: '2026-05-01T00:00:00.000Z',
    parsedData: {
      currency: 'EUR',
      lineItems: [{
        description: ' Beratung   vor Ort ', unit: 'HUR', unitPrice: 100,
        taxRate: 19, taxCategory: 'S', baseQuantity: 1,
      }],
    },
    ...overrides,
  };
}

function generatedData(overrides: Partial<ZugferdData> = {}): ZugferdData {
  return {
    invoiceNumber: 'GENERATED-PRICE',
    date: new Date('2026-01-01'),
    dueDate: new Date('2026-01-15'),
    seller: {
      name: 'Bivaro Testfirma', address: 'Musterstraße 1\n12345 Musterstadt', countryCode: 'DE',
      iban: 'DE89370400440532013000', taxNumber: '123/456/78901',
    },
    buyer: {
      name: 'Kunde GmbH', address: 'Kundenweg 9\n54321 Kundenstadt', countryCode: 'DE',
    },
    items: [{ description: 'Beratung', quantity: 1, unitPrice: 100, total: 100, unit: 'Stunde', taxRate: 0 }],
    netAmount: 100,
    taxAmount: 0,
    currency: 'EUR',
    taxMode: 'small-business',
    ...overrides,
  };
}

describe('price history extraction', () => {
  it('round trips generated CII exemption reasons and keeps different E reasons isolated', async () => {
    const smallBusiness = await parseEInvoiceXml(generateZugferdXml(generatedData()));
    expect(smallBusiness.lineItems[0]).toMatchObject({ taxCategory: 'E', exemptionReason: SMALL_BUSINESS_EXEMPTION_REASON });
    const smallBusinessEntries = extractPriceHistoryEntries([{
      id: 20, invoiceNumber: smallBusiness.invoiceNumber, invoiceDate: smallBusiness.invoiceDate,
      uploadedAt: smallBusiness.invoiceDate || new Date(), parsedData: smallBusiness,
    }]);
    expect(smallBusinessEntries).toHaveLength(1);
    expect(filterPriceHistoryEntries(smallBusinessEntries, {
      description: 'Beratung', unit: 'Stunde', taxRate: 0, taxCategory: 'E', exemptionReason: SMALL_BUSINESS_EXEMPTION_REASON,
    })).toHaveLength(1);

    const reasonA = 'Steuerbefreit nach § 19 UStG A';
    const reasonB = 'Steuerbefreit nach § 19 UStG B';
    const parsedA = await parseEInvoiceXml(generateZugferdXml(generatedData({
      invoiceNumber: 'GENERATED-A',
      taxMode: 'standard',
      items: [{ description: 'Beratung', quantity: 1, unitPrice: 100, total: 100, unit: 'Stunde', taxRate: 0, taxCategory: 'E', exemptionReason: reasonA }],
    })));
    const parsedB = await parseEInvoiceXml(generateZugferdXml(generatedData({
      invoiceNumber: 'GENERATED-B',
      taxMode: 'standard',
      items: [{ description: 'Beratung', quantity: 1, unitPrice: 100, total: 100, unit: 'Stunde', taxRate: 0, taxCategory: 'E', exemptionReason: reasonB }],
    })));
    expect(parsedA.lineItems[0].exemptionReason).toBe(reasonA);
    expect(parsedB.lineItems[0].exemptionReason).toBe(reasonB);
    const entries = extractPriceHistoryEntries([parsedA, parsedB].map((parsed, index) => ({
      id: 30 + index, invoiceNumber: parsed.invoiceNumber, invoiceDate: parsed.invoiceDate,
      uploadedAt: parsed.invoiceDate || new Date(), parsedData: parsed,
    })));
    expect(filterPriceHistoryEntries(entries, { description: 'Beratung', unit: 'Stunde', taxRate: 0, taxCategory: 'E', exemptionReason: reasonA })).toHaveLength(1);
    expect(filterPriceHistoryEntries(entries, { description: 'Beratung', unit: 'Stunde', taxRate: 0, taxCategory: 'E', exemptionReason: reasonB })).toHaveLength(1);
  });

  it('supports parser lineItems and legacy items while normalizing units and dates', () => {
    const entries = extractPriceHistoryEntries([
      sourceInvoice(),
      sourceInvoice({
        id: 11,
        parsedData: {
          currency: 'EUR',
          items: [{ description: 'Beratung vor Ort', unit: 'Stunde', unitPrice: 90, taxRate: 19, taxCategory: 'S' }],
        },
      }),
    ]);

    expect(entries.map(entry => ({ price: entry.unitPrice, unit: entry.unit, description: entry.description }))).toEqual([
      { price: 90, unit: 'Stunde', description: 'Beratung vor Ort' },
      { price: 100, unit: 'Stunde', description: 'Beratung vor Ort' },
    ]);
  });

  it('drops ambiguous, malformed, non-EUR, and non-unit prices', () => {
    const entries = extractPriceHistoryEntries([
      sourceInvoice({ id: 1, parsedData: { currency: 'USD', lineItems: [{ description: 'A', unit: 'Stück', unitPrice: 1, taxRate: 19 }] } }),
      sourceInvoice({ id: 2, parsedData: { currency: 'EUR', lineItems: [
        { description: 'A', unit: 'Stück', unitPrice: Number.NaN, taxRate: 19 },
        { description: 'A', unit: 'Stück', unitPrice: [95], taxRate: 19 },
        { description: 'A', unit: 'Stück', unitPrice: 2, taxRate: 0 },
        { description: 'A', unit: 'Stück', unitPrice: 3, taxRate: 19, baseQuantity: 100 },
      ] } }),
    ]);
    expect(entries).toEqual([]);
  });

  it('requires exact description, unit, rate, category, and exemption treatment', () => {
    const entries = extractPriceHistoryEntries([sourceInvoice({
      parsedData: {
        currency: 'EUR',
        lineItems: [
          { description: 'Service', unit: 'Stück', unitPrice: 10, taxRate: 0, taxCategory: 'E', exemptionReason: '§ 19 UStG' },
          { description: 'Service', unit: 'Stück', unitPrice: 12, taxRate: 0, taxCategory: 'Z' },
          { description: 'Service', unit: 'Stück', unitPrice: 14, taxRate: 19, taxCategory: 'S' },
        ],
      },
    })]);
    expect(filterPriceHistoryEntries(entries, { description: ' service ', unit: 'C62', taxRate: 0, taxCategory: 'E', exemptionReason: '§ 19 UStG' })).toHaveLength(1);
    expect(filterPriceHistoryEntries(entries, { description: 'Service', unit: 'Stück', taxRate: 0, taxCategory: 'Z' })).toHaveLength(1);
    expect(filterPriceHistoryEntries(entries, { description: 'Service', unit: 'Stück', taxRate: 0 })).toHaveLength(0);
    expect(filterPriceHistoryEntries(entries, { description: 'Service', unit: 'Stück', taxRate: 19, taxCategory: 'S' })).toHaveLength(1);
  });
});

describe('customer price history route', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let customerA: { id: number };
  let customerB: { id: number };

  beforeAll(async () => {
    database = createTestDatabase();
    state.client = database.client;
    await database.client.user.createMany({ data: [
      { id: 'price-owner', email: 'price-owner@test.invalid', password: 'unused' },
      { id: 'price-other', email: 'price-other@test.invalid', password: 'unused' },
    ] });
    customerA = await database.client.customer.create({ data: { userId: 'price-owner', name: 'Kunde A' } });
    customerB = await database.client.customer.create({ data: { userId: 'price-other', name: 'Kunde B' } });
    await database.client.settings.create({ data: { userId: 'price-owner', companyName: 'History Seller' } });
    const parsedData = {
      currency: 'EUR',
      sellerInfo: { name: 'History Seller' },
      lineItems: [{ description: 'Beratung', unit: 'HUR', unitPrice: 120, taxRate: 19, taxCategory: 'S' }],
    };
    await database.client.invoice.createMany({ data: [
      { userId: 'price-owner', customerId: customerA.id, type: 'INVOICE', status: 'SENT', issuanceState: 'ISSUED', fileName: 'new.pdf', storedFileName: 'new.pdf', invoiceNumber: 'A-NEW', invoiceDate: new Date('2026-06-01'), parsedData },
      { userId: 'price-owner', customerId: customerA.id, type: 'INVOICE', status: 'CANCELLED', issuanceState: 'ISSUED', fileName: 'cancel.pdf', storedFileName: 'cancel.pdf', invoiceNumber: 'A-CANCEL', invoiceDate: new Date('2026-07-01'), parsedData },
      { userId: 'price-owner', customerId: customerA.id, type: 'INVOICE', status: 'SENT', issuanceState: 'UNKNOWN', fileName: 'import.pdf', storedFileName: 'import.pdf', invoiceNumber: 'A-IMPORT', invoiceDate: new Date('2026-08-01'), parsedData },
      { userId: 'price-owner', customerId: customerA.id, type: 'QUOTE', status: 'SENT', issuanceState: 'ISSUED', fileName: 'quote.pdf', storedFileName: 'quote.pdf', invoiceNumber: 'A-QUOTE', invoiceDate: new Date('2026-09-01'), parsedData },
      { userId: 'price-owner', customerId: customerA.id, type: 'CREDIT_NOTE', status: 'SENT', issuanceState: 'ISSUED', fileName: 'credit.pdf', storedFileName: 'credit.pdf', invoiceNumber: 'A-CREDIT', invoiceDate: new Date('2026-10-01'), parsedData },
      { userId: 'price-other', customerId: customerB.id, type: 'INVOICE', status: 'SENT', issuanceState: 'ISSUED', fileName: 'foreign.pdf', storedFileName: 'foreign.pdf', invoiceNumber: 'B-FOREIGN', invoiceDate: new Date('2026-11-01'), parsedData },
      { userId: 'price-owner', customerId: customerA.id, type: 'INVOICE', status: 'PAID', issuanceState: 'ISSUED', fileName: 'incoming.pdf', storedFileName: 'incoming.pdf', invoiceNumber: 'A-INCOMING', invoiceDate: new Date('2026-12-01'), parsedData: { ...parsedData, sellerInfo: { name: 'External supplier' } } },
      { userId: 'price-owner', customerId: customerA.id, type: 'INVOICE', status: 'PAID', issuanceState: 'ISSUED', fileName: 'unknown.pdf', storedFileName: 'unknown.pdf', invoiceNumber: 'A-UNKNOWN', invoiceDate: new Date('2026-12-02'), parsedData: { ...parsedData, sellerInfo: null } },
      { userId: 'price-owner', customerId: customerA.id, type: 'INVOICE', status: 'DRAFT', issuanceState: 'ISSUED', fileName: 'draft.pdf', storedFileName: 'draft.pdf', invoiceNumber: 'A-DRAFT', invoiceDate: new Date('2026-12-03'), parsedData },
    ] });
  }, 40_000);

  afterAll(async () => { await database?.cleanup(); });

  it('is tenant-safe, excludes non-issued/cancelled document types, and returns sanitized latest entries', async () => {
    const response = await getPriceHistory(new Request(`http://localhost/api/customers/${customerA.id}/price-history`), { params: Promise.resolve({ id: String(customerA.id) }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({ invoiceNumber: 'A-NEW', unit: 'Stunde', unitPrice: 120, currency: 'EUR' });
    expect(JSON.stringify(body)).not.toContain('rawXml');

    const foreignResponse = await getPriceHistory(new Request(`http://localhost/api/customers/${customerB.id}/price-history`), { params: Promise.resolve({ id: String(customerB.id) }) });
    expect(foreignResponse.status).toBe(404);
  });
});
