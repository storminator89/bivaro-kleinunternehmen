import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Income } from '@/types/dashboard';
import { IncomeRowActions } from '../income-row-actions';
import { ManualRecordStatus } from '../manual-record-status';

const income: Income = { id: 7, amount: 100, date: '2025-06-15', description: 'Synthetic manual income', taxRelevant: true, manualRecordState: 'FINALIZED' };
const actions = { onEdit: vi.fn(), onDelete: vi.fn(), onDuplicate: vi.fn(), onManualRecord: vi.fn(), isDeleting: false };
describe('manual financial row actions (source-only component acceptance)', () => {
  it('hides generic edit/delete/duplicate on finalized income while exposing original/history and explicit correction', () => {
    const html = renderToStaticMarkup(createElement(IncomeRowActions, { income, ...actions }));
    expect(html).toContain('Festgeschrieben'); expect(html).toContain('Original, Verlauf / Betrag korrigieren');
    expect(html).not.toContain('bearbeiten'); expect(html).not.toContain('duplizieren'); expect(html).not.toContain('löschen');
  });
  it('describes recorded entries as already financially included, never unbooked', () => {
    const html = renderToStaticMarkup(createElement(IncomeRowActions, { income: { ...income, manualRecordState: 'RECORDED' }, ...actions }));
    expect(html).toContain('Erfasst · bereits berücksichtigt'); expect(html).toContain('bearbeiten'); expect(html).not.toContain('nicht gebucht');
  });
  it('does not manufacture an eligible state from absent list fields', () => {
    const html = renderToStaticMarkup(createElement(ManualRecordStatus, { id: 7, kind: 'income', description: income.description, onOpen: vi.fn() }));
    expect(html).toContain('Status frisch prüfen'); expect(html).not.toContain('Jetzt ausdrücklich festschreiben');
  });
});
