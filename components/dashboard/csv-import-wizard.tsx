'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { autoMapColumns, fieldsFor, MAX_IMPORT_BYTES, parseImportCsv, type ImportKind, type ImportColumnMapping, type ParsedImportCsv } from '@/lib/data-import-contract';
import type { ImportPreview, ImportResult } from '@/lib/data-import-service';
import { formatArticlePrice } from '@/lib/service-articles';

const RECEIPT_KEY = 'bivaro-last-csv-import';
const selectClass = 'min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring';
const templates = {
  customers: 'Name;E-Mail;Straße;PLZ;Stadt;Ansprechpartner;Telefon;Steuernummer\r\nBeispielbetrieb;kontakt@beispiel.invalid;Musterweg 1;01234;Musterstadt;Alex Beispiel;+49 30 123456;\r\n',
  articles: 'Name;Beschreibung;Einheit;Preis;Preisbasis;Steuersatz\r\nWartung;Wartung vor Ort;Stunde;119,00;GROSS;19\r\nBeratung;Individuelle Beratung;Stunde;75,00;NET;0\r\n',
};
function downloadTemplate(kind: ImportKind) {
  const url = URL.createObjectURL(new Blob(['\uFEFF', templates[kind]], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `bivaro-${kind === 'customers' ? 'kunden' : 'artikel'}-vorlage.csv`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function CsvImportWizard({ initialKind = 'customers' }: { initialKind?: ImportKind }) {
  const [kind, setKind] = useState<ImportKind>(initialKind);
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParsedImportCsv | null>(null);
  const [mapping, setMapping] = useState<ImportColumnMapping>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recovery, setRecovery] = useState('');
  const requestId = useRef('');
  const generation = useRef(0);
  const submitting = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let active = true;
    let prior: string | null = null;
    try { prior = sessionStorage.getItem(RECEIPT_KEY); } catch { /* Browser storage is optional. */ }
    if (prior) {
      fetch(`/api/data-import?requestId=${encodeURIComponent(prior)}`, { cache: 'no-store' })
        .then(async response => { if (!response.ok) throw new Error(); return response.json(); })
        .then(data => { if (!active || generation.current !== 0) return; if (data.result) { setKind(data.result.kind); setResult(data.result); } else setRecovery('Für die letzte Importkennung liegt noch kein bestätigtes Ergebnis vor. Wählen Sie dieselbe Datei erneut aus und prüfen Sie die Vorschau. Vorhandene Datensätze werden übersprungen.'); })
        .catch(() => { if (active) setRecovery('Das letzte Importergebnis ist gerade nicht abrufbar. Bitte später erneut laden, bevor Sie einen neuen Import beginnen.'); });
    }
    return () => { active = false; };
  }, []);
  function resetPreview() { generation.current++; setPreview(null); setReviewed(false); setError(''); requestId.current = ''; }
  async function chooseFile(file: File | undefined) {
    resetPreview(); setParsed(null); setCsv(''); setFileName('');
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) { setError('Die Datei ist zu groß. Erlaubt sind höchstens 256 KiB.'); return; }
    const current = generation.current;
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      const value = parseImportCsv(text);
      if (current !== generation.current) return;
      setCsv(text); setParsed(value); setMapping(autoMapColumns(kind, value.headers)); setFileName(file.name);
    } catch (failure) { if (current === generation.current) setError(failure instanceof Error && failure.name === 'ImportInputError' ? failure.message : 'Bitte eine gültige UTF-8-CSV-Datei auswählen.'); }
  }
  async function loadPreview() {
    setBusy(true); setError(''); setReviewed(false); requestId.current = '';
    const current = generation.current;
    try {
      const response = await fetch('/api/data-import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'preview', kind, csv, mapping }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || 'Die Vorschau konnte nicht erstellt werden.');
      if (current === generation.current) { setPreview(value); setTimeout(() => heading.current?.focus(), 0); }
    } catch (failure) { if (current === generation.current) setError(failure instanceof Error && !(failure instanceof TypeError) && !(failure instanceof SyntaxError) ? failure.message : 'Die Vorschau ist gerade nicht erreichbar. Bitte erneut versuchen.'); }
    finally { setBusy(false); }
  }
  async function confirmImport() {
    if (!preview || !reviewed || submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    if (!requestId.current) requestId.current = crypto.randomUUID();
    const id = requestId.current;
    try {
      // Only an opaque receipt ID survives reload; never store CSV/customer data.
      try { sessionStorage.setItem(RECEIPT_KEY, id); } catch { /* Import works without browser storage. */ }
      const response = await fetch('/api/data-import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'confirm', kind, csv, mapping, reviewed: true, fingerprint: preview.fingerprint, requestId: id }) });
      const value = await response.json();
      if (!response.ok) {
        if (response.status === 409) { setPreview(null); setReviewed(false); requestId.current = ''; }
        throw new Error(value.error || 'Das Ergebnis ist noch unklar. Bitte mit derselben Importkennung erneut versuchen.');
      }
      setResult(value); setCsv(''); setParsed(null); setPreview(null); setTimeout(() => heading.current?.focus(), 0);
    } catch (failure) { setError(failure instanceof Error && !(failure instanceof TypeError) && !(failure instanceof SyntaxError) ? failure.message : 'Keine eindeutige Antwort erhalten. Erneut bestätigen ist mit derselben Importkennung sicher; es werden keine zusätzlichen Datensätze angelegt.'); }
    finally { setBusy(false); submitting.current = false; }
  }
  const title = kind === 'customers' ? 'Kunden' : 'Artikel und Leistungen';
  if (result) return <section className="space-y-5 rounded-xl border bg-card p-5 sm:p-8" aria-labelledby="import-result">
    <p className="text-xs font-medium uppercase tracking-wider text-primary">Import abgeschlossen</p>
    <h2 id="import-result" ref={heading} tabIndex={-1} className="text-2xl font-semibold">{result.imported} {result.kind === 'customers' ? 'Kunden' : 'Artikel und Leistungen'} übernommen</h2>
    <p>{result.skipped} Zeilen wurden wie in der Vorschau übersprungen. Bestehende Datensätze wurden nicht verändert.</p>
    <p className="text-sm text-muted-foreground">Es wurden keine Rechnungen, Angebote oder Buchungen erstellt. Ihr Steuerprofil bleibt unverändert.</p>
    <div className="flex flex-wrap gap-3"><Button asChild><Link href={result.kind === 'customers' ? '/customers' : '/customers/articles'}>{result.kind === 'customers' ? 'Zur Kundenliste' : 'Zum Artikelkatalog'}</Link></Button><Button variant="outline" onClick={() => { setResult(null); setKind(initialKind); setRecovery(''); try { sessionStorage.removeItem(RECEIPT_KEY); } catch { /* optional storage */ } resetPreview(); }}>Weitere Datei importieren</Button></div>
  </section>;
  return <div className="space-y-6">
    <ol className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground" aria-label="Importschritte"><li className={!parsed ? 'font-semibold text-primary' : ''}>1 · Datei auswählen</li><li className={parsed && !preview ? 'font-semibold text-primary' : ''}>2 · Spalten zuordnen</li><li className={preview ? 'font-semibold text-primary' : ''}>3 · Prüfen und bestätigen</li></ol>
    {recovery && <p role="status" className="rounded-lg border bg-muted/30 p-4 text-sm">{recovery}</p>}
    {error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>}
    {!preview ? <section className="space-y-5 rounded-xl border bg-card p-5 sm:p-8" aria-labelledby="import-file-title">
      <div><h2 id="import-file-title" className="text-xl font-semibold">Mit Ihren vorhandenen Daten starten</h2><p className="mt-2 text-sm text-muted-foreground">Nur neue Datensätze werden angelegt. Kein Überschreiben und kein automatisches Zusammenführen. Erst die letzte Bestätigung schreibt Daten.</p></div>
      <fieldset disabled={busy} className="space-y-5">
        <div className="space-y-2"><Label htmlFor="import-kind">Was möchten Sie importieren?</Label><select id="import-kind" className={selectClass} value={kind} onChange={event => { setKind(event.target.value as ImportKind); resetPreview(); setParsed(null); setCsv(''); setFileName(''); }}><option value="customers">Kunden</option><option value="articles">Artikel und Leistungen</option></select></div>
        <div className="rounded-lg border bg-muted/20 p-4 text-sm"><p className="font-medium">Eine verständliche Vorlage statt Rätselraten</p><p className="mt-1 text-muted-foreground">UTF-8; Semikolon, Komma oder Tabulator. Maximal 256 KiB, 500 Datenzeilen, 20 Spalten und 2.000 Zeichen je Feld. Beispielzeilen bitte durch eigene Daten ersetzen.</p><Button className="mt-3" type="button" variant="outline" onClick={() => downloadTemplate(kind)}>CSV-Vorlage herunterladen</Button></div>
        {kind === 'articles' && <p className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">Preise sind EUR je Einheit. Preisbasis <strong>NET</strong> = netto, <strong>GROSS</strong> = brutto. Steuersatz immer ausdrücklich 0, 7 oder 19 angeben; leer bedeutet unbekannt, nicht 0. Bruttopreise werden einmalig auf volle Netto-Cent gerundet; dadurch können später berechnete Bruttosummen centweise abweichen. Der Import ändert weder Ihren Steuerstatus noch spätere Dokumente.</p>}
        <div className="space-y-2"><Label htmlFor="import-file">CSV-Datei auswählen</Label><Input key={kind} id="import-file" type="file" accept=".csv,text/csv,text/tab-separated-values" className="h-auto min-h-12 cursor-pointer py-3" onChange={event => void chooseFile(event.target.files?.[0])} /><p className="text-xs text-muted-foreground">Die Dateiauswahl ist vollständig per Tastatur nutzbar. Keine Übertragung an externe Migrationsdienste.</p></div>
        {parsed && <div className="space-y-4 border-t pt-5"><h3 className="font-semibold">Spalten zuordnen</h3><p className="break-all text-sm text-muted-foreground">{fileName} · {parsed.rows.length} Datenzeilen · {parsed.delimiter === '\t' ? 'Tabulator' : `Trennzeichen ${parsed.delimiter}`}. Automatische Vorschläge bitte prüfen. Nicht zugeordnete Spalten werden nicht gespeichert.</p><div className="grid gap-4 sm:grid-cols-2">{fieldsFor(kind).map(field => <div key={field.key} className="min-w-0 space-y-2"><Label htmlFor={`map-${field.key}`}>{field.label}{field.required ? ' *' : ' (optional)'}</Label><select id={`map-${field.key}`} className={selectClass} value={mapping[field.key] ?? -1} onChange={event => { resetPreview(); setMapping(current => ({ ...current, [field.key]: Number(event.target.value) })); }}><option value={-1}>Nicht zugeordnet</option>{parsed.headers.map((header, index) => <option key={index} value={index}>{header}</option>)}</select><p className="truncate text-xs text-muted-foreground">Beispiel: {parsed.rows[0]?.cells[mapping[field.key]] || '—'}</p></div>)}</div><Button type="button" onClick={() => void loadPreview()} disabled={busy}>{busy ? 'Vorschau wird geprüft …' : 'Vorschau prüfen'}</Button></div>}
      </fieldset>
    </section> : <section className="space-y-5 rounded-xl border bg-card p-5 sm:p-8" aria-labelledby="import-preview-title">
      <div><p className="text-xs font-medium uppercase tracking-wider text-primary">Noch nichts gespeichert</p><h2 id="import-preview-title" ref={heading} tabIndex={-1} className="mt-2 text-xl font-semibold">Vorschau: {title}</h2></div>
      <div role="status" className="grid grid-cols-3 gap-2 text-center text-sm"><div className="rounded-lg border border-primary/20 bg-primary/5 p-3"><strong className="block text-xl">{preview.counts.ready}</strong> neu und gültig</div><div className="rounded-lg border p-3"><strong className="block text-xl">{preview.counts.invalid}</strong> fehlerhaft</div><div className="rounded-lg border p-3"><strong className="block text-xl">{preview.counts.duplicate}</strong> doppelt</div></div>
      <p className="text-sm text-muted-foreground">Fehlerhafte und doppelte Zeilen werden ausgelassen. {kind === 'customers' ? 'Als doppelt gelten gleicher Name, E-Mail und Anschrift (Straße, PLZ, Stadt); andere Angaben werden nicht zusammengeführt.' : 'Gleiche Artikelbezeichnungen gelten als doppelt – auch bei anderen Preisen. Es wird nichts überschrieben.'} Die erste gültige Zeile innerhalb der Datei gewinnt.</p>
      <div className="max-h-[28rem] space-y-2 overflow-y-auto rounded-lg border p-2" aria-label="Alle Importzeilen">{preview.rows.map(row => <details key={row.line} className="rounded-md border bg-background p-3"><summary className="cursor-pointer break-words text-sm"><span className="font-medium">Zeile {row.line} · {row.data.name || 'Ohne Name'}</span><span className="ml-2 text-muted-foreground">{row.status === 'ready' ? 'Wird angelegt' : row.status === 'duplicate' ? 'Doppelt – ausgelassen' : 'Fehler – ausgelassen'}</span></summary>{row.errors.length > 0 && <ul className="mt-2 space-y-1 text-sm text-destructive">{row.errors.map((message, index) => <li key={index}>{message}</li>)}</ul>}{row.reason && <p className="mt-2 text-sm text-muted-foreground">{row.reason}</p>}<dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{fieldsFor(kind).map(field => <div key={field.key} className="min-w-0"><dt className="text-xs text-muted-foreground">{field.label}</dt><dd className="whitespace-pre-wrap break-words">{field.key === 'price' ? row.data.sourcePriceCents ? formatArticlePrice(row.data.sourcePriceCents) : 'Nicht angegeben' : field.key === 'priceBasis' ? row.data.sourcePriceBasis || 'Nicht angegeben' : row.data[field.key] || 'Nicht angegeben'}</dd></div>)}{kind === 'articles' && row.data.unitPriceCents && <div><dt className="text-xs text-muted-foreground">Gespeicherter Netto-Einzelpreis</dt><dd>{formatArticlePrice(row.data.unitPriceCents)} · {row.data.taxRate} % Steuer (Quelle)</dd></div>}</dl></details>)}</div>
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-4 text-sm"><input type="checkbox" checked={reviewed} disabled={busy || !preview.counts.ready} onChange={event => setReviewed(event.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--primary)]" /><span>Ich habe die Vorschau{kind === 'articles' ? ' einschließlich Netto-/Bruttopreisen und Steuersätzen' : ''} geprüft. Genau {preview.counts.ready} neue Datensätze anlegen; {preview.counts.invalid + preview.counts.duplicate} Zeilen auslassen.</span></label>
      <div className="flex flex-wrap gap-3"><Button disabled={busy || !reviewed || !preview.counts.ready} onClick={() => void confirmImport()}>{busy ? 'Import wird abgeschlossen …' : requestId.current ? 'Mit derselben Importkennung erneut bestätigen' : `${preview.counts.ready} Datensätze jetzt importieren`}</Button><Button variant="outline" disabled={busy} onClick={() => { resetPreview(); }}>Zurück zur Zuordnung</Button><Button variant="ghost" asChild disabled={busy}><Link href="/customers" aria-disabled={busy} onClick={event => { if (busy) event.preventDefault(); }}>Abbrechen</Link></Button></div>
      <p className="text-xs text-muted-foreground">Wiederholtes Bestätigen derselben Importkennung legt nichts doppelt an. Nach einer Wiederherstellung können alte Ergebnisbelege fehlen; der aktuelle Bestand wird trotzdem auf Dubletten geprüft.</p>
    </section>}
  </div>;
}
