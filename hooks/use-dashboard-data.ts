"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Quote } from "@/components/dashboard/tabs/quotes-tab";
import { toQuery } from "@/lib/dashboard-utils";
import type { Customer, Expense, FilterState, Income, Invoice } from "@/types/dashboard";

type PaginatedResponse<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

type UseDashboardDataParams = {
  filters: FilterState;
  quotesStatusFilter: string;
  quotesSearchTerm: string;
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

export function useDashboardData({
  filters,
  quotesStatusFilter,
  quotesSearchTerm,
}: UseDashboardDataParams) {
  const queryClient = useQueryClient();

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);

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

  const [expensesAll, setExpensesAll] = useState<Expense[]>([]);
  const [incomesAll, setIncomesAll] = useState<Income[]>([]);

  const expensesQueryString = toQuery({
    page: expensesPage,
    pageSize: expensesPageSize,
    category: filters.expenses.category || undefined,
    dateRange: filters.expenses.dateRange !== "all" ? filters.expenses.dateRange : undefined,
    taxRelevant: filters.expenses.taxRelevant !== "all" ? filters.expenses.taxRelevant : undefined,
    hasReceipt: filters.expenses.hasReceipt !== "all" ? filters.expenses.hasReceipt : undefined,
    search: filters.expenses.searchTerm || undefined,
  });
  const incomesQueryString = toQuery({
    page: incomesPage,
    pageSize: incomesPageSize,
    customer: filters.incomes.customer || undefined,
    dateRange: filters.incomes.dateRange !== "all" ? filters.incomes.dateRange : undefined,
    taxRelevant: filters.incomes.taxRelevant !== "all" ? filters.incomes.taxRelevant : undefined,
    search: filters.incomes.searchTerm || undefined,
  });
  const invoicesQueryString = toQuery({
    page: invoicesPage,
    pageSize: invoicesPageSize,
    paidStatus: filters.invoices.paidStatus !== "all" ? filters.invoices.paidStatus : undefined,
    dateRange: filters.invoices.dateRange !== "all" ? filters.invoices.dateRange : undefined,
    search: filters.invoices.searchTerm || undefined,
  });
  const quotesQueryString = toQuery({
    page: quotesPage,
    pageSize: quotesPageSize,
    status: quotesStatusFilter && quotesStatusFilter !== "all" ? quotesStatusFilter : undefined,
    search: quotesSearchTerm || undefined,
  });

  const expensesQuery = useQuery({
    queryKey: ["dashboard", "expenses", "list", expensesQueryString],
    queryFn: () => fetchJson<PaginatedResponse<Expense>>(`/api/expenses?${expensesQueryString}`),
  });
  const incomesQuery = useQuery({
    queryKey: ["dashboard", "incomes", "list", incomesQueryString],
    queryFn: () => fetchJson<PaginatedResponse<Income>>(`/api/incomes?${incomesQueryString}`),
  });
  const invoicesQuery = useQuery({
    queryKey: ["dashboard", "invoices", "list", invoicesQueryString],
    queryFn: () => fetchJson<PaginatedResponse<Invoice>>(`/api/invoices?${invoicesQueryString}`),
  });
  const quotesQuery = useQuery({
    queryKey: ["dashboard", "quotes", "list", quotesQueryString],
    queryFn: () => fetchJson<PaginatedResponse<Quote>>(`/api/quotes?${quotesQueryString}`),
  });
  const expensesAllQuery = useQuery({
    queryKey: ["dashboard", "expenses", "all"],
    queryFn: () => fetchJson<PaginatedResponse<Expense>>("/api/expenses?page=1&pageSize=10000"),
  });
  const incomesAllQuery = useQuery({
    queryKey: ["dashboard", "incomes", "all"],
    queryFn: () => fetchJson<PaginatedResponse<Income>>("/api/incomes?page=1&pageSize=10000"),
  });
  const customersQuery = useQuery({
    queryKey: ["dashboard", "customers"],
    queryFn: () => fetchJson<Customer[]>("/api/customers"),
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
    if (expensesAllQuery.data) setExpensesAll(expensesAllQuery.data.items);
  }, [expensesAllQuery.data]);

  useEffect(() => {
    if (incomesAllQuery.data) setIncomesAll(incomesAllQuery.data.items);
  }, [incomesAllQuery.data]);

  useEffect(() => {
    if (customersQuery.data) setCustomers(customersQuery.data);
  }, [customersQuery.data]);

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
    await queryClient.invalidateQueries({ queryKey: ["dashboard", resource] });
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
  const uniqueCategories = Array.from(new Set(expensesAll.map(expense => expense.category || "Sonstiges")));
  const uniqueCustomers = Array.from(new Set(incomesAll.map(income => income.customerName || "").filter(Boolean)));

  return {
    expenses,
    incomes,
    invoices,
    customers,
    quotes,
    expensesAll,
    incomesAll,
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
