'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { ArrowLeft, ArrowRight, Check, FileSpreadsheet, Loader2, ShieldCheck, TriangleAlert } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BankMappingProfiles } from '@/components/bank-csv/bank-mapping-profiles';
import { applyBankMappingProfile, type BankMappingProfile, type BankMappingProfileReference } from '@/lib/bank-mapping-profile-contract';
import { BankImportHistory, BankImportSave } from '@/components/bank-csv/bank-import-panel';
import { bankImportOriginalBase64 } from '@/lib/bank-import-client';
import { BANK_CSV_INVOICE_LIMIT, loadBankInvoiceCandidates, type BankCandidateResult } from '@/lib/bank-csv-candidates';
import { MAX_BANK_CSV_BYTES, bankCsvExistingPaymentWarnings, buildBankCsvPreview, inferBankCsvMapping, parseBankCsv, suggestBankInvoiceMatches, type BankCsvDelimiter, type BankCsvMapping, type BankCsvParsed, type BankCsvPreview, type BankCsvPreviewRow } from '@/lib/bank-csv';

import styles from './bank-workspace.module.css';

const selectClass = 'min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring';
const PAGE_SIZE = 20;
type Column = 'date' | 'amount' | 'credit' | 'debit' | 'currency' | 'counterparty' | 'reference' | 'externalId';

function money(value: string) {
  const cents = BigInt(value), positive = cents < BigInt(0) ? -cents : cents;
  return `${cents < BigInt(0) ? '−' : ''}${(positive / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/gu, '.')},${(positive % BigInt(100)).toString().padStart(2, '0')} €`;
}
function dateLabel(value: string | null) { return value ? `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}` : 'Datum prüfen'; }

export function BankCsvWorkspace() {
  const { data: session } = useSession();
  // No file, reference or preview survives an account switch or sign-out.
  return <BankCsvContent key={session?.user?.id ?? 'signed-out'} accountScope={session?.user?.id ?? null} />;
}

