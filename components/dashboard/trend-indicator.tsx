import { ArrowDown, ArrowUp, Minus } from 'lucide-react';

/** Direction and business assessment are independent (lower costs are positive). */
export function TrendIndicator({ current, previous, positiveIsGood = true }: {
  current: number;
  previous: number;
  positiveIsGood?: boolean;
}) {
  const change = previous === 0 ? null : (current - previous) / Math.abs(previous) * 100;
  const neutral = change === null || change === 0;
  const good = !neutral && (positiveIsGood ? change > 0 : change < 0);
  const Icon = neutral ? Minus : change > 0 ? ArrowUp : ArrowDown;
  return <span className={`financial-trend ${neutral ? 'text-muted-foreground' : good ? 'text-positive' : 'text-critical'}`}>
    {change !== null && <Icon aria-hidden="true" />}
    <span>{change === null ? <><span aria-hidden="true">—</span><span className="sr-only">Kein Vorjahresvergleich möglich</span></> : `${Math.abs(change).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`}</span>
    {change !== null && change !== 0 && <span className="sr-only">{change > 0 ? 'gestiegen' : 'gesunken'}, {good ? 'positive' : 'negative'} Entwicklung</span>}
  </span>;
}
