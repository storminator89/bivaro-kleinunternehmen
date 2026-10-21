import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ExpenseRowActions } from '@/components/dashboard/expense-row-actions';
import type { Expense } from '@/types/dashboard';

const expense: Expense = { id: 71, description: 'Lieferantenrechnung', amount: 123.45, date: '2026-10-19', taxRelevant: false, receiptFileName: 'rechnung.xml', storedReceiptFileName: 'opaque.xml', sourceLinked: true, sourceDocumentId: 12 };
function render(overrides: Partial<Expense> = {}, compact = false) {
  return renderToStaticMarkup(createElement(ExpenseRowActions, { expense: { ...expense, ...overrides }, compact, isDeleting: false, onEdit: vi.fn(), onDuplicate: vi.fn(), onDelete: vi.fn(), onViewReceipt: vi.fn() }));
}
describe('source-linked expense list actions', () => {
  it.each([false, true])('shows actual detail plus original and clear readonly reason instead of guaranteed-conflict mutations (compact=%s)', compact => {
    const html = render({}, compact);
    expect(html).toContain('Beleggebunden · schreibgeschützt');
    expect(html).toContain('Originalzuordnung geschützt');
    expect(html).toContain('Kassenbuch-Zuordnung wird hier nicht unterstützt');
    expect(html).toContain('href="/expenses/71"');
    expect(html).toContain('aria-label="Gespeicherte Ausgabe zu Lieferantenrechnung ansehen"');
    expect(html).toContain('href="/api/expenses/download?id=71&amp;download=true"');
    expect(html).not.toContain('aria-label="Lieferantenrechnung bearbeiten"');
    expect(html).not.toContain('aria-label="Lieferantenrechnung löschen"');
    expect(html).not.toContain('aria-label="Lieferantenrechnung duplizieren"');
    expect(html).not.toContain('>Bearbeiten<'); expect(html).not.toContain('>Löschen<');
    expect(html).not.toContain('Stornieren'); expect(html).not.toContain('Erstattung');
  });
  it.each([false, true])('wraps the complete source warning inside inherited nowrap table cells (compact=%s)', compact => {
    const html = render({}, compact);
    const containerClasses = html.match(/^<div class="([^"]+)"/)?.[1].split(' ') ?? [];
    expect(containerClasses).toEqual(expect.arrayContaining(['min-w-0', 'max-w-full', 'whitespace-normal']));
    if (compact) expect(containerClasses).toContain('w-64');
    const warningClasses = html.match(/<p class="([^"]+)">Originalzuordnung geschützt:/)?.[1].split(' ') ?? [];
    expect(warningClasses).toEqual(expect.arrayContaining(['whitespace-normal', 'break-words']));
    expect(html).toContain('Auch eine nachträgliche Kassenbuch-Zuordnung wird hier nicht unterstützt.');
    for (const classes of [containerClasses, warningClasses]) {
      expect(classes).not.toContain('whitespace-nowrap');
      expect(classes).not.toContain('truncate');
    }
  });
  it.each([false, true])('does not offer original access when backend marks link unconfirmed; remains readonly (compact=%s)', compact => {
    const html = render({ sourceDocumentId: null }, compact);
    expect(html).toContain('Originalzuordnung nicht bestätigt');
    expect(html).toContain('href="/expenses/71"');
    expect(html).not.toContain('/api/expenses/download'); expect(html).not.toContain('>Bearbeiten<');
  });
  it('retains manual-expense edit/delete and receipt preview on mobile', () => {
    const html = render({ sourceLinked: false, sourceDocumentId: null, receiptFileName: 'manual.pdf', storedReceiptFileName: 'opaque.pdf' });
    expect(html).toContain('>Bearbeiten<'); expect(html).toContain('>Löschen<'); expect(html).toContain('Beleg ansehen');
    expect(html).not.toContain('Beleggebunden'); expect(html).not.toContain('/expenses/71');
  });
  it('retains manual-expense edit/delete/duplicate and receipt actions on desktop', () => {
    const html = render({ sourceLinked: false, sourceDocumentId: null, receiptFileName: 'manual.pdf', storedReceiptFileName: 'opaque.pdf' }, true);
    for (const action of ['bearbeiten', 'löschen', 'duplizieren']) expect(html).toContain(`aria-label="Lieferantenrechnung ${action}"`);
    expect(html).toContain('aria-label="Beleg zu Lieferantenrechnung anzeigen"');
    expect(html).toContain('aria-label="Beleg zu Lieferantenrechnung herunterladen"');
    expect(html).not.toContain('Beleggebunden');
  });
  it('centralizes mobile/desktop mutation policy and explains no later cashbook association before approval', () => {
    const list = readFileSync('components/dashboard/tabs/expenses-tab.tsx', 'utf8');
    expect(list.match(/<ExpenseRowActions /g)).toHaveLength(2);
    expect(list).not.toContain('onEdit(expense)'); expect(list).not.toContain('onDelete(expense.id)');
    const approval = readFileSync('components/purchases/purchase-expense-approval.tsx', 'utf8');
    expect(approval).toContain('keine Zahlungsauslösung oder spätere Kassenzuordnung');
    expect(readFileSync('components/purchases/expense-detail.tsx', 'utf8')).toContain('nachträgliche Kassenbuch-Zuordnung gesperrt');
  });
});
