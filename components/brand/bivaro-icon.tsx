import Image from 'next/image';
import { cn } from '@/lib/utils';

export type BivaroIconName =
  | 'bivaro-app'
  | 'bivaro-sidebar-flat'
  | 'nav-dashboard' | 'nav-invoices' | 'nav-quotes' | 'nav-reminders'
  | 'nav-customers' | 'nav-incomes' | 'nav-expenses' | 'nav-cashbook'
  | 'nav-eur' | 'nav-assets' | 'nav-tax' | 'nav-settings' | 'nav-users' | 'nav-logout'
  | 'tile-incomes' | 'tile-expenses' | 'tile-profit' | 'tile-open-invoices'
  | 'tile-year-comparison' | 'tile-activity' | 'tile-limits'
  | 'invoice-import' | 'invoice-document';

/** Decorative artwork: the adjacent label supplies the accessible name. */
export function BivaroIcon({ name, className, size = 32 }: {
  name: BivaroIconName;
  className?: string;
  size?: number;
}) {
  return <Image
    src={`/brand/icons/${name}.webp`}
    alt=""
    aria-hidden="true"
    width={size}
    height={size}
    className={cn('bivaro-icon', className)}
    data-bivaro-icon={name}
    draggable={false}
    unoptimized
  />;
}
