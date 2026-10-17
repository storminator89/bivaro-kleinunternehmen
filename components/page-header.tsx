import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Shared page hierarchy; actions keep their existing handlers and permissions. */
export function PageHeader({ title, description, section, date, actions, className }: {
  title: string;
  description: string;
  section?: string;
  date?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('workbench-header page-header', className)}>
      <div className="min-w-0">
        {(section || date) && <div className="page-header-meta">{section && <p className="app-section-label">{section}</p>}{date}</div>}
        <h1>{title}</h1>
        <p className="page-header-description">{description}</p>
      </div>
      {actions && <div className="workbench-actions flex flex-wrap items-center gap-2" aria-label="Seitenaktionen">{actions}</div>}
    </header>
  );
}
