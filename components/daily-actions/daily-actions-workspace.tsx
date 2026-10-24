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
import styles from './daily-actions-workspace.module.css';

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
  return <li className={styles.listItem}>
    <article className={first ? `${styles.actionRow} ${styles.firstAction}` : styles.actionRow}>
      <div className={styles.actionDate}>
        <span className={first ? styles.priority : styles.kind}>{first ? 'Zuerst prüfen' : action.kind.startsWith('INVOICE') ? 'Rechnung' : action.kind.startsWith('QUOTE') ? 'Angebot' : 'Belegeingang'}</span>
        <span>{action.dateLabel}</span><time dateTime={action.date}>{dateLabel(action.date)}</time>
      </div>
      <div className={styles.actionContent}>
        <h3>{action.title}</h3>
        <p className={styles.source}><span>{action.source}</span>{action.party && <span>{action.party}</span>}</p>
        <p className={styles.reason}>{action.reason}</p>
      </div>
      <div className={styles.actionDecision}>
        <div className={styles.amount}><p>{action.amountLabel}</p><strong>{dailyActionAmount(action.amountCents)}</strong></div>
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
  return <div className={compact ? styles.compact : styles.workspace}>
    {!compact && <PageHeader title="Heute erledigen" actions={<Button asChild variant="outline"><Link href="/dashboard"><ArrowLeft className="size-4" aria-hidden="true" />Zum Dashboard</Link></Button>} />}
    <section className={styles.panel} aria-labelledby={compact ? 'daily-actions-preview-title' : 'daily-actions-title'} aria-busy={loading}>
      <div className={styles.panelHeader}>
        <div className={styles.panelTitle}><h2 id={compact ? 'daily-actions-preview-title' : 'daily-actions-title'}><ListChecks aria-hidden="true" />{compact ? 'Heute erledigen' : 'Nächste Schritte'}</h2><p>{loading ? 'Aktueller Stand wird geladen…' : error ? 'Stand nicht verfügbar' : <><span>{count} {data?.actionCount === 1 ? 'Schritt' : 'Schritte'}</span><time dateTime={data!.businessDate}>{dateLabel(data!.businessDate)}</time></>}</p></div>
        <div className={styles.panelActions}>{compact && <Button variant="outline" asChild><Link href="/dashboard/today">Alle Schritte<ArrowRight className="size-4" aria-hidden="true" /></Link></Button>}<Button variant="outline" size="icon" disabled={loading} onClick={() => setAttempt(value => value + 1)} aria-label="Nächste Schritte aktualisieren"><RefreshCw className="size-4" aria-hidden="true" /></Button></div>
      </div>
      {loading || error ? <QueryFeedback noun="Nächste Schritte" isError={error} onRetry={() => setAttempt(value => value + 1)} /> : shown.length ? <>
        <ol aria-label="Priorisierte nächste Schritte" className={styles.actionList}>{shown.map((action, index) => <ActionRow key={action.id} action={action} first={index === 0} />)}</ol>
        {data && (data.actionCount > shown.length || data.isPartial) && <p className="border-t border-border p-4 text-sm text-muted-foreground sm:px-5">{shown.length} von {data.isPartial ? 'mindestens ' : ''}{data.actionCount} Schritten in dieser Auswahl.{data.isPartial ? ' Unvollständige Auswahl: bis zu 500 Datensätze je Quelle geprüft. Weiterer Bestand in den Fachlisten.' : compact ? ' Weitere Schritte in der Tagesübersicht.' : ' Bis zu 50 Schritte. Nach Bearbeitung aktualisieren.'}</p>}
      </> : <div className={styles.empty}><CheckCheck aria-hidden="true" /><h3>Keine offenen Schritte</h3><p>Für Rechnungen, Angebote und Belegeingang.</p></div>}
      <details className={styles.scope}><summary>Umfang</summary><p>Bis zu 500 Datensätze je Quelle; keine Vollständigkeitsprüfung. Überfälliges zuerst. Beträge nicht addieren. Keine automatischen Erinnerungen oder Buchungen.</p></details>
    </section>
  </div>;
}
