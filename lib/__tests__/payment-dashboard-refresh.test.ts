import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { connectPaymentRefreshBridge, notifyPaymentDashboardRefresh, PAYMENT_DASHBOARD_REFRESH_EVENT, refreshPaymentDashboardLists } from '@/lib/payment-dashboard-refresh';

describe('saved-payment dashboard refresh', () => {
  it('bridges event-only cross-tab notifications once, never rebroadcasts and releases the last browser channel', () => {
    class BrowserChannel {
      static instances: BrowserChannel[] = [];
      listener: ((event: MessageEvent) => void) | null = null;
      constructor(public name: string) { BrowserChannel.instances.push(this); }
      addEventListener = vi.fn((_type: string, listener: (event: MessageEvent) => void) => { this.listener = listener; });
      removeEventListener = vi.fn(() => { this.listener = null; });
      postMessage = vi.fn(); close = vi.fn();
      receive(data: unknown) { this.listener?.({ data } as MessageEvent); }
    }
    const dispatchEvent = vi.fn(), remoteRefresh = vi.fn();
    vi.stubGlobal('window', { dispatchEvent, BroadcastChannel: BrowserChannel });
    const first = connectPaymentRefreshBridge(remoteRefresh), second = connectPaymentRefreshBridge();
    try {
      expect(BrowserChannel.instances).toHaveLength(1);
      const bridge = BrowserChannel.instances[0];
      notifyPaymentDashboardRefresh();
      expect(dispatchEvent).toHaveBeenCalledTimes(1); expect(remoteRefresh).not.toHaveBeenCalled();
      expect(bridge.postMessage).toHaveBeenCalledExactlyOnceWith(PAYMENT_DASHBOARD_REFRESH_EVENT);
      bridge.receive(PAYMENT_DASHBOARD_REFRESH_EVENT);
      expect(remoteRefresh).toHaveBeenCalledTimes(1); expect(dispatchEvent).toHaveBeenCalledTimes(2);
      expect(bridge.postMessage).toHaveBeenCalledTimes(1);
      bridge.receive({ amount: 'must not be an event' }); expect(remoteRefresh).toHaveBeenCalledTimes(1);
      first(); expect(bridge.close).not.toHaveBeenCalled();
      second(); expect(bridge.close).toHaveBeenCalledTimes(1); expect(bridge.removeEventListener).toHaveBeenCalledTimes(1);
    } finally { first(); second(); vi.unstubAllGlobals(); }
  });
  it('does not accidentally open Node BroadcastChannel when the browser capability is absent', () => {
    const nodeChannel = vi.fn(), dispatchEvent = vi.fn();
    vi.stubGlobal('BroadcastChannel', nodeChannel); vi.stubGlobal('window', { dispatchEvent });
    const disconnect = connectPaymentRefreshBridge();
    try { notifyPaymentDashboardRefresh(); expect(nodeChannel).not.toHaveBeenCalled(); expect(dispatchEvent).toHaveBeenCalledTimes(1); }
    finally { disconnect(); vi.unstubAllGlobals(); }
  });
  it('notifies the independent KPI reader even when a query refresh fails', async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    const client = new QueryClient();
    vi.spyOn(client, 'invalidateQueries').mockRejectedValue(new Error('List refresh unavailable'));
    try {
      await expect(refreshPaymentDashboardLists(client)).rejects.toThrow('List refresh unavailable');
      expect(dispatchEvent).toHaveBeenCalledTimes(1);
      expect(dispatchEvent.mock.calls[0][0].type).toBe(PAYMENT_DASHBOARD_REFRESH_EVENT);
      const dashboard = readFileSync('components/dashboard/dashboard-client.tsx', 'utf8');
      expect(dashboard).toContain('window.addEventListener(PAYMENT_DASHBOARD_REFRESH_EVENT, refreshKpis)');
      expect(dashboard).toContain('window.removeEventListener(PAYMENT_DASHBOARD_REFRESH_EVENT, refreshKpis)');
      expect(dashboard).toContain('signal: controller.signal, cache: \'no-store\'');
      expect(dashboard).toContain('return () => controller.abort()');
    } finally { vi.unstubAllGlobals(); client.clear(); }
  });
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
    expect(reminderRefresh).toContain('notifyPaymentDashboardRefresh()');
    expect(reminderRefresh).not.toContain('POST');
  });
  it('refreshes independently mounted action/history readers with cleanup and no event data', () => {
    for (const path of ['components/daily-actions/daily-actions-workspace.tsx', 'components/history/invoice-history-workspace.tsx']) {
      const source = readFileSync(path, 'utf8');
      expect(source).toContain('window.addEventListener(PAYMENT_DASHBOARD_REFRESH_EVENT, refreshPayments)');
      expect(source).toContain('window.removeEventListener(PAYMENT_DASHBOARD_REFRESH_EVENT, refreshPayments)');
      expect(source).toContain('controller.abort()');
      expect(source).toContain("cache: 'no-store'");
    }
    const refresh = readFileSync('lib/payment-dashboard-refresh.ts', 'utf8');
    expect(refresh).toContain('new Event(PAYMENT_DASHBOARD_REFRESH_EVENT)');
    expect(refresh).not.toContain('CustomEvent');
    const hook = readFileSync('hooks/use-dashboard-data.ts', 'utf8');
    expect(hook).toContain("`/api/invoices?${invoicesQueryString}`, signal, { 'X-Bivaro-Payment-Contract': '3' }");
    expect(hook).toContain('summaryIsFetching: summaryQuery.isFetching');
  });
  it('conservatively rechecks fiscal views on focus, visible return and restored pages, even after a missed cross-tab event', () => {
    const hook = readFileSync('hooks/use-dashboard-data.ts', 'utf8'), tax = readFileSync('app/steuer-simulation/page.tsx', 'utf8');
    expect(hook).toContain('staleTime: 0'); expect(hook).toContain("refetchOnMount: 'always'");
    expect(hook).toContain('connectPaymentRefreshBridge(() =>');
    for (const event of ['focus', 'visibilitychange', 'pageshow']) {
      expect(hook).toContain(`addEventListener('${event}'`); expect(hook).toContain(`removeEventListener('${event}'`);
      expect(tax).toContain(`addEventListener('${event}'`); expect(tax).toContain(`removeEventListener('${event}'`);
    }
    expect(tax).toContain('const disconnect = connectPaymentRefreshBridge()');
    expect(tax).toContain('setSummary(null)'); expect(tax).toContain('const sourceAvailable = !loading && !error && summary !== null');
    const dashboard = readFileSync('components/dashboard/dashboard-content.tsx', 'utf8');
    expect(dashboard).toContain('summaryIsLoading || summaryIsFetching || isExportingEUR');
    expect(dashboard).toContain('summaryIsError || eurExportError || !summary');
  });
});
