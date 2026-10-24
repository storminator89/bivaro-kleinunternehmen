'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { ArrowLeft, ArrowRight, CalendarDays, CircleCheck, FilePenLine, Loader2, Pause, Play, Plus, RefreshCw, Repeat2, SkipForward } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { calculateInvoiceAmounts } from '@/lib/invoice-calculation';
import { ServicePlanEditor } from './service-plan-editor';
import { CADENCE_LABELS, serviceCurrency, serviceDate, serviceJson, type ServiceBillingList, type ServiceBillingPlanDto } from './service-billing-types';
import styles from './service-billing-workspace.module.css';
import { captureServiceDialogOpener, restoreServiceDialogOpener } from './service-dialog-focus';

type Review = { plan: ServiceBillingPlanDto; action: 'GENERATE' | 'SKIP' };
type ReviewResult = { invoiceId: number | null; idempotent: boolean; unrendered: boolean };

function PlanAmount({ plan }: { plan: ServiceBillingPlanDto }) {
  let amount: number | null = null;
  try { amount = calculateInvoiceAmounts(plan.items).grossAmount; } catch { /* Never infer totals from malformed source rows. */ }
  return <div className={styles.amount}><p className="tabular-nums">{amount === null ? 'Betrag prüfen' : serviceCurrency(amount)}</p><span>je Zeitraum</span><span>{plan.taxMode === 'small-business' ? 'Kleinunternehmer-Modus' : 'Regelbesteuerung'}</span></div>;
}

export function PlanCard({ plan, disabled, onEdit, onReview, onToggle }: {
  plan: ServiceBillingPlanDto;
  disabled: boolean;
  onEdit: () => void;
  onReview: (action: Review['action']) => void;
  onToggle: () => void;
}) {
  const paused = plan.status === 'PAUSED';
  return <article aria-label={`Serviceplan ${plan.name}`} className={styles.plan}>
    <div className={styles.planHeader}>
      <div className={styles.identity}><div className={styles.planMeta}><span className={paused ? styles.paused : styles.active}>{paused ? <Pause aria-hidden="true" /> : <Repeat2 aria-hidden="true" />}{paused ? 'Pausiert' : 'Aktiv'}</span><span>{CADENCE_LABELS[plan.cadence]}</span></div><h3>{plan.name}</h3><p>{plan.customer.name}</p></div>
      <PlanAmount plan={plan} />
    </div>
    <div className={styles.planBody}>
      <section aria-label={`Nächster Zeitraum für ${plan.name}`} className={styles.nextPeriod}>
        <h4><CalendarDays aria-hidden="true" />Nächster offener Zeitraum</h4>
        <p className={styles.periodDates}>{serviceDate(plan.preview.periodStart)} – {serviceDate(plan.preview.periodEnd)}</p>
        <p className={styles.hint}>Folgezeitraum ab {serviceDate(plan.preview.nextDue)}<br />keine Zahlungsfrist</p>
        {paused ? <p className={styles.periodState}>Pausiert.</p> : plan.missed ? <p className={styles.missed}>Zeitraum liegt zurück: einzeln prüfen oder überspringen.</p> : !plan.due ? <p className={styles.periodState}>Ab Beginn prüfbar.</p> : <p className={styles.periodState}>Entwurf möglich.</p>}
        <div className={styles.periodActions}><Button type="button" onClick={() => onReview('GENERATE')} disabled={disabled || paused || !plan.due}><FilePenLine aria-hidden="true" />Entwurf vorbereiten</Button>{plan.due && <Button type="button" variant="outline" onClick={() => onReview('SKIP')} disabled={disabled || paused}><SkipForward aria-hidden="true" />Zeitraum überspringen</Button>}</div>
      </section>
      <div className={styles.services}><h4>Leistungen</h4><ul className={styles.items}>{plan.items.map((item, index) => <li key={index}><p>{item.description}</p><span>{item.quantity} {item.unit} × {serviceCurrency(item.unitPrice)} netto</span><span>{item.taxRate} % USt.</span></li>)}</ul><details className={styles.rules}><summary>Terminregeln</summary><p>Start {serviceDate(plan.anchorDate)}. Fehlender Monatstag → Monatsende; Startanker bleibt. Prüftermine sind keine Zahlungsfrist. Keine automatische Nachholung oder Vertragsvereinbarung.</p></details><div className={styles.planActions}><Button type="button" variant="outline" disabled={disabled} onClick={onEdit}>Plan bearbeiten</Button><Button type="button" variant="ghost" disabled={disabled} onClick={onToggle}>{paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}{paused ? 'Plan fortsetzen' : 'Plan pausieren'}</Button></div></div>
    </div>
    <details className={styles.periodHistory}><summary>Bearbeitete Zeiträume {plan.periods.length ? <span>zuletzt {plan.periods.length}</span> : ''}</summary>{plan.periods.length ? <ul>{plan.periods.map(period => <li key={period.periodIndex}><div><p>{serviceDate(period.periodStart)} – {serviceDate(period.periodEnd)}</p><span>{period.action === 'SKIPPED' ? 'Bewusst übersprungen · keine Rechnung' : period.invoiceId === null ? 'Entwurf entfernt · Zeitraum bleibt bearbeitet' : period.invoice?.invoiceNumber ? `Rechnung ${period.invoice.invoiceNumber}` : 'Rechnungsentwurf bereits vorbereitet'}</span></div>{period.action === 'GENERATED' && period.invoiceId !== null && <Button asChild variant="outline" size="sm"><Link href={period.invoice?.unrendered ? `/dashboard/invoices/new?draftId=${period.invoiceId}` : `/history?invoiceId=${period.invoiceId}`}>{period.invoice?.unrendered ? 'Entwurf bearbeiten' : 'Rechnung ansehen'}<ArrowRight aria-hidden="true" /></Link></Button>}</li>)}</ul> : <p className={styles.historyEmpty}>Noch keine Zeiträume bearbeitet.</p>}</details>
  </article>;
}

