"use client";

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { CheckCircle, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatBusinessDateDisplay } from '@/lib/business-date';
import { displayPaymentAmount, paymentAttempt, paymentFailure, paymentIdentityStorageKey, readConfirmedPayment, readPaymentPreflight, recoverConfirmedPayment, validatePaymentFields, type ConfirmedPayment, type PaymentDraft, type PaymentPreflight } from '@/lib/full-payment-form';

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

/** Explicit first full payment only. Never silently derive an accounting date. */
export function FullPaymentDialog(props: Props) {
  const { data: session } = useSession();
  const tenantId = session?.user?.id;
  if (!tenantId) return <Dialog open onOpenChange={(open) => { if (!open) props.onClose(); }}><DialogContent><DialogHeader><DialogTitle>Zahlung erfassen</DialogTitle><DialogDescription>Eine bestätigte Anmeldung ist erforderlich. Bitte warten oder erneut anmelden; es wurde keine Zahlung gebucht.</DialogDescription></DialogHeader><Button type="button" onClick={props.onClose}>Schließen</Button></DialogContent></Dialog>;
  // Never restore another account's in-memory inputs after an account switch.
  return <FullPaymentDialogForm key={`${tenantId}:${props.invoice.id}`} {...props} tenantId={tenantId} />;
}

