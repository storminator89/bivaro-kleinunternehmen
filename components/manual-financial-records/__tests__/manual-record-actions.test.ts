import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Income } from '@/types/dashboard';
import { IncomeRowActions } from '../income-row-actions';
import { ManualRecordCorrectionFields } from '../manual-record-correction-fields';
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

describe('manual correction fields keep stable exact accessible labels while editing', () => {
  it.each([
    ['80.00', 'Synthetischer Erfassungsfehler: Betrag war 80 statt 100 EUR.'],
    ['90.00', 'Neuere noch ungespeicherte Eingabe'],
    ['100.00', 'Bewusst auf alten Wert zurückgeändert'],
  ])('keeps labels independent from amount %s and nonempty controlled reason', (amount, reason) => {
    const html = renderToStaticMarkup(createElement(ManualRecordCorrectionFields, { amount, reason, onAmountChange: vi.fn(), onReasonChange: vi.fn() }));
    const labels = [...html.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)].map(match => match[1]);
    expect(labels).toEqual(['Neuer wirksamer Betrag (EUR)', 'Nachvollziehbarer Korrekturgrund']);
    expect(html).toContain('for="manual-record-reason"'); expect(html).toContain('id="manual-record-reason"');
    expect(html).toContain('>' + reason + '</textarea>');
    expect(html).toContain('value="' + amount + '"');
    labels.forEach(label => expect(label).not.toMatch(/<(?:input|textarea)\b/));
  });
  it('binds both list layouts to stable same-record opener identity', () => {
    for (const kind of ['income', 'expense'] as const) {
      const html = renderToStaticMarkup(createElement(ManualRecordStatus, { kind, id: 7, description: 'Synthetic focus return', state: 'FINALIZED', onOpen: vi.fn() }));
      expect(html).toContain(`data-manual-record-opener="${kind}:7"`);
    }
  });
  it('bounds the lifecycle flex item and shrink-0 shared button without clipping or weakening geometry assertions', () => {
    const css = readFileSync('components/manual-financial-records/manual-record.module.css', 'utf8');
    for (const selector of ['.rowActions', '.rowActions > button', '.rowStatus', '.rowStatus > button']) {
      const rule = css.slice(css.indexOf(selector + ' {')).split('}')[0];
      expect(rule).toContain('min-width: 0'); expect(rule).toContain('max-width: 100%');
      expect(rule).toContain('white-space: normal');
    }
    expect(css.slice(css.indexOf('.rowStatus > button {')).split('}')[0]).toContain('flex: 1 1 100%');
    expect(css).not.toContain('overflow-x: hidden'); expect(css).not.toContain('clip-path');
  });
});
