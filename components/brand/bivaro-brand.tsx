import { BivaroIcon } from './bivaro-icon';
import { SidebarIcon } from './sidebar-icon';
import { cn } from '@/lib/utils';

export function BivaroBrand({ compact = false, className, surface = 'default' }: { compact?: boolean; className?: string; surface?: 'default' | 'sidebar' }) {
  return <span className={cn('bivaro-brand', compact && 'bivaro-brand-compact', className)}>
    {surface === 'sidebar' ? <SidebarIcon name="bivaro-sidebar" size={40} /> : <BivaroIcon name="bivaro-app" size={40} />}
    <span className={compact ? 'sr-only' : 'bivaro-wordmark'}>BIVARO</span>
  </span>;
}
