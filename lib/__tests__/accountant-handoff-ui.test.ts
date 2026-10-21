import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HandoffWorkspace } from '@/components/handoff/handoff-workspace';
import { HandoffReview } from '@/components/handoff/handoff-review';
import { HandoffRequestGate, handoffFilename, handoffPeriodQuery, initialHandoffSelection, readHandoffPreview, type HandoffPreview } from '@/components/handoff/handoff-model';
import { pilotGuides } from '@/components/public-accounting/pilot-guides';

const selection = initialHandoffSelection(new URLSearchParams(), '2026');
const preview: HandoffPreview = {
  filename: 'bivaro-uebergabepaket-2026-01-01-2026-12-31.zip',
  manifest: {
    format: 'bivaro-accountant-handoff', formatVersion: 1, generatedAt: '2026-10-20T21:00:00Z', sourceFingerprint: 'a'.repeat(64),
    period: { from: '2026-01-01', to: '2026-12-31' },
    counts: { incomes: 0, expenses: 0, invoices: 0, cashTransactions: 0, customers: 0, cashBooks: 0 },
    originalCounts: { included: 0, missing: 0, notAttached: 0 }, warnings: [], warningCount: 0,
  },
};

describe('handoff period selection and response contract', () => {
  it('defaults to an explicit current calendar year and restores URL-only period choices', () => {
    expect(selection).toEqual({ mode: 'year', year: '2026', from: '2026-01-01', to: '2026-12-31' });
    expect(handoffPeriodQuery(selection).toString()).toBe('year=2026');
    expect(initialHandoffSelection(new URLSearchParams('from=2025-12-31&to=2026-01-01'), '2026')).toMatchObject({ mode: 'range', from: '2025-12-31', to: '2026-01-01' });
    expect(initialHandoffSelection(new URLSearchParams('year=2024'), '2026').year).toBe('2024');
  });
  it.each(['0001', '2024', '2026', '9999'])('allows a bounded calendar year %s without EÜR-year restrictions', year => {
    expect(handoffPeriodQuery({ ...selection, year }).get('year')).toBe(year);
  });
  it.each(['', '0', '0000', '26', '10000', '2026x', ' 2026'])('rejects invalid year %s', year => {
    expect(() => handoffPeriodQuery({ ...selection, year })).toThrow();
  });
  it('accepts leap-year 366 days and a single inclusive day', () => {
    expect(handoffPeriodQuery({ ...selection, mode: 'range', from: '2024-01-01', to: '2024-12-31' }).toString()).toBe('from=2024-01-01&to=2024-12-31');
    expect(handoffPeriodQuery({ ...selection, mode: 'range', from: '2026-12-31', to: '2026-12-31' }).get('to')).toBe('2026-12-31');
  });
  it.each([
    ['', '2026-01-01'], ['2026-02-30', '2026-03-01'], ['2026-02-01', '2026-01-01'],
    ['2025-01-01', '2026-01-02'], ['2026-01-01T00:00:00Z', '2026-01-31'],
  ])('rejects invalid or unbounded custom range %s–%s', (from, to) => {
    expect(() => handoffPeriodQuery({ ...selection, mode: 'range', from, to })).toThrow();
  });
  it('validates the exact preview version, counters and fingerprint before enabling review', () => {
    expect(readHandoffPreview(preview)).toBe(preview);
    const bad = [null, {}, { ...preview, manifest: { ...preview.manifest, formatVersion: 2 } },
      { ...preview, manifest: { ...preview.manifest, sourceFingerprint: '' } },
      { ...preview, manifest: { ...preview.manifest, counts: {} } },
      { ...preview, manifest: { ...preview.manifest, originalCounts: { included: -1, missing: 0, notAttached: 0 } } },
      { ...preview, manifest: { ...preview.manifest, warningCount: 1 } },
      { ...preview, manifest: { ...preview.manifest, warningCount: 1, warnings: [null] } },
      { ...preview, manifest: { ...preview.manifest, period: { from: '2026-02-30', to: '2026-03-01' } } }];
    for (const value of bad) expect(() => readHandoffPreview(value)).toThrow(/ungültig/);
  });
  it('uses the stable server attachment filename and never turns a response label into a path', () => {
    expect(handoffFilename('attachment; filename="bivaro-test.zip"', preview.manifest.period)).toBe('bivaro-test.zip');
    for (const invalid of [null, 'attachment; filename="../../stolen.zip"', 'attachment; filename="https://example.org/x.zip"', 'attachment; filename="invoice.html"', 'inline; filename="test.zip"', 'attachment; filename="../x.zip"']) {
      expect(handoffFilename(invalid, preview.manifest.period)).toBe(preview.filename);
    }
  });
});

