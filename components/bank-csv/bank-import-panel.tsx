'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { BankImportError, type BankImportReceipt, type BankImportDetail } from '@/lib/bank-import-contract';
import { loadBankImportHistory, loadBankImportReceipt, resolveBankImportReceipt } from '@/lib/bank-import-client';
import type { BankCsvDelimiter, BankCsvMapping } from '@/lib/bank-csv';

function money(value: string) { const amount = BigInt(value); return `${amount / BigInt(100)},${(amount % BigInt(100)).toString().padStart(2, '0')} €`; }
export function BankImportReceiptSummary({ receipt }: { receipt: BankImportReceipt }) {
  return <div className="space-y-3"><p role="status" className="font-semibold">Import gespeichert, noch keine Zahlungen zugeordnet</p><p className="break-all text-sm">{receipt.accountAlias} · {receipt.counts.total} Zeilen · {new Date(receipt.savedAt).toLocaleString('de-DE', { timeZone: 'UTC' })} UTC</p><dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="text-muted-foreground">EUR-Haben</dt><dd className="break-all tabular-nums">{money(receipt.totals.incomingCents)}</dd></div><div><dt className="text-muted-foreground">EUR-Soll</dt><dd className="break-all tabular-nums">{money(receipt.totals.outgoingCents)}</dd></div></dl><p className="text-xs text-muted-foreground">{receipt.counts.invalid} fehlerhafte Zeilen · {receipt.counts.duplicates} mögliche Dubletten · {receipt.counts.overlapRows} Überschneidungshinweise. Alle Zeilen bleiben erhalten und unzugeordnet.</p>{receipt.sameFilePreviouslySaved && <p className="text-sm">Diese Originaldatei wurde bereits mit einer anderen Zuordnung gespeichert. Keine bestehende Quittung wurde verändert.</p>}<details className="rounded-lg border px-3"><summary className="min-h-11 cursor-pointer py-3 text-sm">Quittungsdetails</summary><dl className="space-y-2 pb-3 text-xs"><div><dt>Zeitraum gültiger Zeilen</dt><dd>{receipt.period.from ?? '—'} bis {receipt.period.to ?? '—'}</dd></div><div><dt>Dateihash (SHA-256)</dt><dd className="break-all">{receipt.sourceSha256}</dd></div><div><dt>Prüfnachweis (SHA-256)</dt><dd className="break-all">{receipt.evidenceSha256}</dd></div><div><dt>Parser / Zuordnung</dt><dd>{receipt.parserVersion} / {receipt.mappingVersion}</dd></div><div><dt>Importkennung</dt><dd className="break-all">{receipt.requestId}</dd></div></dl></details></div>;
}
export function BankImportSave({ originalBase64, mapping, delimiter, onPending, onSaved }: { originalBase64: string; mapping: BankCsvMapping; delimiter: BankCsvDelimiter; onPending: (pending: boolean) => void; onSaved: () => void }) {
  const [reviewed, setReviewed] = useState(false), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState('');
  const [receipt, setReceipt] = useState<BankImportReceipt | null>(null);
  const key = useRef<string | null>(null), controller = useRef<AbortController | null>(null), alive = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  async function save() {
    if (!reviewed || controller.current) return;
    key.current ??= crypto.randomUUID();
    const owner = document.activeElement;
    const request = new AbortController(); controller.current = request;
    setBusy(true); setError(''); onPending(true);
    let known = false;
    try {
      const resolved = await resolveBankImportReceipt({ originalBase64, mapping, delimiter, requestId: key.current }, uncertain, request.signal);
      if (!alive.current) return;
      known = true; setReceipt(resolved); setUncertain(false); onSaved();
      requestAnimationFrame(() => { if (alive.current && (document.activeElement === owner || document.activeElement === document.body)) heading.current?.focus(); });
    } catch (failure) {
      if (!alive.current) return;
      // A transport/read failure can occur AFTER the transaction committed. Keep
      // exactly the same request UUID/payload; GET recovery precedes another POST.
      const definite = failure instanceof BankImportError && failure.status < 500;
      known = definite;
      setUncertain(!definite);
      setError(definite ? failure.message : 'Ergebnis unklar. Mit derselben Importkennung erneut prüfen. Bereits gespeicherte Zeilen werden nicht nochmals angelegt. Nach Reload findest du gespeicherte Quittungen im Verlauf.');
    } finally {
      controller.current = null;
      if (alive.current) { setBusy(false); if (known) onPending(false); }
    }
  }
  return <section aria-labelledby="bank-save-heading" className="space-y-4 rounded-xl border bg-card p-4 sm:p-6"><h2 id="bank-save-heading" ref={heading} tabIndex={-1} className="font-semibold outline-none focus-visible:outline-2 focus-visible:outline-ring">{receipt ? 'Gespeicherte Quittung' : 'Geprüfte Umsätze speichern'}</h2>{receipt ? <BankImportReceiptSummary receipt={receipt} /> : <><p className="text-sm text-muted-foreground">Erst diese Bestätigung überträgt die Originalbytes zur erneuten Prüfung an Bivaro. Gespeichert werden begrenzte Bankevidenz und Quittung, nicht die Rohdatei. Keine Zahlung, Einnahme oder Ausgabe entsteht.</p><label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" className="mt-1 size-4 accent-primary" checked={reviewed} disabled={busy || uncertain} onChange={event => setReviewed(event.target.checked)} /><span>Ich habe Kontoalias, Spalten, Vorzeichen und Kontrollsummen geprüft. Auch Fehler und mögliche Dubletten sollen als unzugeordnete Evidenz erhalten bleiben.</span></label>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button type="button" disabled={!reviewed || busy} onClick={() => void save()}>{busy ? 'Quittung wird geprüft…' : uncertain ? 'Ergebnis sicher erneut prüfen' : 'Geprüfte Umsätze speichern'}</Button></>}</section>;
}
export function BankImportHistory({ refresh }: { refresh: number }) {
  const [history, setHistory] = useState<Awaited<ReturnType<typeof loadBankImportHistory>> | null>(null), [detail, setDetail] = useState<BankImportDetail | null>(null);
  const [page, setPage] = useState(0), [error, setError] = useState(''), [busy, setBusy] = useState(false), [reload, setReload] = useState(0);
  const sequence = useRef(0), historySequence = useRef(0), controller = useRef<AbortController | null>(null), heading = useRef<HTMLHeadingElement>(null), lastOpened = useRef<string | null>(null), historyHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const request = new AbortController(), current = ++historySequence.current;
    loadBankImportHistory(page, request.signal).then(value => { if (!request.signal.aborted && historySequence.current === current) { setHistory(value); setError(''); } }).catch(() => { if (!request.signal.aborted && historySequence.current === current) setError('Der Importverlauf konnte nicht geladen werden. Erneut versuchen.'); });
    return () => { request.abort(); };
  }, [page, refresh, reload]);
  useEffect(() => () => { sequence.current++; controller.current?.abort(); }, []);
  async function open(id: string, rowPage: number, button?: HTMLButtonElement) {
    if (busy) return;
    if (button) lastOpened.current = id;
    const owner = document.activeElement;
    const request = new AbortController(), current = ++sequence.current; controller.current?.abort(); controller.current = request; setBusy(true); setError('');
    try { const value = await loadBankImportReceipt(id, rowPage, request.signal); if (sequence.current === current) { setDetail(value); requestAnimationFrame(() => { if (sequence.current === current && (document.activeElement === owner || document.activeElement === document.body)) heading.current?.focus(); }); } }
    catch { if (!request.signal.aborted && sequence.current === current) setError('Die Quittung konnte nicht geladen werden. Erneut öffnen.'); }
    finally { if (sequence.current === current) setBusy(false); }
  }
  function close() {
    const owner = document.activeElement, current = ++sequence.current; controller.current?.abort(); setBusy(false); setDetail(null);
    requestAnimationFrame(() => {
      if (sequence.current !== current || (document.activeElement !== owner && document.activeElement !== document.body)) return;
      const opener = lastOpened.current ? document.querySelector<HTMLButtonElement>(`[data-bank-receipt="${lastOpened.current}"]`) : null;
      (opener ?? historyHeading.current)?.focus();
    });
  }
  return <section aria-labelledby="bank-history-heading" className="space-y-4 rounded-xl border bg-card p-4 sm:p-6"><h2 id="bank-history-heading" ref={historyHeading} tabIndex={-1} className="font-semibold outline-none focus-visible:outline-2 focus-visible:outline-ring">Gespeicherte Importe</h2>{error && <div role="alert" className="space-y-2 text-sm"><p>{error}</p><Button variant="outline" onClick={() => setReload(value => value + 1)}>Verlauf erneut laden</Button></div>}{detail ? <><h3 ref={heading} tabIndex={-1} className="font-semibold outline-none focus-visible:outline-2 focus-visible:outline-ring">Importquittung</h3><BankImportReceiptSummary receipt={detail.receipt} /><ol className="space-y-3">{detail.rows.map(row => <li key={row.rowNumber} className="space-y-1 rounded-lg border p-3 text-sm"><p>Zeile {row.rowNumber} · {row.date ?? 'Datum unklar'} · {row.amountCents !== null ? money(row.amountCents.startsWith('-') ? row.amountCents.slice(1) : row.amountCents) + (row.amountCents.startsWith('-') ? ' Soll' : ' Haben') : 'Betrag nicht bestätigt'}</p><p className="break-words">{row.counterparty || 'Gegenpartei fehlt'} · {row.reference || 'Referenz fehlt'}</p>{row.errors.map((message, index) => <p key={`e${index}`} className="text-destructive">{message}</p>)}{row.duplicate && <p>Mögliche Dublette / Überschneidung. Unzugeordnet, keine Zeile entfernt.</p>}{(row.warnings.length > 0 || row.externalId || row.currency !== 'EUR') && <details><summary className="min-h-11 cursor-pointer py-3">Zeilendetails und Prüfhinweise</summary><dl className="space-y-2 pb-3 text-xs"><div><dt>Bank-ID</dt><dd className="break-all">{row.externalId || 'Nicht angegeben'}</dd></div><div><dt>Währung</dt><dd className="break-all">{row.currency || 'Unklar'}</dd></div><div><dt>Frühere Treffer bei Übernahme · kein Eindeutigkeitsbeweis</dt><dd>Bank-ID: {row.priorMatches.external} · Inhalt: {row.priorMatches.content} · Tag/Betrag: {row.priorMatches.dayAmount}</dd></div></dl><ul className="space-y-2">{row.warnings.map((message, index) => <li key={index}>{message}</li>)}</ul></details>}</li>)}</ol><nav aria-label="Gespeicherte Umsatzseiten" className="flex flex-wrap items-center justify-between gap-2"><Button variant="outline" disabled={busy || detail.page === 0} onClick={() => void open(detail.receipt.id, detail.page - 1)}>Vorherige Zeilen</Button><span className="text-xs">Seite {detail.page + 1} / {detail.pages}</span><Button variant="outline" disabled={busy || detail.page + 1 >= detail.pages} onClick={() => void open(detail.receipt.id, detail.page + 1)}>Nächste Zeilen</Button></nav><Button variant="outline" onClick={close}>Zurück zum Importverlauf</Button></> : <>{!history ? <p className="text-sm text-muted-foreground">Importverlauf laden…</p> : history.receipts.length === 0 ? <p className="text-sm text-muted-foreground">Noch keine gespeicherten Importe.</p> : <ul className="space-y-2">{history.receipts.map(receipt => <li key={receipt.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"><span className="break-all text-sm">{receipt.accountAlias} · {receipt.counts.total} Zeilen · {receipt.savedAt.slice(0, 10)}</span><Button data-bank-receipt={receipt.id} variant="outline" disabled={busy} onClick={event => void open(receipt.id, 0, event.currentTarget)}>Quittung öffnen</Button></li>)}</ul>}{history && <nav aria-label="Importverlaufseiten" className="flex flex-wrap items-center justify-between gap-2"><Button variant="outline" disabled={page === 0 || busy} onClick={() => setPage(value => value - 1)}>Vorherige Importe</Button><span className="text-xs">Seite {page + 1}</span><Button variant="outline" disabled={!history.hasMore || busy} onClick={() => setPage(value => value + 1)}>Nächste Importe</Button></nav>}</>}</section>;
}
