import { createElement, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ cursor: 0, data: null as object | null, error: null as string | null, loading: true }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: () => [[state.data, state.error, state.loading, 0, null][state.cursor++], vi.fn()],
    useEffect: vi.fn(),
  };
});
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined, isFetching: false, isError: false, refetch: vi.fn() }) }));

import { DashboardClient } from '@/components/dashboard/dashboard-client';
import { DashboardOverview } from '@/components/dashboard/dashboard-overview';
import { DashboardHeader } from '@/components/dashboard/dashboard-header';
import { DashboardActivityFeed } from '@/components/dashboard/dashboard-activity-feed';

beforeEach(() => { state.cursor = 0; state.data = null; state.error = null; state.loading = true; });

describe('KPI client presentation slots', () => {
  it.each(['loading', 'error', 'full'])('passes the same independent task element through the %s state', mode => {
    const tasks = createElement('section', { id: 'independent-tasks' }, 'Nächste Schritte');
    state.loading = mode === 'loading';
    state.error = mode === 'error' ? 'Auswertung nicht verfügbar.' : null;
    const data = { revenueThisMonth: 0, revenueThisYear: 120, expensesThisMonth: 0, openInvoices: 80, totalRevenue: 120, totalExpenses: 20, recentActivities: [] };
    state.data = mode === 'full' ? data : null;
    const view = DashboardClient({ tasks });
    expect(view.type).toBe(DashboardOverview);
    expect(view.props.tasks).toBe(tasks);
    if (mode === 'full') {
      const summary = view.props.summary as ReactElement<{ data: object }>;
      expect(summary.type).toBe(DashboardHeader);
      expect(summary.props.data).toBe(data);
      expect(view.props.showDataNote).toBe(true);
      const analysis = view.props.analysis as ReactElement<{ children: ReactElement<{ activities: unknown }>[] }>;
      expect(analysis.props.children[1].type).toBe(DashboardActivityFeed);
      expect(analysis.props.children[1].props.activities).toBe(data.recentActivities);
    } else {
      expect((view.props.summary as ReactElement<Record<string, unknown>>).props.role).toBe(mode === 'loading' ? 'status' : 'alert');
      expect(view.props.showDataNote).not.toBe(true);
    }
  });
});