function FullPaymentDialogForm({ invoice, onClose, onSuccess, tenantId }: Props & { tenantId: string }) {
  const id = useId();
  const [paidAt, setPaidAt] = useState('');
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
  const submitting = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const clearIdentity = useCallback(async (payment: ConfirmedPayment) => {
    // Derive the canonical API amount without a Number round trip.
    const cents = BigInt(payment.amountCents);
    const amount = `${cents / BigInt(100)}.${(cents % BigInt(100)).toString().padStart(2, '0')}`;
    const fingerprint = JSON.stringify([invoice.id, amount, 'EUR', payment.paidAt.slice(0, 10), payment.reference.trim()]);
    try { sessionStorage.removeItem(await paymentIdentityStorageKey(tenantId, invoice.id, fingerprint)); } catch { /* storage may be disabled */ }
  }, [invoice.id, tenantId]);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setLoadError(null);
    setPreflight(null);
    void (async () => {
      try {
        const response = await fetch(`/api/invoices/${invoice.id}/payments`, { cache: 'no-store', signal: controller.signal });
        const data: unknown = await response.json();
        if (!response.ok) throw new Error(paymentFailure(data));
        const recovered = recoverConfirmedPayment(data, invoice.id);
        if (recovered && !controller.signal.aborted) {
          setConfirmed(recovered);
          await clearIdentity(recovered);
          try { await onSuccessRef.current(); } catch { if (!controller.signal.aborted) setRefreshError(true); }
          return;
        }
        const checked = readPaymentPreflight(data);
        if (!controller.signal.aborted) setPreflight(checked);
      } catch (failure) {
        if (!controller.signal.aborted) setLoadError(failure instanceof Error ? failure.message : 'Zahlungsdaten konnten nicht geladen werden. Bitte erneut laden.');
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    })();
    return () => controller.abort();
  }, [invoice.id, reload, clearIdentity]);

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { if (confirmed) successRef.current?.focus(); }, [confirmed]);

  const refreshLists = async () => {
    setRefreshError(false);
    try { await onSuccess(); } catch { setRefreshError(true); }
  };

  const close = () => {
    if (submitting.current) return;
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
    if (submitting.current || confirmed || !preflight) return;
    const invalid = validatePaymentFields(paidAt, reference);
    if (invalid) { setError(invalid); return; }
    submitting.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      const draft = paymentAttempt(attempt.current, invoice.id, preflight.amount, paidAt, reference, () => crypto.randomUUID());
      try {
        const key = await paymentIdentityStorageKey(tenantId, invoice.id, draft.fingerprint);
        const stored = sessionStorage.getItem(key);
        if (stored && /^[\da-f-]{36}$/iu.test(stored)) draft.idempotencyKey = stored;
        sessionStorage.setItem(key, draft.idempotencyKey);
      } catch { /* in-memory retry identity still works when storage is disabled */ }
      attempt.current = draft;
      const response = await fetch(`/api/invoices/${invoice.id}/payments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: preflight.amount, currency: 'EUR', paidAt: draft.paidAt, source: 'MANUAL', reference: draft.reference.trim(), idempotencyKey: draft.idempotencyKey }),
      });
      const data: unknown = await response.json();
      if (!response.ok) { setError(paymentFailure(data)); return; }
      const saved = readConfirmedPayment(data, draft, invoice.id, preflight.amountCents);
      setConfirmed(saved);
      await clearIdentity(saved);
      await refreshLists();
    } catch (failure) {
      setError(failure instanceof Error && failure.message.startsWith('Die Speicherbestätigung') ? failure.message : 'Keine verlässliche Speicherbestätigung erhalten. Bitte unverändert erneut versuchen oder den Zahlungsnachweis prüfen. Ihre Eingaben und die Anfragekennung bleiben erhalten.');
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg" showCloseButton={!isSubmitting}
        onOpenAutoFocus={(event) => { event.preventDefault(); dateRef.current?.focus(); }}
        onEscapeKeyDown={(event) => { if (submitting.current) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (submitting.current) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>Vollständige Zahlung erfassen</DialogTitle>
          <DialogDescription className="break-words">Rechnung {invoice.invoiceNumber || invoice.fileName}. Nur bereits tatsächlich eingegangene Zahlungen erfassen; es wird kein Geld überwiesen.</DialogDescription>
        </DialogHeader>
        {confirmed ? (
          <>
            <div ref={successRef} tabIndex={-1} role="status" className="space-y-2 border-y py-4 outline-none">
              <p className="flex items-center gap-2 font-semibold text-[var(--color-success-ink)]"><CheckCircle className="h-5 w-5 shrink-0" aria-hidden="true" />Zahlung gespeichert</p>
              <p className="text-2xl font-semibold tabular-nums">{displayPaymentAmount(confirmed.amountCents)}</p>
              <p>Tatsächliches Zahlungsdatum: <strong>{formatBusinessDateDisplay(confirmed.paidAt)}</strong></p>
              <p className="break-words text-sm">Referenz: {confirmed.reference}</p>
              <p className="text-sm text-muted-foreground">Zahlungsnachweis #{confirmed.id} · Einnahme ist erfasst. Keine weitere Zahlung erforderlich.</p>
            </div>
            {refreshError && <p role="alert" className="text-sm text-destructive">Die Zahlung ist gespeichert, aber die Listen konnten nicht aktualisiert werden. Nicht erneut buchen.</p>}
            <DialogFooter>{refreshError && <Button type="button" variant="outline" className="min-h-11" onClick={() => void refreshLists()}>Listen aktualisieren</Button>}<Button type="button" className="min-h-11" disabled={isSubmitting} onClick={close}>Schließen</Button></DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-5" aria-busy={isSubmitting}>
            <div className="border-y py-4">
              <p className="text-sm text-muted-foreground">Vollständiger Rechnungsbetrag (EUR)</p>
              {isLoading ? <p role="status" className="mt-2 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Betrag wird geprüft …</p> : preflight ? <p className="mt-1 text-3xl font-semibold tabular-nums">{displayPaymentAmount(preflight.amountCents)}</p> : <p className="mt-1 font-medium">Nicht buchbar</p>}
              <p className="mt-2 text-sm text-muted-foreground">Keine Teilzahlungen, Überzahlungen oder Mahngebühren. Eine bestätigte Zahlung kann nicht zurückgesetzt werden.</p>
            </div>
            {loadError && <div className="space-y-3"><p role="alert" className="text-sm text-destructive">{loadError}</p><Button type="button" variant="outline" className="min-h-11" onClick={reloadPaymentData}>Zahlungsdaten erneut laden</Button></div>}
            <FullPaymentFields id={id} paidAt={paidAt} reference={reference} disabled={isSubmitting} dateRef={dateRef}
              onDateChange={value => { setPaidAt(value); setError(null); }} onReferenceChange={value => { setReference(value); setError(null); }} />
            {error && <div className="space-y-3"><p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-destructive outline-none">{error}</p><Button type="button" variant="outline" className="min-h-11" disabled={isSubmitting} onClick={reloadPaymentData}>Zahlungsnachweis prüfen</Button></div>}
            <DialogFooter><Button type="button" variant="outline" className="min-h-11" disabled={isSubmitting} onClick={close}>Abbrechen</Button><Button type="submit" className="min-h-11" disabled={isLoading || !preflight || isSubmitting}>{isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}{isSubmitting ? 'Wird gespeichert …' : 'Zahlung verbindlich erfassen'}</Button></DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
