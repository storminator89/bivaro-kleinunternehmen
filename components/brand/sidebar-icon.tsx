import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

export type SidebarNavIconName =
  | 'nav-dashboard' | 'nav-invoices' | 'nav-quotes' | 'nav-reminders'
  | 'nav-customers' | 'nav-incomes' | 'nav-expenses' | 'nav-cashbook'
  | 'nav-eur' | 'nav-assets' | 'nav-tax' | 'nav-settings' | 'nav-users' | 'nav-logout';

export type SidebarIconName = SidebarNavIconName | 'bivaro-sidebar';

/** Individually generated flat artwork; the adjacent label supplies its name. */
export function SidebarIcon({ name, className, size = 28 }: {
  name: SidebarIconName;
  className?: string;
  size?: number;
}) {
  return <span
    aria-hidden="true"
    className={cn('sidebar-icon', className)}
    data-bivaro-sidebar-icon={name}
    data-bivaro-style="flat"
    style={{
      '--sidebar-icon-size': `${size}px`,
      '--sidebar-icon-image': `url("/brand/icons/sidebar-flat/${name}.webp")`,
    } as CSSProperties}
  />;
}
