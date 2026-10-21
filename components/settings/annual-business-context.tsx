"use client";

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ANNUAL_CONTEXT_VERSION, validateAnnualContext, type AnnualContextInput, type AnnualContextResponse, type AnnualContextRevision, type ContextCompleteness } from '@/lib/annual-business-context';
import styles from '@/components/onboarding/onboarding.module.css';
import contextStyles from './annual-business-context.module.css';

function blank(year: number): AnnualContextInput {
  return { contextYear: year, effectiveFrom: `${year}-01-01`, foundingYear: null, previousYearTurnoverCents: null, previousYearExternalTurnoverCents: null, completeness: 'UNKNOWN', sourceNote: '' };
}
function inputFrom(row: AnnualContextRevision): AnnualContextInput {
  return { contextYear: row.contextYear, effectiveFrom: row.effectiveFrom, foundingYear: row.foundingYear, previousYearTurnoverCents: row.previousYearTurnoverCents, previousYearExternalTurnoverCents: row.previousYearExternalTurnoverCents, completeness: row.completeness, sourceNote: row.sourceNote };
}
function amount(cents: string | null): string {
  if (cents === null) return '';
  const value = BigInt(cents);
  return `${value / BigInt(100)}.${String(value % BigInt(100)).padStart(2, '0')}`;
}
function cents(value: string): string | null {
  if (!value.trim()) return null;
  if (!/^\d+(?:[.,]\d{1,2})?$/u.test(value)) return `invalid:${value}`;
  const [whole, fraction = ''] = value.replace(',', '.').split('.');
  return (BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'))).toString();
}
const completenessNames = { UNKNOWN: 'Noch offen', PARTIAL: 'Teilweise bekannt', COMPLETE: 'Von mir als vollständig erklärt' };

export function AnnualBusinessContextSettings() {
  const year = new Date().getUTCFullYear();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<AnnualContextResponse | null>(null);
  const [form, setForm] = useState(() => blank(year));
  const [totalText, setTotalText] = useState('');
  const [externalText, setExternalText] = useState('');
  const [saved, setSaved] = useState(() => blank(year));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [confirmed, setConfirmed] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const changed = JSON.stringify(form) !== JSON.stringify(saved);
  const history = data?.history.filter(row => row.contextYear === form.contextYear).slice().reverse() ?? [];

  useEffect(() => {
    if (!changed) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const navigate = (event: MouseEvent) => {
      const link = (event.target as Element).closest?.('a[href]');
      if (link && !window.confirm('Ungespeicherter Jahreskontext wird verworfen. Seite verlassen?')) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('click', navigate, true);
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('click', navigate, true); };
  }, [changed]);
  useEffect(() => { if (Object.keys(errors).length) errorRef.current?.focus(); }, [errors]);

  function setFields(next: AnnualContextInput) {
    setForm(next); setTotalText(amount(next.previousYearTurnoverCents)); setExternalText(amount(next.previousYearExternalTurnoverCents));
  }
  async function load(preserveInputs = false) {
    setLoading(true);
    setErrors({});
    try {
      const response = await fetch('/api/settings/annual-context', { cache: 'no-store' });
      if (!response.ok) throw new Error();
      const result = await response.json() as AnnualContextResponse;
      if (result.version !== ANNUAL_CONTEXT_VERSION || !Array.isArray(result.history)) throw new Error();
      setData(result);
      const row = result.history.filter(item => item.contextYear === form.contextYear).at(-1);
      const next = row ? inputFrom(row) : blank(form.contextYear);
      setSaved(next);
      if (!preserveInputs) setFields(next);
      setConfirmed(false);
      setConflict(false);
      if (preserveInputs) setMessage('Neuester Stand geladen. Ihre Eingaben bleiben ungespeichert. Vergleichen Sie den Verlauf und erklären Sie eine Korrektur bewusst erneut.');
    } catch { setErrors({ load: 'Jahreskontext konnte nicht geladen werden. Es wurde nichts gespeichert. Bitte erneut laden.' }); }
    finally { setLoading(false); }
  }
  function update<K extends keyof AnnualContextInput>(key: K, value: AnnualContextInput[K]) {
    setForm(previous => ({ ...previous, [key]: value })); setConfirmed(false); setErrors({}); setMessage('');
  }
  function changeYear(value: string) {
    const nextYear = Number(value);
    if (changed && !window.confirm('Ungespeicherte Angaben vor dem Jahreswechsel verwerfen?')) return;
    const row = data?.history.filter(item => item.contextYear === nextYear).at(-1);
    const next = row ? inputFrom(row) : blank(nextYear);
    setFields(next); setSaved(next); setConfirmed(false); setErrors({}); setMessage('');
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (savingRef.current || !data || conflict) return;
    const validation = validateAnnualContext(form);
    const nextErrors = validation.ok ? {} : validation.fieldErrors;
    if (!confirmed) nextErrors.declaration = 'Bitte die eigenen Angaben ausdrücklich erklären.';
    setErrors(nextErrors); setMessage('');
    if (Object.keys(nextErrors).length || !validation.ok) return;
    savingRef.current = true; setSaving(true);
    try {
      const response = await fetch('/api/settings/annual-context', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...validation.data, version: 1, expectedRevision: data.revision, declaration: true }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        setErrors({ ...(result?.fieldErrors ?? {}), save: result?.error || 'Nicht gespeichert. Ihre Angaben bleiben hier erhalten.' });
        if (response.status === 409) { setConflict(true); setConfirmed(false); }
        return;
      }
      if (!result?.saved || result.revision !== data.revision + 1) throw new Error();
      const next = inputFrom(result.saved);
      setData({ version: 1, revision: result.revision, history: [...data.history, result.saved] });
      setSaved(next); setFields(next); setConfirmed(false);
      setMessage(`Jahreskontext als Revision ${result.revision} gespeichert. Nicht unabhängig geprüft; Steuerprofil und bestehende Belege unverändert.`);
    } catch { setErrors({ save: 'Speicherung nicht bestätigt. Ihre Eingaben bleiben erhalten. Laden Sie vor einem erneuten Versuch den neuesten Stand.' }); setConflict(true); setConfirmed(false); }
    finally { savingRef.current = false; setSaving(false); }
  }
  function toggle() {
    if (saving || loading) return;
    if (open && changed && !window.confirm('Ungespeicherten Jahreskontext verwerfen und schließen?')) return;
    if (open) { setFields(saved); setConfirmed(false); setErrors({}); }
    else if (!data) void load();
    setOpen(!open);
  }
  const disabled = loading || saving || !data;
  const fieldError = (key: string) => errors[key] ? <p id={`annual-${key}-error`} className={styles.error}>{errors[key]}</p> : null;
  return <section id="annual-context" className={styles.panel} aria-labelledby="annual-context-title">
    <header className={`${styles.header} ${contextStyles.header}`}><div><h2 id="annual-context-title">Optionaler Jahreskontext</h2><p>Eigene Jahresangaben später ergänzen. Kein Steuerstatus, keine automatische Einstufung und keine Änderung bestehender Belege.</p></div>
      <Button type="button" variant="outline" aria-expanded={open} aria-controls="annual-context-content" onClick={toggle} disabled={loading || saving}>{open ? 'Jahreskontext schließen' : 'Jahreskontext öffnen'}</Button></header>
    {open && <div id="annual-context-content" className={styles.body}>
      {loading && <p role="status">Jahreskontext wird geladen…</p>}
      {errors.load && <Button type="button" onClick={() => void load()} disabled={loading}>Jahreskontext erneut laden</Button>}
      {Object.keys(errors).length > 0 && <p ref={errorRef} tabIndex={-1} role="alert" className={styles.error}>{errors.load || errors.save || 'Nicht gespeichert. Bitte prüfen Sie die markierten Angaben.'}</p>}
      <form onSubmit={save} noValidate>
        <fieldset disabled={disabled} className="space-y-5">
          <legend className={styles.legend}>Eigene Angaben für ein Jahr</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label htmlFor="annual-year">Kontextjahr</label><Input id="annual-year" type="number" min={1901} max={9999} value={form.contextYear || ''} onChange={event => changeYear(event.target.value)} aria-invalid={Boolean(errors.contextYear)} aria-describedby="annual-contextYear-error" />{fieldError('contextYear')}</div>
            <div><label htmlFor="annual-effective">Diese Kontextangaben gültig ab</label><Input id="annual-effective" type="date" value={form.effectiveFrom} onChange={event => update('effectiveFrom', event.target.value)} aria-invalid={Boolean(errors.effectiveFrom)} aria-describedby="annual-effectiveFrom-error" />{fieldError('effectiveFrom')}</div>
            <div><label htmlFor="annual-founding">Gründungsjahr · leer = unbekannt</label><Input id="annual-founding" type="number" min={1900} max={form.contextYear} value={form.foundingYear ?? ''} onChange={event => update('foundingYear', event.target.value === '' ? null : Number(event.target.value))} aria-invalid={Boolean(errors.foundingYear)} aria-describedby="annual-foundingYear-error" />{fieldError('foundingYear')}</div>
          </div>
          <p className={styles.description}>Umsätze des Vorjahres {form.contextYear - 1}, in EUR. Leer bedeutet unbekannt, „0“ bedeutet ausdrücklich null Euro. Der externe Anteil ist bereits im Gesamtumsatz enthalten, nicht zusätzlich.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label htmlFor="annual-turnover">Gesamtumsatz im Vorjahr (EUR)</label><Input id="annual-turnover" maxLength={20} inputMode="decimal" value={totalText} onChange={event => { setTotalText(event.target.value); update('previousYearTurnoverCents', cents(event.target.value)); }} aria-invalid={Boolean(errors.previousYearTurnoverCents)} aria-describedby="annual-previousYearTurnoverCents-error" />{fieldError('previousYearTurnoverCents')}</div>
            <div><label htmlFor="annual-external">Davon außerhalb Bivaro erfasst (EUR)</label><Input id="annual-external" maxLength={20} inputMode="decimal" value={externalText} onChange={event => { setExternalText(event.target.value); update('previousYearExternalTurnoverCents', cents(event.target.value)); }} aria-invalid={Boolean(errors.previousYearExternalTurnoverCents)} aria-describedby="annual-previousYearExternalTurnoverCents-error" />{fieldError('previousYearExternalTurnoverCents')}</div>
          </div>
          <div><label htmlFor="annual-completeness">Von mir erklärter Datenstand</label><select id="annual-completeness" value={form.completeness} onChange={event => update('completeness', event.target.value as ContextCompleteness)} className="mt-1 block min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring" aria-invalid={Boolean(errors.completeness)} aria-describedby="annual-completeness-help annual-completeness-error">{Object.entries(completenessNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><p id="annual-completeness-help" className={styles.description}>Vollständig bedeutet: Gründungsjahr und beide Vorjahresbeträge sind bekannt. Dies ist Ihre Erklärung, keine fachliche Verifizierung.</p>{fieldError('completeness')}</div>
          <div><label htmlFor="annual-source">Quelle Ihrer Angaben</label><Input id="annual-source" maxLength={200} value={form.sourceNote} placeholder="Zum Beispiel: eigene Jahresaufstellung 2025" onChange={event => update('sourceNote', event.target.value)} aria-invalid={Boolean(errors.sourceNote)} aria-describedby="annual-sourceNote-error" />{fieldError('sourceNote')}</div>
          <label className={styles.confirmation}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} aria-invalid={Boolean(errors.declaration)} /><span>Ich erkläre diese Angaben für das gewählte Jahr und Gültigkeitsdatum selbst. Bivaro hat sie nicht unabhängig geprüft.</span></label>{fieldError('declaration')}
        </fieldset>
        <div className={styles.notice}><strong>Nur Kontext, keine Steuerentscheidung</strong>Das Datum gilt nur für diese eigenen Kontextangaben. Es ändert weder Ihr Steuerprofil noch alte Rechnungen, Zahlungen oder Exporte. Neue Angaben ergänzen den Verlauf; ältere Revisionen bleiben erhalten.</div>
        <p role="status" className={styles.status}>{message || (data ? `Gespeicherte Revision: ${data.revision}. ${history.length ? 'Eigene Erklärung vorhanden · nicht unabhängig geprüft.' : 'Für dieses Jahr noch keine Erklärung.'}` : '')}</p>
        {conflict && <Button type="button" variant="outline" disabled={loading || saving} onClick={() => void load(true)}>Neueren Stand laden · Eingaben behalten</Button>}
        <div className={styles.actions}><p>{changed ? 'Ungespeicherte Kontextangaben' : 'Keine ungespeicherten Kontextangaben'}. Zurück oder Navigation speichert nicht.</p><Button type="button" variant="outline" disabled={disabled || !changed} onClick={() => { setFields(saved); setConfirmed(false); setErrors({}); setMessage('Änderungen verworfen. Gespeicherte Angaben bleiben unverändert.'); }}>Kontext verwerfen</Button><Button type="submit" disabled={disabled || !changed || conflict}>{saving ? 'Wird gespeichert…' : 'Kontextrevision speichern'}</Button></div>
      </form>
      <details className="min-w-0 rounded-md border p-3"><summary className="cursor-pointer font-medium focus-visible:outline-2">Versionsverlauf für {form.contextYear} ({history.length})</summary>
        {history.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Keine gespeicherten Kontextangaben für dieses Jahr.</p> : <ol className="mt-3 space-y-4">{history.map(row => <li key={row.revision} className="break-words border-t pt-3 text-sm"><strong>Revision {row.revision} · Kontext gültig ab {row.effectiveFrom}</strong><p>Erklärt am {new Date(row.declaredAt).toLocaleString('de-DE')} · nicht unabhängig geprüft</p><p>Gründung: {row.foundingYear ?? 'unbekannt'} · Vorjahr {row.contextYear - 1}: {row.previousYearTurnoverCents === null ? 'unbekannt' : `${amount(row.previousYearTurnoverCents)} EUR`} · davon extern: {row.previousYearExternalTurnoverCents === null ? 'unbekannt' : `${amount(row.previousYearExternalTurnoverCents)} EUR`}</p><p>{completenessNames[row.completeness]} · Quelle: {row.sourceNote}</p></li>)}</ol>}
      </details>
    </div>}
  </section>;
}
