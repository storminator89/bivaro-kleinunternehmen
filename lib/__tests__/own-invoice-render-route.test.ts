import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  session: { user: { id: 'render-owner', role: 'USER' } } as { user?: { id?: string; role?: string } } | null,
  render: vi.fn(),
  persistence: vi.fn(),
  mutationOptions: undefined as { maxBodyBytes?: number } | undefined,
}));

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => state.session) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
// These tests isolate the handler. CSRF/origin enforcement and bounded streaming
// belong to protectMutation's own tests; the wrapper configuration is checked below.
vi.mock('@/lib/request-security', () => ({
  protectMutation: (handler: (request: Request) => Promise<Response>, options: { maxBodyBytes?: number }) => {
    state.mutationOptions = options;
    return handler;
  },
}));
vi.mock('@/lib/server/own-invoice-renderer', () => ({ renderOwnInvoice: state.render }));
// No native image decoder, PDF engine, subprocess, filesystem or database is
// loaded through the rendering dependency in these ordinary handler unit tests.
vi.mock('@/lib/server/own-invoice-image', () => {
  class OwnInvoiceImageError extends Error {
    readonly status = 422;
    constructor() { super('Das Firmenlogo ist ungültig.'); }
  }
  return { OwnInvoiceImageError };
});
vi.mock('@/lib/server/own-invoice-pdfa-validator', () => {
  class OwnInvoicePdfAValidationError extends Error {
    readonly status = 500;
    constructor() { super('Die abschließende PDF/A-3b-Prüfung ist fehlgeschlagen.'); }
  }
  return { OwnInvoicePdfAValidationError };
});
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: state.persistence,
    invoice: { create: state.persistence, update: state.persistence, upsert: state.persistence },
    invoiceNumberCounter: { create: state.persistence, update: state.persistence, upsert: state.persistence },
    income: { create: state.persistence, update: state.persistence },
    accountingEntry: { create: state.persistence },
  },
}));
vi.mock('@/lib/invoice-numbers', () => ({
  getNextDocumentNumber: state.persistence,
  previewDocumentNumber: state.persistence,
}));

import { POST } from '@/app/api/invoices/render/route';
import { MAX_OWN_INVOICE_JSON_BYTES, OwnInvoiceInputError, type OwnInvoiceSource } from '@/lib/own-invoice-source';
import { ProcessingCapacityError } from '@/lib/processing-limit';
import { RequestBodyLimitError } from '@/lib/resource-limits';
import { OwnInvoiceImageError } from '@/lib/server/own-invoice-image';
import { OwnInvoicePdfAValidationError } from '@/lib/server/own-invoice-pdfa-validator';

const PDF_BYTES = new TextEncoder().encode('%PDF-synthetic-unit-fixture\n');

function invoice(): OwnInvoiceSource {
  return {
    version: 1,
    invoiceNumber: 'UNIT-RE-001',
    date: '2026-10-22',
    dueDate: '2026-11-05',
    deliveryDate: '',
    customerAddress: 'Synthetic Customer\nTestweg 1\n12345 Teststadt',
    customerId: '123',
    buyerReference: '',
    buyerCountry: 'DE',
    buyerPostcode: '',
    buyerCity: '',
    buyerEmail: 'customer@example.test',
    sellerCountry: 'DE',
    sellerPostcode: '',
    sellerCity: '',
    taxMode: 'small-business',
    items: [{ description: 'Synthetic service', quantity: 1, unitPrice: 25, unit: 'Stunde', taxRate: 0 }],
    settings: {
      companyName: 'Synthetic Seller',
      companyAddress: 'Musterweg 2\n54321 Musterstadt',
      taxNumber: '123/456/78901',
      iban: '',
      bic: '',
      bankName: '',
      footerText: '',
      email: 'seller@example.test',
      telephone: '',
    },
    notes: 'Synthetic note only.',
    includeQRCode: false,
    paymentMeansCode: '10',
  };
}

