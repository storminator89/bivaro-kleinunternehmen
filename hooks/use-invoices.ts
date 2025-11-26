"use client";

import { useState, useEffect, useCallback } from 'react';
import { Invoice, FilterState } from '@/types/dashboard';
import { toQuery } from '@/lib/dashboard-utils';

type InvoicesFilter = FilterState['invoices'];

type UseInvoicesReturn = {
  invoices: Invoice[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  isLoading: boolean;
  error: string | null;
  loadInvoices: (page?: number, pageSize?: number) => Promise<void>;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  setInvoices: React.Dispatch<React.SetStateAction<Invoice[]>>;
};

export function useInvoices(filters: InvoicesFilter): UseInvoicesReturn {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));

  const loadInvoices = useCallback(async (p = page, ps = pageSize) => {
    setIsLoading(true);
    setError(null);
    try {
      const q = toQuery({
        page: p,
        pageSize: ps,
        paidStatus: filters.paidStatus !== 'all' ? filters.paidStatus : undefined,
        dateRange: filters.dateRange !== 'all' ? filters.dateRange : undefined,
        search: filters.searchTerm || undefined,
      });
      const res = await fetch(`/api/invoices?${q}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setInvoices(data.items);
        setTotal(data.total);
        setPage(data.page);
        setPageSize(data.pageSize);
      } else {
        setError('Fehler beim Laden der Rechnungen');
      }
    } catch (e) {
      setError('Fehler beim Laden der Rechnungen');
    } finally {
      setIsLoading(false);
    }
  }, [filters, page, pageSize]);

  // Initial load
  useEffect(() => {
    loadInvoices(1, pageSize);
  }, []);

  // Reload when filters change
  useEffect(() => {
    loadInvoices(1, pageSize);
  }, [
    filters.paidStatus,
    filters.dateRange,
    filters.searchTerm,
  ]);

  return {
    invoices,
    total,
    page,
    pageSize,
    totalPages,
    isLoading,
    error,
    loadInvoices,
    setPage,
    setPageSize,
    setInvoices,
  };
}
