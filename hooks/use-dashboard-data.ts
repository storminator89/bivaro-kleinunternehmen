"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Quote } from "@/components/dashboard/tabs/quotes-tab";
import { toQuery } from "@/lib/dashboard-utils";
import type { Customer, Expense, FilterState, Income, Invoice, TimeRange } from "@/types/dashboard";

type PaginatedResponse<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type DashboardTab = "expenses" | "incomes" | "invoices" | "quotes" | "eur" | "gwg" | null;

export type DashboardSummary = {
  timeRange: TimeRange;
  totalIncome: number;
  totalExpense: number;
  profit: number;
  expenseCategories: Array<{ category: string; amount: number }>;
  monthlyData: Array<{
    month: number;
    year: number;
    monthName: string;
    revenue: number;
    expenses: number;
    profit: number;
  }>;
  depreciationDetails: Array<{
    id: number;
    description: string;
    date: string;
    totalAmount: number;
    years: number;
    currentYearAmount: number;
    remainingAmount: number;
    calculationExplanation: string;
  }>;
  privateWithdrawals: number;
  privateDeposits: number;
};

type DashboardAssets = {
  items: Expense[];
  total: number;
};

type FilterOptions = {
  categories: string[];
  customers: string[];
};

type UseDashboardDataParams = {
  filters: FilterState;
  quotesStatusFilter: string;
  quotesSearchTerm: string;
  activeTab: DashboardTab;
  selectedTimeRange: TimeRange;
};

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}
function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

