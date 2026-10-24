'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { CheckCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { displayPaymentAmount } from '@/lib/full-payment-form';
import { formatBusinessDateDisplay } from '@/lib/business-date';
import { BankAllocationError, type BankAllocationInvoice, type BankAllocationOperationReceipt, type BankAllocationPreflight, type BankAllocationRowEnvelope, type BankRecordPaymentInput, type BankReallocationInput } from '@/lib/bank-allocation-contract';
import { loadBankAllocationPreflight, loadBankReallocationPreflight, recoverBankPayment, recoverBankReallocation, resolveBankPayment, resolveBankReallocation } from '@/lib/bank-allocation-client';
import { clearBankRecovery, readBankRecoveries, saveBankRecovery, type PendingBankAllocation } from '@/components/bank-csv/bank-allocation-recovery';
import { notifyPaymentDashboardRefresh } from '@/lib/payment-dashboard-refresh';

import styles from './bank-workspace.module.css';

const action = 'h-auto min-h-11 min-w-0 max-w-full whitespace-normal break-words';
type Attempt = { kind: 'record'; input: BankRecordPaymentInput } | { kind: 'move'; bindingStableKey: string; input: BankReallocationInput };

/** Live assignment is separate from the immutable CSV evidence and operation receipt. */
export function BankAllocationRow({ initialRow, accountScope = null, onPendingChange, onChanged }: { initialRow: BankAllocationRowEnvelope; accountScope?: string | null; onPendingChange: (row: string, pending: boolean) => void; onChanged: () => void }) {
  const id = useId();
  const [row, setRow] = useState(initialRow);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [preflight, setPreflight] = useState<BankAllocationPreflight | null>(null);
  const [invoices, setInvoices] = useState<BankAllocationInvoice[]>([]);
  const [search, setSearch] = useState(''), [selectedId, setSelectedId] = useState('');
  const [reviewed, setReviewed] = useState(false), [actionDate, setActionDate] = useState(''), [reason, setReason] = useState('');
  const [error, setError] = useState(''), [uncertain, setUncertain] = useState(false);
  const [recoveryEntry, setRecoveryEntry] = useState<PendingBankAllocation | null>(null), [recoveryUnavailable, setRecoveryUnavailable] = useState(false);
  const [freshReview, setFreshReview] = useState(false), [recoveryReadComplete, setRecoveryReadComplete] = useState(false);
  const callbacks = useRef({ onPendingChange, onChanged }); callbacks.current = { onPendingChange, onChanged };
  const [operation, setOperation] = useState<BankAllocationOperationReceipt | null>(null);
  const recovering = useRef(false);
  const attempt = useRef<Attempt | null>(null), sending = useRef(false), generation = useRef(0), alive = useRef(true);
  const readController = useRef<AbortController | null>(null), opener = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLDivElement>(null), card = useRef<HTMLElement>(null), errorRef = useRef<HTMLParagraphElement>(null);
  const assignment = row.assignment;
  const moving = Boolean(assignment);
  const locked = busy || uncertain;
  const evidence = row.evidence;
  const evidenceAmount = evidence.amountCents === null ? 'Betrag prüfen' : `${evidence.amountCents.startsWith('-') ? '−' : ''}${displayPaymentAmount(evidence.amountCents.startsWith('-') ? evidence.amountCents.slice(1) : evidence.amountCents)}`;
  const usable = row.assignmentState === 'UNASSIGNED' && evidence.currency === 'EUR' && evidence.date !== null && evidence.amountCents !== null && BigInt(evidence.amountCents) > BigInt(0) && evidence.errors.length === 0;
  useEffect(() => { const requestGeneration = generation; alive.current = true; return () => { alive.current = false; requestGeneration.current++; readController.current?.abort(); }; }, []);
  useEffect(() => {
    if (attempt.current || sending.current) return;
    // Immutable chains never rewind: ignore a read started before a completed command.
    if (row.assignment && (initialRow.assignmentState === 'UNASSIGNED' || (initialRow.assignment?.bindingStableKey === row.assignment.bindingStableKey && initialRow.assignment.allocationRevision < row.assignment.allocationRevision))) return;
    setRow(initialRow);
    if (preflight && (initialRow.assignmentState !== preflight.row.assignmentState || initialRow.assignment?.allocationRevision !== preflight.row.assignment?.allocationRevision || initialRow.assignment?.allocatedInvoice.ledgerVersion !== preflight.row.assignment?.allocatedInvoice.ledgerVersion)) {
      setPreflight(null); setReviewed(false); setError('Zuordnung wurde zwischenzeitlich geändert. Aktuellen Stand laden und erneut prüfen.');
    }
  // Only a new server envelope invalidates an existing review, not selecting a candidate.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRow]);
  useEffect(() => {
    if (!accountScope) { setRecoveryUnavailable(true); return; }
    let stored: PendingBankAllocation[];
    try { stored = readBankRecoveries(sessionStorage, accountScope, initialRow.rowStableKey); setRecoveryUnavailable(false); }
    catch { setRecoveryUnavailable(true); return; }
    if (!stored.length) return;
    setRecoveryEntry(stored[stored.length - 1]); setUncertain(true); callbacks.current.onPendingChange(initialRow.rowStableKey, true);
    const controller = new AbortController();
    void (async () => { for (const value of stored) { if (controller.signal.aborted) break; await recoverStored(value, controller.signal); } })();
    return () => controller.abort();
  // Session restoration is GET-only and runs once for this scoped row, never on rerender.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountScope, initialRow.rowStableKey]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { if (operation) heading.current?.focus(); }, [operation]);

  async function load(invoiceId?: number, cursor = 0, query = search) {
    if (sending.current || attempt.current) return;
    const current = ++generation.current, controller = new AbortController();
    readController.current?.abort(); readController.current = controller;
    setLoading(true); setError(''); setReviewed(false);
    // Never leave a formerly valid selection confirmable during revalidation.
    setPreflight(null);
    try {
      const checked = row.assignment
        ? await loadBankReallocationPreflight(row.assignment.bindingStableKey, { search: query, cursor, ...(invoiceId ? { invoiceId } : {}) }, controller.signal)
        : await loadBankAllocationPreflight(row.rowStableKey, { search: query, cursor, ...(invoiceId ? { invoiceId } : {}) }, controller.signal);
      if (!alive.current || current !== generation.current) return;
      setRow(checked.row); setPreflight(checked);
      setInvoices(previous => {
        const next = cursor ? [...previous, ...checked.invoices.filter(invoice => !previous.some(old => old.invoiceId === invoice.invoiceId))] : checked.invoices;
        return checked.selection && !next.some(invoice => invoice.invoiceId === checked.selection!.invoiceId) ? [checked.selection, ...next] : next;
      });
    } catch (failure) {
      if (alive.current && current === generation.current && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Rechnungen konnten nicht geprüft werden. Erneut laden.');
    } finally { if (alive.current && current === generation.current) setLoading(false); }
  }
  function show() {
    setOpen(true);
    if (recoveryEntry) setOperation(null);
    if (!attempt.current && !recoveryEntry) { setOperation(null); setSelectedId(''); setReviewed(false); setPreflight(null); void load(undefined, 0, ''); setSearch(''); }
  }
  function close() { if (!sending.current) setOpen(false); }
  async function refreshCurrent() {
    if (sending.current) return;
    setLoading(true); setError('');
    try {
      const current = await recoverBankPayment(row.rowStableKey, null, new AbortController().signal);
      if (!alive.current) return;
      setRow(current.row); onChanged();
    } catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : 'Aktuelle Zuordnung konnte nicht geladen werden.'); }
    finally { if (alive.current) setLoading(false); }
  }
  function clearStored(value: PendingBankAllocation | null) {
    if (!value) return;
    let remaining: PendingBankAllocation[] = [];
    try { clearBankRecovery(sessionStorage, value); remaining = readBankRecoveries(sessionStorage, value.accountScope, value.rowStableKey); }
    catch { setRecoveryUnavailable(true); }
    setRecoveryEntry(remaining.at(-1) ?? null); setUncertain(remaining.length > 0); setFreshReview(false);
    callbacks.current.onPendingChange(value.rowStableKey, remaining.length > 0);
  }
  function reviewFreshState() {
    if (sending.current || loading || attempt.current || !recoveryReadComplete) return;
    setFreshReview(true); setUncertain(false); setOperation(null); setReviewed(false); setSelectedId(''); setSearch('');
    void load(undefined, 0, '');
  }
  async function recoverStored(value: PendingBankAllocation, signal: AbortSignal) {
    if (recovering.current) return;
    recovering.current = true;
    setLoading(true); setError(''); setRecoveryReadComplete(false); setUncertain(true); setFreshReview(false);
    try {
      const result = value.kind === 'move'
        ? await recoverBankReallocation(value.bindingStableKey!, value.operationKey, signal)
        : await recoverBankPayment(value.rowStableKey, value.operationKey, signal);
      if (!alive.current || signal.aborted) return;
      setRow(previous => previous.assignment && (result.row.assignmentState === 'UNASSIGNED' || result.row.assignment?.bindingStableKey === previous.assignment.bindingStableKey && result.row.assignment.allocationRevision < previous.assignment.allocationRevision) ? previous : result.row);
      if (!result.operation) {
        const current = result.row.assignment;
        const superseded = value.kind === 'record' ? result.row.assignmentState === 'ASSIGNED' : current?.bindingStableKey === value.bindingStableKey && (current.allocationRevision > value.expectedAllocationRevision! || current.allocatedInvoice.ledgerVersion !== value.expectedSourceLedgerVersion);
        if (superseded) { clearStored(value); setReviewed(false); setPreflight(null); setError('Der aktuelle Zuordnungsstand hat diese frühere Anfrage überholt. Kein Vorgang für ihre Kennung bestätigt. Eine neue Auswahl erfordert eine neue Prüfung.'); return; }
        setRecoveryReadComplete(true);
        setError('Noch keine gespeicherte Bestätigung gefunden. Die ursprünglichen Eingaben sind nach erneutem Öffnen nicht verfügbar. Ergebnis erneut lesen oder den aktuellen Stand ausdrücklich neu prüfen. Die frühere Anfrage bleibt bis zur Klärung sichtbar.'); return;
      }
      if ((value.kind === 'record') !== (result.operation.kind === 'BANK_PAYMENT_RECORDED')) throw new Error('Die frühere Anfrage konnte nicht sicher zugeordnet werden.');
      setOperation(result.operation); setUncertain(false); attempt.current = null; clearStored(value);
      notifyPaymentDashboardRefresh(); callbacks.current.onChanged();
    } catch (failure) { if (alive.current && !signal.aborted) setError(failure instanceof Error ? failure.message : 'Frühere Anfrage konnte nicht geprüft werden. Nur erneut lesen; nichts neu erfassen.'); }
    finally { recovering.current = false; if (alive.current && !signal.aborted) setLoading(false); }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (recoveryEntry && !freshReview && !attempt.current && !sending.current && !loading) { await recoverStored(recoveryEntry, new AbortController().signal); return; }
    if (sending.current || loading || operation || (!attempt.current && (!reviewed || !preflight?.canConfirm || !preflight.selection))) return;
    if (!attempt.current) {
      const checked = preflight!;
      attempt.current = checked.row.assignment ? { kind: 'move', bindingStableKey: checked.row.assignment.bindingStableKey, input: {
        invoiceId: checked.selection!.invoiceId, idempotencyKey: crypto.randomUUID(), expectedAllocationRevision: checked.row.assignment.allocationRevision,
        expectedSourceLedgerVersion: checked.row.assignment.allocatedInvoice.ledgerVersion, expectedTargetLedgerVersion: checked.selection!.ledgerVersion,
        actionDate, reason: reason.normalize('NFC').trim(), cashNeutralReviewed: true,
      } } : { kind: 'record', input: { invoiceId: checked.selection!.invoiceId, idempotencyKey: crypto.randomUUID(), expectedLedgerVersion: checked.selection!.ledgerVersion, expectedRowEvidenceHash: checked.row.rowEvidenceHash, reviewed: true, receiptConfirmed: true } };
    }
    const frozen = attempt.current;
    const earlier = freshReview ? recoveryEntry : null;
    const identity: PendingBankAllocation = { accountScope: accountScope!, rowStableKey: row.rowStableKey, bindingStableKey: frozen.kind === 'move' ? frozen.bindingStableKey : null, operationKey: frozen.input.idempotencyKey, kind: frozen.kind, expectedAllocationRevision: frozen.kind === 'move' ? frozen.input.expectedAllocationRevision : null, expectedSourceLedgerVersion: frozen.kind === 'move' ? frozen.input.expectedSourceLedgerVersion : null };
    try { if (!accountScope) throw new Error(); saveBankRecovery(sessionStorage, identity); }
    catch { setRecoveryUnavailable(true); }
    setRecoveryEntry(identity); setFreshReview(false);
    sending.current = true; setBusy(true); setError(''); onPendingChange(row.rowStableKey, true);
    try {
      const controller = new AbortController();
      // An explicit retry always recovers by GET first. Closing cannot cancel a sent command.
      const result = frozen.kind === 'move'
        ? await resolveBankReallocation(frozen.bindingStableKey, frozen.input, uncertain, controller.signal)
        : await resolveBankPayment(row.rowStableKey, frozen.input, uncertain, controller.signal);
      if (!alive.current) return;
      setRow(result.row); setOperation(result.operation); setUncertain(false); attempt.current = null; clearStored(identity);
      notifyPaymentDashboardRefresh(); onChanged();
      if (earlier) await recoverStored(earlier, new AbortController().signal);
    } catch (failure) {
      if (!alive.current) return;
      const definite = failure instanceof BankAllocationError && failure.status < 500 && failure.code !== 'IDEMPOTENCY_CONFLICT';
      if (definite) { clearStored(identity); attempt.current = null; setUncertain(false); setPreflight(null); setReviewed(false); if (earlier) await recoverStored(earlier, new AbortController().signal); }
      else setUncertain(true);
      setError(definite && failure instanceof Error ? failure.message : 'Ergebnis noch unklar. Eingaben und Anfragekennung bleiben unverändert. Erst Ergebnis prüfen; keine neue Zahlung erfassen.');
    } finally { sending.current = false; if (alive.current) setBusy(false); }
  }
  const target = preflight?.selection;
  const current = preflight?.row.assignment ?? assignment;
  return <article ref={card} tabIndex={-1} aria-label={`Gespeicherte Bankzeile ${evidence.rowNumber}`} className={`${styles.allocationEntry} outline-none focus-visible:outline-2 focus-visible:outline-ring space-y-3`}>
    <div className={`${styles.entryTop} ${styles.allocationTop}`}><div className={styles.rowMeta}><span>Zeile {evidence.rowNumber}</span><span>{evidence.date ? formatBusinessDateDisplay(evidence.date) : 'Datum prüfen'}</span></div><div className={styles.entryDescription}><p className="break-words font-semibold">{evidence.counterparty || 'Gegenpartei fehlt'}</p><p className="mt-1 break-words text-muted-foreground">{evidence.reference || 'Referenz fehlt'}</p></div><p className={`${styles.entryAmount} text-lg font-semibold tabular-nums`}>{evidence.amountCents !== null && evidence.currency === 'EUR' ? evidenceAmount : 'Betrag / Währung prüfen'}</p></div>
    {row.assignmentState === 'REVIEW_REQUIRED' ? <p role="status">Zuordnung prüfen · {row.assignmentReviewReason}</p> : assignment ? <div className={styles.assignmentBand}><div><p className="font-medium">Aktuell: <Link className="text-primary underline underline-offset-4" href={`/history?invoiceId=${assignment.allocatedInvoice.invoiceId}`}>{assignment.allocatedInvoice.invoiceNumber}</Link></p><p className="mt-1 text-xs text-muted-foreground">Original-Zahlungsnachweis #{assignment.originalPaymentId} · Ursprung {assignment.originInvoiceNumber} · Stand {assignment.allocationRevision}</p></div><Button ref={opener} type="button" variant="outline" className={action} disabled={!assignment.canReallocate && !attempt.current && !recoveryEntry} onClick={show}>{attempt.current || recoveryEntry ? 'Ergebnis prüfen' : 'Andere Rechnung'}</Button>{!assignment.canReallocate && assignment.reallocationReviewReason && <p className="w-full text-xs text-muted-foreground">{assignment.reallocationReviewReason}</p>}</div> : <div className={styles.assignmentBand}><span className="text-xs text-muted-foreground">Noch nicht zugeordnet</span><Button ref={opener} type="button" variant="outline" className={action} disabled={!usable && !attempt.current && !recoveryEntry} onClick={show}>{attempt.current || recoveryEntry ? 'Ergebnis prüfen' : 'Rechnung wählen'}</Button></div>}
    {(evidence.errors.length > 0 || evidence.warnings.length > 0 || evidence.duplicate) && <details><summary className="min-h-11 cursor-pointer py-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring">Zeilendetails und Prüfhinweise</summary><ul className="space-y-2 text-xs text-muted-foreground">{evidence.errors.map((message, index) => <li key={`e${index}`}>{message}</li>)}{evidence.warnings.map((message, index) => <li key={`w${index}`}>{message}</li>)}{evidence.duplicate && <li>Mögliche Dublette / Überschneidung. Keine Zeile entfernt.</li>}</ul></details>}
    <Dialog open={open} onOpenChange={value => { if (!value) close(); }}><DialogContent className={`${styles.allocationDialog} max-h-[calc(100dvh-2rem)] min-w-0 grid-cols-1 overflow-y-auto sm:max-w-2xl`} showCloseButton={!busy}
      onCloseAutoFocus={event => { event.preventDefault(); (opener.current && !opener.current.disabled ? opener.current : card.current)?.focus(); }}
      onEscapeKeyDown={event => { if (sending.current) event.preventDefault(); }} onPointerDownOutside={event => { if (sending.current) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>{operation ? 'Zuordnung gespeichert' : moving ? 'Zuordnung ändern' : 'Rechnung zuordnen'}</DialogTitle><DialogDescription>{moving ? 'Nur die Rechnungszuordnung ändert sich. Kein zusätzlicher Geldeingang und keine Rückzahlung.' : 'Die CSV allein belegt keinen Geldeingang. Bestätige nur tatsächlich erhaltenes Geld.'}</DialogDescription></DialogHeader>
      <div className={styles.dialogEvidence}><strong>{evidence.amountCents !== null ? evidenceAmount : 'Betrag prüfen'}</strong><p className="text-xs text-muted-foreground">{evidence.date ? formatBusinessDateDisplay(evidence.date) : 'Datum prüfen'}</p><p className="break-words">{evidence.reference || 'Referenz fehlt'}</p></div>
      {operation ? <><div ref={heading} role="status" tabIndex={-1} className="space-y-2 outline-none"><p className="flex items-center gap-2 font-semibold"><CheckCircle className="size-5" aria-hidden="true" />{operation.kind === 'BANK_PAYMENT_RECORDED' ? 'Zahlung erfasst' : 'Zuordnung geändert'}</p><p className="text-sm">{operation.kind === 'BANK_PAYMENT_RECORDED' ? `Ursprünglich bestätigt für ${operation.originInvoiceNumber} · Zahlungsnachweis #${operation.originalPaymentId}` : `Gespeicherter Wechsel: ${operation.fromInvoiceNumber} → ${operation.toInvoiceNumber} · Stand ${operation.revision}`}</p><p className="text-sm font-medium">Aktuelle Zuordnung: {row.assignment ? <Link className="text-primary underline underline-offset-4" href={`/history?invoiceId=${row.assignment.allocatedInvoice.invoiceId}`}>{row.assignment.allocatedInvoice.invoiceNumber}</Link> : 'Bitte aktuellen Stand prüfen'}</p><p className="text-xs text-muted-foreground">Der gespeicherte Vorgang bleibt unverändert. Eine spätere Zuordnung kann davon abweichen.</p></div><DialogFooter><Button className={action} onClick={close}>Schließen</Button></DialogFooter></> : <form className="min-w-0 space-y-4" onSubmit={submit} aria-busy={busy}>
        {uncertain && <p role="status" className="rounded-lg border p-3 text-sm">Anfrage ungeklärt. Kein neuer Auftrag: „Ergebnis sicher prüfen“ liest zuerst den gespeicherten Vorgang. Nur solange die ursprünglichen Eingaben hier noch vorhanden sind, ist dieselbe Anfrage wiederholbar.</p>}
        <fieldset disabled={locked} className="min-w-0 space-y-4">
          <div className="flex min-w-0 flex-wrap items-end gap-2"><div className="min-w-0 flex-1 space-y-2"><Label htmlFor={`${id}-search`}>Rechnung suchen</Label><Input id={`${id}-search`} type="search" maxLength={100} value={search} onChange={event => setSearch(event.target.value)} placeholder="Rechnungsnummer oder Kunde" /></div><Button type="button" variant="outline" className={action} disabled={loading} onClick={() => { setSelectedId(''); void load(); }}>Suchen</Button></div>
          <div className="space-y-2"><Label htmlFor={`${id}-invoice`}>Rechnung</Label><select id={`${id}-invoice`} className="min-h-11 w-full min-w-0 rounded-md border bg-background px-3 text-sm" value={selectedId} disabled={loading} onChange={event => { setSelectedId(event.target.value); void load(Number(event.target.value) || undefined); }}><option value="">Rechnung bewusst auswählen</option>{invoices.map(invoice => <option key={invoice.invoiceId} value={invoice.invoiceId}>{invoice.invoiceNumber} · {invoice.customerName} · offen {displayPaymentAmount(invoice.openCents)}</option>)}</select>{preflight?.nextCursor !== null && preflight?.nextCursor !== undefined && <Button type="button" variant="ghost" className={action} disabled={loading} onClick={() => void load(Number(selectedId) || undefined, preflight.nextCursor!)}>Weitere Rechnungen</Button>}{!loading && invoices.length === 0 && !error && <p className="text-xs text-muted-foreground">Keine passende Rechnung. Suche ändern; es wird nichts automatisch zugeordnet.</p>}</div>
          {target && <dl className={styles.balanceReview}>{current && <div><dt className="text-muted-foreground">Bisher · {current.allocatedInvoice.invoiceNumber}</dt><dd className="mt-1 font-medium">Offen {displayPaymentAmount(current.allocatedInvoice.openCents)} → {preflight?.sourceAfterOpenCents !== null && preflight?.sourceAfterOpenCents !== undefined ? displayPaymentAmount(preflight.sourceAfterOpenCents) : 'nicht freigegeben'}</dd></div>}<div><dt className="text-muted-foreground">{moving ? 'Künftig' : 'Gewählt'} · {target.invoiceNumber}</dt><dd className="mt-1 font-medium">Offen {displayPaymentAmount(target.openCents)} → {preflight?.afterOpenCents !== null && preflight?.afterOpenCents !== undefined ? displayPaymentAmount(preflight.afterOpenCents) : 'nicht freigegeben'}</dd></div></dl>}
          {moving && <><div className="space-y-2"><Label htmlFor={`${id}-date`}>Entdeckungsdatum</Label><Input id={`${id}-date`} type="date" required value={actionDate} onChange={event => setActionDate(event.target.value)} /></div><div className="space-y-2"><Label htmlFor={`${id}-reason`}>Grund</Label><Textarea id={`${id}-reason`} required maxLength={1000} rows={2} value={reason} onChange={event => setReason(event.target.value)} /></div></>}
          {preflight?.reviewReasons.length ? <ul role="status" className="space-y-2 rounded-lg border p-3 text-sm">{preflight.reviewReasons.map((message, index) => <li key={index}>{message}</li>)}</ul> : null}
          <label className={styles.confirmation}><input type="checkbox" required className="mt-0.5 size-4 shrink-0 accent-primary" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /><span>{moving ? 'Ich habe beide Rechnungen geprüft. Nur die Zuordnung ändert sich; kein Geldeingang und keine Rückzahlung.' : 'Ich bestätige: Dieser Betrag ist am gespeicherten Datum tatsächlich eingegangen. Rechnung und vorhandene Zahlungen sind geprüft.'}</span></label>
        </fieldset>
        {loading && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Aktuellen Zahlungsstand prüfen…</p>}
        {error && <p ref={errorRef} tabIndex={-1} role="alert" className="break-words text-sm text-destructive outline-none">{error}</p>}
        {recoveryEntry && !attempt.current && !freshReview && recoveryReadComplete && <Button type="button" variant="outline" className={action} disabled={loading || busy} onClick={reviewFreshState}>Aktuellen Stand neu prüfen</Button>}
        {recoveryEntry && freshReview && <p role="status" className="text-xs text-muted-foreground">Frühere Anfrage weiter ungeklärt. Diese neue Auswahl wird separat bestätigt; nur ein gültiger aktueller Zeilen-/Zuordnungsstand kann gespeichert werden.</p>}
        {error && !uncertain && !freshReview && <Button type="button" variant="outline" className={action} disabled={loading || busy} onClick={() => void load(Number(selectedId) || undefined)}>Aktuellen Stand laden</Button>}
        <DialogFooter><Button type="button" variant="outline" className={action} disabled={busy} onClick={close}>{uncertain ? 'Schließen · Anfrage bleibt offen' : 'Abbrechen'}</Button><Button type="submit" className={action} disabled={busy || loading || (!uncertain && (!reviewed || !preflight?.canConfirm || !target))}>{busy ? 'Wird geprüft…' : uncertain ? 'Ergebnis sicher prüfen' : moving ? 'Zuordnung ändern' : 'Zahlung zuordnen'}</Button></DialogFooter>
      </form>}
    </DialogContent></Dialog>
    {operation && !open && <Button type="button" variant="ghost" className={action} onClick={() => setOpen(true)}>Gespeicherten Vorgang ansehen</Button>}
    {recoveryUnavailable && <p role="status" className="text-xs text-muted-foreground">Sitzungsspeicher nicht verfügbar. Eingaben und sichere Wiederholung bleiben nur in diesem geöffneten Fenster erhalten. Nach erneutem Öffnen wird nur der aktuelle Serverstand geladen, nicht die frühere Anfragebestätigung.</p>}
    {uncertain && !open && <p role="status" className="text-xs">Anfrage ungeklärt · Ergebnis prüfen, nichts neu erfassen.</p>}
    {row.assignmentState === 'REVIEW_REQUIRED' && <Button type="button" variant="outline" className={action} disabled={loading || busy} onClick={() => void refreshCurrent()}>Zuordnungsstand erneut prüfen</Button>}
  </article>;
}
