import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { PDFDocument } from 'pdf-lib';
import { QuoteEditor, type QuoteItem } from '@/components/dashboard/editors/quote-editor';
import { calculateInvoiceAmounts } from '@/lib/invoice-calculation';

// Actual editor handlers + PDF drawing with synthetic data only. No browser,
// server, database, real download or network; independent PDF text extraction
// is retained with the issue's bounded audit evidence.
const hooks = vi.hoisted(() => ({ index: 0, states: [] as unknown[], mode: 'small-business', refIndex: 0, refs: [] as { current: unknown }[], monetaryEffect: undefined as (() => void) | undefined }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.states[index], (value: unknown) => { hooks.states[index] = typeof value === 'function' ? value(hooks.states[index]) : value; }];
  },
  // Only flush the monetary invalidation effect; mount/network/timer effects
  // stay outside this focused, server-free regression harness.
  useEffect: (effect: () => void, dependencies?: unknown[]) => {
    if (dependencies?.length === 1 && typeof dependencies[0] === 'string') hooks.monetaryEffect = effect;
  },
  useCallback: (callback: unknown) => callback,
  useRef: (current: unknown) => {
    const index = hooks.refIndex++;
    hooks.refs[index] ??= { current };
    return hooks.refs[index];
  },
}));
vi.mock('@/components/dashboard/service-article-picker', () => ({ ServiceArticlePicker: () => null }));
vi.mock('@/lib/document-tax-profile', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/document-tax-profile')>(),
  resolveDocumentTaxState: () => ({ mode: hooks.mode, ready: true, source: 'manual' }),
}));

type Element = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function nodes(root: ReactNode): Element[] {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!isValidElement(root)) return [];
  return [root as Element, ...nodes((root as Element).props.children)];
}
function text(root: ReactNode): string {
  if (Array.isArray(root)) return root.map(text).join(' ');
  if (isValidElement(root)) return text((root as Element).props.children);
  return typeof root === 'string' || typeof root === 'number' ? String(root) : '';
}
function render() { hooks.index = 0; hooks.refIndex = 0; return QuoteEditor({ onCancel() {} }); }
function field(root: ReactNode, id: string) {
  const result = nodes(root).find(node => node.props.id === id);
  expect(result, id).toBeDefined(); return result!;
}
function change(root: ReactNode, id: string, value: string | number) {
  (field(root, id).props.onChange as (event: unknown) => void)({ target: { value: String(value) } });
}
function button(root: ReactNode, label: string) {
  const result = nodes(root).find(node => node.props['aria-label'] === label);
  expect(result, label).toBeDefined(); return result!;
}
const money = (value: number) => value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const cases = [
  { name: 'two half-cent zero-tax lines', rate: 0, quantity: 0.5, price: 10.01, gross: 10.02, net: 10.02, tax: 0 },
  { name: 'two half-cent 19% lines', rate: 19, quantity: 0.5, price: 10.01, gross: 11.92, net: 10.02, tax: 1.9 },
  { name: 'ordinary mixed 19% and 7%', rate: 19, secondRate: 7, quantity: 1, price: 100, gross: 226, net: 200, tax: 26 },
  { name: 'tax rounded per group, not per line', rate: 19, quantity: 1, price: 0.03, gross: 0.07, net: 0.06, tax: 0.01 },
  { name: 'two below-half-cent prices', rate: 0, quantity: 1, price: 1.004, gross: 2, net: 2, tax: 0 },
];

