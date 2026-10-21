import { parseBusinessDate } from '@/lib/business-date';

export type HandoffSelection = { mode: 'year' | 'range'; year: string; from: string; to: string };
export type HandoffPreview = {
  filename: string;
  manifest: {
    format: 'bivaro-accountant-handoff';
    formatVersion: 1;
    generatedAt: string;
    sourceFingerprint: string;
    period: { from: string; to: string };
    counts: Record<string, number>;
    originalCounts: { included: number; missing: number; notAttached: number };
    warnings: { code: string; recordType: string; recordId: number | null; message: string }[];
    warningCount: number;
  };
};

export function initialHandoffSelection(params: URLSearchParams, currentYear: string): HandoffSelection {
  return {
    mode: params.has('from') || params.has('to') ? 'range' : 'year',
    year: params.get('year') ?? currentYear,
    from: params.get('from') ?? `${currentYear}-01-01`,
    to: params.get('to') ?? `${currentYear}-12-31`,
  };
}

/** Client feedback only; the server remains authoritative for the same bounded range. */
export function handoffPeriodQuery(selection: HandoffSelection): URLSearchParams {
  if (selection.mode === 'year') {
    if (!/^\d{4}$/.test(selection.year) || Number(selection.year) < 1) throw new Error('Bitte ein vierstelliges Kalenderjahr von 0001 bis 9999 angeben.');
    return new URLSearchParams({ year: selection.year });
  }
  let from: Date;
  let to: Date;
  try { from = parseBusinessDate(selection.from); to = parseBusinessDate(selection.to); }
  catch { throw new Error('Bitte zwei gültige Kalenderdaten angeben.'); }
  const days = (to.getTime() - from.getTime()) / 86_400_000 + 1;
  if (days < 1 || days > 366) throw new Error('Der Zeitraum muss aufsteigend sein und darf höchstens 366 Tage umfassen.');
  return new URLSearchParams({ from: selection.from, to: selection.to });
}

export function handoffFilename(disposition: string | null, period: { from: string; to: string }): string {
  const fallback = `bivaro-uebergabepaket-${period.from}-${period.to}.zip`;
  const supplied = disposition?.match(/^attachment;\s*filename="([a-zA-Z0-9._-]+\.zip)"$/i)?.[1];
  // A server filename is a label, never a local path or an external URL.
  return supplied && !supplied.includes('..') ? supplied : fallback;
}

export function readHandoffPreview(value: unknown): HandoffPreview {
  if (!value || typeof value !== 'object') throw new Error('Die Vorschau ist ungültig. Bitte erneut laden.');
  const result = value as HandoffPreview;
  const m = result.manifest;
  const isCount = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  if (typeof result.filename !== 'string' || !/^[a-zA-Z0-9._-]+\.zip$/.test(result.filename) || result.filename.includes('..') ||
      !m || typeof m.generatedAt !== 'string' || !Number.isFinite(Date.parse(m.generatedAt)) || m.format !== 'bivaro-accountant-handoff' || m.formatVersion !== 1 ||
      !/^[a-f0-9]{64}$/.test(m.sourceFingerprint) || !m.period ||
      !m.counts || !['incomes', 'expenses', 'invoices', 'cashTransactions', 'customers', 'cashBooks'].every(key => isCount(m.counts[key])) ||
      !m.originalCounts || !Object.values(m.originalCounts).every(isCount) ||
      !isCount(m.originalCounts.included) || !isCount(m.originalCounts.missing) || !isCount(m.originalCounts.notAttached) ||
      !isCount(m.warningCount) || !Array.isArray(m.warnings) || m.warnings.length !== m.warningCount ||
      !m.warnings.every(w => w && typeof w === 'object' && typeof w.message === 'string' && typeof w.code === 'string' && typeof w.recordType === 'string' && (w.recordId === null || isCount(w.recordId)))) {
    throw new Error('Die Vorschau ist ungültig. Bitte erneut laden.');
  }
  try { handoffPeriodQuery({ mode: 'range', year: '', from: m.period.from, to: m.period.to }); }
  catch { throw new Error('Der Vorschauzeitraum ist ungültig. Bitte erneut laden.'); }
  return result;
}

/** Synchronous request ownership blocks double clicks and discards stale completions. */
export class HandoffRequestGate {
  private controller: AbortController | null = null;
  get active() { return this.controller !== null; }
  begin(): AbortController | null {
    if (this.controller) return null;
    this.controller = new AbortController();
    return this.controller;
  }
  isCurrent(controller: AbortController) { return this.controller === controller && !controller.signal.aborted; }
  finish(controller: AbortController) {
    if (!this.isCurrent(controller)) return false;
    this.controller = null;
    return true;
  }
  cancel() {
    this.controller?.abort();
    this.controller = null;
  }
}

export type HandoffReadiness = {
  period: { from: string; to: string };
  checkedAt: string;
  incoming: {
    datedCount: number; undatedCount: number; undatedUploadedInPeriod: number;
    datedExamples: { id: number; originalFileName: string }[];
    undatedExamples: { id: number; originalFileName: string }[];
  };
};
export function readHandoffReadiness(value: unknown, period: HandoffPreview['manifest']['period']): HandoffReadiness {
  const invalid = () => new Error('Die Prüfaufgaben sind ungültig. Bitte die Vorschau erneut laden.');
  if (!value || typeof value !== 'object') throw invalid();
  const result = value as HandoffReadiness;
  const n = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
  if (!result.period || result.period.from !== period.from || result.period.to !== period.to ||
      typeof result.checkedAt !== 'string' || !Number.isFinite(Date.parse(result.checkedAt)) || !result.incoming) throw invalid();
  const i = result.incoming;
  if (![i.datedCount, i.undatedCount, i.undatedUploadedInPeriod].every(n) || i.undatedUploadedInPeriod > i.undatedCount) throw invalid();
  for (const [samples, total] of [[i.datedExamples, i.datedCount], [i.undatedExamples, i.undatedCount]] as const) {
    if (!Array.isArray(samples) || samples.length > Math.min(5, total) || !samples.every(row => row && n(row.id) && row.id > 0 && typeof row.originalFileName === 'string')) throw invalid();
  }
  return result;
}

export function handoffWarningTarget(warning: HandoffPreview['manifest']['warnings'][number]): { href: string; label: string } | null {
  if (warning.recordType === 'expense' && warning.recordId !== null && warning.recordId > 0) return { href: `/expenses/${warning.recordId}`, label: 'Ausgabe und Original prüfen' };
  if (warning.recordType === 'invoice' || warning.recordType === 'payment') return { href: '/dashboard?tab=invoices', label: warning.recordType === 'payment' ? 'Zahlungsverlauf der Rechnung prüfen' : 'Rechnungsoriginal prüfen' };
  if (warning.recordType === 'income') return { href: '/dashboard?tab=incomes', label: 'Einnahmen prüfen' };
  if (warning.recordType === 'cashTransaction') return { href: '/cashbook', label: 'Kassenbuch prüfen' };
  return null;
}