export function useDashboardData({
  filters,
  quotesStatusFilter,
  quotesSearchTerm,
  activeTab,
  selectedTimeRange,
}: UseDashboardDataParams) {
  const queryClient = useQueryClient();

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [assetExpenses, setAssetExpenses] = useState<Expense[]>([]);

  const [quotesTotal, setQuotesTotal] = useState(0);
  const [quotesPage, setQuotesPage] = useState(1);
  const [quotesPageSize, setQuotesPageSize] = useState(20);

  const [expensesPage, setExpensesPage] = useState(1);
  const [expensesPageSize, setExpensesPageSize] = useState(10);
  const [expensesTotal, setExpensesTotal] = useState(0);

  const [incomesPage, setIncomesPage] = useState(1);
  const [incomesPageSize, setIncomesPageSize] = useState(10);
  const [incomesTotal, setIncomesTotal] = useState(0);

  const [invoicesPage, setInvoicesPage] = useState(1);
  const [invoicesPageSize, setInvoicesPageSize] = useState(10);
  const [invoicesTotal, setInvoicesTotal] = useState(0);

  const expenseSearch = useDebouncedValue(filters.expenses.searchTerm);
  const incomeSearch = useDebouncedValue(filters.incomes.searchTerm);
  const invoiceSearch = useDebouncedValue(filters.invoices.searchTerm);
  const quotesSearch = useDebouncedValue(quotesSearchTerm);

  const expensesQueryString = toQuery({
    page: expensesPage,
    pageSize: expensesPageSize,
    category: filters.expenses.category || undefined,
    dateRange: filters.expenses.dateRange !== "all" ? filters.expenses.dateRange : undefined,
    taxRelevant: filters.expenses.taxRelevant !== "all" ? filters.expenses.taxRelevant : undefined,
    hasReceipt: filters.expenses.hasReceipt !== "all" ? filters.expenses.hasReceipt : undefined,
    search: expenseSearch || undefined,
  });
  const incomesQueryString = toQuery({
    page: incomesPage,
    pageSize: incomesPageSize,
    customer: filters.incomes.customer || undefined,
    dateRange: filters.incomes.dateRange !== "all" ? filters.incomes.dateRange : undefined,
    taxRelevant: filters.incomes.taxRelevant !== "all" ? filters.incomes.taxRelevant : undefined,
    search: incomeSearch || undefined,
  });
  const invoicesQueryString = toQuery({
    page: invoicesPage,
    pageSize: invoicesPageSize,
    paidStatus: filters.invoices.paidStatus !== "all" ? filters.invoices.paidStatus : undefined,
    dateRange: filters.invoices.dateRange !== "all" ? filters.invoices.dateRange : undefined,
    search: invoiceSearch || undefined,
  });
  const quotesQueryString = toQuery({
    page: quotesPage,
    pageSize: quotesPageSize,
    status: quotesStatusFilter && quotesStatusFilter !== "all" ? quotesStatusFilter : undefined,
    search: quotesSearch || undefined,
  });

  const expensesQuery = useQuery({
    queryKey: ["dashboard", "expenses", "list", expensesQueryString],
    queryFn: ({ signal }) => fetchJson<PaginatedResponse<Expense>>(`/api/expenses?${expensesQueryString}`, signal),
    enabled: activeTab === "expenses",
  });
  const incomesQuery = useQuery({
    queryKey: ["dashboard", "incomes", "list", incomesQueryString],
    queryFn: ({ signal }) => fetchJson<PaginatedResponse<Income>>(`/api/incomes?${incomesQueryString}`, signal),
    enabled: activeTab === "incomes",
  });
  const invoicesQuery = useQuery({
    queryKey: ["dashboard", "invoices", "list", invoicesQueryString],
    queryFn: ({ signal }) => fetchJson<PaginatedResponse<Invoice>>(`/api/invoices?${invoicesQueryString}`, signal),
    enabled: activeTab === "invoices",
  });
  const quotesQuery = useQuery({
    queryKey: ["dashboard", "quotes", "list", quotesQueryString],
    queryFn: ({ signal }) => fetchJson<PaginatedResponse<Quote>>(`/api/quotes?${quotesQueryString}`, signal),
    enabled: activeTab === "quotes",
  });
  const customersQuery = useQuery({
    queryKey: ["dashboard", "customers"],
    queryFn: ({ signal }) => fetchJson<Customer[]>("/api/customers", signal),
    enabled: activeTab === "incomes",
  });
  const filterOptionsQuery = useQuery({
    queryKey: ["dashboard", "filter-options"],
    queryFn: ({ signal }) => fetchJson<FilterOptions>("/api/dashboard/filter-options", signal),
    enabled: activeTab === "expenses" || activeTab === "incomes",
  });
  const summaryQuery = useQuery({
    queryKey: ["dashboard", "summary", selectedTimeRange],
    queryFn: ({ signal }) => fetchJson<DashboardSummary>(
      `/api/dashboard/summary?timeRange=${encodeURIComponent(selectedTimeRange)}`,
      signal,
    ),
    enabled: activeTab === "eur",
  });
  const assetsQuery = useQuery({
    queryKey: ["dashboard", "assets", "gwg", selectedTimeRange],
    queryFn: ({ signal }) => fetchJson<DashboardAssets>(
      `/api/dashboard/assets?kind=gwg&timeRange=${encodeURIComponent(selectedTimeRange)}`,
      signal,
    ),
    enabled: activeTab === "gwg",
  });

  useEffect(() => {
    if (!expensesQuery.data) return;
    setExpenses(expensesQuery.data.items);
    setExpensesTotal(expensesQuery.data.total);
    setExpensesPage(expensesQuery.data.page);
    setExpensesPageSize(expensesQuery.data.pageSize);
  }, [expensesQuery.data]);

  useEffect(() => {
    if (!incomesQuery.data) return;
    setIncomes(incomesQuery.data.items);
    setIncomesTotal(incomesQuery.data.total);
    setIncomesPage(incomesQuery.data.page);
    setIncomesPageSize(incomesQuery.data.pageSize);
  }, [incomesQuery.data]);

  useEffect(() => {
    if (!invoicesQuery.data) return;
    setInvoices(invoicesQuery.data.items);
    setInvoicesTotal(invoicesQuery.data.total);
    setInvoicesPage(invoicesQuery.data.page);
    setInvoicesPageSize(invoicesQuery.data.pageSize);
  }, [invoicesQuery.data]);

  useEffect(() => {
    if (!quotesQuery.data) return;
    setQuotes(quotesQuery.data.items);
    setQuotesTotal(quotesQuery.data.total);
    setQuotesPage(quotesQuery.data.page);
    setQuotesPageSize(quotesQuery.data.pageSize);
  }, [quotesQuery.data]);

  useEffect(() => {
    if (customersQuery.data) setCustomers(customersQuery.data);
  }, [customersQuery.data]);

  useEffect(() => {
    if (assetsQuery.data) setAssetExpenses(assetsQuery.data.items);
  }, [assetsQuery.data]);

  useEffect(() => {
    setExpensesPage(1);
  }, [
    filters.expenses.category,
    filters.expenses.dateRange,
    filters.expenses.taxRelevant,
    filters.expenses.hasReceipt,
    filters.expenses.searchTerm,
  ]);

  useEffect(() => {
    setIncomesPage(1);
  }, [
    filters.incomes.customer,
    filters.incomes.dateRange,
    filters.incomes.taxRelevant,
    filters.incomes.searchTerm,
  ]);

  useEffect(() => {
    setInvoicesPage(1);
  }, [
    filters.invoices.paidStatus,
    filters.invoices.dateRange,
    filters.invoices.searchTerm,
  ]);

  useEffect(() => {
    setQuotesPage(1);
  }, [quotesStatusFilter, quotesSearchTerm]);

  async function invalidateDashboardQueries(resource: "expenses" | "incomes" | "invoices" | "quotes") {
    const invalidations: Array<Promise<unknown>> = [
      queryClient.invalidateQueries({ queryKey: ["dashboard", resource] }),
    ];
    if (resource === "expenses" || resource === "incomes" || resource === "invoices") {
      invalidations.push(queryClient.invalidateQueries({ queryKey: ["dashboard", "summary"] }));
      invalidations.push(queryClient.invalidateQueries({ queryKey: ["dashboard", "assets"] }));
    }
    if (resource === "expenses" || resource === "incomes") {
      invalidations.push(queryClient.invalidateQueries({ queryKey: ["dashboard", "filter-options"] }));
    }
    await Promise.all(invalidations);
  }

  async function loadExpenses(page = expensesPage, pageSize = expensesPageSize) {
    setExpensesPage(page);
    setExpensesPageSize(pageSize);
    await invalidateDashboardQueries("expenses");
  }

  async function loadIncomes(page = incomesPage, pageSize = incomesPageSize) {
    setIncomesPage(page);
    setIncomesPageSize(pageSize);
    await invalidateDashboardQueries("incomes");
  }

  async function loadInvoices(page = invoicesPage, pageSize = invoicesPageSize) {
    setInvoicesPage(page);
    setInvoicesPageSize(pageSize);
    await invalidateDashboardQueries("invoices");
  }

  async function loadQuotes(page = quotesPage, pageSize = quotesPageSize) {
    setQuotesPage(page);
    setQuotesPageSize(pageSize);
    await invalidateDashboardQueries("quotes");
  }

  const expensesTotalPages = Math.max(1, Math.ceil(expensesTotal / Math.max(1, expensesPageSize)));
  const incomesTotalPages = Math.max(1, Math.ceil(incomesTotal / Math.max(1, incomesPageSize)));
  const invoicesTotalPages = Math.max(1, Math.ceil(invoicesTotal / Math.max(1, invoicesPageSize)));
  const quotesTotalPages = Math.max(1, Math.ceil(quotesTotal / Math.max(1, quotesPageSize)));
  const uniqueCategories = filterOptionsQuery.data?.categories ?? [];
  const uniqueCustomers = filterOptionsQuery.data?.customers ?? [];

  return {
    expenses,
    incomes,
    invoices,
    customers,
    quotes,
    assetExpenses,
    summary: summaryQuery.data,
    summaryIsLoading: summaryQuery.isLoading,
    summaryIsError: summaryQuery.isError,
    summaryError: summaryQuery.error,
    assetsIsLoading: assetsQuery.isLoading,
    assetsIsError: assetsQuery.isError,
    assetsError: assetsQuery.error,
    uniqueCategories,
    uniqueCustomers,
    expensesPage,
    expensesPageSize,
    expensesTotal,
    expensesTotalPages,
    incomesPage,
    incomesPageSize,
    incomesTotal,
    incomesTotalPages,
    invoicesPage,
    invoicesPageSize,
    invoicesTotal,
    invoicesTotalPages,
    quotesPage,
    quotesPageSize,
    quotesTotal,
    quotesTotalPages,
    setExpensesPage,
    setExpensesPageSize,
    setIncomesPage,
    setIncomesPageSize,
    setInvoicesPage,
    setInvoicesPageSize,
    setQuotesPage,
    setQuotesPageSize,
    loadExpenses,
    loadIncomes,
    loadInvoices,
    loadQuotes,
  };
}
