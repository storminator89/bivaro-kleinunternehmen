'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, CheckCheck, ListChecks, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { QueryFeedback } from '@/components/dashboard/query-feedback';
import { quoteBusinessToday } from '@/lib/quote-workflow';
import type { DailyAction, DailyActions } from '@/lib/daily-actions/contract';
import { PAYMENT_DASHBOARD_REFRESH_EVENT } from '@/lib/payment-dashboard-refresh';

export function dailyActionAmount(cents: string | null): string {
  if (cents === null) return 'Nicht verfügbar';
  const value = BigInt(cents);
  return `${(value / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${(value % BigInt(100)).toString().padStart(2, '0')} €`;
}
function dateLabel(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}
export function ActionRow({ action, first }: { action: DailyAction; first: boolean }) {
  return <li className="border-t border-border first:border-t-0">
    <article className="grid min-w-0 gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_13rem] lg:gap-6">
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-medium">
          <span className={first ? 'text-primary' : 'text-muted-foreground'}>{first ? 'Zuerst prüfen' : action.kind.startsWith('INVOICE') ? 'Rechnung' : action.kind.startsWith('QUOTE') ? 'Angebot' : 'Belegeingang'}</span>
          <span aria-hidden="true" className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{action.dateLabel} <time dateTime={action.date}>{dateLabel(action.date)}</time></span>
        </div>
        <h3 className="text-base font-semibold leading-6">{action.title}</h3>
        <p className="mt-1 break-words text-sm font-medium [overflow-wrap:anywhere]">{action.source}{action.party ? ` · ${action.party}` : ''}</p>
        <p className="mt-2 max-w-prose text-sm leading-6 text-muted-foreground">{action.reason}</p>
      </div>
      <div className="flex min-w-0 flex-col items-start gap-3 lg:items-end lg:justify-between">
        <div className="max-w-full lg:text-right"><p className="text-xs text-muted-foreground">{action.amountLabel}</p><p className="mt-1 break-words font-semibold tabular-nums">{dailyActionAmount(action.amountCents)}</p></div>
        <Button asChild variant={first ? 'default' : 'outline'} className="max-w-full"><Link href={action.href} prefetch={false} aria-label={`${action.cta}: ${action.source}`}><span className="min-w-0 whitespace-normal text-left">{action.cta}</span><ArrowRight className="size-4 shrink-0" aria-hidden="true" /></Link></Button>
      </div>
    </article>
  </li>;
}
export function DailyActionsWorkspace() {
  return <DailyActionsPanel />;
}
export function DailyActionsPanel({ compact = false }: { compact?: boolean }) {
  const { data: session } = useSession();
  // A changed account must never inherit another account's in-memory action list.
  return <DailyActionsContent key={session?.user?.id ?? 'signed-out'} compact={compact} />;
}
function DailyActionsContent({ compact }: { compact: boolean }) {
  const [data, setData] = useState<DailyActions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const refreshPayments = () => setAttempt(value => value + 1);
    window.addEventListener(PAYMENT_DASHBOARD_REFRESH_EVENT, refreshPayments);
    return () => window.removeEventListener(PAYMENT_DASHBOARD_REFRESH_EVENT, refreshPayments);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(false); setData(null);
    fetch('/api/daily-actions', { cache: 'no-store', signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error('Could not load actions'); return await response.json() as DailyActions; })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') setAttempt(value => value + 1); };
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) refresh(); };
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', refresh);
    // Re-evaluate the German business day without an elapsed-24-hour assumption.
    const timer = window.setInterval(() => { if (data && data.businessDate !== quoteBusinessToday()) refresh(); }, 60_000);
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('pageshow', onPageShow); document.removeEventListener('visibilitychange', refresh); window.clearInterval(timer); };
  }, [data]);
  const count = data ? `${data.isPartial ? 'Mindestens ' : ''}${data.actionCount}` : '–';
  const shown = data?.actions.slice(0, compact ? 3 : undefined) ?? [];
  return <div className={compact ? '' : 'space-y-6'}>
    {!compact && <PageHeader section="Dein Arbeitstag" title="Heute erledigen" description="Konkrete nächste Schritte aus deinen Rechnungen, Angeboten und Eingangsbelegen. Du entscheidest und prüfst im bestehenden Arbeitsablauf." actions={<Button asChild variant="outline"><Link href="/dashboard"><ArrowLeft className="size-4" aria-hidden="true" />Zum Dashboard</Link></Button>} />}
    <section className="overflow-hidden rounded-xl border border-border bg-card" aria-labelledby={compact ? 'daily-actions-preview-title' : 'daily-actions-title'} aria-busy={loading}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4 sm:p-5">
        <div className="min-w-0"><h2 id={compact ? 'daily-actions-preview-title' : 'daily-actions-title'} className="flex items-center gap-2 text-lg font-semibold"><ListChecks className="size-5 shrink-0 text-primary" aria-hidden="true" />{compact ? 'Heute erledigen' : 'Deine nächsten Schritte'}</h2><p className="mt-1 text-sm text-muted-foreground">{loading ? 'Aktueller Stand wird geladen…' : error ? 'Stand nicht verfügbar' : `${count} ${data?.actionCount === 1 ? 'Schritt' : 'Schritte'} · ${dateLabel(data!.businessDate)} · deutscher Kalender`}</p></div>
        <div className="flex flex-wrap gap-2">{compact && <Button variant="outline" asChild><Link href="/dashboard/today">Alle Schritte<ArrowRight className="size-4" aria-hidden="true" /></Link></Button>}<Button variant="outline" size="icon" disabled={loading} onClick={() => setAttempt(value => value + 1)} aria-label="Nächste Schritte aktualisieren"><RefreshCw className="size-4" aria-hidden="true" /></Button></div>
      </div>
      {loading || error ? <QueryFeedback noun="Nächste Schritte" isError={error} onRetry={() => setAttempt(value => value + 1)} /> : shown.length ? <>
        <ol aria-label="Priorisierte nächste Schritte">{shown.map((action, index) => <ActionRow key={action.id} action={action} first={index === 0} />)}</ol>
        {data && (data.actionCount > shown.length || data.isPartial) && <p className="border-t border-border p-4 text-sm text-muted-foreground sm:px-5">{shown.length} von {data.isPartial ? 'mindestens ' : ''}{data.actionCount} Schritten in dieser Auswahl.{data.isPartial ? ' Pro Quelle wurden die ersten 500 Datensätze geprüft. Die Übersicht ist nicht vollständig; die Fachlisten zeigen den weiteren Bestand.' : compact ? ' Alle weiteren Schritte findest du in der Tagesübersicht.' : ' Bis zu 50 Schritte werden hier angezeigt. Nach der Bearbeitung aktualisieren.'}</p>}
      </> : <div className="space-y-2 px-5 py-9"><CheckCheck className="size-6 text-primary" aria-hidden="true" /><h3 className="font-semibold">Aktuell kein nächster Schritt aus diesen Quellen</h3><p className="max-w-prose text-sm leading-6 text-muted-foreground">Keine fällige versendete Rechnung, kein anstehender Angebotsschritt und kein offener Eingangsbeleg in dieser Auswahl. Das ist keine Bestätigung, dass deine Buchhaltung vollständig ist.</p></div>}
      <div className="border-t border-border px-4 py-4 text-xs leading-5 text-muted-foreground sm:px-5"><p>Überfällige Restbeträge zuerst, danach ungeklärte Zahlungsstände, heute fällige Rechnungen, Angebote und Belegprüfungen. Beträge werden nicht zusammengerechnet.</p>{!compact && <p className="mt-1">Keine automatische E-Mail, Buchung, Zahlung oder KI-Anfrage. Die Liste wird aus dem aktuellen Stand neu gebildet, nicht als separate Aufgabe gespeichert.</p>}</div>
    </section>
  </div>;
}
