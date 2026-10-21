import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { refreshPaymentDashboardLists } from '@/lib/payment-dashboard-refresh';

describe('saved-payment dashboard refresh', () => {
  it.each(['invoices', 'incomes', 'summary'])('propagates an active %s refetch failure and retries reads only', async resource => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const queryKey = ['dashboard', resource];
    const fetchList = vi.fn().mockRejectedValueOnce(new Error('Refresh unavailable')).mockResolvedValueOnce({ items: ['saved-payment'] });
    client.setQueryData(queryKey, { items: ['stale'] });
    const observer = new QueryObserver(client, { queryKey, queryFn: fetchList });
    const unsubscribe = observer.subscribe(() => {});
    try {
      // This rejection was previously swallowed by invalidateQueries defaults.
      await expect(refreshPaymentDashboardLists(client)).rejects.toThrow('Refresh unavailable');
      expect(fetchList).toHaveBeenCalledTimes(1);
      await expect(refreshPaymentDashboardLists(client)).resolves.toBeUndefined();
      expect(fetchList).toHaveBeenCalledTimes(2);
      expect(client.getQueryData(queryKey)).toEqual({ items: ['saved-payment'] });
    } finally { unsubscribe(); client.clear(); }
  });

  it('invalidates inactive invoice/Income lists without an eager fetch and keeps unrelated expenses untouched', async () => {
    const client = new QueryClient();
    const resources = ['invoices', 'incomes', 'summary', 'assets', 'year-comparison', 'filter-options', 'reminders'];
    resources.forEach(resource => client.setQueryData(['dashboard', resource], { previous: true }));
    client.setQueryData(['dashboard', 'expenses'], { previous: true });
    try {
      await refreshPaymentDashboardLists(client);
      resources.forEach(resource => expect(client.getQueryState(['dashboard', resource])?.isInvalidated).toBe(true));
      expect(client.getQueryState(['dashboard', 'expenses'])?.isInvalidated).toBe(false);
    } finally { client.clear(); }
  });

  it('wires the strict refresh only to saved-payment success and retains a separate read-only retry', () => {
    const dashboard = readFileSync('components/dashboard/dashboard-content.tsx', 'utf8');
    const dialog = readFileSync('components/dashboard/full-payment-dialog.tsx', 'utf8');
    const reminders = readFileSync('app/dashboard/reminders/page.tsx', 'utf8');
    expect(dashboard).toContain('onSuccess={refreshPaymentLists}');
    expect(dialog).toContain('Die Zahlung ist gespeichert, aber die Listen konnten nicht aktualisiert werden. Nicht erneut buchen.');
    expect(dialog).toContain('onClick={() => void refreshLists()}>Listen aktualisieren');
    const refreshOnly = dialog.slice(dialog.indexOf('const refreshLists ='), dialog.indexOf('const close ='));
    expect(refreshOnly).toContain('await onSuccess()');
    expect(refreshOnly).toContain('setRefreshError(true)');
    expect(refreshOnly).not.toContain('POST');
    const reminderRefresh = reminders.slice(reminders.indexOf('const handlePaymentSuccess ='), reminders.indexOf('const handleDeleteReminder ='));
    expect(reminderRefresh).toContain("fetch('/api/reminders?includeAll=true', { cache: 'no-store' })");
    expect(reminderRefresh).toContain('if (!response.ok) throw');
    expect(reminderRefresh).not.toContain('POST');
  });
});
