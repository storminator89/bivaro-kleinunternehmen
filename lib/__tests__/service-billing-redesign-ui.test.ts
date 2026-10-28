import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { PlanCard } from '@/components/service-billing/service-billing-workspace';
import { ServicePlanEditor } from '@/components/service-billing/service-plan-editor';
import type { ServiceBillingPlanDto } from '@/components/service-billing/service-billing-types';

// Pure fixture rendering only: no application server, network, database or browser.
// Radix portals are represented as markup so the editor's owned fields can be inspected.
vi.mock('@/components/ui/dialog', () => {
  const block = ({ children, className }: { children?: ReactNode; className?: string }) => createElement('div', { className }, children);
  return { Dialog: block, DialogContent: block, DialogHeader: block, DialogFooter: block, DialogTitle: block, DialogDescription: block };
});
vi.mock('@/components/dashboard/service-article-picker', () => ({ ServiceArticlePicker: () => null }));

const plan: ServiceBillingPlanDto = {
  id: 'synthetic-plan', stableKey: 'synthetic-key', name: 'Synthetic IT-Betreuung', customerId: 7,
  customer: { id: 7, name: 'Synthetic Kundin' }, cadence: 'MONTHLY', anchorDate: '2026-01-31',
  nextPeriod: 0, status: 'ACTIVE', revision: 4, taxMode: 'standard',
  items: [{ description: 'Synthetic Support', quantity: 1, unitPrice: 100, unit: 'Pauschal', taxRate: 19 }],
  preview: { periodStart: '2026-01-31', periodEnd: '2026-02-27', nextDue: '2026-02-28' },
  due: true, missed: false, periods: [],
};
function row(overrides: Partial<ServiceBillingPlanDto> = {}, disabled = false) {
  return renderToStaticMarkup(createElement(PlanCard, { plan: { ...plan, ...overrides }, disabled, onEdit() {}, onReview() {}, onToggle() {} }));
}
function button(html: string, text: string) {
  const found = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)?.find(value => value.includes(text));
  expect(found, text).toBeDefined();
  return found!;
}

