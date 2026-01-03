"use client";

import { useState, useEffect, useCallback } from 'react';
import { Income, FilterState } from '@/types/dashboard';
import { toQuery } from '@/lib/dashboard-utils';

type IncomesFilter = FilterState['incomes'];

type UseIncomesReturn = {
  incomes: Income[];
  incomesAll: Income[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  isLoading: boolean;
  error: string | null;
  loadIncomes: (page?: number, pageSize?: number) => Promise<void>;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  setIncomes: React.Dispatch<React.SetStateAction<Income[]>>;
  setIncomesAll: React.Dispatch<React.SetStateAction<Income[]>>;
  reloadAll: () => Promise<void>;
};

export function useIncomes(filters: IncomesFilter): UseIncomesReturn {
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [incomesAll, setIncomesAll] = useState<Income[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));

  const loadIncomes = useCallback(async (p = page, ps = pageSize) => {
    setIsLoading(true);
    setError(null);
    try {
      const q = toQuery({
        page: p,
        pageSize: ps,
        customer: filters.customer || undefined,
        dateRange: filters.dateRange !== 'all' ? filters.dateRange : undefined,
        taxRelevant: filters.taxRelevant !== 'all' ? filters.taxRelevant : undefined,
        search: filters.searchTerm || undefined,
      });
      const res = await fetch(`/api/incomes?${q}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setIncomes(data.items);
        setTotal(data.total);
        setPage(data.page);
        setPageSize(data.pageSize);
      } else {
        setError('Fehler beim Laden der Einnahmen');
      }
    } catch {
      setError('Fehler beim Laden der Einnahmen');
    } finally {
      setIsLoading(false);
    }
  }, [filters, page, pageSize]);

  const reloadAll = useCallback(async () => {
    try {
      const res = await fetch('/api/incomes?page=1&pageSize=10000', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setIncomesAll(data.items);
      }
    } catch (e) {
      console.error('Error loading all incomes:', e);
    }
  }, []);

  useEffect(() => {
    loadIncomes(1, pageSize);
    reloadAll();
  }, [loadIncomes, pageSize, reloadAll]);

  useEffect(() => {
    loadIncomes(1, pageSize);
  }, [
    loadIncomes,
    pageSize,
    filters.customer,
    filters.dateRange,
    filters.taxRelevant,
    filters.searchTerm,
  ]);

  return {
    incomes,
    incomesAll,
    total,
    page,
    pageSize,
    totalPages,
    isLoading,
    error,
    loadIncomes,
    setPage,
    setPageSize,
    setIncomes,
    setIncomesAll,
    reloadAll,
  };
}
