import { DashboardIcon, type DashboardIconName } from '@/components/brand/dashboard-icon';
import { formatCurrency } from '@/lib/dashboard-utils';
import { sumDecimalEUR } from '@/lib/money';

/** Page-scoped totals stay explicit when the list is filtered or paginated. */
export function LedgerListHeading({ title, total, amounts, isLoading = false, isError = false, icon }: {
  title: string;
  icon?: DashboardIconName;
  total: number;
  amounts: number[];
  isLoading?: boolean;
  isError?: boolean;
}) {
  return (
    <div className="ledger-list-heading">
      <div className="flex min-w-0 items-center gap-2.5">
        {icon && <DashboardIcon name={icon} size={32} />}
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="ledger-count" aria-label={`${total} Ergebnisse`}>{isLoading || isError ? '—' : total}</span>
      </div>
      <p className="ledger-page-total"><span>Summe dieser Seite</span><strong>{isLoading || isError ? '—' : formatCurrency(Number(sumDecimalEUR(amounts)))}</strong></p>
    </div>
  );
}
