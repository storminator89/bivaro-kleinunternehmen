"use client";

import { useState, useEffect, useCallback } from 'react';
import { Expense, FilterState } from '@/types/dashboard';
import { toQuery } from '@/lib/dashboard-utils';

type ExpensesFilter = FilterState['expenses'];

type UseExpensesReturn = {
  expenses: Expense[];
  expensesAll: Expense[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  isLoading: boolean;
  error: string | null;
  loadExpenses: (page?: number, pageSize?: number) => Promise<void>;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  setExpenses: React.Dispatch<React.SetStateAction<Expense[]>>;
  setExpensesAll: React.Dispatch<React.SetStateAction<Expense[]>>;
  reloadAll: () => Promise<void>;
};

export function useExpenses(filters: ExpensesFilter): UseExpensesReturn {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expensesAll, setExpensesAll] = useState<Expense[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));

  const loadExpenses = useCallback(async (p = page, ps = pageSize) => {
    setIsLoading(true);
    setError(null);
    try {
      const q = toQuery({
        page: p,
        pageSize: ps,
        category: filters.category || undefined,
        dateRange: filters.dateRange !== 'all' ? filters.dateRange : undefined,
        taxRelevant: filters.taxRelevant !== 'all' ? filters.taxRelevant : undefined,
        hasReceipt: filters.hasReceipt !== 'all' ? filters.hasReceipt : undefined,
        search: filters.searchTerm || undefined,
      });
      const res = await fetch(`/api/expenses?${q}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setExpenses(data.items);
        setTotal(data.total);
        setPage(data.page);
        setPageSize(data.pageSize);
      } else {
        setError('Fehler beim Laden der Ausgaben');
      }
    } catch {
      setError('Fehler beim Laden der Ausgaben');
    } finally {
      setIsLoading(false);
    }
  }, [filters, page, pageSize]);

  const reloadAll = useCallback(async () => {
    try {
      const res = await fetch('/api/expenses?page=1&pageSize=10000', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setExpensesAll(data.items);
      }
    } catch (e) {
      console.error('Error loading all expenses:', e);
    }
  }, []);

  useEffect(() => {
    loadExpenses(1, pageSize);
    reloadAll();
  }, [loadExpenses, pageSize, reloadAll]);

  useEffect(() => {
    loadExpenses(1, pageSize);
  }, [
    loadExpenses,
    pageSize,
    filters.category,
    filters.dateRange,
    filters.taxRelevant,
    filters.hasReceipt,
    filters.searchTerm,
  ]);

  return {
    expenses,
    expensesAll,
    total,
    page,
    pageSize,
    totalPages,
    isLoading,
    error,
    loadExpenses,
    setPage,
    setPageSize,
    setExpenses,
    setExpensesAll,
    reloadAll,
  };
}
