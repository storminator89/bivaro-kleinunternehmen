'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EMPTY_INVOICE_DATE_FILTER, parseIncomingInvoiceDateFilter, type IncomingInvoiceDateFilter } from '@/lib/purchase-documents/invoice-date-filter';

type FilterInput = { invoiceDateFrom: string; invoiceDateTo: string; invoiceDateMissing: string };

/** Applying a list filter is explicit, read-only and uses the workspace's existing navigation guard. */
export function IncomingInvoiceDateFilter({ value, onApply }: { value: FilterInput; onApply: (value: IncomingInvoiceDateFilter) => void }) {
  const { invoiceDateFrom, invoiceDateTo, invoiceDateMissing } = value;
  const [from, setFrom] = useState(invoiceDateFrom);
  const [to, setTo] = useState(invoiceDateTo);
  const [missing, setMissing] = useState(invoiceDateMissing === 'only');
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(() => Boolean(invoiceDateFrom || invoiceDateTo || invoiceDateMissing !== 'any'));
  const errorRef = useRef<HTMLParagraphElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  useEffect(() => {
    setFrom(invoiceDateFrom); setTo(invoiceDateTo); setMissing(invoiceDateMissing === 'only');
    // Only a genuinely changed accepted filter resets disclosure state. A
    // normal list/detail refresh must not reopen a disclosure the user closed.
    setExpanded(Boolean(invoiceDateFrom || invoiceDateTo || invoiceDateMissing !== 'any'));
    try { parseIncomingInvoiceDateFilter({ invoiceDateFrom, invoiceDateTo, invoiceDateMissing }); setError(null); }
    catch (caught) { setError((caught as Error).message); setExpanded(true); }
  }, [invoiceDateFrom, invoiceDateTo, invoiceDateMissing]);
  const active = Boolean(invoiceDateFrom || invoiceDateTo || invoiceDateMissing !== 'any');
  let acceptedLabel = '';
  try {
    const accepted = parseIncomingInvoiceDateFilter({ invoiceDateFrom, invoiceDateTo, invoiceDateMissing });
    if (active) acceptedLabel = accepted.invoiceDateMissing === 'only' ? 'ohne ausgelesenes Datum' : `${accepted.invoiceDateFrom || 'offen'} bis ${accepted.invoiceDateTo || 'offen'}`;
  } catch { acceptedLabel = 'Angaben prüfen'; }
  return <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)} className="border-b border-border">
    <summary ref={summaryRef} className="min-h-11 cursor-pointer px-4 py-3 text-sm font-medium sm:px-6">Rechnungsdatum filtern{acceptedLabel && <span className="break-words font-normal text-muted-foreground"> · {acceptedLabel}</span>}</summary>
    <form noValidate className="space-y-3 p-4 pt-0 sm:px-6" aria-label="Nach Rechnungsdatum filtern" onSubmit={event => {
    event.preventDefault();
    try {
      const next = parseIncomingInvoiceDateFilter({ invoiceDateFrom: missing ? '' : from, invoiceDateTo: missing ? '' : to, invoiceDateMissing: missing ? 'only' : 'any' });
      setError(null); onApply(next);
    } catch (caught) { setError((caught as Error).message); setExpanded(true); requestAnimationFrame(() => errorRef.current?.focus()); }
  }}>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <div className="min-w-0 space-y-2"><Label htmlFor="incoming-invoice-date-from">Rechnungsdatum von</Label><Input id="incoming-invoice-date-from" type="date" min="0001-01-01" max="9999-12-31" value={from} disabled={missing} onChange={event => { setFrom(event.target.value); setError(null); }} aria-describedby="incoming-invoice-date-help" className="min-h-11 min-w-0 text-base sm:text-sm" /></div>
      <div className="min-w-0 space-y-2"><Label htmlFor="incoming-invoice-date-to">Rechnungsdatum bis (einschließlich)</Label><Input id="incoming-invoice-date-to" type="date" min="0001-01-01" max="9999-12-31" value={to} disabled={missing} onChange={event => { setTo(event.target.value); setError(null); }} aria-describedby="incoming-invoice-date-help" className="min-h-11 min-w-0 text-base sm:text-sm" /></div>
    </div>
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"><input type="checkbox" checked={missing} onChange={event => { setMissing(event.target.checked); setError(null); }} aria-describedby="incoming-invoice-date-help" className="size-4 shrink-0" />Nur ohne ausgelesenes Rechnungsdatum</label>
    <p id="incoming-invoice-date-help" className="text-xs text-muted-foreground">Nur das ausgelesene Rechnungsdatum zählt. Foto-/Prüfentwurfsdaten und Uploaddatum ersetzen es nicht. Ein Bereich blendet Belege ohne ausgelesenes Datum aus; ohne Datumsfilter bleiben sie enthalten.</p>
    {error && <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-critical-foreground outline-none focus-visible:outline-2 focus-visible:outline-ring">{error}</p>}
    <div className="flex flex-wrap gap-2"><Button type="submit" variant="outline">Datumsfilter anwenden</Button>{(active || from || to || missing) && <Button type="button" variant="ghost" onClick={() => { setFrom(''); setTo(''); setMissing(false); setError(null); setExpanded(false); summaryRef.current?.focus(); onApply({ ...EMPTY_INVOICE_DATE_FILTER }); }}>Datumsfilter zurücksetzen</Button>}</div>
    {active && <p role="status" className="text-xs text-muted-foreground">{invoiceDateMissing === 'only' ? 'Aktiv: nur ohne ausgelesenes Rechnungsdatum.' : `Aktiver Rechnungsdatumbereich: ${invoiceDateFrom || 'offen'} bis ${invoiceDateTo || 'offen'} (einschließlich).`}</p>}
    </form>
  </details>;
}
