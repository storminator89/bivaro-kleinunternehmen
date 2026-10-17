import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { DashboardIcon } from '@/components/brand/dashboard-icon';
import { formatCurrency } from '@/lib/dashboard-utils';

type Activity = { id: number | string; type: 'income' | 'expense'; description: string; date: string; amount: number };

export function DashboardActivityFeed({ activities }: { activities: Activity[] }) {
  return <section className="dashboard-activity-feed" aria-labelledby="activity-feed-heading">
    <header><DashboardIcon name="tile-activity" size={32} /><h2 id="activity-feed-heading">Letzte Aktivitäten</h2></header>
    {activities.length ? <ul>{activities.slice(0, 5).map(activity => {
      const income = activity.type === 'income';
      return <li key={`${activity.type}-${activity.id}`}><Link href={`/dashboard?tab=${income ? 'incomes' : 'expenses'}`} aria-label={`${income ? 'Einnahmen' : 'Ausgaben'} anzeigen: ${activity.description}`}>
        <span className={`activity-direction ${income ? 'text-positive bg-positive-surface' : 'text-muted-foreground bg-secondary'}`}><DashboardIcon name={income ? "nav-incomes" : "nav-expenses"} size={32} /></span>
        <span className="activity-description"><strong>{activity.description}</strong><span>{new Date(activity.date).toLocaleDateString('de-DE')} · {income ? 'Einnahme' : 'Ausgabe'}</span></span>
        <span className={`activity-amount ${income ? 'text-positive' : 'text-critical'}`}>{!income && activity.amount > 0 ? '−' : ''}{formatCurrency(activity.amount)}</span>
      </Link></li>;
    })}</ul> : <p className="p-6 text-sm text-muted-foreground">Noch keine Buchungen. Erfassen Sie Ihre erste Einnahme oder Ausgabe.</p>}
    <footer><Link href="/dashboard?tab=invoices">Rechnungen verwalten<ChevronRight aria-hidden="true" /></Link></footer>
  </section>;
}
