import { formatCurrency } from '@/lib/dashboard-utils';
import { sumDecimalEUR } from '@/lib/money';

/** Page-scoped totals stay explicit when the list is filtered or paginated. */
export function LedgerListHeading({ title, total, amounts, isLoading = false }: {
  title: string;
  total: number;
  amounts: number[];
  isLoading?: boolean;
}) {
  return (
    <div className="ledger-list-heading">
      <div className="flex min-w-0 items-center gap-2.5">
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="ledger-count" aria-label={`${total} Ergebnisse`}>{isLoading ? '—' : total}</span>
      </div>
      <p className="ledger-page-total"><span>Summe dieser Seite</span><strong>{isLoading ? '—' : formatCurrency(Number(sumDecimalEUR(amounts)))}</strong></p>
    </div>
  );
}
