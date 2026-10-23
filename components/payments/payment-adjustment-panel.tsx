"use client";

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { CheckCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { invoicePaymentAmounts } from '@/components/payments/payment-presentation';
import { formatBusinessDateDisplay } from '@/lib/business-date';
import { displayPaymentAmount, paymentAmountInput, paymentInputCents, readPaymentLedger, type PaymentLedger } from '@/lib/full-payment-form';
import { adjustmentFailure, adjustmentFingerprintHash, adjustmentPendingStorageKey, paymentAdjustmentAttempt, paymentAdjustmentPayload, persistPendingAdjustment, readConfirmedPaymentAdjustment, readPendingAdjustment, readPaymentAdjustmentPreflight, validatePaymentAdjustmentFields, type PaymentAdjustmentDraft, type PaymentAdjustmentEvent, type PaymentAdjustmentKind, type PaymentAdjustmentPreflight, type PendingAdjustment } from '@/lib/payment-adjustment-form';

type Props = {
  invoiceId: number; tenantId: string; journal: PaymentAdjustmentPreflight; disabled: boolean; loading: boolean;
  onEditingChange: (editing: boolean) => void; onBusyChange: (busy: boolean) => void;
  onReload: () => void; onRecorded: () => Promise<void>;
};

// Dialog actions must wrap inside the available mobile width, not enlarge its grid.
const adjustmentActionClassName = 'h-auto min-h-11 min-w-0 max-w-full whitespace-normal break-words leading-snug';

export function PaymentAdjustmentFields({ id, kind, amount, actionDate, reason, reference, acknowledged, disabled, onAmountChange, onDateChange, onReasonChange, onReferenceChange, onAcknowledgedChange }: {
  id: string; kind: PaymentAdjustmentKind; amount: string; actionDate: string; reason: string; reference: string; acknowledged: boolean; disabled: boolean;
  onAmountChange: (value: string) => void; onDateChange: (value: string) => void; onReasonChange: (value: string) => void;
  onReferenceChange: (value: string) => void; onAcknowledgedChange: (value: boolean) => void;
}) {
  const refund = kind === 'CUSTOMER_REFUND';
  return <>
    <div className="space-y-2"><Label htmlFor={`${id}-amount`}>{refund ? 'Tatsächlich ausgezahlter Betrag (EUR)' : 'Nie erhaltener Betrag (EUR)'}</Label><Input id={`${id}-amount`} inputMode="decimal" autoComplete="off" required value={amount} disabled={disabled} aria-describedby={`${id}-amount-help`} onChange={event => onAmountChange(event.target.value)} /><p id={`${id}-amount-help`} className="text-xs text-muted-foreground">Centgenau, z. B. 40,00.</p></div>
    <div className="space-y-2"><Label htmlFor={`${id}-date`}>{refund ? 'Tatsächliches Auszahlungsdatum' : 'Datum der entdeckten Fehlbuchung'}</Label><Input id={`${id}-date`} type="date" required value={actionDate} disabled={disabled} aria-describedby={`${id}-date-help`} onChange={event => onDateChange(event.target.value)} /><p id={`${id}-date-help`} className="text-xs text-muted-foreground">Bewusst wählen; kein heutiges Datum vorbelegt. {!refund && 'Buchungszuordnung: ursprünglicher Zahlungstag.'}</p></div>
    <div className="space-y-2"><Label htmlFor={`${id}-reason`}>Nachvollziehbarer Grund</Label><Textarea id={`${id}-reason`} required maxLength={1000} rows={2} className="min-h-20" value={reason} disabled={disabled} onChange={event => onReasonChange(event.target.value)} /></div>
    <div className="space-y-2"><Label htmlFor={`${id}-reference`}>{refund ? 'Nachweis der tatsächlichen Auszahlung' : 'Prüfbarer Korrekturbezug'}</Label><Input id={`${id}-reference`} required maxLength={255} value={reference} disabled={disabled} aria-describedby={`${id}-reference-help`} onChange={event => onReferenceChange(event.target.value)} /><p id={`${id}-reference-help`} className="text-xs text-muted-foreground">{refund ? 'Kontoauszug mit Buchungsreferenz; eine geplante Überweisung reicht nicht.' : 'Kontenabgleich mit Bezug zur fehlerhaften Erfassung.'}</p></div>
    <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3"><input id={`${id}-declaration`} type="checkbox" required checked={acknowledged} disabled={disabled} className="mt-0.5 h-5 w-5 shrink-0" onChange={event => onAcknowledgedChange(event.target.checked)} /><Label htmlFor={`${id}-declaration`} className="text-sm leading-relaxed">{refund ? 'Ich bestätige: Der Kunde hat den Betrag tatsächlich zurückerhalten. Hier wird keine Überweisung ausgelöst.' : 'Ich bestätige: Dieser Betrag ist nie eingegangen – keine Rückzahlung von bereits erhaltenem Geld.'}</Label></div>
  </>;
}

/** Separate, original-linked append-only actions. No payout provider is invoked. */
export function PaymentAdjustmentPanel({ invoiceId, tenantId, journal, disabled, loading, onEditingChange, onBusyChange, onReload, onRecorded }: Props) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState<PaymentAdjustmentKind>('PAYMENT_CORRECTION');
  const [originalId, setOriginalId] = useState('');
  const [amount, setAmount] = useState('');
  const [actionDate, setActionDate] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflictVersion, setConflictVersion] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<PaymentAdjustmentEvent | null>(null);
  const [confirmedLedger, setConfirmedLedger] = useState<PaymentLedger | null>(null);
  const [refreshError, setRefreshError] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const pending = useRef<PendingAdjustment | null>(null);
  const attempt = useRef<PaymentAdjustmentDraft | null>(null);
  const submitting = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const entryRef = useRef<HTMLButtonElement>(null);
  const choiceRef = useRef<HTMLInputElement>(null);
  const wasEditing = useRef(false);
  const callbacks = useRef({ onEditingChange, onRecorded });
  callbacks.current = { onEditingChange, onRecorded };
  const storageKey = adjustmentPendingStorageKey(tenantId, invoiceId);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(storageKey), restored = readPendingAdjustment(stored);
      if (stored !== null && !restored) throw new Error();
      pending.current ??= restored;
      setStorageError(false);
    } catch {
      setStorageError(true); setEditing(true); callbacks.current.onEditingChange(true);
      setError('Die gespeicherte Anfragekennung ist nicht sicher lesbar. Bitte Browser-Speicher und Journal prüfen; keine neue Korrektur oder Erstattung erfassen.');
      return;
    }
    if (!pending.current) return;
    setUncertain(true);
    setEditing(true);
    callbacks.current.onEditingChange(true);
    const saved = journal.adjustments.find(event => event.idempotencyKey === pending.current?.idempotencyKey);
    if (!saved) return;
    let cancelled = false;
    void (async () => {
      const recovered = paymentAdjustmentAttempt(null, { kind: saved.kind, originalPaymentId: saved.originalPaymentId, amount: paymentAmountInput(saved.amountCents), actionDate: saved.actionDate.slice(0, 10), reason: saved.reason, reference: saved.reference, expectedLedgerVersion: pending.current!.expectedLedgerVersion, ...(saved.contractVersion === 3 && saved.allocationRevision !== null ? { expectedAllocationRevision: saved.allocationRevision } : {}), ...(saved.cancellationInvoiceId ? { cancellationInvoiceId: saved.cancellationInvoiceId } : {}) }, () => saved.idempotencyKey);
      const hash = await adjustmentFingerprintHash(recovered.fingerprint);
      if (cancelled || hash !== pending.current?.fingerprintHash) return;
      setConfirmed(saved);
      setUncertain(false);
      pending.current = null;
      attempt.current = null;
      try { sessionStorage.removeItem(storageKey); } catch { /* saved event is already verified */ }
      try { await callbacks.current.onRecorded(); } catch { if (!cancelled) setRefreshError(true); }
    })().catch(() => { if (!cancelled) setError('Die frühere Anfrage konnte nicht sicher zugeordnet werden. Bitte Journal und Nachweis prüfen; nichts neu erfassen.'); });
    return () => { cancelled = true; };
  }, [journal, storageKey]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { if (confirmed) successRef.current?.focus(); }, [confirmed]);
  useEffect(() => {
    if (editing && !confirmed) choiceRef.current?.focus();
    else if (wasEditing.current && !editing) entryRef.current?.focus();
    wasEditing.current = editing;
  }, [editing, confirmed]);

  const changeEditing = (value: boolean) => { setEditing(value); onEditingChange(value); };
  const clearPending = () => {
    pending.current = null;
    setUncertain(false);
    try { sessionStorage.removeItem(storageKey); } catch { /* no evidence is persisted */ }
  };
  const refresh = async () => { setRefreshError(false); try { await onRecorded(); } catch { setRefreshError(true); } };
  const v3 = journal.ledger.version === 3;
  const roots = v3 ? (journal.effectivePayments ?? []).map(root => ({ id: root.originalPaymentId, ...root })) : journal.events;
  const capacities = v3 ? (journal.rootCapabilities ?? []).filter(capacity => kind === 'PAYMENT_CORRECTION' ? capacity.canCorrect : capacity.canRefund) : journal.adjustmentCapacities.filter(capacity => (kind === 'PAYMENT_CORRECTION' ? capacity.correctableCents : capacity.refundableCents) !== '0');
  const selectedRoot = journal.effectivePayments?.find(root => root.originalPaymentId === Number(originalId));
  const rootCapability = journal.rootCapabilities?.find(root => root.originalPaymentId === Number(originalId));
  const rootReviewReason = rootCapability ? kind === 'PAYMENT_CORRECTION' ? rootCapability.correctionReviewReason : rootCapability.refundReviewReason : null;
  const selected = capacities.find(capacity => capacity.originalPaymentId === Number(originalId));
  const available = selected ? kind === 'PAYMENT_CORRECTION' ? selected.correctableCents : selected.refundableCents : '0';
  const locked = busy || disabled || storageError || (uncertain && Boolean(attempt.current));
  // The verified write response owns the new balances until the fresh journal
  // includes that immutable adjustment. Never display the pre-write balances.
  const displayLedger = confirmedLedger && !journal.adjustments.some(event => event.id === confirmed?.id) ? confirmedLedger : journal.ledger;
  const displayAmounts = invoicePaymentAmounts(displayLedger);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current || disabled || storageError || confirmed || conflictVersion || loading || (!journal.canRecordAdjustment && !pending.current)) return;
    const invalid = validatePaymentAdjustmentFields(kind, actionDate, reason, reference, acknowledged);
    if (invalid) { setError(invalid); return; }
    setError(null);
    submitting.current = true; setBusy(true); onBusyChange(true);
    try {
      const amountCents = paymentInputCents(amount);
      if (!pending.current && (!selected || BigInt(amountCents) > BigInt(available))) { setError('Der Betrag überschreitet den für diesen ursprünglichen Zahlungsnachweis freigegebenen Betrag. Bitte Journal prüfen.'); return; }
      const draft = uncertain && attempt.current ? attempt.current : paymentAdjustmentAttempt(attempt.current, {
        kind, originalPaymentId: Number(originalId), amount, actionDate, reason, reference,
        expectedLedgerVersion: pending.current?.expectedLedgerVersion ?? journal.ledgerVersion,
        ...(selectedRoot?.allocationRevision !== null && selectedRoot?.allocationRevision !== undefined ? { expectedAllocationRevision: selectedRoot.allocationRevision } : {}),
        ...(kind === 'CUSTOMER_REFUND' && journal.eligibleCancellationBasis ? { cancellationInvoiceId: journal.eligibleCancellationBasis.invoiceId } : {}),
      }, () => pending.current?.idempotencyKey ?? crypto.randomUUID());
      const fingerprintHash = await adjustmentFingerprintHash(draft.fingerprint);
      if (pending.current && pending.current.fingerprintHash !== fingerprintHash) { setError('Eine frühere Anfrage ist noch ungeklärt. Bitte deren exakt unveränderte Daten eingeben; keine neue Korrektur oder Erstattung erfassen.'); return; }
      attempt.current = draft;
      pending.current = { idempotencyKey: draft.idempotencyKey, expectedLedgerVersion: draft.expectedLedgerVersion, fingerprintHash };
      try { persistPendingAdjustment(sessionStorage, storageKey, pending.current); }
      catch (failure) { pending.current = null; setStorageError(true); throw failure; }
      if (uncertain) {
        const recovery = await fetch(`/api/invoices/${invoiceId}/payments`, { cache: 'no-store', headers: { 'X-Bivaro-Payment-Contract': '3' } });
        const recoveryData: unknown = await recovery.json();
        if (!recovery.ok) throw new Error(adjustmentFailure(recoveryData));
        const checked = readPaymentAdjustmentPreflight(recoveryData, invoiceId);
        const saved = checked.adjustments.find(adjustment => adjustment.idempotencyKey === draft.idempotencyKey);
        if (saved) {
          const recovered = readConfirmedPaymentAdjustment({ ...(recoveryData as object), adjustment: saved }, draft, roots.find(root => root.id === draft.originalPaymentId)?.paidAt ?? null);
          setConfirmedLedger(checked.ledger); setConfirmed(recovered); clearPending(); attempt.current = null; await refresh(); return;
        }
      }
      const response = await fetch(`/api/invoices/${invoiceId}/payments/adjustments`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bivaro-Payment-Contract': '3' }, body: JSON.stringify(paymentAdjustmentPayload(draft)) });
      const data: unknown = await response.json();
      if (!response.ok) {
        const code = data && typeof data === 'object' ? (data as { code?: string }).code : undefined;
        if (code === 'PAYMENT_STATE_CHANGED' || code === 'PAYMENT_LEDGER_CHANGED') {
          clearPending(); attempt.current = null; setConflictVersion(journal.ledgerVersion); onReload();
        } else if (response.status < 500 && code !== 'IDEMPOTENCY_CONFLICT') clearPending(); else setUncertain(true);
        setError(adjustmentFailure(data)); return;
      }
      const saved = readConfirmedPaymentAdjustment(data, draft, roots.find(event => event.id === draft.originalPaymentId)?.paidAt ?? null);
      setConfirmedLedger(readPaymentLedger((data as { ledger: unknown }).ledger));
      setConfirmed(saved); clearPending(); attempt.current = null;
      await refresh();
    } catch (failure) {
      setUncertain(Boolean(pending.current));
      setError(failure instanceof Error ? failure.message : 'Keine verlässliche Speicherbestätigung. Bitte unverändert erneut versuchen oder Journal prüfen.');
    } finally { submitting.current = false; setBusy(false); onBusyChange(false); }
  };

  return <section aria-label="Zahlung korrigieren oder Erstattung dokumentieren" className="min-w-0 space-y-4 rounded-xl border bg-card p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <h3 className="font-semibold">{editing ? kind === 'CUSTOMER_REFUND' ? 'Erstattung dokumentieren' : 'Zahlung korrigieren' : 'Zahlungsstand'}</h3>
      <Badge variant="outline" aria-label="Steuerliche Zuordnung: prüfpflichtig, nicht fachlich freigegeben">Steuerlich nicht freigegeben</Badge>
    </div>
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
      <div><dt className="text-xs text-muted-foreground">{v3 ? 'Gültig zugeordnet' : 'Gültig eingegangen'}</dt><dd className="mt-1 font-semibold tabular-nums">{displayPaymentAmount(displayAmounts.valid)}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Nie erhalten / korrigiert</dt><dd className="mt-1 font-semibold tabular-nums">{displayPaymentAmount(displayAmounts.corrected)}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Bereits zurückgezahlt</dt><dd className="mt-1 font-semibold tabular-nums">{displayPaymentAmount(displayAmounts.refunded)}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Tatsächlich einbehalten</dt><dd className="mt-1 font-semibold tabular-nums">{displayPaymentAmount(displayAmounts.retained)}</dd></div>
      <div className="rounded-lg bg-muted/40 p-2.5"><dt className="text-xs text-muted-foreground">Noch einzuziehen</dt><dd className="mt-1 font-semibold tabular-nums">{displayPaymentAmount(displayAmounts.open)}</dd></div>
      <div className="rounded-lg bg-muted/40 p-2.5"><dt className="text-xs text-muted-foreground">Noch zu erstatten</dt><dd className="mt-1 font-semibold tabular-nums">{displayPaymentAmount(displayAmounts.refundDue)}</dd></div>
    </dl>
    <p className="text-xs text-muted-foreground">Hier wird niemals Geld überwiesen.</p>
    {journal.adjustmentReviewReason && <p role="status" className="text-sm">Nur lesbar · Prüfung erforderlich.</p>}
    <details className="text-sm text-muted-foreground">
      <summary className="min-h-11 cursor-pointer py-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring">Hinweise und Grenzen</summary>
      <div className="space-y-2 pb-2"><p>Originale bleiben unveränderlich. Korrektur: Geld nie erhalten. Erstattung: erhaltenes Geld tatsächlich zurückgezahlt.</p><p>Steuerliche Zuordnung: prüfpflichtig, nicht fachlich freigegeben. Vor EÜR oder Steuerexport prüfen.</p><p>Kassenbuch, ungeklärte Legacy-Nachweise und Teilgutschriften sind ausgeschlossen. Erhaltenes Geld auf der falschen Rechnung: im Bankimport „Andere Rechnung“ wählen, nicht „nie erhalten“.</p>{journal.adjustmentReviewReason && <p>{journal.adjustmentReviewReason}</p>}{journal.rootCapabilities?.some(root => root.correctionReviewReason || root.refundReviewReason) && <ul className="space-y-1">{journal.rootCapabilities.map(root => <li key={root.originalPaymentId}>Nachweis #{root.originalPaymentId}: {root.correctionReviewReason || 'Korrektur verfügbar'} · {root.refundReviewReason || 'Erstattung verfügbar'}</li>)}</ul>}</div>
    </details>
    {!editing ? <Button ref={entryRef} type="button" variant="outline" className={`${adjustmentActionClassName} w-full`} disabled={disabled || loading || !journal.canRecordAdjustment} onClick={() => changeEditing(true)}>Korrektur / Erstattung dokumentieren</Button> : confirmed ? <>
      <div ref={successRef} tabIndex={-1} role="status" className="space-y-2 rounded-lg bg-muted/30 p-4 outline-none"><p className="flex items-center gap-2 font-semibold"><CheckCircle aria-hidden="true" className="h-5 w-5" />{confirmed.kind === 'PAYMENT_CORRECTION' ? 'Korrektur gespeichert' : 'Erstattung dokumentiert'}</p><p className="text-2xl font-semibold tabular-nums">{displayPaymentAmount(confirmed.amountCents)}</p><p className="text-sm">Original-Zahlungsnachweis #{confirmed.originalPaymentId} · {formatBusinessDateDisplay(confirmed.actionDate)}</p><details className="text-sm"><summary className="min-h-11 cursor-pointer py-3 font-medium focus-visible:outline-2 focus-visible:outline-ring">Gespeicherten Nachweis ansehen</summary><div className="space-y-2"><p>{confirmed.kind === 'CUSTOMER_REFUND' ? 'Tatsächliche Auszahlung' : 'Korrektur entdeckt'}: {formatBusinessDateDisplay(confirmed.actionDate)}</p><p>Buchungszuordnung: {formatBusinessDateDisplay(confirmed.accountingEffectiveOn)} · steuerlich ungeprüft</p><p className="break-words">Nachweis #{confirmed.id} · {confirmed.reference}</p></div></details></div>
      {refreshError && <p role="alert" className="text-sm text-destructive">Gespeichert, aber die Listen konnten nicht aktualisiert werden. Nicht erneut erfassen.</p>}
      {refreshError && <Button type="button" variant="outline" className={adjustmentActionClassName} onClick={() => void refresh()}>Listen aktualisieren</Button>}
    </> : <form onSubmit={submit} className="space-y-5 border-t pt-4" aria-busy={busy}>
      {uncertain && <div role="status" className="space-y-1 rounded-lg border p-3 text-sm"><p className="font-medium">Anfrage noch ungeklärt · nichts neu erfassen.</p><p>Nur unverändert wiederholen oder Journal prüfen.</p><details><summary className="min-h-11 cursor-pointer py-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring">Nach erneutem Öffnen</summary><p>Dieselben Daten erneut eingeben. Nachweise werden nicht im Browser gespeichert.</p></details></div>}
      <p className="text-xs text-muted-foreground">Geld erhalten, aber falsche Rechnung? {journal.rootCapabilities?.some(root => root.canReallocate) && !locked ? <Link className="inline-flex min-h-11 items-center text-primary underline underline-offset-4" href="/bank-csv">Andere Rechnung</Link> : 'Nicht als „nie erhalten“ korrigieren.'}</p>
      <fieldset disabled={locked} className="min-w-0 space-y-2"><legend className="mb-2 text-sm font-medium">Was ist passiert?</legend>
        <label className={`flex min-h-16 cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${kind === 'PAYMENT_CORRECTION' ? 'border-primary bg-primary/5' : ''}`}><input ref={choiceRef} type="radio" name={`${id}-kind`} className="mt-1" checked={kind === 'PAYMENT_CORRECTION'} onChange={() => { setKind('PAYMENT_CORRECTION'); setOriginalId(''); setAcknowledged(false); }} /><span><strong className="block">Korrektur</strong><span className="text-muted-foreground">Erfasster Betrag ist tatsächlich nie eingegangen · nicht für eine andere Rechnung</span></span></label>
        <label className={`flex min-h-16 cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${kind === 'CUSTOMER_REFUND' ? 'border-primary bg-primary/5' : ''}`}><input type="radio" name={`${id}-kind`} className="mt-1" checked={kind === 'CUSTOMER_REFUND'} onChange={() => { setKind('CUSTOMER_REFUND'); setOriginalId(''); setAcknowledged(false); }} /><span><strong className="block">Erstattung</strong><span className="text-muted-foreground">Bereits zurückgezahlt · vollständiges Storno</span></span></label>
      </fieldset>
      {kind === 'CUSTOMER_REFUND' && <p className="rounded-lg bg-muted/30 p-3 text-sm">{journal.eligibleCancellationBasis ? `Vollständiger Stornobeleg: ${journal.eligibleCancellationBasis.invoiceNumber || `#${journal.eligibleCancellationBasis.invoiceId}`}.` : 'Kein geprüfter vollständiger Stornobeleg · Erstattung nicht verfügbar.'}</p>}
      <div className="space-y-2"><Label htmlFor={`${id}-original`}>Ursprünglicher Zahlungsnachweis</Label><select id={`${id}-original`} required value={originalId} disabled={locked} className="min-h-11 w-full min-w-0 rounded-md border bg-background px-3 text-sm" onChange={event => { setOriginalId(event.target.value); setError(null); }}><option value="">Original bewusst auswählen</option>{(pending.current || v3 ? roots : roots.filter(event => capacities.some(capacity => capacity.originalPaymentId === event.id))).map(event => <option key={event.id} value={event.id}>#{event.id} · {displayPaymentAmount(event.amountCents)} · {event.paidAt ? formatBusinessDateDisplay(event.paidAt) : 'Datum unbekannt'}{'originInvoiceId' in event ? ` · Ursprung #${event.originInvoiceId} → aktuell #${event.allocatedInvoiceId}` : ''}{!capacities.some(capacity => capacity.originalPaymentId === event.id) ? ' · nicht verfügbar' : ''}</option>)}</select><p className="text-xs text-muted-foreground">Für dieses Original verfügbar: <strong className="font-medium tabular-nums">{displayPaymentAmount(available)}</strong></p></div>
      {selectedRoot && <p className="text-xs text-muted-foreground">Original auf Rechnung #{selectedRoot.originInvoiceId} · aktuell zugeordnet zu Rechnung #{selectedRoot.allocatedInvoiceId} · Stand {selectedRoot.allocationRevision ?? 'manuell'}</p>}{rootReviewReason && <p role="status" className="text-sm">{rootReviewReason}</p>}
      <PaymentAdjustmentFields id={id} kind={kind} amount={amount} actionDate={actionDate} reason={reason} reference={reference} acknowledged={acknowledged} disabled={locked} onAmountChange={setAmount} onDateChange={setActionDate} onReasonChange={setReason} onReferenceChange={setReference} onAcknowledgedChange={setAcknowledged} />
      {error && <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-destructive outline-none">{error}</p>}
      {conflictVersion && <div className="space-y-3"><p className="text-sm">Journalstand geändert. Betrag, Original und Nachweise erneut prüfen.</p><Button type="button" className={`${adjustmentActionClassName} w-full`} disabled={loading || journal.ledgerVersion === conflictVersion} onClick={() => { setConflictVersion(null); setError(null); }}>Aktuellen Journalstand geprüft</Button></div>}
      <div className="space-y-2">
        {!conflictVersion && <Button type="submit" className={`${adjustmentActionClassName} w-full`} disabled={busy || disabled || storageError || loading || (!journal.canRecordAdjustment && !pending.current) || (!pending.current && (!selected || (kind === 'CUSTOMER_REFUND' && !journal.eligibleCancellationBasis)))}>{busy && <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />}{busy ? 'Wird gespeichert …' : uncertain ? 'Unverändert erneut bestätigen' : kind === 'CUSTOMER_REFUND' ? 'Erstattung verbindlich dokumentieren' : 'Korrektur verbindlich speichern'}</Button>}
        <div className="flex flex-wrap justify-between gap-2"><Button type="button" variant="ghost" className={adjustmentActionClassName} disabled={busy || disabled || uncertain || storageError} onClick={() => changeEditing(false)}>Zurück zum Zahlungseingang</Button>{(error || uncertain || storageError) && <Button type="button" variant="ghost" className={adjustmentActionClassName} disabled={busy || disabled || loading} onClick={onReload}>Journal prüfen</Button>}</div>
      </div>
    </form>}
  </section>;
}
