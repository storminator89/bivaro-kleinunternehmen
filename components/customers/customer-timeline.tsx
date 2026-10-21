"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { TimelineEntry } from '@/lib/customer-timeline-contract';
import { formatMoneyEUR } from '@/lib/money';
import styles from './customer-timeline.module.css';

type TimelinePage = {
  customer: { id: number; name: string };
  entries: TimelineEntry[];
  nextCursor: string | null;
};

type CustomerTimelineProps = {
  customer: { id: number; name: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const dateFormatter = new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', dateStyle: 'medium' });
const timestampFormatter = new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' });
const fallbackError = 'Der Verlauf konnte nicht geladen werden. Bitte erneut versuchen.';
class TimelineRequestError extends Error {}

function dateLabel(value: string, withTime = false) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Datum unbekannt';
  return withTime ? `${timestampFormatter.format(date)} UTC` : dateFormatter.format(date);
}

function euros(value: string | null) {
  if (value === null || !/^[0-9]{1,16}$/u.test(value)) return null;
  return `${formatMoneyEUR(BigInt(value)).replace('.', ',')} €`;
}

function documentType(type: string) {
  return type === 'QUOTE' ? 'Angebot' : type === 'CREDIT_NOTE' ? 'Stornobeleg' : type === 'INVOICE' ? 'Rechnung' : 'Beleg';
}

function entryTitle(entry: TimelineEntry) {
  const document = `${documentType(entry.document.type)} ${entry.document.number || 'ohne Nummer'}`;
  return entry.kind === 'PAYMENT' ? `Zahlungsnachweis · ${document}`
    : entry.kind === 'ADJUSTMENT' ? `Korrektur / Erstattung · ${document}` : document;
}

function businessDateLabel(entry: TimelineEntry) {
  if (entry.kind === 'DOCUMENT') return 'Belegdatum';
  if (entry.kind === 'ADJUSTMENT') return 'Datum des Nachweises';
  return entry.dateCertainty === 'ACTUAL' ? 'Zahlungsdatum' : 'Historischer Datumsnachweis';
}

function isTimelinePage(value: unknown, customerId: number): value is TimelinePage {
  if (!value || typeof value !== 'object') return false;
  const page = value as Partial<TimelinePage>;
  return page.customer?.id === customerId && typeof page.customer.name === 'string'
    && Array.isArray(page.entries) && page.entries.length <= 20
    && page.entries.every(entry => entry && typeof entry.key === 'string'
      && ['DOCUMENT', 'PAYMENT', 'ADJUSTMENT'].includes(entry.kind)
      && typeof entry.recordedAt === 'string' && typeof entry.statusLabel === 'string'
      && entry.document && Number.isSafeInteger(entry.document.id)
      && typeof entry.document.type === 'string' && typeof entry.document.status === 'string'
      && [`/history?invoiceId=${entry.document.id}`, `/api/quotes/download?id=${entry.document.id}`].includes(entry.document.href)
      && (!entry.document.convertedInvoice || (Number.isSafeInteger(entry.document.convertedInvoice.id)
        && entry.document.convertedInvoice.id > 0
        && entry.document.convertedInvoice.href === `/history?invoiceId=${entry.document.convertedInvoice.id}`))
      && entry.balance && ['KNOWN', 'REVIEW', 'NOT_APPLICABLE'].includes(entry.balance.state))
    && (page.nextCursor === null || typeof page.nextCursor === 'string');
}

export function CustomerTimeline({ customer, open, onOpenChange }: CustomerTimelineProps) {
  const openerRef = useRef<HTMLElement | null>(null);
  const customerIdRef = useRef<number | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={styles.dialog}
        onOpenAutoFocus={() => {
          const active = document.activeElement;
          openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
          customerIdRef.current = customer?.id ?? null;
        }}
        onCloseAutoFocus={event => {
          const customerId = customerIdRef.current;
          const usable = (element: HTMLElement | null): element is HTMLElement => Boolean(element
            && customerId !== null && element.dataset.customerTimelineReturn === String(customerId)
            && element.isConnected && element.getClientRects().length > 0
            && getComputedStyle(element).visibility === 'visible'
            && !element.matches(':disabled, [aria-disabled="true"]')
            && !element.closest('[inert], [hidden], [role="dialog"], [role="menu"]'));
          const target = usable(openerRef.current) ? openerRef.current : customerId !== null
            ? Array.from(document.querySelectorAll<HTMLElement>(`[data-customer-timeline-return="${customerId}"]`)).find(usable)
            : null;
          if (target) { event.preventDefault(); target.focus(); }
          openerRef.current = null;
          customerIdRef.current = null;
        }}
      >
        <DialogHeader className={styles.header}>
          <DialogTitle className="pr-7 leading-snug">Verlauf: {customer?.name || 'Kunde'}</DialogTitle>
          <DialogDescription>Vorhandene Belege und Zahlungsnachweise · nur lesend</DialogDescription>
        </DialogHeader>
        {open && customer && <TimelineEntries key={customer.id} customerId={customer.id} />}
      </DialogContent>
    </Dialog>
  );
}

