import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

const dashboardIcons = {
  'tile-incomes': 'incomes',
  'tile-expenses': 'expenses',
  'tile-profit': 'profit',
  'tile-open-invoices': 'open-invoices',
  'tile-year-comparison': 'year-comparison',
  'tile-activity': 'activity',
  'tile-limits': 'limits',
  'invoice-import': 'import',
  'invoice-document': 'document',
  'nav-invoices': 'document',
  'nav-quotes': 'proposal',
  'nav-incomes': 'incomes',
  'nav-expenses': 'expenses',
  'nav-cashbook': 'ledger',
  'nav-assets': 'inventory',
} as const;

export type DashboardIconName = keyof typeof dashboardIcons;

/** Generated silhouettes inherit one quiet, theme-aware ink color. */
export function DashboardIcon({ name, className, size = 28 }: {
  name: DashboardIconName;
  className?: string;
  size?: number;
}) {
  const dimension = Math.min(size, 32);
  return <span
    aria-hidden="true"
    className={cn('dashboard-icon', className)}
    data-bivaro-icon={name}
    data-bivaro-style="flat"
    style={{
      width: dimension,
      height: dimension,
      '--dashboard-icon-image': `url("/brand/icons/flat/${dashboardIcons[name]}.webp")`,
    } as CSSProperties}
  />;
}
