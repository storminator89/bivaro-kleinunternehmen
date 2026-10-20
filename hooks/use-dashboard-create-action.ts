"use client";

import { useEffect } from 'react';

type CreateActionOptions = {
  searchParams: Pick<URLSearchParams, 'get' | 'toString'>;
  requestedTab: string;
  activeTab: string;
  router: { replace: (href: string, options?: { scroll: boolean }) => void };
  expenseEntryOpen: boolean;
  incomeEntryOpen: boolean;
  setExpenseEntryOpen: (open: boolean) => void;
  setIncomeEntryOpen: (open: boolean) => void;
};

/** Execute a palette deep link only after the requested entry panel is mounted and open. */
export function useDashboardCreateAction({
  searchParams, requestedTab, activeTab, router,
  expenseEntryOpen, incomeEntryOpen, setExpenseEntryOpen, setIncomeEntryOpen,
}: CreateActionOptions) {
  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('new');

    if (requestedTab === 'invoices' || requestedTab === 'quotes') {
      nextParams.delete('tab');
      const query = nextParams.toString();
      router.replace(`/dashboard/${requestedTab}/new${query ? `?${query}` : ''}${window.location.hash}`);
      return;
    }

    if (activeTab !== requestedTab) return;
    if (requestedTab === 'expenses') {
      if (!expenseEntryOpen) {
        setExpenseEntryOpen(true);
        return;
      }
    } else if (requestedTab === 'incomes') {
      if (!incomeEntryOpen) {
        setIncomeEntryOpen(true);
        return;
      }
    } else {
      return;
    }

    const timer = window.setTimeout(() => {
      const input = document.getElementById(requestedTab === 'incomes' ? 'incomeDescription' : 'description');
      if (!input) return;
      input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      input.focus({ preventScroll: true });
      if (document.activeElement !== input) return;

      const query = nextParams.toString();
      router.replace(`/dashboard${query ? `?${query}` : ''}${window.location.hash}`, { scroll: false });
    }, 0);

    // Do not steal focus or overwrite a newer URL when the user navigates away.
    return () => window.clearTimeout(timer);
  }, [searchParams, requestedTab, activeTab, router, expenseEntryOpen, incomeEntryOpen,
    setExpenseEntryOpen, setIncomeEntryOpen]);
}
