"use client";

import { useState, useEffect, useCallback } from 'react';
import { Customer } from '@/types/dashboard';

type UseCustomersReturn = {
  customers: Customer[];
  isLoading: boolean;
  error: string | null;
  loadCustomers: () => Promise<void>;
};

export function useCustomers(): UseCustomersReturn {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCustomers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/customers', { cache: 'no-store' });
      if (res.ok) {
        setCustomers(await res.json());
      } else {
        setError('Fehler beim Laden der Kunden');
      }
    } catch (e) {
      setError('Fehler beim Laden der Kunden');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  return {
    customers,
    isLoading,
    error,
    loadCustomers,
  };
}
