import type { ReactNode } from 'react';

/** Presentation only: each slot keeps its own data, state and action owner. */
export function DashboardOverview({ summary, tasks, analysis, showDataNote = false }: {
  summary: ReactNode;
  tasks: ReactNode;
  analysis?: ReactNode;
  showDataNote?: boolean;
}) {
  return <div className="dashboard-layout">
    {summary}
    {showDataNote && <p role="note" className="text-xs text-muted-foreground">Zahlungsübersicht · steuerlich ungeprüft.</p>}
    <div className={`dashboard-overview-grid${analysis ? '' : ' dashboard-overview-grid-tasks-only'}`}>
      <div className="dashboard-overview-actions">{tasks}</div>
      {analysis && <div className="dashboard-overview-analysis">{analysis}</div>}
    </div>
  </div>;
}
