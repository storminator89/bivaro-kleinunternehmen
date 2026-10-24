"use client";

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { validateNumberingFormat, type NumberingPolicy } from '@/lib/document-numbering-policy';

type PolicyRow = NumberingPolicy & { nextNumber: string | null; error: string | null };
const names = { INVOICE: 'Rechnungen', QUOTE: 'Angebote', CREDIT_NOTE: 'Stornogutschriften' };
function NumberingRow({ row, reload }: { row: PolicyRow; reload: (saved?: boolean) => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(row);
  const [preview, setPreview] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const id = `numbering-${row.type}`;
  function change(next: Partial<PolicyRow>) { setForm(previous => ({ ...previous, ...next })); setPreview(null); setConfirmed(false); setMessage(''); }
  function close() { if (busyRef.current) return; setEditing(false); setForm(row); setPreview(null); setConfirmed(false); setMessage(''); triggerRef.current?.focus(); }
  async function submit(action: 'preview' | 'save') {
    if (busyRef.current || blocked) return;
    try { validateNumberingFormat(form); } catch (error) { setMessage(error instanceof Error ? error.message : 'Bitte das Format prüfen.'); return; }
    if (action === 'save' && (!preview || !confirmed)) return;
    busyRef.current = true; setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/settings/document-numbering', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 1, ...form, expectedRevision: row.revision, expectedNumber: preview, confirmed, action }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(result?.error || 'Nicht gespeichert. Bitte erneut prüfen.');
        setPreview(null); setConfirmed(false);
        if (response.status === 409) setBlocked(true);
        return;
      }
      if (action === 'preview') { if (typeof result?.nextNumber !== 'string') throw new Error(); setPreview(result.nextNumber); setConfirmed(false); }
      else { if (result?.saved !== true) throw new Error(); reload(true); }
    } catch {
      setMessage(action === 'save' ? 'Speicherung nicht bestätigt. Vor erneutem Speichern bitte den neuesten Stand laden.' : 'Prüfung fehlgeschlagen. Es wurde nichts gespeichert; bitte erneut prüfen.');
      if (action === 'save') setBlocked(true);
    } finally { busyRef.current = false; setBusy(false); }
  }
  useEffect(() => { if (message) errorRef.current?.focus(); }, [message]);
  return <div className="rounded-lg border p-3 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-medium">{names[row.type]}</h3><p className="text-sm text-muted-foreground break-all">{row.nextNumber ? `Nächste Nummer: ${row.nextNumber}` : row.error || 'Keine sichere Vorschau'} · Revision {row.revision}/100</p></div><Button ref={triggerRef} type="button" variant="outline" size="sm" disabled={busy || row.revision >= 100} aria-expanded={editing} aria-controls={id} onClick={() => editing ? close() : setEditing(true)}>{editing ? 'Abbrechen' : 'Ändern'}</Button></div>
    {editing && <div id={id} className="space-y-3">
      <fieldset disabled={busy || blocked} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><legend className="sr-only">Nummernformat für {names[row.type]}</legend>
        <div><label className="text-sm" htmlFor={`${id}-prefix`}>Präfix (max. 16 Zeichen)</label><Input id={`${id}-prefix`} maxLength={16} value={form.prefix} onChange={event => change({ prefix: event.target.value })} placeholder="RE-" /></div>
        <div><label className="text-sm" htmlFor={`${id}-width`}>Mindestbreite der Sequenz</label><Input id={`${id}-width`} type="number" min={1} max={10} step={1} value={form.sequenceWidth} onChange={event => change({ sequenceWidth: Number(event.target.value) })} /></div>
        <div><label className="text-sm" htmlFor={`${id}-start`}>Nächster Startwert</label><Input id={`${id}-start`} type="number" min={1} max={2147483647} step={1} value={form.startSequence} onChange={event => change({ startSequence: Number(event.target.value) })} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.includeYear} onChange={event => change({ includeYear: event.target.checked })} />Jahr in der Nummer</label>
      </fieldset>
      <p className="text-xs text-muted-foreground">Bisher nur mit Jahr: Jahreszähler, Startwert nur für {row.effectiveYear}. Sobald einmal ohne Jahr gespeichert: dauerhaft fortlaufend über alle Jahre, auch bei erneut eingeblendetem Jahr. Unklare Altformate blockieren die Umstellung. Historische Dokumente bleiben unverändert.</p>
      {message && <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-destructive">{message}</p>}
      {preview && <><p className="text-sm break-all" role="status">Geprüft, nicht reserviert: <strong>{preview}</strong></p><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />Dieses Format und den Startwert ausschließlich für künftige Nummernvergaben verwenden.</label></>}
      <div className="flex flex-wrap gap-2">{blocked ? <Button type="button" variant="outline" onClick={() => reload()}>Neuesten Stand laden</Button> : <><Button type="button" variant={preview ? 'outline' : 'default'} disabled={busy} onClick={() => void submit('preview')}>{busy ? 'Bitte warten…' : 'Vorschau prüfen'}</Button>{preview && <Button type="button" disabled={busy || !confirmed} onClick={() => void submit('save')}>Nummernformat bestätigen</Button>}</>}</div>
    </div>}
  </div>;
}
export function DocumentNumberingSettings() {
  const [rows, setRows] = useState<PolicyRow[] | null>(null);
  const [generation, setGeneration] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    fetch('/api/settings/document-numbering', { cache: 'no-store' }).then(async response => {
      const result = await response.json();
      if (!response.ok || result.version !== 1 || !Array.isArray(result.rows) || result.rows.length !== 3) throw new Error();
      if (active) { setRows(result.rows); setError(''); }
    }).catch(() => { if (active) setError('Nummernformate konnten nicht geladen werden.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [generation]);
  function reload(saved = false) { setLoading(true); setRows(null); setMessage(saved ? 'Nummernformat gespeichert. Offene Editorvorschauen müssen ausdrücklich aktualisiert werden.' : ''); setGeneration(value => value + 1); }
  return <Card id="document-numbering-settings"><CardHeader><CardTitle>Nummernkreise</CardTitle><p className="text-sm text-muted-foreground">Vorschauen reservieren keine Nummer. Rechnungen, Angebote und Stornogutschriften bleiben getrennte Zähler; Dokumentnummern müssen gemeinsam eindeutig sein.</p></CardHeader><CardContent className="space-y-3">
    {loading && <p role="status">Nummernformate werden geladen…</p>}{message && <p role="status" className="text-sm">{message}</p>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}{error && <Button type="button" variant="outline" onClick={() => reload()}>Erneut laden</Button>}
    {rows?.map(row => <NumberingRow key={`${generation}:${row.type}:${row.revision}`} row={row} reload={reload} />)}
  </CardContent></Card>;
}
