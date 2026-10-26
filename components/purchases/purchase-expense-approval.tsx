'use client';

import { useEffect, useRef, useState } from 'react';
import { ReviewLink as Link } from '@/components/purchases/review-link';
import { useSession } from 'next-auth/react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isPhotoMedia } from '@/lib/purchase-documents/manual-photo-contract';
import { getRecommendedExpenseCategories } from '@/lib/eur-line-mapping';
import type { IncomingDocument, PurchaseExpenseApprovalInput, PurchaseExpenseApprovalResponse } from '@/lib/purchase-documents/types';
import { errorMessage, formatSourceAmount, formatSourceDate, incomingJson, IncomingRequestError } from './incoming-document-ui';
import { approvalAmount, approvalBlockedReason, approvalIdentityKey, hasApprovalIdentity, storedApprovalId, validBusinessShare, validPaymentDate } from './purchase-expense-ui';

type Props = { document: IncomingDocument; onApproved: (result: PurchaseExpenseApprovalResponse) => void; onBack: () => void; onReload: () => void; onOpenDuplicate: (id: number) => void; onBusyChange: (busy: boolean) => void; onPendingChange: (pending: boolean) => void };
const selectClass = 'min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

export function ApprovalSummary({ input }: { input: Omit<PurchaseExpenseApprovalInput, 'approvalRequestId'> }) {
  return <dl className="grid gap-4 text-sm sm:grid-cols-2 [&_dt]:text-muted-foreground [&_dd]:mt-1 [&_dd]:break-words [&_dd]:font-medium">
    {input.manualPhotoReview && <div className="sm:col-span-2"><dt>Manuelle Foto-Originalprüfung · keine Extraktion</dt><dd>{input.manualPhotoReview.expectedDraft.supplierName} · {input.manualPhotoReview.expectedDraft.invoiceNumber} · Rechnungsdatum {formatSourceDate(input.manualPhotoReview.expectedDraft.invoiceDate)} · Käufer {input.manualPhotoReview.buyerName}</dd></div>}
    <div className="sm:col-span-2"><dt>Beschreibung</dt><dd>{input.description}</dd></div>
    <div><dt>Vollständiger Brutto-Zahlungsabfluss</dt><dd>{formatSourceAmount(input.amount, 'EUR')}</dd></div>
    <div><dt>Tatsächliches Zahlungsdatum</dt><dd>{formatSourceDate(input.expenseDate)}</dd></div>
    <div><dt>Kategorie</dt><dd>{input.category}</dd></div><div><dt>Steuerliche Berücksichtigung</dt><dd>{input.taxRelevant ? 'Ja, ausdrücklich gewählt' : 'Nein, ausdrücklich gewählt'}</dd></div>
    <div><dt>Erfasster betrieblicher / abziehbarer Anteil</dt><dd>{input.taxDeductiblePercentage} %</dd></div><div><dt>Abschreibungsdauer</dt><dd>{input.depreciationYears === null ? 'Keine mehrjährige Abschreibung gewählt' : `${input.depreciationYears} Jahre`}</dd></div>
  </dl>;
}

