'use client';

import { useEffect, useMemo, useState } from 'react';
import { History, Loader2, RotateCcw } from 'lucide-react';
import { filterPriceHistoryEntries, type PriceHistoryEntry } from '@/lib/price-history';

export interface PriceHistoryProps {
  customerId: number | null;
  description: string;
  unit: string;
  taxRate: number;
  taxCategory?: string;
  exemptionReason?: string;
  currentPrice: number;
  onApply: (price: number) => void;
}

type HistoryResult = { entries: PriceHistoryEntry[] };

// A modal can render one history control per line. Share one request per
// customer while still filtering descriptions locally in each control. Keep
// only in-flight work: settled results must not survive a later save or login.
const historyInFlight = new Map<number, Promise<PriceHistoryEntry[]>>();

async function loadCustomerHistory(customerId: number): Promise<PriceHistoryEntry[]> {
  const inFlight = historyInFlight.get(customerId);
  if (inFlight) return inFlight;

  const promise = fetch(`/api/customers/${customerId}/price-history`, { headers: { Accept: 'application/json' } })
    .then(async response => {
      const body = await response.json().catch(() => null) as HistoryResult | { error?: string } | null;
      if (!response.ok) throw new Error(body && 'error' in body && body.error ? body.error : 'Preishistorie konnte nicht geladen werden');
      const entries = body && 'entries' in body && Array.isArray(body.entries) ? body.entries : null;
      if (!entries) throw new Error('Ungültige Preishistorie');
      return entries;
    })
    .finally(() => {
      if (historyInFlight.get(customerId) === promise) historyInFlight.delete(customerId);
    });
  historyInFlight.set(customerId, promise);
  return promise;
}

export function PriceHistory({
  customerId,
  description,
  unit,
  taxRate,
  taxCategory,
  exemptionReason,
  currentPrice,
  onApply,
}: PriceHistoryProps) {
  const [entries, setEntries] = useState<PriceHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let active = true;
    if (customerId === null) {
      setEntries([]);
      setLoading(false);
      setError(null);
      return () => { active = false; };
    }

    setEntries([]);
    setLoading(true);
    setError(null);
    loadCustomerHistory(customerId)
      .then(result => {
        if (active) setEntries(result);
      })
      .catch(loadError => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Preishistorie konnte nicht geladen werden');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [customerId, retryToken]);

  const matches = useMemo(() => filterPriceHistoryEntries(entries, {
    description,
    unit,
    taxRate,
    taxCategory,
    exemptionReason,
  }), [description, entries, exemptionReason, taxCategory, taxRate, unit]);

  if (customerId === null) return null;

  const formatPrice = (price: number) => new Intl.NumberFormat('de-DE', {
    style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(price);

  return (
    <section className="mt-2 rounded-md border border-dashed border-border bg-muted/20 p-2.5" aria-label="Preise aus früheren Rechnungen">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <History className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Preis aus früherer Rechnung</span>
        {Number.isFinite(currentPrice) && <span className="ml-auto tabular-nums">Aktuell {formatPrice(currentPrice)}</span>}
      </div>

      {loading && (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Preishistorie wird geladen …
        </div>
      )}
      {error && !loading && (
        <div className="mt-2 flex items-center gap-2 text-xs text-destructive" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="inline-flex items-center gap-1 underline underline-offset-2"
            onClick={() => {
              if (customerId !== null) historyInFlight.delete(customerId);
              setRetryToken(token => token + 1);
            }}
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            Erneut versuchen
          </button>
        </div>
      )}
      {!loading && !error && matches.length === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Keine eindeutige Übereinstimmung für Beschreibung, Einheit und Steuer gefunden.
        </p>
      )}
      {!loading && !error && matches.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {matches.slice(0, 8).map((entry, index) => (
            <button
              type="button"
              key={`${entry.invoiceId}-${index}`}
              className="rounded border border-input bg-background px-2 py-1 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground"
              onClick={() => onApply(entry.unitPrice)}
              aria-label={`Preis übernehmen: ${formatPrice(entry.unitPrice)}`}
              title={entry.invoiceNumber ? `Rechnung ${entry.invoiceNumber}` : `Rechnung ${entry.invoiceId}`}
            >
              <span className="font-semibold tabular-nums">{formatPrice(entry.unitPrice)}</span>
              <span className="ml-1.5 text-muted-foreground">
                {new Intl.DateTimeFormat('de-DE').format(new Date(entry.invoiceDate))}
                {entry.invoiceNumber ? ` · ${entry.invoiceNumber}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export default PriceHistory;
