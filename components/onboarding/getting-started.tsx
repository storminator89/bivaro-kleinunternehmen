"use client";

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getSetupProgress } from './setup-state';
import type { SetupSettings } from './setup-state';
import styles from './onboarding.module.css';

async function fetchSetupJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('Der Einrichtungsstand konnte nicht geladen werden.');
  return response.json();
}

export function GettingStartedChecklist({ settings, invoiceCount, hasCustomer }: {
  settings: SetupSettings;
  invoiceCount: number;
  hasCustomer: boolean;
}) {
  const progress = getSetupProgress(settings, invoiceCount);
  const rows = [
    { key: 'company', done: progress.companyComplete, title: 'Firmendaten',
            href: '/settings#company-settings', action: progress.companyComplete ? 'Firmendaten prüfen' : 'Firmendaten ergänzen' },
    { key: 'fiscal', done: progress.fiscalComplete, title: 'Steuerprofil',
            href: '/settings#fiscal-profile', action: progress.fiscalComplete ? 'Steuerprofil prüfen' : 'Steuerprofil einrichten' },
    { key: 'invoice', done: progress.invoiceComplete, title: 'Kunde und erste Rechnung',
            href: progress.invoiceComplete ? '/dashboard?tab=invoices' : '/dashboard/invoices/new', action: progress.invoiceComplete ? 'Rechnungen öffnen' : 'Rechnung erstellen' },
    { key: 'export', done: false, title: 'Unterlagen',
            href: '/help#export', action: 'Exportwege ansehen' },
  ];

  return <details className={`${styles.panel} ${styles.compactChecklist}`}>
    <summary className={styles.summary}>
      <span><h2>Einrichtung</h2></span>
      <span className={styles.progress}>{progress.completed} / 3 gespeichert<ChevronDown aria-hidden="true" /></span>
    </summary>
    <div className={styles.body}>

      <ol className={styles.rows}>
        {rows.map((row, index) => <li key={row.key} className={styles.row} aria-current={progress.nextStep === row.key ? 'step' : undefined}>
          <span className={`${styles.marker} ${row.done ? styles.done : progress.nextStep === row.key ? styles.current : ''}`} aria-hidden="true">{row.done ? <Check /> : index < 3 ? index + 1 : '•'}</span>
          <div><h3>{row.title}{row.done && <span className="sr-only"> – gespeichert</span>}</h3></div>
          <div className={styles.rowAction}>
            {row.key === 'invoice' && !progress.invoiceComplete && <Link href="/customers" className={styles.link}>{hasCustomer ? 'Kunden öffnen' : 'Kunde anlegen'}</Link>}
            <Link href={row.href} className={styles.link}>{row.action}</Link>
          </div>
        </li>)}
      </ol>

    </div>
  </details>;
}

export function GettingStarted() {
  const settings = useQuery({ queryKey: ['onboarding', 'settings'], queryFn: ({ signal }) => fetchSetupJson<SetupSettings>('/api/settings', signal), staleTime: 0 });
  const invoices = useQuery({ queryKey: ['dashboard', 'invoices', 'onboarding-first'], queryFn: ({ signal }) => fetchSetupJson<{ total: number }>('/api/invoices?page=1&pageSize=1', signal), staleTime: 0 });
  const customers = useQuery({ queryKey: ['dashboard', 'customers'], queryFn: ({ signal }) => fetchSetupJson<unknown[]>('/api/customers', signal), staleTime: 0 });
  const queries = [settings, invoices, customers];
  if (queries.some(query => query.isPending)) return <section className={styles.panel} aria-label="Erststart" aria-busy="true"><div className={styles.header}><p role="status">Einrichtung wird geladen…</p></div></section>;
  if (queries.some(query => query.isError) || !settings.data || !invoices.data || !customers.data) return <section className={styles.panel} aria-label="Erststart"><div className={styles.header}><div><h2>Einrichtung</h2><p role="status">Einrichtungsstand nicht verfügbar.</p><Button type="button" variant="outline" className="mt-3" disabled={queries.some(query => query.isFetching)} onClick={() => { void Promise.all(queries.map(query => query.refetch())); }}><RefreshCw aria-hidden="true" />Erneut laden</Button></div></div></section>;
  return <GettingStartedChecklist settings={settings.data} invoiceCount={invoices.data.total} hasCustomer={customers.data.length > 0} />;
}
