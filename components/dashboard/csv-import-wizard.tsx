'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { autoMapColumns, fieldsFor, MAX_IMPORT_BYTES, parseImportCsv, type ImportKind, type ImportColumnMapping, type ParsedImportCsv } from '@/lib/data-import-contract';
import type { ImportPreview, ImportResult } from '@/lib/data-import-service';
import { formatArticlePrice } from '@/lib/service-articles';
import styles from '@/components/customers/customer-workspace.module.css';

const RECEIPT_KEY = 'bivaro-last-csv-import';
const selectClass = styles.select;
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
  if (result) return <section className={styles.importResult} aria-labelledby="import-result">
    <h2 id="import-result" ref={heading} tabIndex={-1}>{result.imported} {result.kind === 'customers' ? 'Kunden' : 'Artikel und Leistungen'} übernommen</h2>
    <p role="status" className={styles.importStatus}>Import abgeschlossen</p>
    <p>{result.skipped} Zeilen wurden wie in der Vorschau übersprungen. Bestehende Datensätze wurden nicht verändert.</p>
    <p className={styles.importMuted}>Es wurden keine Rechnungen, Angebote oder Buchungen erstellt. Ihr Steuerprofil bleibt unverändert.</p>
    <div className={styles.importActions}><Button asChild><Link href={result.kind === 'customers' ? '/customers' : '/customers/articles'}>{result.kind === 'customers' ? 'Zur Kundenliste' : 'Zum Artikelkatalog'}</Link></Button><Button type="button" variant="outline" onClick={() => { setResult(null); setKind(initialKind); setRecovery(''); try { sessionStorage.removeItem(RECEIPT_KEY); } catch { /* optional storage */ } resetPreview(); }}>Weitere Datei importieren</Button></div>
  </section>;
  return <div className={styles.importFlow}>
    <ol className={styles.importSteps} aria-label="Importschritte">
      <li aria-current={!parsed ? 'step' : undefined}><span>1</span>Datei auswählen</li>
      <li aria-current={parsed && !preview ? 'step' : undefined}><span>2</span>Spalten zuordnen</li>
      <li aria-current={preview ? 'step' : undefined}><span>3</span>Prüfen und bestätigen</li>
    </ol>
    {recovery && <p role="status" className={styles.importRecovery}>{recovery}</p>}
    {error && <div role="alert" className={styles.importError}>{error}</div>}
    {!preview ? <section className={styles.importFile} aria-labelledby="import-file-title">
      <h2 id="import-file-title">Datei auswählen</h2>
      <fieldset disabled={busy} className={styles.importFileFields}>
        <div className={styles.importKind}><Label htmlFor="import-kind">Datenart</Label><select id="import-kind" className={selectClass} value={kind} onChange={event => { setKind(event.target.value as ImportKind); resetPreview(); setParsed(null); setCsv(''); setFileName(''); }}><option value="customers">Kunden</option><option value="articles">Artikel und Leistungen</option></select></div>
        <div className={styles.importTemplate}><Button type="button" variant="outline" onClick={() => downloadTemplate(kind)}>CSV-Vorlage herunterladen</Button><span>UTF-8</span><span>max. 256 KiB / 500 Zeilen</span></div>
        {kind === 'articles' && <details className={styles.articleRules}><summary>Preise und Steuersätze</summary><p>Preise sind EUR je Einheit. Preisbasis <strong>NET</strong> = netto, <strong>GROSS</strong> = brutto. Steuersatz immer ausdrücklich 0, 7 oder 19 angeben; leer bedeutet unbekannt, nicht 0. Bruttopreise werden einmalig auf volle Netto-Cent gerundet; dadurch können später berechnete Bruttosummen centweise abweichen. Der Import ändert weder Ihren Steuerstatus noch spätere Dokumente.</p></details>}
        <div className={styles.importFileInput}><Label htmlFor="import-file">CSV-Datei auswählen</Label><Input key={kind} id="import-file" type="file" accept=".csv,text/csv,text/tab-separated-values" className="h-auto min-h-12 cursor-pointer py-3" onChange={event => void chooseFile(event.target.files?.[0])} /></div>
        {parsed && <div className={styles.importMapping}>
          <h3>Spalten zuordnen</h3>
          <div className={styles.importFileMeta}><span>{fileName}</span><span>{parsed.rows.length} Datenzeilen</span><span>{parsed.delimiter === '\t' ? 'Tabulator' : `Trennzeichen ${parsed.delimiter}`}</span><p>Nicht zugeordnete Spalten werden ausgelassen.</p></div>
          <div className={styles.mappingFields}>{fieldsFor(kind).map(field => <div key={field.key}><Label htmlFor={`map-${field.key}`}>{field.label}{field.required ? ' *' : ' (optional)'}</Label><select id={`map-${field.key}`} className={selectClass} value={mapping[field.key] ?? -1} onChange={event => { resetPreview(); setMapping(current => ({ ...current, [field.key]: Number(event.target.value) })); }}><option value={-1}>Nicht zugeordnet</option>{parsed.headers.map((header, index) => <option key={index} value={index}>{header}</option>)}</select><p>Beispiel: {parsed.rows[0]?.cells[mapping[field.key]] || '—'}</p></div>)}</div>
          <Button type="button" onClick={() => void loadPreview()} disabled={busy}>{busy ? 'Vorschau wird geprüft …' : 'Vorschau prüfen'}</Button>
        </div>}
      </fieldset>
    </section> : <section className={styles.importPreview} aria-labelledby="import-preview-title">
      <div className={styles.previewContent}>
        <div className={styles.previewHeading}><h2 id="import-preview-title" ref={heading} tabIndex={-1}>Vorschau: {title}</h2><p role="status" className={styles.importStatus}>Noch nichts gespeichert</p></div>
        <div role="status" className={styles.previewCounts}><div><strong>{preview.counts.ready}</strong><span>neu und gültig</span></div><div><strong>{preview.counts.invalid}</strong><span>fehlerhaft</span></div><div><strong>{preview.counts.duplicate}</strong><span>doppelt</span></div></div>
        <details className={styles.importRules}><summary>Importregeln</summary><p>Fehlerhafte und doppelte Zeilen werden ausgelassen. {kind === 'customers' ? 'Als doppelt gelten gleicher Name, E-Mail und Anschrift (Straße, PLZ, Stadt); andere Angaben werden nicht zusammengeführt.' : 'Gleiche Artikelbezeichnungen gelten als doppelt – auch bei anderen Preisen. Es wird nichts überschrieben.'} Die erste gültige Zeile innerhalb der Datei gewinnt.</p></details>
        <div className={styles.importRows} aria-label="Alle Importzeilen">{preview.rows.map(row => <details key={row.line} className={styles.importRow}>
          <summary><span className={styles.importRowName}>Zeile {row.line} · {row.data.name || 'Ohne Name'}</span><span className={styles.importRowStatus}>{row.status === 'ready' ? 'Wird angelegt' : row.status === 'duplicate' ? 'Doppelt – ausgelassen' : 'Fehler – ausgelassen'}</span></summary>
          {row.errors.length > 0 && <ul className={styles.importRowErrors}>{row.errors.map((message, index) => <li key={index}>{message}</li>)}</ul>}
          {row.reason && <p className={styles.importMuted}>{row.reason}</p>}
          <dl className={styles.importRowDetails}>{fieldsFor(kind).map(field => <div key={field.key}><dt>{field.label}</dt><dd>{field.key === 'price' ? row.data.sourcePriceCents ? formatArticlePrice(row.data.sourcePriceCents) : 'Nicht angegeben' : field.key === 'priceBasis' ? row.data.sourcePriceBasis || 'Nicht angegeben' : row.data[field.key] || 'Nicht angegeben'}</dd></div>)}{kind === 'articles' && row.data.unitPriceCents && <div><dt>Gespeicherter Netto-Einzelpreis</dt><dd>{formatArticlePrice(row.data.unitPriceCents)} · {row.data.taxRate} % Steuer (Quelle)</dd></div>}</dl>
        </details>)}</div>
      </div>
      <div className={styles.previewReview}>
        <label className={styles.reviewConfirmation}><input type="checkbox" checked={reviewed} disabled={busy || !preview.counts.ready} onChange={event => setReviewed(event.target.checked)} /><span>Ich habe die Vorschau{kind === 'articles' ? ' einschließlich Netto-/Bruttopreisen und Steuersätzen' : ''} geprüft. Genau {preview.counts.ready} neue Datensätze anlegen; {preview.counts.invalid + preview.counts.duplicate} Zeilen auslassen.</span></label>
        <div className={styles.importActions}><Button type="button" disabled={busy || !reviewed || !preview.counts.ready} onClick={() => void confirmImport()}>{busy ? 'Import wird abgeschlossen …' : requestId.current ? 'Mit derselben Importkennung erneut bestätigen' : `${preview.counts.ready} Datensätze jetzt importieren`}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => { resetPreview(); }}>Zurück zur Zuordnung</Button><Button variant="ghost" asChild disabled={busy}><Link href="/customers" aria-disabled={busy} onClick={event => { if (busy) event.preventDefault(); }}>Abbrechen</Link></Button></div>
      </div>
    </section>}
  </div>;
}