describe('reviewed-period ledger fixture presentation', () => {
  it('retains the customer, canonical gross amount, tax mode, services and anchored dates', () => {
    const html = row();
    for (const value of ['Synthetic IT-Betreuung', 'Synthetic Kundin', '119,00', 'Regelbesteuerung', 'Synthetic Support', '100,00', '19 % USt.', '31.01.2026', '27.02.2026', '28.02.2026', 'keine Zahlungsfrist', 'Keine automatische Nachholung oder Vertragsvereinbarung.']) expect(html).toContain(value);
    expect(button(html, 'Entwurf vorbereiten')).not.toContain(' disabled=""');
    expect(button(html, 'Zeitraum überspringen')).not.toContain(' disabled=""');
  });
  it('keeps pause and future-period controls unavailable without hiding the reason', () => {
    const paused = row({ status: 'PAUSED' });
    expect(button(paused, 'Entwurf vorbereiten')).toContain(' disabled=""');
    expect(button(paused, 'Zeitraum überspringen')).toContain(' disabled=""');
    expect(button(paused, 'Plan fortsetzen')).not.toContain(' disabled=""');
    const future = row({ due: false });
    expect(button(future, 'Entwurf vorbereiten')).toContain(' disabled=""');
    expect(future).not.toContain('Zeitraum überspringen');
    expect(future).toContain('Ab Beginn prüfbar.');
  });
  it('preserves the single-period warning and all busy-state control guards', () => {
    const html = row({ missed: true }, true);
    expect(html).toContain('Zeitraum liegt zurück: einzeln prüfen oder überspringen.');
    for (const label of ['Entwurf vorbereiten', 'Zeitraum überspringen', 'Plan bearbeiten', 'Plan pausieren']) expect(button(html, label)).toContain(' disabled=""');
  });
  it('keeps exact draft/history destinations and does not invent links for skipped or removed drafts', () => {
    const base = { periodStart: '2026-01-31', periodEnd: '2026-02-27' };
    const html = row({ periods: [
      { ...base, periodIndex: 0, action: 'GENERATED', invoiceId: 21, invoice: { id: 21, status: 'DRAFT', invoiceNumber: null, unrendered: true } },
      { ...base, periodIndex: 1, action: 'GENERATED', invoiceId: 22, invoice: { id: 22, status: 'SENT', invoiceNumber: 'SYN-22', unrendered: false } },
      { ...base, periodIndex: 2, action: 'SKIPPED', invoiceId: null },
      { ...base, periodIndex: 3, action: 'GENERATED', invoiceId: null },
    ] });
    expect(html).toContain('href="/dashboard/invoices/new?draftId=21"');
    expect(html).toContain('href="/history?invoiceId=22"');
    expect(html.match(/<a\b/g)).toHaveLength(2);
    expect(html).toContain('Bewusst übersprungen · keine Rechnung');
    expect(html).toContain('Entwurf entfernt · Zeitraum bleibt bearbeitet');
  });
  it('does not replace malformed source amounts with a plausible zero', () => {
    const html = row({ items: [{ ...plan.items[0], unitPrice: Number.NaN }] });
    expect(html).toContain('Betrag prüfen');
    expect(html).not.toContain('0,00');
  });
  it('keeps small-business cent rounding and safely renders long customer material', () => {
    const html = row({ taxMode: 'small-business', customer: { id: 7, name: '<script>Synthetic</script>' }, items: [{ ...plan.items[0], quantity: 0.5, unitPrice: 0.01, taxRate: 0 }] });
    expect(html).toContain('0,01');
    expect(html).toContain('Kleinunternehmer-Modus');
    expect(html).toContain('&lt;script&gt;Synthetic&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });
});

describe('split authoring workbench fixture presentation', () => {
  it('keeps all new-plan labels, required fields, tax choice and date/amount limits', () => {
    const html = renderToStaticMarkup(createElement(ServicePlanEditor, { plan: null, today: '2026-10-24', onClose() {}, onSaved() {} }));
    for (const id of ['service-plan-name', 'service-plan-customer', 'service-plan-cadence', 'service-plan-anchor', 'service-plan-tax', 'service-line-description-0', 'service-line-quantity-0', 'service-line-unit-0', 'service-line-price-0', 'service-line-tax-0']) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`for="${id}"`);
    }
    expect(html).toContain('Speichern erstellt noch keine Rechnung.');
    expect(html).toContain('min="1900-01-01"');
    expect(html).toContain('max="9998-12-31"');
    expect(html).toContain('max="9999999.99"');
    expect(html).toContain('step="0.000001"');
    expect(html).toContain('<option value="" selected="">Bitte wählen</option>');
    expect(button(html, 'Serviceplan speichern')).toContain(' disabled=""');
  });
  it('leaves an existing schedule fixed and retains special-case tax evidence', () => {
    const existing = { ...plan, items: [{ ...plan.items[0], taxRate: 0, taxCategory: 'Z' as const, exemptionReason: 'Synthetic original evidence' }] };
    const html = renderToStaticMarkup(createElement(ServicePlanEditor, { plan: existing, today: '2026-10-24', onClose() {}, onSaved() {} }));
    expect(html).not.toContain('id="service-plan-cadence"');
    expect(html).not.toContain('id="service-plan-anchor"');
    for (const value of ['Rhythmus und Start bleiben fest.', '31.01.2026', 'Vorhandener Sonderfall Z:', 'Synthetic original evidence', 'Es wird keine neue Steuerbefreiung abgeleitet; bitte fachlich prüfen.']) expect(html).toContain(value);
  });
});

function sourceContracts(text: string) {
  const tree = ts.createSourceFile('fixture.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bindings: string[] = [], logic: string[] = [], ids: string[] = [], autofocus: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(tree);
      const opening = node.parent.parent;
      const reviewedAutofocus = (ts.isJsxOpeningElement(opening) || ts.isJsxSelfClosingElement(opening))
        && opening.tagName.getText(tree) === 'DialogContent'
        && (name === 'onOpenAutoFocus' || name === 'onCloseAutoFocus');
      // Only these additive DialogContent handlers are classified separately;
      // every original binding and all other event attributes keep the main baseline.
      if (reviewedAutofocus) autofocus.push(node.getText(tree).replace(/\s+/g, ' '));
      else if (/^(on[A-Z].*|href|name|type|key|value|defaultValue|checked|required|disabled|min|max|step|inputMode|maxLength|showCloseButton)$/.test(name)) bindings.push(node.getText(tree).replace(/\s+/g, ' '));
      if (name === 'id') ids.push(node.getText(tree));
    }
    if (ts.isCallExpression(node) && /^(useState|useEffect|calculateInvoiceAmounts|readServiceBillingPlanInput|serviceJson|fetch|JSON.stringify|dailyActionAmount)$/.test(node.expression.getText(tree))) logic.push(node.getText(tree).replace(/\s+/g, ' '));
    ts.forEachChild(node, visit);
  }
  visit(tree);
  const hash = (values: string[]) => createHash('sha256').update(values.sort().join('\n')).digest('hex');
  return { bindings: hash(bindings), logic: hash(logic), ids, autofocus };
}

