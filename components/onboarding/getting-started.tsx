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
    { key: 'company', done: progress.companyComplete, title: 'Firmendaten hinterlegen',
      description: progress.companyComplete ? 'Firmenname, Anschrift und Steuernummer / USt-ID sind gespeichert.' : 'Tragen Sie Firmenname, Anschrift und Steuernummer / USt-ID für Ihre Rechnungen ein.',
      href: '/settings#company-settings', action: progress.companyComplete ? 'Firmendaten prüfen' : 'Firmendaten ergänzen' },
    { key: 'fiscal', done: progress.fiscalComplete, title: 'Steuerprofil bewusst wählen',
      description: progress.fiscalComplete ? 'Ihre Einordnung und ihr Gültigkeitsdatum sind gespeichert. Bivaro prüft die Voraussetzungen nicht.' : 'Kleingewerbe ist nicht automatisch § 19. Klären Sie Ihre Einordnung und bestätigen Sie sie mit Gültigkeitsdatum.',
      href: '/settings#fiscal-profile', action: progress.fiscalComplete ? 'Steuerprofil prüfen' : 'Steuerprofil einrichten' },
    { key: 'invoice', done: progress.invoiceComplete, title: 'Kunde und erste Rechnung',
      description: progress.invoiceComplete ? 'Mindestens eine Rechnung ist gespeichert. Prüfen Sie den Beleg vor dem Versand.' : hasCustomer ? 'Ein Kunde ist gespeichert. Erstellen Sie Ihre erste Rechnung und prüfen Sie die Angaben vor dem Versand.' : 'Legen Sie einen Kunden an und erstellen Sie anschließend Ihre erste Rechnung.',
      href: progress.invoiceComplete ? '/dashboard?tab=invoices' : '/dashboard/invoices/new', action: progress.invoiceComplete ? 'Rechnungen öffnen' : 'Rechnung erstellen' },
    { key: 'export', done: false, title: 'Unterlagen übergeben und sichern',
      description: 'Exportwege, PDF-Versand und Datensicherung kennenlernen. Stimmen Sie das benötigte Format mit Ihrer Steuerberatung ab.',
      href: '/help#export', action: 'Exportwege ansehen' },
  ];

  return <details className={styles.panel} open={progress.completed < 3}>
    <summary className={styles.summary}>
      <span><h2>Ihr Start in Bivaro</h2><small>{progress.completed === 3 ? 'Die drei Startschritte sind gespeichert. Unterlagen und Hilfe bleiben hier erreichbar.' : 'Schritt für Schritt zur ersten Rechnung – mit Ihren gespeicherten Angaben.'}</small></span>
      <span className={styles.progress}>{progress.completed} von 3 Startschritten<ChevronDown aria-hidden="true" /></span>
    </summary>
    <div className={styles.body}>
      <p className={styles.description}>Diese Orientierung ist keine Prüfung auf steuerliche oder rechtliche Vollständigkeit. Ein Schritt zählt erst mit gespeicherten Daten, nicht nach einem Klick.</p>
      <ol className={styles.rows}>
        {rows.map((row, index) => <li key={row.key} className={styles.row} aria-current={progress.nextStep === row.key ? 'step' : undefined}>
          <span className={`${styles.marker} ${row.done ? styles.done : progress.nextStep === row.key ? styles.current : ''}`} aria-hidden="true">{row.done ? <Check /> : index < 3 ? index + 1 : '•'}</span>
          <div><h3>{row.title}{row.done && <span className="sr-only"> – gespeichert</span>}</h3><p>{row.description}</p></div>
          <div className={styles.rowAction}>
            {row.key === 'invoice' && !progress.invoiceComplete && <Link href="/customers" className={styles.link}>{hasCustomer ? 'Kunden öffnen' : 'Kunde anlegen'}</Link>}
            <Link href={row.href} className={styles.link}>{row.action}</Link>
          </div>
        </li>)}
      </ol>
      <Link href="/help" className={styles.link}>Hilfe zum ersten Arbeitstag</Link>
    </div>
  </details>;
}

export function GettingStarted() {
  const settings = useQuery({ queryKey: ['onboarding', 'settings'], queryFn: ({ signal }) => fetchSetupJson<SetupSettings>('/api/settings', signal), staleTime: 0 });
  const invoices = useQuery({ queryKey: ['dashboard', 'invoices', 'onboarding-first'], queryFn: ({ signal }) => fetchSetupJson<{ total: number }>('/api/invoices?page=1&pageSize=1', signal), staleTime: 0 });
  const customers = useQuery({ queryKey: ['dashboard', 'customers'], queryFn: ({ signal }) => fetchSetupJson<unknown[]>('/api/customers', signal), staleTime: 0 });
  const queries = [settings, invoices, customers];
  if (queries.some(query => query.isPending)) return <section className={styles.panel} aria-label="Erststart" aria-busy="true"><div className={styles.header}><p role="status">Ihr gespeicherter Einrichtungsstand wird geladen…</p></div></section>;
  if (queries.some(query => query.isError) || !settings.data || !invoices.data || !customers.data) return <section className={styles.panel} aria-label="Erststart"><div className={styles.header}><div><h2>Ihr Start in Bivaro</h2><p role="status">Der Einrichtungsstand konnte nicht geladen werden. Es wird kein Fortschritt angenommen.</p><Button type="button" variant="outline" className="mt-3" disabled={queries.some(query => query.isFetching)} onClick={() => { void Promise.all(queries.map(query => query.refetch())); }}><RefreshCw aria-hidden="true" />Erneut laden</Button></div></div></section>;
  return <GettingStartedChecklist settings={settings.data} invoiceCount={invoices.data.total} hasCustomer={customers.data.length > 0} />;
}