function BankCsvContent({ accountScope }: { accountScope: string | null }) {
  const [source, setSource] = useState('');
  const [fileName, setFileName] = useState('');
  const [originalBase64, setOriginalBase64] = useState('');
  const [profilePending, setProfilePending] = useState(false);
  const [mappingProfile, setMappingProfile] = useState<BankMappingProfileReference | undefined>();
  const [importPending, setImportPending] = useState(false);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [currentSaved, setCurrentSaved] = useState(false);
  const [parsed, setParsed] = useState<BankCsvParsed | null>(null);
  const [mapping, setMapping] = useState<BankCsvMapping>(() => inferBankCsvMapping([]));
  const [delimiter, setDelimiter] = useState<BankCsvDelimiter | ''>('');
  const [headerRow, setHeaderRow] = useState(0);
  const [preview, setPreview] = useState<BankCsvPreview | null>(null);
  const [candidates, setCandidates] = useState<BankCandidateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const reading = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const mappingHeading = useRef<HTMLHeadingElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const resultsFocus = useRef<{ owner: Element | null; generation: number } | null>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  const matchesButton = useRef<HTMLButtonElement>(null);
  useEffect(() => () => { generation.current++; request.current?.abort(); }, []);
  useEffect(() => {
    const pending = resultsFocus.current;
    if (!candidates || !pending) return;
    resultsFocus.current = null;
    // Concurrent rendering may commit the results after the next animation
    // frame. Deliver focus only once the heading exists, without stealing it.
    if (generation.current === pending.generation && (document.activeElement === pending.owner || document.activeElement === document.body)) resultsHeading.current?.focus();
  }, [candidates]);

  function invalidate() {
    generation.current++;
    request.current?.abort(); request.current = null;
    reading.current = false;
    setBusy(false); setCandidates(null); setError(''); setPage(0);
  }
  function focusIfOwned(ref: { current: HTMLElement | null }, owner: Element | null, current: number) {
    requestAnimationFrame(() => {
      if (generation.current === current && (document.activeElement === owner || document.activeElement === document.body)) ref.current?.focus();
    });
  }
  function parseSource(text: string, selectedDelimiter: BankCsvDelimiter | '', selectedHeader: number) {
    const result = parseBankCsv(text, { ...(selectedDelimiter ? { delimiter: selectedDelimiter } : {}), headerRow: selectedHeader });
    setParsed(result);
    setMapping(current => ({ ...inferBankCsvMapping(result.headers), accountAlias: current.accountAlias, headerRow: selectedHeader }));
  }
  async function chooseFile(file: File | undefined) {
    if (profilePending) return;
    setMappingProfile(undefined); invalidate(); setCurrentSaved(false); setPreview(null); setParsed(null); setSource(''); setOriginalBase64(''); setFileName(''); setHeaderRow(0); setDelimiter('');
    if (!file) return;
    if (file.size > MAX_BANK_CSV_BYTES) { setError('Die Datei ist zu groß. Erlaubt sind höchstens 2 MiB.'); return; }
    const current = generation.current, owner = document.activeElement;
    reading.current = true; setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (current !== generation.current) return;
      setSource(text); setOriginalBase64(bankImportOriginalBase64(bytes)); setFileName(file.name);
      parseSource(text, '', 0);
      focusIfOwned(mappingHeading, owner, current);
    } catch (failure) {
      if (current === generation.current) setError(failure instanceof Error && failure.name !== 'TypeError' ? failure.message : 'Die Datei ist keine gültige UTF-8-CSV. Bitte im Bankexport UTF-8 wählen.');
    } finally { if (current === generation.current) { reading.current = false; setBusy(false); } }
  }
  function reparse(nextDelimiter: BankCsvDelimiter | '', nextHeader: number) {
    if (profilePending) return;
    setMappingProfile(undefined); invalidate(); setPreview(null); setParsed(null); setDelimiter(nextDelimiter); setHeaderRow(nextHeader);
    try { parseSource(source, nextDelimiter, nextHeader); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Die CSV konnte nicht gelesen werden.'); }
  }
  function updateMapping(patch: Partial<BankCsvMapping>) { if (profilePending) return; setMappingProfile(undefined); invalidate(); setPreview(null); setMapping(current => ({ ...current, ...patch })); }
  async function applyProfile(profile: BankMappingProfile): Promise<boolean> {
    invalidate(); setPreview(null); setCurrentSaved(false); setMappingProfile(undefined);
    const current = generation.current;
    try {
      const result = parseBankCsv(source, { delimiter: profile.configuration.delimiter, headerRow: profile.configuration.mapping.headerRow });
      const applied = await applyBankMappingProfile(profile.configuration, result);
      if (current !== generation.current) return false;
      setParsed(result); setDelimiter(profile.configuration.delimiter); setHeaderRow(profile.configuration.mapping.headerRow); setMapping(applied.mapping);
      if (applied.matches) setMappingProfile({ id: profile.id, revision: profile.revision });
      return applied.matches;
    } catch {
      if (current === generation.current) { setMapping({ ...inferBankCsvMapping([]), accountAlias: profile.configuration.mapping.accountAlias }); setError('Dateiformat passt nicht zum Profil. Keine Spaltenrolle wurde übernommen. Bitte Trenner und Kopfzeile manuell prüfen.'); }
      return false;
    }
  }
  function showPreview() {
    if (!parsed || busy || profilePending) return;
    invalidate(); setCurrentSaved(false);
    const value = buildBankCsvPreview(parsed, mapping);
    if (value.errors.length) { setError(value.errors.join(' ')); return; }
    setPreview(value);
    focusIfOwned(previewHeading, document.activeElement, generation.current);
  }
  async function showMatches() {
    if (!preview || busy || reading.current || request.current) return;
    const current = ++generation.current, owner = document.activeElement;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(''); setCandidates(null);
    try {
      const result = await loadBankInvoiceCandidates(controller.signal);
      if (current !== generation.current) return;
      resultsFocus.current = { owner, generation: current };
      setCandidates(result);
    } catch (failure) {
      if (current === generation.current && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Rechnungen konnten nicht geprüft werden. Die Vorschau bleibt erhalten.');
    } finally { if (current === generation.current) { controller.abort(); setBusy(false); request.current = null; } }
  }
  function backToMapping() {
    invalidate(); setCurrentSaved(false); setPreview(null);
    focusIfOwned(previewButton, document.activeElement, generation.current);
  }
  function reset() {
    if (profilePending) return;
    setMappingProfile(undefined); invalidate(); setCurrentSaved(false); setSource(''); setOriginalBase64(''); setFileName(''); setParsed(null); setPreview(null); setMapping(inferBankCsvMapping([])); setDelimiter(''); setHeaderRow(0);
    if (fileInput.current) fileInput.current.value = '';
    focusIfOwned(fileInput, document.activeElement, generation.current);
  }
  function column(field: Column, label: string, required = false) {
    return <div className="min-w-0 space-y-2"><Label htmlFor={`bank-map-${field}`}>{label}{required ? ' *' : ''}</Label><select id={`bank-map-${field}`} className={selectClass} value={mapping[field] ?? -1} onChange={event => updateMapping({ [field]: Number(event.target.value) < 0 ? null : Number(event.target.value) })}><option value={-1}>Nicht zugeordnet</option>{parsed?.headers.map((header, index) => <option key={index} value={index}>{index + 1} · {header || 'Ohne Überschrift'}</option>)}</select><p className="truncate text-xs text-muted-foreground" title={parsed?.rows[0]?.[mapping[field] ?? -1] || undefined}>Beispiel: {parsed?.rows[0]?.[mapping[field] ?? -1] || '—'}</p></div>;
  }
  const step = preview ? 3 : parsed ? 2 : 1;
  const visibleRows = preview?.rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) ?? [];
  const pageCount = Math.ceil((preview?.rows.length ?? 0) / PAGE_SIZE);
  return <div className={`${styles.workspace} mx-auto w-full min-w-0 max-w-6xl space-y-6`}>
    <PageHeader section="Zahlungseingänge" title="Bank-CSV prüfen" description="Bankumsätze verstehen. Passende Rechnungen finden. Nichts automatisch buchen." actions={<Button asChild variant="outline"><Link href="/dashboard?tab=invoices"><ArrowLeft aria-hidden="true" />Rechnungen</Link></Button>} />
    <div className={styles.progressPanel}>
      <ol aria-label="Bank-CSV Schritte" className={styles.steps}>{['Datei', 'Zuordnen', 'Prüfen'].map((label, index) => <li key={label} aria-current={step === index + 1 ? 'step' : undefined} data-state={index + 1 < step ? 'complete' : step === index + 1 ? 'current' : 'upcoming'}><span className={styles.stepNumber} aria-hidden="true">{index + 1 < step ? <Check className="size-4" /> : index + 1}</span><span>{label}</span></li>)}</ol>
      <span className={styles.evidenceState}><ShieldCheck className="size-4" aria-hidden="true" />{currentSaved ? 'Evidenz gespeichert · keine Buchung' : 'Nur Vorschau · keine Buchung'}</span>
    </div>
    {error && <div role="alert" className="rounded-xl border border-destructive/35 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>}
    {!preview ? <>
      <div className={styles.fileLayout}>
        <section aria-labelledby="bank-file-heading" className={styles.surface}>
          <div className={styles.sectionHeading}><FileSpreadsheet className="size-5 shrink-0" aria-hidden="true" /><h2 id="bank-file-heading">CSV aus deinem Bankexport</h2></div>
          <p className="mb-5 mt-2 text-sm text-muted-foreground">Bis zur Bestätigung bleibt die Datei in diesem Browser. Kein Bankzugang, kein Upload.</p>
      <div className="space-y-2"><Label htmlFor="bank-file">Bank-CSV auswählen</Label><Input ref={fileInput} id="bank-file" disabled={profilePending} type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" className={`${styles.fileInput} h-auto min-h-12 cursor-pointer py-3`} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void chooseFile(file); }} aria-describedby="bank-file-help" /><p id="bank-file-help" className="text-xs text-muted-foreground">UTF-8 · bis 2 MiB / 2.000 Umsatzzeilen · Semikolon, Komma oder Tabulator</p></div>
      {busy && !preview && <p role="status" className="mt-4 flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Datei wird gelesen…</p>}
        </section>
        <BankMappingProfiles mapping={mapping} parsed={parsed} hasSource={!!source} disabled={busy} onApply={applyProfile} onPending={setProfilePending} onDetach={() => setMappingProfile(undefined)} />
      </div>
      {source && <section className={styles.surface}><div className="mb-5 flex flex-wrap items-start justify-between gap-3"><h2 ref={mappingHeading} tabIndex={-1} className="text-lg font-semibold outline-none focus-visible:outline-2 focus-visible:outline-ring">Spalten zuordnen</h2><span className="max-w-full break-all text-xs text-muted-foreground">{fileName}{parsed ? ` · ${parsed.rows.length} Zeilen` : ''}</span></div>
        <div className={`${styles.accountFields} grid gap-4 sm:grid-cols-2`}><div className="space-y-2"><Label htmlFor="bank-alias">Kontoalias *</Label><Input id="bank-alias" disabled={profilePending} value={mapping.accountAlias} maxLength={80} placeholder="z. B. Geschäftskonto" onChange={event => updateMapping({ accountAlias: event.target.value })} /><p className="text-xs text-muted-foreground">Eigener Name, keine IBAN oder Zugangsdaten nötig.</p></div><div className="space-y-2"><Label htmlFor="bank-decimal">Dezimalzeichen *</Label><select id="bank-decimal" disabled={profilePending} className={selectClass} value={mapping.decimalSeparator} onChange={event => updateMapping({ decimalSeparator: event.target.value as ',' | '.' })}><option value=",">Komma · 1.234,56</option><option value=".">Punkt · 1,234.56</option></select></div></div>
        <details className={`${styles.disclosure} my-5`}><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Dateiformat anpassen</summary><div className="grid gap-4 pb-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="bank-delimiter">Spaltentrenner</Label><select id="bank-delimiter" disabled={profilePending} className={selectClass} value={delimiter} onChange={event => reparse(event.target.value as BankCsvDelimiter | '', headerRow)}><option value="">Automatisch erkennen</option><option value=";">Semikolon ;</option><option value=",">Komma ,</option><option value={'\t'}>Tabulator</option></select></div><div className="space-y-2"><Label htmlFor="bank-header">Kopfzeile</Label><Input id="bank-header" disabled={profilePending} type="number" min={1} max={51} value={headerRow + 1} onChange={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= 51) reparse(delimiter, value - 1); }} /><p className="text-xs text-muted-foreground">CSV-Datensatz der Überschriften; eine sep=-Angabe zählt nicht mit.</p></div></div></details>
        {parsed && <fieldset className="space-y-5" disabled={busy || profilePending}><div className="space-y-2"><Label htmlFor="bank-amount-mode">Betragsdarstellung *</Label><select id="bank-amount-mode" className={selectClass} value={mapping.amountMode} onChange={event => updateMapping({ amountMode: event.target.value as BankCsvMapping['amountMode'] })}><option value="signed">Eine Betragsspalte · Plus = Eingang, Minus = Ausgang</option><option value="credit-debit">Getrennte Haben-/Soll-Spalten · nur positive Werte</option></select></div><div className={`${styles.mappingColumns} grid gap-4 sm:grid-cols-2 lg:grid-cols-3`}>{column('date', 'Tatsächliches Buchungsdatum', true)}{mapping.amountMode === 'signed' ? column('amount', 'Betrag mit Vorzeichen', true) : <>{column('credit', 'Haben · Eingang', true)}{column('debit', 'Soll · Ausgang', true)}</>}{column('reference', 'Verwendungszweck / Referenz')}{column('currency', 'Währung')}{column('counterparty', 'Gegenpartei')}{column('externalId', 'Bank-Umsatz-ID')}</div>
          {mapping.currency === null && <label className="flex cursor-pointer items-start gap-3 rounded-lg border bg-secondary/20 p-3 text-sm"><input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-primary" checked={mapping.defaultCurrency === 'EUR'} onChange={event => updateMapping({ defaultCurrency: event.target.checked ? 'EUR' : undefined })} /><span>Der gesamte Export ist in EUR. Ich habe die Kontowährung geprüft.</span></label>}
          <div className="rounded-lg border border-caution/30 bg-caution-surface/30 px-3 py-2 text-sm">Vorzeichen prüfen: Ein Zahlungseingang muss positiv sein. Fremdwährung, Ausgänge und Fehler bleiben ohne Vorschlag.</div>
          <Button ref={previewButton} type="button" onClick={showPreview}><ArrowRight aria-hidden="true" />Vorschau prüfen</Button>
        </fieldset>}
      </section>}
    </> : <>
      <section aria-labelledby="bank-preview-heading" className={`${styles.surface} space-y-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="bank-preview-heading" ref={previewHeading} tabIndex={-1} className="mt-1 text-xl font-semibold outline-none focus-visible:outline-2 focus-visible:outline-ring">Vorschau prüfen</h2><p className="mt-1 break-all text-sm text-muted-foreground">{mapping.accountAlias}</p></div><span className="max-w-full break-all text-xs text-muted-foreground">{fileName}</span></div>
        <dl className={styles.controlTotals}><div><dt>EUR-Eingänge</dt><dd>{money(preview.totals.incomingCents)}</dd></div><div><dt>EUR-Ausgänge</dt><dd>{money(preview.totals.outgoingCents)}</dd></div><div><dt>Gültige Zeilen</dt><dd>{preview.counts.valid} / {preview.counts.total}</dd></div><div><dt>Fehler / mögliche Dubletten</dt><dd>{preview.counts.invalid} / {preview.counts.duplicates}</dd></div></dl>
        {(preview.counts.duplicates > 0 || preview.counts.invalid > 0) && <div className="flex gap-2 rounded-lg border border-caution/30 bg-caution-surface/30 p-3 text-sm"><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><p>{preview.counts.invalid > 0 ? `${preview.counts.invalid} fehlerhafte Zeilen bleiben ohne Rechnungsvorschlag. ` : ''}{preview.counts.duplicates > 0 ? 'Mögliche Dubletten wurden markiert, nicht entfernt. Gleiche Beträge können echte getrennte Umsätze sein.' : ''}</p></div>}
        <p className="text-xs text-muted-foreground">Kontrollsummen enthalten nur gültige EUR-Zeilen — auch markierte Dubletten. Das sind keine erfassten Einnahmen oder Ausgaben.</p>
        {!candidates ? <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap"><Button ref={matchesButton} variant="outline" type="button" disabled={busy || !preview.counts.incoming} onClick={() => void showMatches()}>{busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}{busy ? 'Zahlungsdaten werden geprüft…' : error ? 'Rechnungsvorschläge erneut prüfen' : 'Rechnungsvorschläge prüfen'}</Button><Button type="button" variant="outline" disabled={importPending} onClick={backToMapping}>Zurück zur Zuordnung</Button></div> : <div className={`${styles.matchSummary} space-y-3`}><h3 ref={resultsHeading} tabIndex={-1} className="flex items-center gap-2 font-semibold outline-none focus-visible:outline-2 focus-visible:outline-ring"><Check className="size-4 text-primary" aria-hidden="true" />Rechnungsvorschläge geprüft</h3><p className="text-sm text-muted-foreground">{candidates.checked} Rechnungen anhand ihres Zahlungsjournals verglichen. Vorschläge sind keine Zuordnung.</p>{(candidates.truncated || candidates.unavailable > 0) && <p role="status" className="text-sm">{candidates.truncated ? `Nur die letzten ${BANK_CSV_INVOICE_LIMIT} Rechnungen wurden berücksichtigt. ` : ''}{candidates.unavailable ? `${candidates.unavailable} Rechnungen konnten nicht sicher geprüft werden; bitte einzeln öffnen.` : ''}</p>}{candidates.reviewInvoices.length > 0 && <div className="rounded-lg border border-caution/30 bg-caution-surface/30 p-3 text-sm"><p>{candidates.reviewInvoices.length} Rechnungen mit Korrektur oder Erstattung: kein Zuordnungsvorschlag. Bitte das Zahlungsjournal separat prüfen.</p><details className="mt-2"><summary className="min-h-11 cursor-pointer py-2 text-xs font-medium">Betroffene Rechnungen anzeigen</summary><ul className="space-y-2">{candidates.reviewInvoices.map(invoice => <li key={invoice.id}><Link className="text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring" href={`/history?invoiceId=${invoice.id}`}>{invoice.invoiceNumber} · Journal prüfen</Link></li>)}</ul></details></div>}<div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"><Button asChild variant="outline"><Link href="/dashboard?tab=invoices">Zu den Rechnungen<ArrowRight aria-hidden="true" /></Link></Button><Button type="button" variant="outline" disabled={importPending} onClick={backToMapping}>Zuordnung ändern</Button></div></div>}
      </section>
      <div className={styles.previewLayout}>
        <section aria-label="Bankumsätze in der Vorschau" className={styles.ledger}>
          <div className={styles.listHeading}><h2>Bankumsätze in der Vorschau</h2><span>Zeilen {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, preview.rows.length)} von {preview.rows.length}</span></div>
          <div className={styles.entryList}>{visibleRows.map(row => <BankCsvPreviewRowCard key={row.rowNumber} row={row} candidates={candidates} />)}</div>{pageCount > 1 && <nav aria-label="Umsatzseiten" className={styles.pagination}><Button variant="outline" onClick={() => setPage(current => current - 1)} disabled={page === 0}>Vorherige</Button><span role="status" className="text-xs text-muted-foreground">Seite {page + 1} / {pageCount}</span><Button variant="outline" onClick={() => setPage(current => current + 1)} disabled={page + 1 >= pageCount}>Nächste</Button></nav>}</section>
        <div className={styles.saveRail}><BankImportSave mappingProfile={mappingProfile} originalBase64={originalBase64} mapping={mapping} delimiter={parsed!.delimiter} onPending={setImportPending} onSaved={() => { setCurrentSaved(true); setHistoryRefresh(value => value + 1); }} /></div>
      </div>
    </>}
    <BankImportHistory refresh={historyRefresh} accountScope={accountScope} />
    <footer className="flex flex-col items-start justify-between gap-3 border-t pt-4 text-xs text-muted-foreground sm:flex-row sm:items-center"><p>Die Vorschau bleibt bis zur Bestätigung lokal. Speichern erzeugt nur unzugeordnete Evidenz, keine Zahlung. Gespeicherte Quittungen bleiben nach Reload im Importverlauf.</p>{source && <Button type="button" variant="ghost" size="sm" disabled={importPending || profilePending} onClick={reset}>Datei verwerfen</Button>}</footer>
  </div>;
}

export function BankCsvPreviewRowCard({ row, candidates }: { row: BankCsvPreviewRow; candidates: BankCandidateResult | null }) {
  const matches = candidates ? suggestBankInvoiceMatches(row, candidates.invoices) : [];
  const existingWarnings = candidates ? bankCsvExistingPaymentWarnings(row, candidates.invoices) : [];
  const warnings = [...new Set([...row.warnings, ...existingWarnings])];
  const existingPayment = matches.some(match => match.existingPayment);
  const duplicateDetails = new Set(row.duplicateWarnings);
  const immediateWarnings = row.warnings.filter(message => !duplicateDetails.has(message));
  const detailWarnings = [...new Set([...row.duplicateWarnings, ...existingWarnings])];
  const incoming = row.amountCents !== null && BigInt(row.amountCents) > BigInt(0);
  return <article aria-label={`Bankzeile ${row.rowNumber}`} className={styles.previewEntry}>
    <div className={styles.entryTop}><div className={styles.rowMeta}><span>Zeile {row.rowNumber}</span><span>{dateLabel(row.date)}</span></div><div className={styles.entryDescription}><h3 className="break-words font-semibold">{row.counterparty || 'Gegenpartei nicht angegeben'}</h3><p className="mt-1 break-words text-sm text-muted-foreground">{row.reference || 'Referenz fehlt'}</p></div><div className={styles.entryAmount}><p className="break-all text-lg font-semibold tabular-nums">{row.amountCents !== null ? (row.currency === 'EUR' ? money(row.amountCents) : `${row.amountCents} Cent · ${row.currency || 'Währung fehlt'}`) : 'Betrag prüfen'}</p><p className="mt-1 text-xs text-muted-foreground">{row.errors.length ? 'Fehlerhaft' : !incoming ? 'Ohne Vorschlag · kein EUR-Eingang' : row.duplicate ? 'Mögliche Dublette' : 'EUR-Eingang'}</p></div></div>
    {row.errors.length > 0 && <ul className="space-y-1 border-t px-4 py-3 text-sm text-destructive">{row.errors.map((message, index) => <li key={index}>{message}</li>)}</ul>}
    {warnings.length > 0 && <div className="space-y-2 border-t bg-caution-surface/20 px-4 py-3 text-sm">
      {row.duplicate && <p className="flex items-start gap-2"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /><span>Mögliche Dublette. Keine Zeile entfernt. Originalbelege prüfen.</span></p>}
      {existingPayment && <p className="flex items-start gap-2"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /><span>Möglicherweise bereits erfasst. Vorhandenen Zahlungsnachweis prüfen; nicht erneut buchen.</span></p>}
      {immediateWarnings.length > 0 && <ul className="space-y-1">{immediateWarnings.map((message, index) => <li key={index} className="flex items-start gap-2"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /><span>{message}</span></li>)}</ul>}
      {detailWarnings.length > 0 && <details className="rounded-md border bg-background/70 px-3"><summary className="min-h-11 cursor-pointer py-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring" aria-label={`Prüfhinweise zu Bankzeile ${row.rowNumber}`}>Prüfhinweise anzeigen</summary><ul className="space-y-2 pb-3 text-xs leading-5 text-muted-foreground">{detailWarnings.map((message, index) => <li key={index}>{message}</li>)}</ul></details>}
    </div>}
    {candidates && incoming && !row.errors.length && <div className={`${styles.suggestions} space-y-3`}>{matches.length ? matches.map(match => <div key={match.invoiceId} className={styles.suggestion}><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="break-words text-sm font-semibold">{match.invoiceNumber}</h4><span className="rounded-full border bg-background px-2 py-1 text-xs">{match.confidence === 'strong' ? 'Starkes Signal' : match.confidence === 'medium' ? 'Mögliches Signal' : 'Manuell prüfen'}</span></div><ul className="mt-2 space-y-1 text-xs text-muted-foreground">{match.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>{match.warnings.map((warning, index) => !match.existingPayment && <p key={index} className="mt-2 text-xs font-medium">{warning}</p>)}<p className="mt-2 text-xs">{match.existingPayment ? 'Vorhandenen Nachweis prüfen · nicht erneut buchen' : 'Nur Vorschlag · keine Zahlung erfasst'}</p><p className="mt-2 text-xs text-muted-foreground">Geprüfter Rechnungsrest: {money(candidates.invoices.find(invoice => invoice.id === match.invoiceId)!.openCents)}</p><Button asChild variant="link" size="sm" className="mt-1 h-auto min-h-11 max-w-full whitespace-normal px-0"><Link href={`/history?invoiceId=${match.invoiceId}`}>{match.existingPayment ? 'Nachweis öffnen' : 'Rechnung öffnen'}<ArrowRight aria-hidden="true" /></Link></Button></div>) : <p className="text-sm text-muted-foreground">Kein eindeutiger Rechnungsvorschlag. Bitte Betrag, Referenz und vorhandene Zahlungen einzeln prüfen.</p>}</div>}
  </article>;
}