function PeriodReview({ review, onClose, onSaved }: { review: Review; onClose: () => void; onSaved: (message: string, result: ReviewResult) => void }) {
  const openerRef = useRef<HTMLElement | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { plan, action } = review;
  const generating = action === 'GENERATE';
  async function submit() {
    if (!confirmed || busy) return;
    setBusy(true); setError('');
    try {
      const result = await serviceJson<ReviewResult>('/api/service-billing/period', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planId: plan.id, revision: plan.revision, periodIndex: plan.nextPeriod, action, confirmed: true }) });
      // Successful reviews already move focus to the refreshed list heading.
      openerRef.current = null;
      onSaved(result.idempotent ? 'Dieser Zeitraum wurde bereits bearbeitet. Den vorhandenen Entwurf findest du unter „Bearbeitete Zeiträume“; es wurde nichts doppelt erzeugt.' : generating ? 'Rechnungsentwurf vorbereitet. Öffne ihn unter „Bearbeitete Zeiträume“ im normalen Rechnungseditor. Nichts wurde versendet oder als Einnahme gebucht.' : 'Genau dieser Zeitraum wurde bewusst übersprungen. Es wurde keine Rechnung erzeugt.', result);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Die Prüfung konnte nicht gespeichert werden.'); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent showCloseButton={!busy} className={styles.reviewDialog}
    onOpenAutoFocus={() => { openerRef.current = captureServiceDialogOpener(document); }}
    onCloseAutoFocus={event => {
      event.preventDefault();
      const opener = openerRef.current;
      openerRef.current = null;
      restoreServiceDialogOpener(opener);
    }}><DialogHeader className="text-left"><DialogTitle>{generating ? 'Einen Rechnungsentwurf vorbereiten?' : 'Diesen Zeitraum überspringen?'}</DialogTitle><DialogDescription>{generating ? 'Ein Zeitraum, ein nicht ausgestellter Entwurf.' : 'Dieser eine Zeitraum wird als bewusst übersprungen gespeichert. Das lässt sich hier nicht rückgängig machen.'}</DialogDescription></DialogHeader><div className="space-y-4"><div className={styles.reviewSummary}><div><p className={styles.reviewName}>{plan.name}</p><p className={styles.hint}>{plan.customer.name}</p><p className={styles.reviewDates}>{serviceDate(plan.preview.periodStart)} – {serviceDate(plan.preview.periodEnd)}</p></div>{generating && <PlanAmount plan={plan} />}</div><p className="text-sm leading-6 text-muted-foreground">{generating ? 'Ohne Rechnungsnummer, Versand, Zahlung oder Einnahme. Danach im Rechnungseditor bearbeiten. Keine automatische Nachholung.' : 'Keine Rechnung, kein Versand und keine Einnahme. Nur der nächste offene Zeitraum wird angezeigt; es werden keine weiteren Zeiträume übersprungen oder nachgeholt.'}</p><label className={styles.confirmation}><input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-primary" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy} />{generating ? 'Ich habe Kunde, Leistungen und Zeitraum geprüft und möchte genau einen Entwurf vorbereiten.' : 'Ich möchte genau diesen Zeitraum ohne Rechnung überspringen.'}</label>{error && <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 p-3 text-sm"><p>{error}</p><p className="text-xs text-muted-foreground">Bei einer unterbrochenen Verbindung ist die erneute Bestätigung desselben Zeitraums gegen doppelte Entwürfe geschützt. Bei einem geänderten Plan: abbrechen und den aktuellen Stand laden.</p></div>}</div><DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Abbrechen</Button><Button type="button" onClick={submit} disabled={!confirmed || busy}>{busy && <Loader2 className="animate-spin" aria-hidden="true" />}{busy ? 'Wird gespeichert…' : generating ? 'Nur diesen Entwurf anlegen' : 'Nur diesen Zeitraum überspringen'}</Button></DialogFooter></DialogContent></Dialog>;
}