export function PurchaseExpenseApproval({ document, onApproved, onBack, onReload, onOpenDuplicate, onBusyChange, onPendingChange }: Props) {
  const { data: session } = useSession();
  const tenantId = session?.user?.id;
  const manual = isPhotoMedia(document.originalRef.mediaType);
  const draft = document.reviewDraft;
  const [previousAttempt, setPreviousAttempt] = useState(false);
  const [step, setStep] = useState<'details' | 'confirm'>('details');
  const [description, setDescription] = useState([manual ? draft?.supplierName : document.supplierName, (manual ? draft?.invoiceNumber : document.invoiceNumber) ? `Rechnung ${manual ? draft?.invoiceNumber : document.invoiceNumber}` : 'Rechnung'].filter(Boolean).join(' · '));
  // Payment date, tax treatment and business share are intentionally never inferred from source/today.
  const [expenseDate, setExpenseDate] = useState(manual ? draft?.paymentDate ?? '' : '');
  const [buyerName, setBuyerName] = useState('');
  const [sourceOwned, setSourceOwned] = useState(false);
  const [exactDraft, setExactDraft] = useState(false);
  const [ordinaryInvoice, setOrdinaryInvoice] = useState(false);
  const [category, setCategory] = useState('');
  const [taxRelevant, setTaxRelevant] = useState('');
  const [share, setShare] = useState('');
  const [depreciation, setDepreciation] = useState('');
  const [depreciationExpanded, setDepreciationExpanded] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [buyerConfirmed, setBuyerConfirmed] = useState(false);
  const [paid, setPaid] = useState(false);
  const [duplicates, setDuplicates] = useState<number[]>([]);
  const [pending, setPending] = useState<PurchaseExpenseApprovalInput | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const lock = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const identityKey = useRef<string | null>(null);
  useEffect(() => {
    alive.current = true;
    try { if (tenantId) setPreviousAttempt(hasApprovalIdentity(sessionStorage, tenantId, document.id)); }
    catch { /* A storage error is explained before sending. */ }
    setReady(true);
    return () => { alive.current = false; };
  }, [document.id, tenantId]);
  useEffect(() => { heading.current?.focus(); }, [step]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const reason = approvalBlockedReason(document);
  const amount = approvalAmount(manual ? draft?.amount ?? null : document.totalAmount);
  const detailsValid = (!manual || !!buyerName.trim() && buyerName.trim().length <= 1000) && !!amount && !!description.trim() && description.trim().length <= 255 && !!category.trim() && category.trim().length <= 255 && validPaymentDate(expenseDate) && taxRelevant !== '' && validBusinessShare(share) && (depreciation === '' || /^[1-9]\d*$/.test(depreciation) && Number.isSafeInteger(Number(depreciation)));
  const input: Omit<PurchaseExpenseApprovalInput, 'approvalRequestId'> = { expectedRevision: document.revision, description: description.trim(), amount, expenseDate, category: category.trim(), taxRelevant: taxRelevant === 'yes', taxDeductiblePercentage: share === '' ? '' : String(Number(share.replace(',', '.'))), depreciationYears: depreciation === '' ? null : Number(depreciation), confirmPaymentDate: true, confirmReviewedOriginal: true, confirmBuyerBelongsToBusiness: true, ...(manual && draft && document.reviewDraftSavedAt ? { manualPhotoReview: { expectedDraft: draft, expectedDraftSavedAt: document.reviewDraftSavedAt, buyerName: buyerName.trim(), currency: 'EUR' as const, documentType: 'INVOICE' as const, confirmSourceOwnership: true as const, confirmExactDraftValues: true as const, confirmOrdinaryInvoice: true as const } } : {}), acknowledgedDuplicates: document.businessDuplicates.filter(item => duplicates.includes(item.id)).map(item => ({ id: item.id, revision: item.revision })) };
  const confirmationsValid = reviewed && buyerConfirmed && paid && (!manual || sourceOwned && exactDraft && ordinaryInvoice) && document.businessDuplicates.every(item => duplicates.includes(item.id));
  async function submit() {
    if (lock.current || !ready || !pending && (!detailsValid || !confirmationsValid || reason)) return;
    if (!tenantId) { setError('Deine Sitzung konnte nicht bestätigt werden. Bitte neu anmelden und den Belegstatus prüfen.'); return; }
    // Claim the click before asynchronous hashing so a double click cannot create two identities.
    lock.current = true; setBusy(true); onBusyChange(true); setError(null);
    let request = pending;
    try {
      const key = identityKey.current ?? await approvalIdentityKey(tenantId, document.id, input);
      identityKey.current = key;
      request ??= { ...input, approvalRequestId: storedApprovalId(sessionStorage.getItem(key)) ?? crypto.randomUUID() };
      sessionStorage.setItem(key, request.approvalRequestId);
    } catch {
      setError('Die sichere Wiederholungskennung konnte nicht erstellt oder in diesem Tab gespeichert werden. Bitte eine sichere HTTPS-Verbindung und erlaubte Tab-Speicherung prüfen; es wurde keine Buchung gestartet.');
      identityKey.current = null; lock.current = false; setBusy(false); onBusyChange(false); return;
    }
    setPending(request); onPendingChange(true);
    try {
      const result = await incomingJson<PurchaseExpenseApprovalResponse>(`/api/purchase-documents/${document.id}/approve-expense`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
      try { if (identityKey.current) sessionStorage.removeItem(identityKey.current); } catch { /* A successful server response remains authoritative. */ }
      onPendingChange(false); onApproved(result);
    } catch (error) {
      if (!alive.current) return;
      const ambiguous = !(error instanceof IncomingRequestError) || error.status === 0 || error.status >= 500;
      setUncertain(ambiguous);
      if (!ambiguous) { try { if (identityKey.current) sessionStorage.removeItem(identityKey.current); } catch { /* Kept request is safe to replay. */ } identityKey.current = null; setPending(null); onPendingChange(false); }
      setError(ambiguous ? 'Die Antwort ist unklar. Die Ausgabe könnte bereits gespeichert sein. Nicht erneut manuell buchen: Belegstatus prüfen oder exakt dieselbe Anfrage sicher wiederholen.' : errorMessage(error));
    } finally { lock.current = false; if (alive.current) setBusy(false); onBusyChange(false); }
  }
  return <section className="space-y-5" aria-labelledby="purchase-approval-heading">
    <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Ausgabe erfassen · {step === 'details' ? '1 von 2' : '2 von 2'}</p><h3 ref={heading} tabIndex={-1} id="purchase-approval-heading" className="mt-1 text-lg font-semibold outline-none">{step === 'details' ? 'Zahlung und Einordnung' : 'Angaben bewusst bestätigen'}</h3><p className="mt-2 text-sm text-muted-foreground">Nur vollständig bezahlte Belege. Bestätigung bucht eine beleggebundene Ausgabe ohne Kassenbucheintrag; keine Zahlungsauslösung oder spätere Kassenzuordnung.</p></div>
    {error && <div ref={errorRef} role="alert" tabIndex={-1} className="space-y-2 rounded-md bg-critical-surface p-3 text-sm text-critical-foreground outline-none"><p>{error}</p><Button variant="outline" disabled={busy} onClick={onReload}>Gespeicherten Belegstatus prüfen</Button></div>}
    {previousAttempt && !pending && <p role="status" className="border-l-2 border-caution pl-3 text-sm">Es gibt eine frühere Wiederholungskennung für diesen Beleg. Nach dem Neuladen wurde der tatsächliche Belegstatus abgefragt. Falls noch offen: Angaben erneut bewusst eingeben. Nur eine unveränderte Anfrage verwendet dieselbe Kennung; es wurden keine Buchungsfelder im Browser gespeichert.</p>}
    {pending && <p role="status" className="border-l-2 border-caution pl-3 text-sm">{uncertain ? 'Eine Antwort ist noch ungeklärt. Die folgenden Angaben bleiben im Arbeitsspeicher für die sichere Wiederholung unverändert. Nach Neuladen zuerst den tatsächlichen Belegstatus prüfen.' : 'Anfrage wird verarbeitet. Bitte nicht parallel manuell buchen.'}</p>}
    {step === 'details' ? <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (detailsValid) { setStep('confirm'); setError(null); } }}>
      <div className="border-y border-border py-4"><p className="text-xs text-muted-foreground">{manual ? 'Manuell gespeicherter EUR-Bruttobetrag · vor Freigabe am Foto prüfen' : 'Vollständiger Bruttobetrag aus Original · keine Teilzahlung'}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{formatSourceAmount(amount, manual ? 'EUR' : document.currency)}</p></div>
      {manual && <><p className="border-l-2 border-caution pl-3 text-sm">Angaben aus dem gespeicherten Prüfentwurf am Foto prüfen. Änderungen dort speichern.</p><div className="space-y-2"><Label htmlFor="purchase-photo-buyer">Empfänger / Käufer laut Foto-Original</Label><Input id="purchase-photo-buyer" required maxLength={1000} value={buyerName} onChange={event => setBuyerName(event.target.value)} /></div></>}
      <div className="space-y-2"><Label htmlFor="purchase-expense-description">{manual ? 'Beschreibung / betrieblicher Zweck' : 'Beschreibung'}</Label><Input id="purchase-expense-description" required maxLength={255} value={description} onChange={event => setDescription(event.target.value)} /></div>
      <div className="space-y-2"><Label htmlFor="purchase-expense-date">Tatsächliches Zahlungsdatum</Label><Input id="purchase-expense-date" type="date" required readOnly={manual} value={expenseDate} onChange={event => setExpenseDate(event.target.value)} aria-describedby="purchase-date-help" /><p id="purchase-date-help" className="text-xs text-muted-foreground">Vollständigen Zahlungsabfluss angeben. {manual && 'Zum Ändern zurück zum Prüfentwurf. '}Rechnungsdatum {formatSourceDate(manual ? draft?.invoiceDate ?? null : document.invoiceDate)} ist kein Zahlungsnachweis.</p></div>
      <div className="space-y-2"><Label htmlFor="purchase-expense-category">Kategorie</Label><Input id="purchase-expense-category" list="purchase-expense-categories" required maxLength={255} value={category} onChange={event => setCategory(event.target.value)} placeholder="Bewusst auswählen oder eingeben" /><datalist id="purchase-expense-categories">{getRecommendedExpenseCategories().map(item => <option key={item} value={item} />)}</datalist></div>
      <div className="space-y-2"><Label htmlFor="purchase-tax-relevant">Steuerlich berücksichtigen?</Label><select id="purchase-tax-relevant" required className={selectClass} value={taxRelevant} onChange={event => setTaxRelevant(event.target.value)}><option value="">Bitte ausdrücklich wählen</option><option value="yes">Ja</option><option value="no">Nein</option></select></div>
      <div className="space-y-2"><Label htmlFor="purchase-expense-share">Betrieblicher / abziehbarer Anteil in %</Label><Input id="purchase-expense-share" inputMode="decimal" required value={share} maxLength={6} onChange={event => setShare(event.target.value)} placeholder="0 bis 100, selbst prüfen" aria-describedby="purchase-tax-help" /><p id="purchase-tax-help" className="text-xs text-muted-foreground">Abziehbarkeit und private Nutzung selbst prüfen. Keine Vorsteuerberechnung.</p></div>
      <details open={depreciationExpanded || depreciation !== ''} onToggle={event => setDepreciationExpanded(event.currentTarget.open)} className="border-t border-border pt-2"><summary aria-disabled={depreciation !== ''} onClick={event => { if (depreciation !== '') event.preventDefault(); }} className="min-h-11 cursor-pointer py-3 text-sm font-medium">Mehrjährige Abschreibung (optional){depreciation !== '' && <span className="font-normal text-muted-foreground"> · {depreciation} Jahre eingetragen</span>}</summary><div className="space-y-2"><Label htmlFor="purchase-depreciation">Abschreibungsdauer in Jahren (optional)</Label><Input id="purchase-depreciation" inputMode="numeric" value={depreciation} maxLength={4} onChange={event => setDepreciation(event.target.value)} placeholder="Leer: keine mehrjährige Abschreibung" /><p className="text-xs text-muted-foreground">Ganze Jahre; GWG/AfA selbst prüfen.</p></div></details>
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={!ready || !detailsValid || !!reason}>Weiter zur Bestätigung</Button><Button type="button" variant="ghost" onClick={onBack}>Abbrechen · nicht buchen</Button></div>
    </form> : <>
      <ApprovalSummary input={pending ?? input} />
      <p className="border-y border-border py-3 text-sm">Gewählter Lieferantenkontakt: <strong className="break-words">{document.selectedSupplierSnapshot?.name ?? 'Nicht ausgewählt'}</strong>. Empfänger und Steuerangaben selbst prüfen.</p>
      {!pending && <div className="space-y-3">
        {manual && <><Check id="purchase-photo-owned" checked={sourceOwned} onChange={setSourceOwned}>Dieses Foto ist mein zulässig aufbewahrtes betriebliches Original; ich habe Eigentum und Zuordnung geprüft.</Check><Check id="purchase-photo-exact" checked={exactDraft} onChange={setExactDraft}>Ich habe alle gespeicherten Entwurfsangaben samt Betrag, Rechnungsdatum und Zahlungsdatum am unveränderten Foto geprüft. Empfänger und betrieblicher Zweck sind richtig.</Check><Check id="purchase-photo-ordinary" checked={ordinaryInvoice} onChange={setOrdinaryInvoice}>Es ist eine gewöhnliche EUR-Einkaufsrechnung: keine Gutschrift, Belastungsanzeige, Erstattung, Teil- oder Vorauszahlung.</Check></>}
        <Check id="purchase-reviewed" checked={reviewed} onChange={setReviewed}>Ich habe das unveränderte Original geprüft, nicht nur die ausgelesene Vorschau.</Check>
        <Check id="purchase-buyer" checked={buyerConfirmed} onChange={setBuyerConfirmed}>Der Empfänger / Käufer im Original gehört zu meinem Betrieb; ich habe die Zuordnung geprüft.</Check>
        <Check id="purchase-paid" checked={paid} onChange={setPaid}>Der vollständige Betrag ist tatsächlich abgeflossen. Das angegebene Zahlungsdatum ist richtig; keine Teil- oder Vorauszahlung.</Check>
        {document.businessDuplicates.length > 0 && <section className="space-y-3 border-t border-border pt-4" aria-label="Dubletten bewusst prüfen"><h4 className="font-semibold">Ähnliche Belege einzeln prüfen</h4><p className="text-xs text-muted-foreground">Nicht automatisch zusammengeführt. Bereits erfasste Ausgaben nicht doppelt buchen. Öffnen eines anderen Belegs verwirft diesen noch nicht gesendeten Entwurf.</p>{document.businessDuplicates.map(item => <div key={`${item.id}-${item.revision}`} className="space-y-1"><Button variant="link" className="h-auto min-h-11 max-w-full whitespace-normal px-0 text-left" onClick={() => onOpenDuplicate(item.id)}>Beleg #{item.id} · {item.invoiceNumber ?? 'Ohne Nummer'} · {formatSourceAmount(item.totalAmount, item.currency)} · {item.linkedExpenseId ? `Ausgabe #${item.linkedExpenseId}` : 'Nicht gebucht'}</Button><Check id={`purchase-duplicate-${item.id}`} checked={duplicates.includes(item.id)} onChange={checked => setDuplicates(current => checked ? [...current, item.id] : current.filter(id => id !== item.id))}>Ich habe Beleg #{item.id} geprüft und will diese Rechnung trotzdem als eigene Ausgabe erfassen.</Check></div>)}</section>}
      </div>}
      <div className="flex flex-wrap gap-2"><Button disabled={busy || !ready || !pending && (!confirmationsValid || !!reason)} className="h-auto min-h-11 whitespace-normal" onClick={() => void submit()}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}{pending ? 'Dieselbe Anfrage sicher wiederholen' : 'Zahlung bestätigen und Ausgabe erfassen'}</Button>{!pending && <Button variant="outline" disabled={busy} onClick={() => setStep('details')}>Angaben ändern</Button>}<Button variant="ghost" disabled={busy} onClick={pending ? onReload : onBack}>{pending ? 'Zurück zum Belegstatus' : 'Abbrechen · nicht buchen'}</Button></div>
    </>}
    {reason && !pending && <p role="status" className="text-sm text-caution-foreground">{reason}</p>}
    <p className="text-xs text-muted-foreground">Gespeicherte Ausgabe in der <Link href="/dashboard?tab=expenses" className="underline underline-offset-4">Ausgabenübersicht</Link>. Verknüpfte Originale bleiben unveränderlich.</p>
  </section>;
}
function Check({ id, checked, onChange, children }: { id: string; checked: boolean; onChange: (checked: boolean) => void; children: React.ReactNode }) {
  return <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-relaxed"><input id={id} type="checkbox" className="mt-1 size-5 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" checked={checked} onChange={event => onChange(event.target.checked)} /><span>{children}</span></label>;
}