describe('presentation-only source contracts against accepted main 17cd6f1', () => {
  it.each([
    ['components/service-billing/service-billing-workspace.tsx', '695bb1483e6a7180dd743b245963525ca2cc53d69d12a848bcd7fca630053b18', '8d11cd8d924d230f6fbdcfa92ee707dcced18ef58b28f56016b8ebcd73be3377'],
    ['components/service-billing/service-plan-editor.tsx', '5ac26f6f61b61c6f47b6814a1b0a53033c25913b29642bf36bde821ed3fa3357', '4332254385ae864889e51e7aeeb3d954debeca8cba441698ce90b949067095c1'],
    ['components/daily-actions/daily-actions-workspace.tsx', 'bd08e38741b93a5ddaba5890239d8fd2cd6fe4e06fbc230ee2d0b1daffedba1c', '105e52a0b85f72ee68e1e5f3d8cdd6264cb33a08bfe505f72e170ea5ac4668d8'],
  ])('preserves every owned binding, guard, request body and hook in %s', (file, bindings, logic) => {
    expect(sourceContracts(readFileSync(file, 'utf8'))).toMatchObject({ bindings, logic });
  });
  it.each([
    'components/service-billing/service-billing-workspace.tsx',
    'components/service-billing/service-plan-editor.tsx',
  ])('adds only the reviewed opener capture and guarded restoration handlers in %s', file => {
    const source = readFileSync(file, 'utf8');
    expect(sourceContracts(source).autofocus).toEqual([
      'onOpenAutoFocus={() => { openerRef.current = captureServiceDialogOpener(document); }}',
      'onCloseAutoFocus={event => { event.preventDefault(); const opener = openerRef.current; openerRef.current = null; restoreServiceDialogOpener(opener); }}',
    ]);
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const clearsBeforeSaved: string[] = [];
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && node.expression.getText(tree) === 'onSaved') {
        const statement = node.parent;
        expect(ts.isExpressionStatement(statement) && ts.isBlock(statement.parent)).toBe(true);
        if (ts.isExpressionStatement(statement) && ts.isBlock(statement.parent)) {
          const index = statement.parent.statements.indexOf(statement);
          clearsBeforeSaved.push(statement.parent.statements[index - 1]?.getText(tree).replace(/\s+/g, ' ') ?? '<missing-clear>');
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
    expect(clearsBeforeSaved).toEqual(['openerRef.current = null;']);
  });
  it('does not add any unreviewed autofocus handlers to the Today workspace', () => {
    expect(sourceContracts(readFileSync('components/daily-actions/daily-actions-workspace.tsx', 'utf8')).autofocus).toEqual([]);
  });
  it('retains the original field and list-heading identifiers', () => {
    const workspace = sourceContracts(readFileSync('components/service-billing/service-billing-workspace.tsx', 'utf8'));
    expect(workspace.ids).toContain('id="service-plans-heading"');
    const editor = sourceContracts(readFileSync('components/service-billing/service-plan-editor.tsx', 'utf8'));
    expect(editor.ids).toHaveLength(11);
    for (const field of ['anchor', 'cadence', 'customer', 'name', 'tax']) expect(editor.ids).toContain(`id="service-plan-${field}"`);
    for (const field of ['description', 'price', 'quantity', 'tax', 'unit']) expect(editor.ids).toContain('id={`service-line-' + field + '-${index}`}');
  });
  it('retains focus, reduced-motion and long-content safeguards', () => {
    const billing = readFileSync('components/service-billing/service-billing-workspace.module.css', 'utf8');
    const daily = readFileSync('components/daily-actions/daily-actions-workspace.module.css', 'utf8');
    for (const css of [billing, daily]) {
      expect(css).toContain('min-width: 0');
      expect(css).toContain(':focus-visible');
      expect(css).toContain('prefers-reduced-motion: reduce');
      expect(css).toContain('overflow-wrap: anywhere');
      // The generated --color-muted alias is a surface color. Using it for
      // text previously caused a contrast failure; keep the text-role guard
      // until computed-style or browser coverage replaces it.
      expect(css).toContain('var(--bivaro-color-muted)');
      expect(css).not.toContain('var(--color-muted)');
    }
  });
});