function post(body: unknown): Promise<Response> {
  return POST(new Request('http://localhost:3000/api/invoices/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

async function expectJsonFailure(response: Response, status: number): Promise<Record<string, unknown>> {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toContain('application/json');
  const body = await response.json() as Record<string, unknown>;
  expect(body.error).toEqual(expect.any(String));
  expect(Object.keys(body)).toEqual(['error']);
  return body;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.session = { user: { id: 'render-owner', role: 'USER' } };
  state.render.mockReset().mockResolvedValue(PDF_BYTES);
  state.persistence.mockImplementation(() => { throw new Error('Unexpected persistence operation in a render-only route.'); });
});

describe('controlled own-invoice rendering route', () => {
  it('configures a bounded mutation wrapper without claiming CSRF coverage in this mocked handler test', () => {
    expect(state.mutationOptions).toEqual({ maxBodyBytes: MAX_OWN_INVOICE_JSON_BYTES });
  });

  it.each([
    null,
    {},
    { user: {} },
    { user: { id: 'render-owner' } },
    { user: { id: '', role: 'USER' } },
    { user: { id: 'render-owner', role: 'VIEWER' } },
    { user: { id: 'render-owner', role: 'admin' } },
  ])('rejects a missing or unsupported authenticated identity before rendering', async session => {
    state.session = session;
    await expectJsonFailure(await post({ source: invoice(), preview: false }), 401);
    expect(state.render).not.toHaveBeenCalled();
    expect(state.persistence).not.toHaveBeenCalled();
  });

  it.each(['ADMIN', 'USER'])('allows an authenticated %s without changing its owner identity', async role => {
    state.session = { user: { id: `synthetic-${role.toLowerCase()}`, role } };
    const source = invoice();
    const response = await post({ source, preview: false });
    expect(response.status).toBe(200);
    expect(state.render).toHaveBeenCalledExactlyOnceWith(source, { userId: `synthetic-${role.toLowerCase()}`, preview: false });
  });

  it.each([true, false])('passes the canonical source and explicit preview=%s to the same renderer', async preview => {
    const source = invoice();
    const original = JSON.stringify(source);
    const response = await post({ source, preview });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF_BYTES);
    expect(state.render).toHaveBeenCalledExactlyOnceWith(source, { userId: 'render-owner', preview });
    expect(JSON.stringify(source)).toBe(original);
    // Persistence/numbering are separate issuance/upload contracts. This tests
    // handler isolation only; the rendering module is deliberately mocked.
    expect(state.persistence).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [],
    'invoice',
    {},
    { preview: false },
    { source: invoice() },
    { source: invoice(), preview: 'false' },
    { source: invoice(), preview: null },
    { source: invoice(), preview: false, userId: 'different-owner' },
    { source: invoice(), preview: false, xmlContent: '<invoice />' },
    { source: invoice(), preview: false, fontPath: '/not-an-input' },
    { source: invoice(), preview: false, basePdfBytes: [] },
  ])('rejects a malformed envelope or extra rendering authority', async body => {
    await expectJsonFailure(await post(body), 400);
    expect(state.render).not.toHaveBeenCalled();
    expect(state.persistence).not.toHaveBeenCalled();
  });

  it('returns a controlled 400 for malformed JSON', async () => {
    const response = await POST(new Request('http://localhost:3000/api/invoices/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid',
    }));
    await expectJsonFailure(response, 400);
    expect(state.render).not.toHaveBeenCalled();
  });

  it.each([
    { ...invoice(), date: '2026-02-30' },
    { ...invoice(), items: [] },
    { ...invoice(), xmlContent: '<invoice />' },
    { ...invoice(), commands: [{ kind: 'text' }] },
    { ...invoice(), settings: { ...invoice().settings, logoUrl: '/not-an-input' } },
    { ...invoice(), items: [{ ...invoice().items[0], total: 0 }] },
  ])('rejects source validation errors before loading the renderer', async source => {
    await expectJsonFailure(await post({ source, preview: false }), 400);
    expect(state.render).not.toHaveBeenCalled();
    expect(state.persistence).not.toHaveBeenCalled();
  });

  it('surfaces ordinary bounded rendering input failures as JSON, never PDF bytes', async () => {
    state.render.mockRejectedValueOnce(new OwnInvoiceInputError('Nicht unterstützte Rechnungsdaten.'));
    await expectJsonFailure(await post({ source: invoice(), preview: false }), 400);
    expect(state.persistence).not.toHaveBeenCalled();
  });

  it('returns 429 with Retry-After when document processing capacity is exhausted', async () => {
    state.render.mockRejectedValueOnce(new ProcessingCapacityError());
    const response = await post({ source: invoice(), preview: false });
    await expectJsonFailure(response, 429);
    expect(response.headers.get('retry-after')).toBe('1');
    expect(state.persistence).not.toHaveBeenCalled();
  });

  it('returns a controlled 422 for an invalid company logo', async () => {
    state.render.mockRejectedValueOnce(new OwnInvoiceImageError());
    await expectJsonFailure(await post({ source: invoice(), preview: false }), 422);
    expect(state.persistence).not.toHaveBeenCalled();
  });

  it('returns 413 for a bounded-output failure', async () => {
    state.render.mockRejectedValueOnce(new RequestBodyLimitError());
    await expectJsonFailure(await post({ source: invoice(), preview: false }), 413);
    expect(state.persistence).not.toHaveBeenCalled();
  });

  it('fails closed with 500 and no PDF payload when final PDF/A validation fails', async () => {
    state.render.mockRejectedValueOnce(new OwnInvoicePdfAValidationError());
    const response = await post({ source: invoice(), preview: false });
    const body = await expectJsonFailure(response, 500);
    expect(body.error).toContain('PDF/A-3b');
    expect(JSON.stringify(body)).not.toContain('%PDF');
    expect(state.persistence).not.toHaveBeenCalled();
  });

  it('does not disclose native diagnostics or invoice source data on an unexpected rendering failure', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      state.render.mockRejectedValueOnce(new Error('PRIVATE native details and provider secret'));
      const response = await post({ source: invoice(), preview: false });
      const body = await expectJsonFailure(response, 500);
      expect(JSON.stringify(body)).not.toContain('PRIVATE');
      expect(JSON.stringify(body)).not.toContain(invoice().customerAddress);
      expect(errorLog).toHaveBeenCalledExactlyOnceWith('Controlled invoice rendering failed.');
      expect(state.persistence).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  });
});