function TimelineEntries({ customerId }: { customerId: number }) {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const failedCursorRef = useRef<string | null>(null);
  const activeRef = useRef(false);
  const busyRef = useRef(false);
  const requestRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async (cursor: string | null = null) => {
    if (busyRef.current) return;
    busyRef.current = true;
    const requestId = ++requestRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      const response = await fetch(`/api/customers/${customerId}/timeline${query}`, { cache: 'no-store', signal: controller.signal });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 401) throw new TimelineRequestError('Bitte erneut anmelden, um den Verlauf zu öffnen.');
        if (response.status === 404) throw new TimelineRequestError('Der Kunde ist nicht mehr verfügbar. Bitte die Kundenliste neu laden.');
        const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' && data.error.length <= 500
          ? data.error : fallbackError;
        throw new TimelineRequestError(message);
      }
      if (!isTimelinePage(data, customerId)) throw new Error(fallbackError);
      if (!activeRef.current || requestId !== requestRef.current) return;
      setEntries(previous => {
        if (!cursor) return data.entries;
        const existing = new Set(previous.map(entry => entry.key));
        return [...previous, ...data.entries.filter(entry => !existing.has(entry.key))];
      });
      setNextCursor(data.nextCursor);
      setLoaded(true);
    } catch (failure) {
      if (activeRef.current && requestId === requestRef.current && !controller.signal.aborted) {
        failedCursorRef.current = cursor;
        setError(failure instanceof TimelineRequestError ? failure.message : fallbackError);
      }
    } finally {
      if (requestId === requestRef.current) {
        busyRef.current = false;
        if (activeRef.current) setLoading(false);
      }
    }
  }, [customerId]);

  useEffect(() => {
    const requestState = requestRef;
    activeRef.current = true;
    void load();
    return () => {
      activeRef.current = false;
      controllerRef.current?.abort();
      requestState.current++;
      busyRef.current = false;
    };
  }, [load]);

  return (
    <div className={styles.body}>
      <div className={styles.toolbar}>
        <p>Nach Erfassung · neueste zuerst</p>
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading} aria-label="Verlauf neu laden">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />Neu laden
        </Button>
      </div>
      {error && <div role="alert" className={styles.error}><p>{error}</p><Button variant="outline" size="sm" disabled={loading} onClick={() => void load(failedCursorRef.current)}>Erneut versuchen</Button></div>}
      {loaded && entries.length === 0 && !loading && <div className={styles.empty}><h2>Noch kein Verlauf</h2><p>Für diesen Kunden sind keine Belege oder Zahlungsnachweise direkt verknüpft.</p></div>}
      {entries.length > 0 && <ol className={styles.entries} aria-label="Kundenverlauf">
        {entries.map(entry => {
          const amount = euros(entry.amountCents);
          const open = euros(entry.balance.openCents);
          const collectible = entry.kind === 'DOCUMENT' && entry.document.type === 'INVOICE'
            && !['DRAFT', 'CANCELLED'].includes(entry.document.status);
          return <li key={entry.key} className={styles.entry}>
            <div className={styles.entryHeading}>
              <div><p className={styles.recorded}><time dateTime={entry.recordedAt}>{dateLabel(entry.recordedAt)}</time></p><h2>{entryTitle(entry)}</h2></div>
              <span className={styles.status}>{entry.statusLabel}</span>
            </div>
            <div className={styles.entryFoot}>
              <div className={styles.facts}>
                {collectible && entry.balance.state === 'KNOWN' && open !== null && <p>Aktueller Rest <strong>{open}</strong></p>}
                {entry.balance.state === 'REVIEW' && <p className={styles.review}>Zahlungsstand zu prüfen</p>}
                {entry.kind !== 'DOCUMENT' && amount !== null && <p>Nachweisbetrag <strong>{amount}</strong></p>}
                {entry.kind === 'DOCUMENT' && entry.document.type === 'QUOTE' && <p>Keine Forderung</p>}
                {entry.kind === 'DOCUMENT' && entry.document.type === 'INVOICE' && entry.document.status === 'DRAFT' && <p>Entwurf · kein Umsatznachweis</p>}
                {entry.kind === 'DOCUMENT' && entry.document.status === 'CANCELLED' && <p>Storniert · keine offene Forderung</p>}
              </div>
              <a className={styles.detailLink} href={entry.document.href} target="_blank" rel="noopener noreferrer" aria-label={`${documentType(entry.document.type)} ${entry.document.number || 'ohne Nummer'} öffnen (neuer Tab)`}>Details öffnen<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a>
            </div>
            <details className={styles.details}>
              <summary>Einzelheiten</summary>
              <dl><div><dt>Erfasst am</dt><dd><time dateTime={entry.recordedAt}>{dateLabel(entry.recordedAt, true)}</time></dd></div>
                <div><dt>{businessDateLabel(entry)}</dt><dd>{entry.businessDate ? <time dateTime={entry.businessDate}>{dateLabel(entry.businessDate)}</time> : 'Unbekannt'}</dd></div>
                {entry.kind === 'PAYMENT' && entry.dateCertainty !== 'ACTUAL' && <div><dt>Datumsqualität</dt><dd>Historischer Nachweis, kein bestätigtes tatsächliches Zahlungsdatum</dd></div>}
              </dl>
              {entry.document.convertedInvoice && <a className={styles.detailLink}
                href={entry.document.convertedInvoice.href} target="_blank" rel="noopener noreferrer"
                aria-label={`Übernommene Rechnung ${entry.document.convertedInvoice.number || 'ohne Nummer'} öffnen (neuer Tab)`}>
                Übernommene Rechnung {entry.document.convertedInvoice.number || 'ohne Nummer'} öffnen<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>}
            </details>
          </li>;
        })}
      </ol>}
      {loading && <p role="status" className={styles.loading}><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Verlauf wird geladen …</p>}
      {nextCursor && !error && <Button variant="outline" className={styles.more} disabled={loading} onClick={() => void load(nextCursor)}>Ältere Einträge laden</Button>}
      <p className={styles.scope}>Belegbezogene Zahlungsstände sind aktuell. Angebote sind keine Forderungen; eine Zahlungskorrektur ist keine Erstattung. Kein Kundengesamtsaldo.</p>
    </div>
  );
}