beforeEach(() => {
  hooks.index = 0; hooks.states = []; hooks.mode = 'small-business'; hooks.refIndex = 0; hooks.refs = []; hooks.monetaryEffect = undefined;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('quote #230: rounded PDF, editor, saved total and invoice agree', () => {
  it.each(cases)('$name', async fixture => {
    hooks.mode = fixture.rate ? 'standard' : 'small-business';
    let root = render();
    change(root, 'customer', 'Synthetic Buyer\nTestweg 1\n12345 Teststadt');
    change(root, 'quote-number', 'SYNTHETIC-230');
    for (const [suffix, value] of [['description', 'Synthetic service'], ['quantity', fixture.quantity], ['unit-price', fixture.price], ['tax', fixture.rate]] as const) { change(root, `quote-item-0-${suffix}`, value); root = render(); }
    root = render();
    (button(root, 'Position 1 duplizieren').props.onClick as () => void)();
    root = render();
    if ('secondRate' in fixture) { change(root, 'quote-item-1-tax', fixture.secondRate!); root = render(); }
    const submit = button(root, 'Angebot erstellen & speichern');
    expect(submit.props.disabled).toBe(false);
    expect(text(root)).toContain(money(fixture.gross));
    expect(text(root)).toContain(money(fixture.net));
    expect(text(root)).toContain(money(fixture.tax));

    const drawn: string[] = [];
    const originalCreate = PDFDocument.create.bind(PDFDocument);
    vi.spyOn(PDFDocument, 'create').mockImplementation(async () => {
      const doc = await originalCreate();
      const originalAddPage = doc.addPage.bind(doc);
      vi.spyOn(doc, 'addPage').mockImplementation((...args) => {
        const page = originalAddPage(...args);
        const originalDraw = page.drawText.bind(page);
        vi.spyOn(page, 'drawText').mockImplementation((value, options) => { drawn.push(value); originalDraw(value, options); });
        return page;
      });
      return doc;
    });
    vi.stubGlobal('FileReader', class {
      result: string | null = null;
      onload?: () => void;
      readAsDataURL(blob: Blob) { void blob.arrayBuffer().then(bytes => { this.result = `data:application/pdf;base64,${Buffer.from(bytes).toString('base64')}`; this.onload?.(); }); }
    });
    const fetcher = vi.fn(async () => Response.json({ id: 230 }));
    vi.stubGlobal('fetch', fetcher);
    vi.stubGlobal('alert', vi.fn());
    vi.stubGlobal('document', { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } });
    await (submit.props.onClick as () => Promise<void>)();
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/quotes');
    const body = JSON.parse(String(request.body)) as { totalAmount: number; parsedData: { totalAmount: number; items: QuoteItem[] }; pdfBytes: string };
    expect(body.totalAmount).toBe(fixture.gross);
    expect(body.parsedData.totalAmount).toBe(fixture.gross);
    expect(calculateInvoiceAmounts(body.parsedData.items)).toMatchObject({ netAmount: fixture.net, taxAmount: fixture.tax, grossAmount: fixture.gross });
    expect(Buffer.from(body.pdfBytes, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
    expect(drawn[drawn.indexOf('Angebotssumme:') + 1]).toBe(money(body.totalAmount));
    expect(drawn[drawn.indexOf('Netto:') + 1]).toBe(money(fixture.net));
    expect(drawn[drawn.indexOf(fixture.tax > 0 ? 'zzgl. USt.:' : 'zzgl. USt. 0%:') + 1]).toBe(money(fixture.tax));
    expect(vi.mocked(globalThis.alert)).not.toHaveBeenCalled();
  });

  it('clears and revokes a valid preview on invalid amounts, then renders a fresh valid preview', async () => {
    const createUrl = vi.fn().mockReturnValueOnce('blob:synthetic-valid-1').mockReturnValueOnce('blob:synthetic-valid-2');
    const revokeUrl = vi.fn();
    vi.spyOn(URL, 'createObjectURL').mockImplementation(createUrl);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeUrl);
    let root = render();
    change(root, 'quote-item-0-unit-price', 10.01); root = render();
    const open = nodes(root).find(node => node.props['aria-pressed'] === false)!;
    (open.props.onClick as () => void)(); root = render();
    await (button(root, 'Vorschau aktualisieren').props.onClick as () => Promise<void>)(); root = render();
    expect(nodes(root).find(node => node.type === 'iframe')?.props.src).toBe('blob:synthetic-valid-1');

    change(root, 'quote-item-0-quantity', 0); root = render();
    expect(hooks.monetaryEffect).toBeDefined(); hooks.monetaryEffect!(); root = render();
    expect(nodes(root).some(node => node.type === 'iframe')).toBe(false);
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:synthetic-valid-1');
    expect(button(root, 'Angebot erstellen & speichern').props.disabled).toBe(true);
    await (button(root, 'Vorschau aktualisieren').props.onClick as () => Promise<void>)();
    expect(createUrl).toHaveBeenCalledOnce();

    change(root, 'quote-item-0-quantity', 1); root = render();
    await (button(root, 'Vorschau aktualisieren').props.onClick as () => Promise<void>)(); root = render();
    expect(nodes(root).find(node => node.type === 'iframe')?.props.src).toBe('blob:synthetic-valid-2');
    expect(text(root)).toContain('10,01 €');
    expect(nodes(root).some(node => node.props.role === 'alert')).toBe(false);
  });

  it.each(['0', '-1', 'NaN', '1e-13'])('does not crash or advertise a valid amount for quantity %s', value => {
    let root = render(); change(root, 'quote-item-0-quantity', value); root = render();
    expect(nodes(root).some(node => node.props.role === 'alert')).toBe(true);
    expect(text(field(root, 'quote-total-title').props.children)).toBe('Angebotssumme');
    expect(button(root, 'Angebot erstellen & speichern').props.disabled).toBe(true);
    expect(text(root)).toContain('–');
  });
});