export function ServiceBillingWorkspace() {
  const { data: session } = useSession();
  return <ServiceBillingContent key={session?.user?.id ?? 'signed-out'} />;
}
function ServiceBillingContent() {
  const [data, setData] = useState<ServiceBillingList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [editor, setEditor] = useState<{ plan: ServiceBillingPlanDto | null } | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [mutating, setMutating] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeInvoice, setNoticeInvoice] = useState<ReviewResult | null>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const focusListAfterReload = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    serviceJson<ServiceBillingList>('/api/service-billing', { signal: controller.signal })
      .then(result => {
        if (!result || !Array.isArray(result.plans) || typeof result.today !== 'string') throw new Error('Die Serviceplan-Liste ist unvollständig. Bitte den aktuellen Stand erneut laden.');
        if (!controller.signal.aborted) setData(result);
      })
      .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Servicepläne konnten nicht geladen werden.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => {
    if (!loading && !error && focusListAfterReload.current) { focusListAfterReload.current = false; listHeading.current?.focus({ preventScroll: true }); }
  }, [loading, error]);
  const reload = () => setRefresh(value => value + 1);
  async function toggle(plan: ServiceBillingPlanDto) {
    if (mutating) return;
    setMutating(true); setNotice(''); setNoticeInvoice(null); setError('');
    try {
      await serviceJson('/api/service-billing', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: plan.id, revision: plan.revision, status: plan.status === 'PAUSED' ? 'ACTIVE' : 'PAUSED' }) });
      setNotice(plan.status === 'PAUSED' ? 'Plan fortgesetzt. Offene Zeiträume bleiben einzeln zur Prüfung; es wurde nichts automatisch erzeugt.' : 'Plan pausiert. Kein Zeitraum wurde weitergeschaltet und keine Rechnung erzeugt.'); reload();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Der Plan konnte nicht geändert werden.'); }
    finally { setMutating(false); }
  }
  const plans = data?.plans ?? [];
  const ready = plans.filter(plan => plan.status === 'ACTIVE' && plan.due).length;
  return <div className={styles.workspace}>
    <PageHeader title="Servicepläne" description="Ein Entwurf je Bestätigung. Keine automatische Abrechnung." actions={<><Button variant="outline" asChild><Link href="/dashboard?tab=invoices"><ArrowLeft aria-hidden="true" />Rechnungen</Link></Button><Button onClick={() => { setNotice(''); setNoticeInvoice(null); setEditor({ plan: null }); }} disabled={loading || Boolean(error) || !data}><Plus aria-hidden="true" />Neuer Serviceplan</Button></>} />
    {notice && <div role="status" className="flex items-start gap-3 rounded-xl border border-primary/20 bg-card p-4 text-sm leading-6"><CircleCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" /><div className="min-w-0"><p>{notice}</p>{noticeInvoice?.invoiceId !== null && noticeInvoice?.invoiceId !== undefined && <Button asChild variant="link" className="mt-1 px-0"><Link href={noticeInvoice.unrendered ? `/dashboard/invoices/new?draftId=${noticeInvoice.invoiceId}` : `/history?invoiceId=${noticeInvoice.invoiceId}`}>{noticeInvoice.unrendered ? 'Vorhandenen Entwurf bearbeiten' : 'Vorhandene Rechnung ansehen'}<ArrowRight aria-hidden="true" /></Link></Button>}</div></div>}
    <section aria-labelledby="service-plans-heading" aria-busy={loading} className={styles.ledger}>
      <div className={styles.ledgerHeader}><div><h2 ref={listHeading} id="service-plans-heading" tabIndex={-1}>Servicepläne</h2><p>{loading ? 'Pläne werden geladen…' : error ? 'Aktueller Stand nicht verfügbar' : <><span>{plans.length} Pläne</span><span>{ready} prüfbar</span></>}</p></div><Button type="button" variant="outline" onClick={reload} disabled={loading || mutating}><RefreshCw className={loading ? 'animate-spin' : ''} aria-hidden="true" />Aktualisieren</Button></div>
      {loading ? <div className={styles.loading}><p role="status"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Servicepläne werden geladen…</p><div aria-hidden="true" className={styles.skeleton}><span /><span /><span /></div></div> : error ? <div role="alert" className={styles.feedback}><p>{error}</p><p className={styles.hint}>Es werden keine veralteten Pläne zur Abrechnung angeboten. Bereits bestätigte Entwürfe bleiben gespeichert.</p><Button variant="outline" onClick={reload}>Aktuellen Stand erneut laden</Button></div> : plans.length ? <div>{plans.map(plan => <PlanCard key={plan.id} plan={plan} disabled={mutating} onEdit={() => { setNotice(''); setNoticeInvoice(null); setEditor({ plan }); }} onReview={action => { setNotice(''); setNoticeInvoice(null); setReview({ plan, action }); }} onToggle={() => toggle(plan)} />)}</div> : <div className={styles.empty}><Repeat2 aria-hidden="true" /><h3>Noch keine Servicepläne</h3><Button onClick={() => setEditor({ plan: null })}><Plus aria-hidden="true" />Ersten Serviceplan anlegen</Button></div>}
    </section>

    {editor && data && <ServicePlanEditor key={editor.plan?.id ?? 'new'} plan={editor.plan} today={data.today} onClose={() => setEditor(null)} onSaved={() => { focusListAfterReload.current = true; setEditor(null); setNotice('Serviceplan gespeichert. Es wurde keine Rechnung erzeugt.'); setNoticeInvoice(null); reload(); }} />}
    {review && <PeriodReview key={`${review.plan.id}:${review.plan.nextPeriod}:${review.action}`} review={review} onClose={() => setReview(null)} onSaved={(message, result) => { focusListAfterReload.current = true; setReview(null); setNotice(message); setNoticeInvoice(result); reload(); }} />}
  </div>;
}
