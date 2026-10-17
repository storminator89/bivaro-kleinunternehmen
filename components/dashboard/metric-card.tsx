import Link from 'next/link';
import { TrendIndicator } from './trend-indicator';
import { ChevronRight } from 'lucide-react';
import { DashboardIcon, type DashboardIconName } from '@/components/brand/dashboard-icon';
import { formatCurrency } from '@/lib/dashboard-utils';

export function MetricCard({ title, amount, icon, tone = 'positive', period, previous, positiveIsGood = true, href, series }: {
  title: string;
  amount: number;
  icon: DashboardIconName;
  tone?: 'positive' | 'critical' | 'notice';
  period: string;
  previous?: number;
  positiveIsGood?: boolean;
  href: string;
  series?: number[];
}) {
  const max = Math.max(...(series ?? []), 1);

  return <Link href={href} className="dashboard-metric" aria-label={`${title}: ${formatCurrency(amount)}. ${period}. Öffnen`}>
    <span className="metric-symbol"><DashboardIcon name={icon} size={48} /></span>
    <div className="metric-content">
      <h2>{title}</h2>
      <p className="metric-value">{formatCurrency(amount)}</p>
      <p className="metric-period">{period}</p>
      {previous !== undefined && <div className="metric-comparison">
        <TrendIndicator current={amount} previous={previous} positiveIsGood={positiveIsGood} />
        {previous !== 0 && <span>Vorjahr: {formatCurrency(previous)}</span>}
      </div>}
    </div>
    {series && series.some(value => value > 0) ? <span className={`metric-sparkline metric-sparkline-${tone}`} aria-hidden="true">{series.map((value, index) => <i key={index} style={{ height: `${Math.max(0, value) / max * 100}%` }} />)}</span> : <ChevronRight className="metric-link-icon" aria-hidden="true" />}
  </Link>;
}
