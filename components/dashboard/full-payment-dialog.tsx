"use client";

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { CheckCircle, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { paymentDialogReturnTarget } from '@/lib/payment-dialog-focus';
import { PaymentHistory } from '@/components/payments/payment-history';
import { PaymentAdjustmentPanel } from '@/components/payments/payment-adjustment-panel';
import { readPaymentAdjustmentPreflight, type PaymentAdjustmentPreflight } from '@/lib/payment-adjustment-form';
import { formatBusinessDateDisplay } from '@/lib/business-date';
import { displayPaymentAmount, paymentAttempt, paymentFailure, paymentIdentityStorageKey, paymentPendingStorageKey, paymentInputCents, readPaymentEvents, readConfirmedPayment, readPaymentPreflight, recoverConfirmedPayment, validatePaymentFields, type ConfirmedPayment, type PaymentDraft, type PaymentPreflight, type PaymentHistoryEvent } from '@/lib/full-payment-form';

type Props = {
  invoice: { id: number; invoiceNumber?: string | null; fileName: string };
  onClose: () => void;
  onSuccess: () => Promise<void>;
};

export function FullPaymentFields({ id, paidAt, reference, disabled, dateRef, onDateChange, onReferenceChange }: {
  id: string; paidAt: string; reference: string; disabled: boolean;
  dateRef?: React.Ref<HTMLInputElement>; onDateChange: (value: string) => void; onReferenceChange: (value: string) => void;
}) {
  return <>
    <div className="space-y-2">
      <Label htmlFor={`${id}-date`}>Tatsächliches Zahlungsdatum</Label>
      <Input ref={dateRef} id={`${id}-date`} type="date" required className="min-h-11" value={paidAt} disabled={disabled} aria-describedby={`${id}-date-help`} onChange={event => onDateChange(event.target.value)} />
      <p id={`${id}-date-help`} className="text-sm text-muted-foreground">Datum laut Zahlungsnachweis wählen. Es wird bewusst kein heutiges Datum vorbelegt.</p>
    </div>
    <div className="space-y-2">
      <Label htmlFor={`${id}-reference`}>Zahlungsreferenz</Label>
      <Input id={`${id}-reference`} required maxLength={255} className="min-h-11" value={reference} disabled={disabled} aria-describedby={`${id}-reference-help`} placeholder="z. B. Kontoauszug / Buchungstext" onChange={event => onReferenceChange(event.target.value)} />
      <p id={`${id}-reference-help`} className="text-sm text-muted-foreground">Nachvollziehbare Zuordnung der eingegangenen Zahlung (max. 255 Zeichen).</p>
    </div>
  </>;
}

/** Allocation entry and immutable history. Never infer evidence or saved success. */
export function FullPaymentDialog(props: Props) {
  const { data: session } = useSession();
  const tenantId = session?.user?.id;
  if (!tenantId) return <Dialog open onOpenChange={(open) => { if (!open) props.onClose(); }}><DialogContent><DialogHeader><DialogTitle>Zahlung erfassen</DialogTitle><DialogDescription>Eine bestätigte Anmeldung ist erforderlich. Bitte warten oder erneut anmelden; es wurde keine Zahlung gebucht.</DialogDescription></DialogHeader><Button type="button" onClick={props.onClose}>Schließen</Button></DialogContent></Dialog>;
  // Never restore another account's in-memory inputs after an account switch.
  return <FullPaymentDialogForm key={`${tenantId}:${props.invoice.id}`} {...props} tenantId={tenantId} />;
}

function FullPaymentDialogForm({ invoice, onClose, onSuccess, tenantId }: Props & { tenantId: string }) {
  const id = useId();
  const returnFocusRef = useRef<HTMLElement | null>(typeof document !== 'undefined' ? document.activeElement as HTMLElement | null : null);
  const [amount, setAmount] = useState('');
  const [paidAt, setPaidAt] = useState('');
  const [history, setHistory] = useState<PaymentHistoryEvent[]>([]);
  const [conflict, setConflict] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const pendingKey = useRef<string | null>(null);
  const pendingBaseline = useRef<string | null>(null);
  const pendingLedgerVersion = useRef<string | null>(null);
  const [reference, setReference] = useState('');
  const attempt = useRef<PaymentDraft | null>(null);
  const [preflight, setPreflight] = useState<PaymentPreflight | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<ConfirmedPayment | null>(null);
  const [refreshError, setRefreshError] = useState(false);
  const [reload, setReload] = useState(0);
  const [adjustmentJournal, setAdjustmentJournal] = useState<PaymentAdjustmentPreflight | null>(null);
  const [adjustmentEditing, setAdjustmentEditing] = useState(false);
  const [adjustmentBusy, setAdjustmentBusy] = useState(false);
  const adjustmentSubmitting = useRef(false);
  const submitting = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const clearIdentity = useCallback(() => {
    const pendingStorage = paymentPendingStorageKey(tenantId, invoice.id);
    try {
      const identityStorage = sessionStorage.getItem(`${pendingStorage}:identity`);
      if (identityStorage) sessionStorage.removeItem(identityStorage);
      sessionStorage.removeItem(pendingStorage);
      sessionStorage.removeItem(`${pendingStorage}:identity`);
      sessionStorage.removeItem(`${pendingStorage}:baseline`);
      sessionStorage.removeItem(`${pendingStorage}:ledger-version`);
    } catch { /* storage may be disabled */ }
    attempt.current = null;
    pendingKey.current = null;
    pendingBaseline.current = null;
    pendingLedgerVersion.current = null;
    setUncertain(false);
  }, [invoice.id, tenantId]);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setLoadError(null);
    setPreflight(null);
    void (async () => {
      try {
        const response = await fetch(`/api/invoices/${invoice.id}/payments`, { cache: 'no-store', headers: { 'X-Bivaro-Payment-Contract': '2' }, signal: controller.signal });
        const data: unknown = await response.json();
        if (!response.ok) throw new Error(paymentFailure(data));
        try {
          const storage = paymentPendingStorageKey(tenantId, invoice.id);
          pendingKey.current ??= sessionStorage.getItem(storage);
          const baseline = sessionStorage.getItem(`${storage}:baseline`);
          if (baseline && /^(?:0|[1-9]\d{0,15})$/u.test(baseline) && BigInt(baseline) <= BigInt(Number.MAX_SAFE_INTEGER)) pendingBaseline.current ??= baseline;
          const version = sessionStorage.getItem(`${storage}:ledger-version`);
          if (version && /^[a-f0-9]{64}$/u.test(version)) pendingLedgerVersion.current ??= version;
        } catch { /* storage may be disabled */ }
        const events = readPaymentEvents(data);
        if (!controller.signal.aborted) setHistory(events);
        const checked = readPaymentPreflight(data);
        const adjustments = data && typeof data === 'object' && 'ledger' in data ? readPaymentAdjustmentPreflight(data, invoice.id) : null;
        if (!controller.signal.aborted) setAdjustmentJournal(adjustments);
        const recovered = recoverConfirmedPayment(data, invoice.id, pendingKey.current, attempt.current);
        if (recovered && !controller.signal.aborted) {
          setConfirmed(recovered);
          clearIdentity();
          try { await onSuccessRef.current(); } catch { if (!controller.signal.aborted) setRefreshError(true); }
          return;
        }
        if (!controller.signal.aborted) {
          setPreflight(checked);
          setAmount(current => current || checked.amount);
          if (pendingKey.current) setUncertain(true);
        }
      } catch (failure) {
        if (!controller.signal.aborted) setLoadError(failure instanceof Error ? failure.message : 'Zahlungsdaten konnten nicht geladen werden. Bitte erneut laden.');
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    })();
    return () => controller.abort();
  }, [invoice.id, reload, clearIdentity, tenantId]);

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { if (confirmed) successRef.current?.focus(); }, [confirmed]);

  const refreshLists = async () => {
    setRefreshError(false);
    try { await onSuccess(); } catch { setRefreshError(true); }
  };

  const close = () => {
    if (submitting.current || adjustmentSubmitting.current) return;
    onClose();
  };

  const reloadPaymentData = () => {
    if (submitting.current) return;
    setError(null);
    setPreflight(null);
    setIsLoading(true);
    setReload(value => value + 1);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current || adjustmentSubmitting.current || adjustmentEditing || confirmed || !preflight || (!preflight.canRecordPayment && !pendingKey.current) || conflict) return;
    try { paymentInputCents(amount); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Bitte Betrag prüfen.'); return; }
    const invalid = validatePaymentFields(paidAt, reference);
    if (invalid) { setError(invalid); return; }
    submitting.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      const amountCents = paymentInputCents(amount);
      if (!uncertain && BigInt(amountCents) > BigInt(preflight.summary.openCents)) {
        setError('Der Betrag übersteigt den offenen Restbetrag. Bitte den Betrag korrigieren.');
        return;
      }
      const draft = uncertain && attempt.current
        ? attempt.current
        : paymentAttempt(attempt.current, invoice.id, amount, paidAt, reference, () => crypto.randomUUID(), pendingKey.current ? pendingBaseline.current ?? preflight.summary.paidCents : preflight.summary.paidCents, pendingKey.current ? pendingLedgerVersion.current ?? undefined : preflight.ledgerVersion);
      let identityStorage: string | null = null;
      try {
        identityStorage = await paymentIdentityStorageKey(tenantId, invoice.id, draft.fingerprint);
        const stored = sessionStorage.getItem(identityStorage);
        if (stored && /^[\da-f-]{36}$/iu.test(stored)) draft.idempotencyKey = stored;
      } catch { /* the in-memory identity remains usable */ }
      // Never let a storage error turn an unresolved attempt into a fresh key.
      if (pendingKey.current && pendingKey.current !== draft.idempotencyKey) {
        setError('Eine frühere Anfrage ist noch ungeklärt. Bitte deren unveränderte Zahlungsdaten eingeben und den Zahlungsnachweis erneut prüfen; keine neue Zahlung erfassen.');
        return;
      }
      try {
        const pendingStorage = paymentPendingStorageKey(tenantId, invoice.id);
        if (identityStorage) {
          sessionStorage.setItem(identityStorage, draft.idempotencyKey);
          sessionStorage.setItem(`${pendingStorage}:identity`, identityStorage);
        }
        sessionStorage.setItem(pendingStorage, draft.idempotencyKey);
        // Preserve the optimistic precondition, never plaintext evidence fields.
        sessionStorage.setItem(`${pendingStorage}:baseline`, draft.expectedPaidCents);
        if (draft.expectedLedgerVersion) sessionStorage.setItem(`${pendingStorage}:ledger-version`, draft.expectedLedgerVersion);
      } catch { /* in-memory retry identity still works when storage is disabled */ }
      attempt.current = draft;
      pendingKey.current = draft.idempotencyKey;
      pendingBaseline.current = draft.expectedPaidCents;
      pendingLedgerVersion.current = draft.expectedLedgerVersion ?? null;
      const response = await fetch(`/api/invoices/${invoice.id}/payments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: draft.amount, currency: 'EUR', paidAt: draft.paidAt, source: 'MANUAL', reference: draft.reference.trim(), idempotencyKey: draft.idempotencyKey, expectedPaidCents: draft.expectedPaidCents, ...(draft.expectedLedgerVersion ? { expectedLedgerVersion: draft.expectedLedgerVersion } : {}) }),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const code = data && typeof data === 'object' ? (data as { code?: string }).code : undefined;
        if (code === 'PAYMENT_STATE_CHANGED' || code === 'PAYMENT_LEDGER_CHANGED' || code === 'PAYMENT_EXCEEDS_OPEN') {
          clearIdentity();
          setConflict(true);
          setReload(value => value + 1);
        } else if (response.status < 500 && code !== 'IDEMPOTENCY_CONFLICT') {
          // Rejected input wrote nothing. An unchanged retry retains its UUID.
          pendingKey.current = null;
          pendingBaseline.current = null;
          pendingLedgerVersion.current = null;
          setUncertain(false);
          try {
            const key = paymentPendingStorageKey(tenantId, invoice.id);
            sessionStorage.removeItem(key);
            sessionStorage.removeItem(`${key}:identity`);
            sessionStorage.removeItem(`${key}:baseline`);
            sessionStorage.removeItem(`${key}:ledger-version`);
          } catch { /* in-memory identity remains available */ }
        } else setUncertain(true);
        setError(paymentFailure(data));
        return;
      }
      const saved = readConfirmedPayment(data, draft, invoice.id);
      setConfirmed(saved);
      try { setHistory(readPaymentEvents({ events: [...history, (data as { event: unknown }).event] })); } catch { /* confirmation above already verifies the saved allocation */ }
      clearIdentity();
      await refreshLists();
    } catch (failure) {
      setUncertain(Boolean(attempt.current));
      setError(failure instanceof Error && failure.message.startsWith('Die Speicherbestätigung') ? failure.message : 'Keine verlässliche Speicherbestätigung erhalten. Bitte unverändert erneut versuchen oder den Zahlungsnachweis prüfen. Ihre Eingaben und die Anfragekennung bleiben erhalten.');
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-cols-1 overflow-y-auto sm:max-w-lg" showCloseButton={!isSubmitting && !adjustmentBusy}
        onOpenAutoFocus={(event) => { event.preventDefault(); dateRef.current?.focus(); }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          paymentDialogReturnTarget(invoice.id, returnFocusRef.current)?.focus({ preventScroll: true });
        }}
        onEscapeKeyDown={(event) => { if (submitting.current || adjustmentSubmitting.current) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (submitting.current || adjustmentSubmitting.current) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>Zahlungen und Korrekturen</DialogTitle>
          <DialogDescription className="break-words">Rechnung {invoice.invoiceNumber || invoice.fileName}. Nur bereits tatsächlich eingegangene Zahlungen erfassen; es wird kein Geld überwiesen.</DialogDescription>
        </DialogHeader>
        <PaymentHistory events={history} adjustments={adjustmentJournal?.adjustments} />
        {adjustmentJournal && <PaymentAdjustmentPanel invoiceId={invoice.id} tenantId={tenantId} journal={adjustmentJournal}
          disabled={isSubmitting || uncertain || Boolean(pendingKey.current) || Boolean(confirmed)} loading={isLoading}
          onEditingChange={setAdjustmentEditing} onBusyChange={busy => { adjustmentSubmitting.current = busy; setAdjustmentBusy(busy); }}
          onReload={reloadPaymentData} onRecorded={async () => { try { await onSuccess(); } finally { setReload(value => value + 1); } }} />}
        {adjustmentEditing && isLoading && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />Aktueller Journalstand wird geprüft …</p>}
        {adjustmentEditing && loadError && <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{loadError}</p><Button type="button" variant="outline" disabled={adjustmentBusy || isLoading} onClick={reloadPaymentData}>Journal erneut laden</Button></div>}
        {adjustmentEditing ? <DialogFooter><Button type="button" variant="ghost" className="min-h-11" disabled={adjustmentBusy} onClick={close}>Schließen</Button></DialogFooter> : confirmed ? (
          <>
            <div ref={successRef} tabIndex={-1} role="status" className="space-y-2 border-y py-4 outline-none">
              <p className="flex items-center gap-2 font-semibold text-[var(--color-success-ink)]"><CheckCircle className="h-5 w-5 shrink-0" aria-hidden="true" />Zahlung gespeichert</p>
              <p className="text-2xl font-semibold tabular-nums">{displayPaymentAmount(confirmed.amountCents)}</p>
              <p>Tatsächliches Zahlungsdatum: <strong>{formatBusinessDateDisplay(confirmed.paidAt)}</strong></p>
              <p className="break-words text-sm">Referenz: {confirmed.reference}</p>
              <p className="text-sm text-muted-foreground">Zahlungsnachweis #{confirmed.id} · Einnahme ist erfasst. {confirmed.summary.paid ? 'Rechnung vollständig bezahlt.' : `Noch offen: ${displayPaymentAmount(confirmed.summary.openCents)}.`}</p>
            </div>
            {refreshError && <p role="alert" className="text-sm text-destructive">Die Zahlung ist gespeichert, aber die Listen konnten nicht aktualisiert werden. Nicht erneut buchen.</p>}
            <DialogFooter>{refreshError && <Button type="button" variant="outline" className="min-h-11" onClick={() => void refreshLists()}>Listen aktualisieren</Button>}<Button type="button" className="min-h-11" disabled={isSubmitting} onClick={close}>Schließen</Button></DialogFooter>
          </>
        ) : preflight && !preflight.canRecordPayment && !pendingKey.current ? <>
          {!adjustmentJournal && <dl className="grid grid-cols-3 gap-3 text-sm"><div><dt>Gesamt</dt><dd>{displayPaymentAmount(preflight.summary.totalCents)}</dd></div><div><dt>Erhalten</dt><dd>{displayPaymentAmount(preflight.summary.paidCents)}</dd></div><div><dt>Noch offen</dt><dd>{displayPaymentAmount(preflight.summary.openCents)}</dd></div></dl>}
          <p className="text-sm">{preflight.ledger?.documentState === 'CANCELLED' ? 'Rechnung vollständig storniert; kein weiterer Betrag einzuziehen. Eine offene Erstattung wird separat ausgewiesen.' : preflight.summary.paid ? 'Gültige Zahlungseingänge decken den Rechnungsbetrag. Mögliche Erstattungen werden separat ausgewiesen.' : 'Für diesen Rechnungsstatus kann keine neue Zahlung erfasst werden.'}</p>
          <DialogFooter><Button type="button" className="min-h-11" onClick={close}>Schließen</Button></DialogFooter>
        </> : (
          <form onSubmit={submit} className="space-y-5" aria-busy={isSubmitting}>
            <div className="border-y py-4">
              {isLoading ? <p role="status" className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Zahlungssaldo wird geprüft …</p> : preflight ? <dl className="grid grid-cols-3 gap-3 text-sm">
                <div><dt>Gesamt</dt><dd className="font-semibold tabular-nums">{displayPaymentAmount(preflight.summary.totalCents)}</dd></div>
                <div><dt>Erhalten</dt><dd className="font-semibold tabular-nums">{displayPaymentAmount(preflight.summary.paidCents)}</dd></div>
                <div><dt>Noch offen</dt><dd className="font-semibold tabular-nums">{displayPaymentAmount(preflight.summary.openCents)}</dd></div>
              </dl> : <p className="font-medium">Nicht buchbar</p>}
              <p className="mt-2 text-sm text-muted-foreground">Teilzahlungen sind möglich, Überzahlungen und Mahngebühren nicht. Bestätigte Zahlungen bleiben unveränderlich erhalten.</p>
            </div>
            {uncertain && <p role="status" className="text-sm">Eine Anfrage ist noch ungeklärt. Nur unverändert wiederholen oder den Zahlungsnachweis prüfen; keine neue Zahlung erfassen.</p>}
            <div className="space-y-2">
              <Label htmlFor={`${id}-amount`}>Eingegangener Betrag (EUR)</Label>
              <Input id={`${id}-amount`} inputMode="decimal" autoComplete="off" required value={amount} disabled={isSubmitting || (uncertain && Boolean(attempt.current))} aria-describedby={`${id}-amount-help`} onChange={event => { setAmount(event.target.value); setError(null); }} />
              <p id={`${id}-amount-help`} className="text-sm text-muted-foreground">Exakter Betrag laut Zahlungsnachweis, z. B. 40,00.</p>
            </div>
            {loadError && <div className="space-y-3"><p role="alert" className="text-sm text-destructive">{loadError}</p><Button type="button" variant="outline" className="min-h-11" onClick={reloadPaymentData}>Zahlungsdaten erneut laden</Button></div>}
            <FullPaymentFields id={id} paidAt={paidAt} reference={reference} disabled={isSubmitting || (uncertain && Boolean(attempt.current))} dateRef={dateRef}
              onDateChange={value => { setPaidAt(value); setError(null); }} onReferenceChange={value => { setReference(value); setError(null); }} />
            {error && <div className="space-y-3"><p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-destructive outline-none">{error}</p><Button type="button" variant="outline" className="min-h-11" disabled={isSubmitting} onClick={reloadPaymentData}>Zahlungsnachweis prüfen</Button></div>}
            {conflict && <div className="space-y-2 rounded-md border p-3"><p className="text-sm">Der Saldo wurde aktualisiert; Ihre Zahlungsdaten wurden nicht verändert. Bitte Betrag und Nachweis erneut prüfen.</p><Button type="button" variant="outline" disabled={isLoading || !preflight} onClick={() => { setConflict(false); setError(null); }}>Aktuellen Restbetrag geprüft</Button></div>}
            <DialogFooter><Button type="button" variant="outline" className="min-h-11" disabled={isSubmitting} onClick={close}>Abbrechen</Button><Button type="submit" className="min-h-11" disabled={isLoading || !preflight || (!preflight.canRecordPayment && !pendingKey.current) || isSubmitting || conflict}>{isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}{isSubmitting ? 'Wird gespeichert …' : uncertain ? 'Unverändert erneut bestätigen' : 'Zahlung verbindlich erfassen'}</Button></DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