describe('request cancellation and duplicate submission ownership', () => {
  it('blocks double clicks synchronously and allows a deliberate retry after finishing', () => {
    const gate = new HandoffRequestGate();
    const first = gate.begin()!;
    expect(gate.active).toBe(true);
    expect(gate.begin()).toBeNull();
    expect(gate.finish(first)).toBe(true);
    expect(gate.active).toBe(false);
    expect(gate.begin()).not.toBeNull();
  });
  it('aborts on cancel/back/unmount and refuses stale responses or stale finally cleanup', () => {
    const gate = new HandoffRequestGate();
    const cancelled = gate.begin()!;
    gate.cancel();
    expect(cancelled.signal.aborted).toBe(true);
    const retry = gate.begin()!;
    expect(gate.isCurrent(cancelled)).toBe(false);
    expect(gate.finish(cancelled)).toBe(false);
    expect(gate.active).toBe(true);
    expect(gate.isCurrent(retry)).toBe(true);
    gate.cancel();
    expect(gate.isCurrent(retry)).toBe(false);
    expect(gate.finish(retry)).toBe(false);
    expect(gate.active).toBe(false);
  });
});

describe('handoff accessible rendering and honest scope', () => {
  it('starts with a deliberate native year selection, a preview action and no download', () => {
    const html = renderToStaticMarkup(createElement(HandoffWorkspace, { initialSelection: selection, currentYear: '2026' }));
    expect(html).toContain('aria-current="step"');
    expect((html.match(/type="radio"/gu) ?? []).length).toBe(2);
    expect(html).toContain('for="handoff-year"');
    expect(html).toContain('value="2026"');
    expect(html).toContain('Vorschau laden');
    expect(html).not.toContain('ZIP herunterladen');
    for (const copy of ['Format 1', 'kein vollständiger GoBD-Prüfexport', 'keine ELSTER-Einreichung', 'Kein DATEV-Format', 'payments.csv', 'historischer Datumsunsicherheit', 'dürfen nicht addiert werden', 'separates Erstattungsjournal', 'nichts automatisch', 'aria-live="polite"', 'href="/help#export"', 'href="/settings#handoff-settings"']) expect(html).toContain(copy);
    expect(html).not.toContain('role="alert"');
  });
  it('offers a labelled two-date form for custom ranges', () => {
    const html = renderToStaticMarkup(createElement(HandoffWorkspace, { initialSelection: { ...selection, mode: 'range' }, currentYear: '2026' }));
    expect((html.match(/type="date"/gu) ?? []).length).toBe(2);
    expect(html).toContain('for="handoff-from"');
    expect(html).toContain('for="handoff-to"');
    expect(html).toContain('höchstens');
  });
  it('makes an empty period explicit without inventing completeness', () => {
    const html = renderToStaticMarkup(createElement(HandoffReview, { preview }));
    expect(html).toContain('Keine Datensätze');
    expect(html).toContain('keine Vollständigkeitsprüfung');
    expect(html).toContain('Keine technischen Warnungen');
    expect(html).toContain('Addieren Sie diese Tabellen nicht');
  });
  it('prominently exposes missing and unattached originals and never says fully checked', () => {
    const html = renderToStaticMarkup(createElement(HandoffReview, { preview: { ...preview, manifest: { ...preview.manifest,
      counts: { ...preview.manifest.counts, expenses: 2 }, originalCounts: { included: 1, missing: 1, notAttached: 1 },
      warnings: [{ code: 'ORIGINAL_MISSING', recordType: 'expense', recordId: 4, message: 'Original fehlt.' }], warningCount: 1,
    } } }));
    expect(html).toContain('2 Originale fehlen');
    expect(html).toContain('1 Warnung');
    expect(html).toContain('nicht als vollständig geprüft');
    expect(html).toContain('expense #4');
    expect(html).toContain('Original fehlt.');
    expect(html).not.toContain('Keine technischen Warnungen');
  });
  it('limits the inline warning list openly while referring to every warning in the manifest', () => {
    const warnings = Array.from({ length: 51 }, (_, recordId) => ({ code: 'MISSING', recordType: 'expense', recordId, message: `Warnung ${recordId}` }));
    const html = renderToStaticMarkup(createElement(HandoffReview, { preview: { ...preview, manifest: { ...preview.manifest, warnings, warningCount: warnings.length } } }));
    expect(html).toContain('ersten 50 von 51');
    expect(html).toContain('Alle Warnungen stehen in manifest.json');
    expect(html).not.toContain('Warnung 50');
  });
  it('makes the handoff discoverable from the export help guide with unchanged EÜR caveats', () => {
    const guide = pilotGuides.find(value => value.id === 'export')!;
    expect(guide.links.some(link => link.href === '/handoff')).toBe(true);
    expect(guide.caution).toContain('2024 und 2025, nicht 2026');
    expect(guide.caution).toContain('kein vollständiger GoBD-Prüfexport');
  });
});
