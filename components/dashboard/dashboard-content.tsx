"use client";

import Link from "next/link";
import { DailyActionsPanel } from "@/components/daily-actions/daily-actions-workspace";
import { PageHeader } from "@/components/page-header";
import { GettingStarted } from "@/components/onboarding/getting-started";
import { toast } from 'sonner';
import { useSession } from "next-auth/react";
import { reviewSessionKey } from "@/components/purchases/incoming-review-history";
import { useReviewNavigation } from "@/components/purchases/use-review-navigation";
import React, { useEffect, useState } from 'react';
import { Plus, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSearchParams, useRouter } from 'next/navigation';
import { DashboardClient } from "@/components/dashboard/dashboard-client";
import { CreateInvoiceModal } from "@/components/dashboard/create-invoice-modal";
import { QuotesTab, Quote } from "@/components/dashboard/tabs/quotes-tab";

// Importiere extrahierte Komponenten und Typen
import {
  EditModal,
  InvoiceDetailsModal,
  ReceiptModal,
  DeleteConfirmationModal,
  CreditNoteModal
} from "@/components/dashboard/modals";
import { RecurringExpensesModal } from "@/components/dashboard/modals/recurring-expenses-modal";
import { protectedManualRecordState } from "@/components/manual-financial-records/manual-record-client";
import { ManualRecordDialog } from "@/components/manual-financial-records/manual-record-dialog";
import type { ManualRecordOpener } from "@/components/manual-financial-records/manual-record-status";
import type { ManualFinancialRecordState, ManualFinancialRecordDto } from "@/lib/manual-financial-record-contract";
import { FullPaymentDialog } from "@/components/dashboard/full-payment-dialog";
import {
  Expense,
  Income,
  Invoice,
  FilterState,
  DashboardEditData
} from "@/types/dashboard";
import { toQuery } from "@/lib/dashboard-utils";
import { formatBusinessDate, formatLocalBusinessDate } from "@/lib/business-date";
import { EURTab, GWGTab, ExpensesTab, IncomesTab, InvoicesTab } from "@/components/dashboard/tabs";
import { useDashboardData } from "@/hooks/use-dashboard-data";
import type { DashboardTab } from "@/hooks/use-dashboard-data";
import { useDashboardCreateAction } from "@/hooks/use-dashboard-create-action";
import { buildEURCSVFromFreshSummary } from "@/lib/eur-csv-export";
import { useInvoiceDetailSelection } from '@/hooks/use-invoice-detail-selection';
import { useManualEntrySubmission } from '@/hooks/use-manual-entry-submission';
import { manualEntryOutcome } from '@/lib/manual-entry-submission';

export function DashboardContent() {
  const { data: dashboardSession, status: dashboardSessionStatus } = useSession();
  const dashboardSessionKey = reviewSessionKey(dashboardSession, dashboardSessionStatus);
  const requestReviewNavigation = useReviewNavigation();
  // URL-Parameter für Tab-Auswahl
  const searchParams = useSearchParams();
  const router = useRouter();
  const tabParam = searchParams.get('tab');

  // State Definitionen
  const quotesStatusFilter = searchParams.get('quoteStatus') || 'all';
  const quotesSearchTerm = searchParams.get('quoteSearch') || '';
  function updateQuoteFilter(key: 'quoteStatus' | 'quoteSearch', value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (!value || value === 'all') params.delete(key); else params.set(key, value);
    const url = `${window.location.pathname}?${params.toString()}`;
    if (key === 'quoteSearch') router.replace(url, { scroll: false }); else router.push(url, { scroll: false });
  }
  const setQuotesStatusFilter = (value: string) => updateQuoteFilter('quoteStatus', value);
  const setQuotesSearchTerm = (value: string) => updateQuoteFilter('quoteSearch', value);

  // Tabs-State - Tab-Namen normalisieren (income -> incomes)
  const normalizeTab = (tab: string | null) => {
    if (tab === 'income') return 'incomes';
    if (tab === 'expenses' || tab === 'incomes' || tab === 'invoices' || tab === 'quotes' || tab === 'eur' || tab === 'gwg') return tab;
    return 'expenses';
  };

  const [activeTab, setActiveTab] = useState(normalizeTab(tabParam));

  // URL-Änderungen verfolgen und Tab aktualisieren
  useEffect(() => {
    const newTab = normalizeTab(tabParam);
    if (newTab !== activeTab) {
      setActiveTab(newTab);
    }
  }, [tabParam, activeTab]);

  const [manualSelection, setManualSelection] = useState<{ kind: 'income' | 'expense'; id: number; opener: HTMLButtonElement; sessionKey: string } | null>(null);
  const [manualCache, setManualCache] = useState<{ sessionKey: string; states: Record<string, ManualFinancialRecordState> }>({ sessionKey: dashboardSessionKey, states: {} });
  const manualOverrides = manualCache.sessionKey === dashboardSessionKey ? manualCache.states : {};
  const openManualRecord: ManualRecordOpener = (kind, id, opener) => setManualSelection({ kind, id, opener, sessionKey: dashboardSessionKey });
  const observeManualRecord = (record: ManualFinancialRecordDto) => {
    if (manualSelection?.sessionKey !== dashboardSessionKey || record.state !== 'FINALIZED') return;
    setManualCache(current => ({ sessionKey: dashboardSessionKey, states: { ...(current.sessionKey === dashboardSessionKey ? current.states : {}), [`${record.kind}:${record.id}`]: record.state } }));
  };
  // Modal States
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editType, setEditType] = useState<'expense' | 'income'>('expense');
  const [itemToEdit, setItemToEdit] = useState<DashboardEditData | null>(null);
  const [invoiceDetailsModalOpen, setInvoiceDetailsModalOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useInvoiceDetailSelection();
  const [invoiceToPay, setInvoiceToPay] = useState<Pick<Invoice, 'id' | 'invoiceNumber' | 'fileName'> | null>(null);
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [selectedReceiptUrl, setSelectedReceiptUrl] = useState<string | null>(null);
  const [_error, _setError] = useState<string | null>(null);
  const [_showCashCountModal, _setShowCashCountModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isExportingReceipts, setIsExportingReceipts] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isExportingIncomeDocuments, setIsExportingIncomeDocuments] = useState(false);
  const [incomeExportError, setIncomeExportError] = useState<string | null>(null);
  const [isExportingEUR, setIsExportingEUR] = useState(false);
  const [eurExportError, setEURExportError] = useState<string | null>(null);
  const eurExportInFlight = React.useRef(false);
  const [selectedTimeRange, setSelectedTimeRange] = useState<'all' | 'last3Months' | 'last6Months' | 'thisYear' | 'lastYear'>('thisYear');
  const currentEURRange = React.useRef(selectedTimeRange);
  const currentEURView = React.useRef(tabParam);
  currentEURRange.current = selectedTimeRange;
  currentEURView.current = tabParam;
  useEffect(() => () => { currentEURView.current = null; }, []);
  useEffect(() => { setEURExportError(null); }, [selectedTimeRange]);
  const [recurringExpensesModalOpen, setRecurringExpensesModalOpen] = useState(false);

  // Delete Modal State
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{ id: number; type: 'expense' | 'income' | 'invoice' } | null>(null);
  const [createInvoiceModalOpen, setCreateInvoiceModalOpen] = useState(false);
  const [fromQuote, setFromQuote] = useState<Quote | null>(null);

  // Credit Note Modal State
  const [creditNoteModalOpen, setCreditNoteModalOpen] = useState(false);
  const [invoiceToCancel, setInvoiceToCancel] = useState<Invoice | null>(null);

  // Filter States
  const [filters, setFilters] = useState<FilterState>({
    expenses: {
      category: '',
      dateRange: 'all',
      taxRelevant: 'all',
      hasReceipt: 'all',
      searchTerm: '',
      sortBy: 'date',
      sortOrder: 'desc',
    },
    incomes: {
      customer: '',
      dateRange: 'all',
      taxRelevant: 'all',
      searchTerm: '',
      sortBy: 'date',
      sortOrder: 'desc',
    },
    invoices: {
      paidStatus: 'all',
      dateRange: 'all',
      searchTerm: '',
      sortBy: 'date',
      sortOrder: 'desc',
    },
    quotes: {
      statusFilter: 'all',
      searchTerm: '',
    },
  });

  // Tab-Änderung
  const handleTabChange = (value: string) => {
    requestReviewNavigation(() => {
      setActiveTab(value);
      router.push(`/dashboard?tab=${value}`, { scroll: false });
    });
  };

  // Form States
  const [newExpense, setNewExpense] = useState({
    description: '',
    amount: '',
    date: new Date().toISOString().split('T')[0],
    category: '',
    taxRelevant: true,
    taxDeductiblePercentage: 100,
    depreciationYears: ''
  });

  const [newIncome, setNewIncome] = useState<{
    description: string;
    amount: string;
    date: string;
    customerId?: number;
    taxRelevant: boolean;
  }>({
    description: '',
    amount: '',
    date: formatLocalBusinessDate(),
    customerId: undefined,
    taxRelevant: true
  });
  const [incomeFormError, setIncomeFormError] = useState<{ field?: string; message: string } | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [expenseEntryOpen, setExpenseEntryOpen] = useState(false);
  const [incomeEntryOpen, setIncomeEntryOpen] = useState(false);
  const [expenseReceipt, setExpenseReceipt] = useState<File | null>(null);
  const [expenseReceiptInputKey, setExpenseReceiptInputKey] = useState(0);
  const expenseSubmission = useManualEntrySubmission();
  const incomeSubmission = useManualEntrySubmission();
  const editSubmission = useManualEntrySubmission();

  const clearExpenseDraft = () => {
    setNewExpense({ description: '', amount: '', date: new Date().toISOString().split('T')[0], category: '', taxRelevant: true, taxDeductiblePercentage: 100, depreciationYears: '' });
    setExpenseReceipt(null);
    // File inputs are uncontrolled: changing React state alone keeps the native
    // selected file and can silently attach it to a later intentional entry.
    setExpenseReceiptInputKey(current => current + 1);
  };
  const clearIncomeDraft = () => {
    setNewIncome({ description: '', amount: '', date: formatLocalBusinessDate(), customerId: undefined, taxRelevant: true });
    setIncomeFormError(null);
  };
  const expenseSubmitPhase = expenseSubmission.state.phase;
  const incomeSubmitPhase = incomeSubmission.state.phase;
  const editSubmitPhase = editSubmission.state.phase;
  const releaseExpenseAfterCommit = expenseSubmission.releaseAfterCommit;
  const releaseIncomeAfterCommit = incomeSubmission.releaseAfterCommit;
  const releaseEditAfterCommit = editSubmission.releaseAfterCommit;
  // Release an accepted new-entry lease only after React committed the cleared
  // draft/native-file remount. An old form cannot submit again between the
  // response and that commit; normal subsequent empty-form entry stays intact.
  useEffect(() => {
    if ((expenseSubmitPhase === 'accepted' || expenseSubmitPhase === 'discarding') && newExpense.description === '' && newExpense.amount === '' && expenseReceipt === null) releaseExpenseAfterCommit();
  }, [expenseSubmitPhase, releaseExpenseAfterCommit, newExpense.description, newExpense.amount, expenseReceipt]);
  useEffect(() => {
    if ((incomeSubmitPhase === 'accepted' || incomeSubmitPhase === 'discarding') && newIncome.description === '' && newIncome.amount === '') releaseIncomeAfterCommit();
  }, [incomeSubmitPhase, releaseIncomeAfterCommit, newIncome.description, newIncome.amount]);
  useEffect(() => {
    if ((editSubmitPhase === 'accepted' || editSubmitPhase === 'discarding') && !editModalOpen && itemToEdit === null) releaseEditAfterCommit();
  }, [editSubmitPhase, releaseEditAfterCommit, editModalOpen, itemToEdit]);

  useDashboardCreateAction({
    searchParams, requestedTab: normalizeTab(tabParam), activeTab, router,
    expenseEntryOpen, incomeEntryOpen, setExpenseEntryOpen, setIncomeEntryOpen,
  });

  const {
    expenses,
    incomes,
    invoices,
    customers,
    quotes,
    assetExpenses,
    summary,
    summaryIsLoading,
    summaryIsFetching,
    summaryIsError,
    summaryError,
    reloadSummary,
    assetsIsLoading,
    assetsIsError,
    assetsError,
    uniqueCategories,
    uniqueCustomers,
    expensesPage,
    expensesPageSize,
    expensesTotal,
    expensesTotalPages,
    expensesIsFetching,
    expensesIsError,
    incomesPage,
    incomesPageSize,
    incomesTotal,
    incomesTotalPages,
    incomesIsFetching,
    incomesIsError,
    invoicesPage,
    invoicesPageSize,
    invoicesTotal,
    invoicesTotalPages,
    invoicesIsFetching,
    invoicesIsError,
    quotesPage,
    quotesPageSize,
    quotesTotal,
    quotesTotalPages,
    quotesWorkflowCounts,
    quotesWorkflowDate,
    quotesIsFetching,
    quotesIsError,
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
    refreshPaymentLists,
    loadQuotes,
  } = useDashboardData({
    filters,
    quotesStatusFilter,
    quotesSearchTerm,
    activeTab: tabParam ? (activeTab as DashboardTab) : null,
    selectedTimeRange,
  });

  useEffect(() => {
    setExportError(null);
  }, [
    filters.expenses.category,
    filters.expenses.dateRange,
    filters.expenses.taxRelevant,
    filters.expenses.hasReceipt,
    filters.expenses.searchTerm,
  ]);

  useEffect(() => {
    setIncomeExportError(null);
  }, [
    filters.incomes.customer,
    filters.incomes.dateRange,
    filters.incomes.taxRelevant,
    filters.incomes.searchTerm,
  ]);

  // Daten werden serverseitig gefiltert, hier nur Alias für Anzeige
  // Keep the immutable finalized protection if a later list read fails. No
  // amount is cached here: stale overrides must never mask cross-tab corrections.
  const filteredExpenses = expenses.map(item => ({ ...item, manualRecordState: protectedManualRecordState(item.manualRecordState, manualOverrides[`expense:${item.id}`]) }));
  const filteredIncomes = incomes.map(item => ({ ...item, manualRecordState: protectedManualRecordState(item.manualRecordState, manualOverrides[`income:${item.id}`]) }));

  // Rechnungen sortieren
  const sortedInvoices = [...invoices].sort((a, b) => {
    const { sortBy, sortOrder } = filters.invoices;
    let comparison = 0;

    if (sortBy === 'date') {
      const dateA = a.invoiceDate ? new Date(a.invoiceDate).getTime() : new Date(a.uploadedAt).getTime();
      const dateB = b.invoiceDate ? new Date(b.invoiceDate).getTime() : new Date(b.uploadedAt).getTime();
      comparison = dateA - dateB;
    } else if (sortBy === 'invoiceNumber') {
      const numA = a.invoiceNumber || '';
      const numB = b.invoiceNumber || '';
      comparison = numA.localeCompare(numB, 'de', { numeric: true });
    } else if (sortBy === 'amount') {
      comparison = (a.totalAmount || 0) - (b.totalAmount || 0);
    }

    return sortOrder === 'asc' ? comparison : -comparison;
  });
  const filteredInvoices = sortedInvoices;

  // Handlers
  const handleExportReceipts = async () => {
    try {
      setExportError(null);
      setIsExportingReceipts(true);

      const query = toQuery({
        category: filters.expenses.category || undefined,
        dateRange: filters.expenses.dateRange !== 'all' ? filters.expenses.dateRange : undefined,
        taxRelevant: filters.expenses.taxRelevant !== 'all' ? filters.expenses.taxRelevant : undefined,
        hasReceipt: filters.expenses.hasReceipt !== 'all' ? filters.expenses.hasReceipt : undefined,
        search: filters.expenses.searchTerm || undefined,
      });
      const queryString = query ? `?${query}` : '';

      const response = await fetch(`/api/expenses/export${queryString}`);

      if (!response.ok) {
        let message = 'Der Export der Belege ist fehlgeschlagen.';
        try {
          const data = await response.json();
          if (data?.error) {
            message = data.error;
          }
        } catch {
          // Ignoriere JSON-Parsing-Fehler bei nicht-JSON-Antworten
        }
        setExportError(message);
        return;
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const disposition = response.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="(.+?)"/);
      link.href = downloadUrl;
      link.download = match?.[1] ?? 'belege-export.zip';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => window.URL.revokeObjectURL(downloadUrl), 1000);
    } catch (error) {
      console.error('Fehler beim Export der Belege:', error);
      setExportError('Der Export der Belege ist fehlgeschlagen.');
    } finally {
      setIsExportingReceipts(false);
    }
  };

  const handleExportIncomeDocuments = async () => {
    try {
      setIncomeExportError(null);
      setIsExportingIncomeDocuments(true);

      const query = toQuery({
        customer: filters.incomes.customer || undefined,
        dateRange: filters.incomes.dateRange !== 'all' ? filters.incomes.dateRange : undefined,
        taxRelevant: filters.incomes.taxRelevant !== 'all' ? filters.incomes.taxRelevant : undefined,
        search: filters.incomes.searchTerm || undefined,
      });
      const queryString = query ? `?${query}` : '';

      const response = await fetch(`/api/incomes/export${queryString}`);

      if (!response.ok) {
        let message = 'Der Export der Rechnungspakete ist fehlgeschlagen.';
        try {
          const data = await response.json();
          if (data?.error) {
            message = data.error;
          }
        } catch {
          // Ignoriere JSON-Parsing-Fehler bei nicht-JSON-Antworten
        }
        setIncomeExportError(message);
        return;
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const disposition = response.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="(.+?)"/);
      link.href = downloadUrl;
      link.download = match?.[1] ?? 'einnahmen-export.zip';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => window.URL.revokeObjectURL(downloadUrl), 1000);
    } catch (error) {
      console.error('Fehler beim Export der Einnahmen:', error);
      setIncomeExportError('Der Export der Rechnungspakete ist fehlgeschlagen.');
    } finally {
      setIsExportingIncomeDocuments(false);
    }
  };

  const handleExpenseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = expenseSubmission.begin();
    if (token === null) return;
    const draft = { ...newExpense };
    const receipt = expenseReceipt;
    let sent = false;
    try {
      const formData = new FormData();
      formData.append('description', draft.description);
      formData.append('amount', draft.amount);
      formData.append('date', new Date(draft.date).toISOString());
      formData.append('category', draft.category);
      formData.append('taxRelevant', draft.taxRelevant.toString());
      formData.append('taxDeductiblePercentage', draft.taxDeductiblePercentage.toString());
      if (draft.depreciationYears) {
        formData.append('depreciationYears', draft.depreciationYears.toString());
      }
      if (receipt) {
        formData.append('receipt', receipt);
      }
      sent = true;
      const response = await fetch('/api/expenses', {
        method: 'POST',
        signal: expenseSubmission.signal(token),
        body: formData,
      });

      const outcome = await manualEntryOutcome(response);
      if (!expenseSubmission.current(token)) return;
      if (outcome.kind === 'accepted') {
        expenseSubmission.settle(token, { phase: 'accepted', message: '' });
        clearExpenseDraft();
        // A failed read after an accepted write must never offer a POST retry.
        void loadExpenses(1, expensesPageSize).catch(() => {});
      } else if (outcome.kind === 'rejected') {
        expenseSubmission.settle(token, { phase: 'idle', message: outcome.message });
      } else {
        expenseSubmission.settle(token, { phase: 'unknown', message: '' });
      }
    } catch (error) {
      console.error('Error creating expense:', error);
      expenseSubmission.settle(token, { phase: sent ? 'unknown' : 'idle', message: sent ? '' : 'Die Eingaben konnten nicht gesendet werden. Prüfen Sie das Datum.' });
    }
  };

  const handleIncomeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = incomeSubmission.begin();
    if (token === null) return;
    const draft = { ...newIncome };
    setIncomeFormError(null);

    try {
      const response = await fetch('/api/incomes', {
        method: 'POST',
        signal: incomeSubmission.signal(token),
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          description: draft.description,
          amount: parseFloat(draft.amount),
          date: draft.date,
          customerId: draft.customerId,
          taxRelevant: draft.taxRelevant
        }),
      });

      const outcome = await manualEntryOutcome(response);
      if (!incomeSubmission.current(token)) return;
      if (outcome.kind === 'accepted') {
        incomeSubmission.settle(token, { phase: 'accepted', message: '' });
        clearIncomeDraft();
        void loadIncomes(1, incomesPageSize).catch(() => {});
      } else if (outcome.kind === 'rejected') {
        incomeSubmission.settle(token, { phase: 'idle', message: '' });
        setIncomeFormError({
          field: outcome.field,
          message: outcome.field === 'date'
            ? 'Bitte geben Sie ein gültiges Zahlungsdatum an.'
            : outcome.message,
        });
      } else {
        incomeSubmission.settle(token, { phase: 'unknown', message: '' });
      }
    } catch (error) {
      console.error('Error creating income:', error);
      incomeSubmission.settle(token, { phase: 'unknown', message: '' });
    }
  };

  // Bearbeitungs- und Löschfunktionen
  const openEditModal = (item: Expense | Income, type: 'expense' | 'income', isDuplicate: boolean = false) => {
    if (item.manualRecordState === 'FINALIZED' || manualOverrides[`${type}:${item.id}`] === 'FINALIZED') return;
    if (!editSubmission.reset()) return;
    const editData: DashboardEditData = {
      ...item,
      amount: item.amount.toString()
    };

    if (isDuplicate) {
      editData.id = undefined;
      if (type === 'expense') {
        editData.date = new Date().toISOString();
        editData.receiptFileName = undefined;
        editData.storedReceiptFileName = undefined;
      }
    }

    setItemToEdit(editData);
    setEditType(type);
    setEditModalOpen(true);
  };

  const handleDuplicate = (item: Expense | Income, type: 'expense' | 'income') => {
    openEditModal(item, type, true);
  };

  const handleEditSave = async (formData: DashboardEditData) => {
    const token = editSubmission.begin();
    if (token === null) return;
    const draft = { ...formData };
    const kind = editType;
    let sent = false;
    try {
      const isNewItem = draft.id === undefined;
      const method = isNewItem ? 'POST' : 'PUT';
      const endpoint = kind === 'expense' ? '/api/expenses' : '/api/incomes';

      const dataToSend: Record<string, unknown> = { ...draft };
      if (isNewItem) {
        delete dataToSend.id; // ID entfernen, da sie vom Backend generiert wird
        // Für duplizierte Ausgaben, die keinen Beleg haben sollen
        if (kind === 'expense') {
          delete dataToSend.receiptFileName;
          delete dataToSend.storedReceiptFileName;
        }
      }
      dataToSend.amount = parseFloat(draft.amount); // Betrag als Zahl senden
      if (kind === 'expense' && typeof dataToSend.date === 'string') {
        dataToSend.date = new Date(dataToSend.date).toISOString();
      } else if (kind === 'income' && typeof dataToSend.date === 'string') {
        if (isNewItem) {
          // A duplicate is a new manual write: send its explicit calendar day.
          dataToSend.date = formatBusinessDate(dataToSend.date);
        } else if (!/^\d{4}-\d{2}-\d{2}$/.test(dataToSend.date)) {
          // Legacy rows may still contain an instant. Omitting it preserves the
          // existing value instead of silently converting its timezone.
          delete dataToSend.date;
        }
      }

      sent = true;
      const response = await fetch(endpoint, {
        method,
        signal: editSubmission.signal(token),
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(dataToSend),
      });

      const outcome = await manualEntryOutcome(response, isNewItem ? undefined : draft.id);
      if (!editSubmission.current(token)) return;
      if (outcome.kind === 'accepted') {
        editSubmission.settle(token, { phase: 'accepted', message: '' });
        setEditModalOpen(false);
        setItemToEdit(null);
        const refresh = kind === 'expense'
          ? loadExpenses(isNewItem ? 1 : expensesPage, expensesPageSize)
          : loadIncomes(isNewItem ? 1 : incomesPage, incomesPageSize);
        void refresh.catch(() => {});
      } else if (outcome.kind === 'rejected') {
        editSubmission.settle(token, { phase: 'idle', message: outcome.message });
      } else {
        editSubmission.settle(token, { phase: 'unknown', message: '' });
      }
    } catch (error) {
      console.error(`Error ${editType}:`, error);
      editSubmission.settle(token, { phase: sent ? 'unknown' : 'idle', message: sent ? '' : 'Die Eingaben konnten nicht gesendet werden. Prüfen Sie das Datum.' });
    }
  };

  const handleDelete = (id: number, type: 'expense' | 'income') => {
    const row = (type === 'expense' ? filteredExpenses : filteredIncomes).find(item => item.id === id);
    if (row?.manualRecordState === 'FINALIZED') return;
    setItemToDelete({ id, type });
    setDeleteModalOpen(true);
  };

  const performDelete = async () => {
    if (!itemToDelete) return;

    const { id, type } = itemToDelete;
    setIsDeleting(true);

    try {
      if (type === 'invoice') {
        const response = await fetch(`/api/invoices?id=${id}`, {
          method: 'DELETE',
        });

        if (response.ok) {
          await loadInvoices(invoicesPage, invoicesPageSize);
          setDeleteModalOpen(false);
          setItemToDelete(null);
        }
      } else {
        const endpoint = type === 'expense' ? `/api/expenses?id=${id}` : `/api/incomes?id=${id}`;
        const response = await fetch(endpoint, {
          method: 'DELETE',
        });

        if (response.ok) {
          if (type === 'expense') await loadExpenses(expensesPage, expensesPageSize);
          else await loadIncomes(incomesPage, incomesPageSize);
          setDeleteModalOpen(false);
          setItemToDelete(null);
        }
      }
    } catch (error) {
      console.error(`Error deleting ${type}:`, error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleFileUpload = async () => {
    if (!selectedFile) return;

    setIsUploading(true);

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const response = await fetch('/api/invoices/upload', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        await loadInvoices(1, invoicesPageSize);
        setSelectedFile(null);
        await loadIncomes(incomesPage, incomesPageSize);
      } else {
        const errorBody = await response.json().catch(() => null);
        toast.error(errorBody?.error || 'Die Rechnung konnte nicht hochgeladen werden.');
      }
    } catch (error) {
      console.error('Error uploading invoice:', error);
      toast.error('Die Rechnung konnte nicht hochgeladen werden. Versuchen Sie es erneut.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleInvoiceDelete = (id: number) => {
    setItemToDelete({ id, type: 'invoice' });
    setDeleteModalOpen(true);
  };

  const openInvoiceDetails = (invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setInvoiceDetailsModalOpen(true);
  };

  const openReceiptModal = (receiptUrl: string) => {
    setSelectedReceiptUrl(receiptUrl);
    setReceiptModalOpen(true);
  };

  const handleInvoiceStatusChange = async (id: number | undefined, newStatus: string) => {
    if (id === undefined) return;
    if (newStatus === 'PAID' || newStatus === 'PAYMENT_HISTORY') {
      const invoice = invoices.find(item => item.id === id);
      // Eligibility comes from this invoice's complete server ledger, never a paginated Income list.
      if (newStatus === 'PAID' && invoice?.status === 'PAID') return;
      // Let the status menu close and restore its trigger before the dialog
      // takes focus, so cancellation has a live keyboard return target.
      window.requestAnimationFrame(() => setInvoiceToPay(invoice ?? { id, fileName: `#${id}` }));
      return;
    }
    try {
      const response = await fetch('/api/invoices', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id,
          status: newStatus,
        }),
      });

      if (response.ok) {
        await loadInvoices(invoicesPage, invoicesPageSize);
        await loadIncomes(incomesPage, incomesPageSize);
      } else {
        const failure = await response.json().catch(() => null);
        toast.error(failure?.error || 'Der Zahlungsstatus konnte nicht geändert werden.');
      }
    } catch (error) {
      toast.error('Der Zahlungsstatus konnte nicht geändert werden. Versuchen Sie es erneut.');
      console.error('Error updating invoice status:', error);
    }
  };

  // Handler für Rechnungsstornierung
  const handleInvoiceCancel = (invoice: Invoice) => {
    setInvoiceToCancel(invoice);
    setCreditNoteModalOpen(true);
  };

  const handleCreditNoteSuccess = async () => {
    // Reload invoices after successful cancellation
    await loadInvoices(invoicesPage, invoicesPageSize);
    // Also reload incomes as cancellation may affect them
    await loadIncomes(incomesPage, incomesPageSize);
  };

  // --- Quote Handlers ---
  const handleQuoteStatusChange = async (quoteId: number, newStatus: string) => {
    try {
      const res = await fetch('/api/quotes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: quoteId, status: newStatus }),
      });
      if (!res.ok) { const result = await res.json().catch(() => ({})); throw new Error(result.error || 'Angebotsstatus konnte nicht gespeichert werden.'); }
      await loadQuotes(quotesPage, quotesPageSize);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Angebotsstatus konnte nicht gespeichert werden.');
      console.error('Error updating quote status:', err);
    }
  };

  const handleConvertToInvoice = (quote: Quote) => {
    setFromQuote(quote);
    setCreateInvoiceModalOpen(true);
  };

  const handleQuoteDelete = async (quoteId: number) => {
    try {
      const res = await fetch(`/api/quotes?id=${quoteId}`, { method: 'DELETE' });
      if (res.ok) await loadQuotes(quotesPage, quotesPageSize);
    } catch (err) {
      console.error('Error deleting quote:', err);
    }
  };

  // Berechnungen für EÜR
  const { totalIncome, totalExpense, profit, depreciationDetails } = React.useMemo(() => ({
    totalIncome: summary?.totalIncome ?? 0,
    totalExpense: summary?.totalExpense ?? 0,
    profit: summary?.profit ?? 0,
    depreciationDetails: summary?.depreciationDetails ?? [],
  }), [summary]);

  // Private transactions calculation (Privatentnahmen / Privateinlagen)
  const privateTransactions = React.useMemo(() => ({
    privateWithdrawals: summary?.privateWithdrawals ?? 0,
    privateDeposits: summary?.privateDeposits ?? 0,
    privateBalance: (summary?.privateDeposits ?? 0) - (summary?.privateWithdrawals ?? 0),
  }), [summary]);

  // Chart Data Preparation
  const monthlyChartData = (summary?.monthlyData ?? []).map((month) => ({
    name: month.monthName,
    fullName: new Date(month.year, month.month - 1, 1).toLocaleString('de-DE', { month: 'long', year: 'numeric' }),
    Einnahmen: month.revenue,
    Ausgaben: month.expenses,
  }));
  const categoryChartData = (summary?.expenseCategories ?? []).map((item) => ({
    name: item.category,
    value: item.amount,
  }));



  // CSV-Export für die EÜR
  const handleExportEUR = async () => {
    if (eurExportInFlight.current) return;
    eurExportInFlight.current = true;
    setIsExportingEUR(true);
    setEURExportError(null);
    const requestedRange = selectedTimeRange;
    try {
      // refetch executes the no-store, server-guarded summary request each time.
      const freshSummary = await reloadSummary();
      if (currentEURRange.current !== requestedRange || currentEURView.current !== 'eur') return;
      const csvContent = buildEURCSVFromFreshSummary(freshSummary, requestedRange);
      const date = new Date().toISOString().split('T')[0];
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `eur-export-${requestedRange}-${date}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      if (currentEURRange.current === requestedRange && currentEURView.current === 'eur') setEURExportError(failure instanceof Error ? failure.message : 'Die aktuelle EÜR-Prüfung ist fehlgeschlagen. Es wurde keine CSV erzeugt.');
    } finally { eurExportInFlight.current = false; setIsExportingEUR(false); }
  };

  // CSV-Export für das GWG-Verzeichnis
  const handleExportGWG = () => {
    // Aktuelles Datum für den Dateinamen
    const date = new Date().toISOString().split('T')[0];
    const fileName = `gwg-verzeichnis-${date}.csv`;

    // CSV-Header
    let csvContent = "Datum;Beschreibung;Kategorie;Betrag (Netto)\n";

    // Gefilterte GWG-Ausgaben
    const gwgExpenses = assetExpenses;

    // Zeilen hinzufügen
    gwgExpenses.forEach(expense => {
      const dateStr = new Date(expense.date).toLocaleDateString('de-DE');
      const amountStr = expense.amount.toFixed(2).replace('.', ',');
      csvContent += `${dateStr};${expense.description};${expense.category || ''};${amountStr}\n`;
    });

    // CSV-Datei erstellen und herunterladen
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', fileName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Hauptkomponente rendern
  return (
    <div className="dashboard-workbench space-y-6">
        <PageHeader
          title={tabParam ? ({ expenses: "Ausgaben", incomes: "Einnahmen", invoices: "Rechnungen", quotes: "Angebote", eur: "EÜR", gwg: "GWG-Verzeichnis" }[activeTab] ?? "Buchhaltung") : "Buchhaltung"}
          date={<time dateTime={formatLocalBusinessDate(new Date())}>{new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</time>}
          actions={<>
            {(!tabParam || activeTab === 'expenses' || activeTab === 'incomes') && <>
              <Button type="button" variant={tabParam && activeTab === 'expenses' ? 'default' : 'outline'} onClick={() => { setExpenseEntryOpen(true); handleTabChange('expenses'); }}><ArrowUpRight aria-hidden="true" />Ausgabe erfassen</Button>
              <Button type="button" variant={tabParam && activeTab === 'incomes' ? 'default' : 'outline'} onClick={() => { setIncomeEntryOpen(true); handleTabChange('incomes'); }}><ArrowDownLeft aria-hidden="true" />Einnahme erfassen</Button>
            </>}
            {(!tabParam || activeTab === 'invoices') && <Button type="button" onClick={() => router.push('/dashboard/invoices/new')}><Plus aria-hidden="true" />Rechnung erstellen</Button>}
            {activeTab === 'quotes' && tabParam && <Button type="button" onClick={() => router.push('/dashboard/quotes/new')}><Plus aria-hidden="true" />Angebot erstellen</Button>}
          {(activeTab === 'eur' || activeTab === 'gwg') && (
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:w-auto">
            <div className="flex min-h-11 flex-1 items-center gap-1 rounded-md border border-border/80 bg-card sm:flex-none" aria-label="Berichtszeitraum">
              <span className="sr-only">Berichtszeitraum</span>
              <button
                type="button"
                onClick={() => {
                  if (selectedTimeRange === 'thisYear') {
                    setSelectedTimeRange('lastYear');
                  }
                }}
                className="min-h-11 min-w-11 rounded-l-lg px-2 transition-colors hover:bg-muted disabled:opacity-50"
                aria-label="Vorheriges Jahr anzeigen"
                title="Vorheriges Jahr"
                disabled={selectedTimeRange !== 'thisYear'}
              >
                <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <Select
                value={selectedTimeRange}
                onValueChange={(value) => setSelectedTimeRange(value as typeof selectedTimeRange)}
              >
                <SelectTrigger className="h-11 min-w-[160px] flex-1 border-0 bg-transparent shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="thisYear">{new Date().getFullYear()} (aktuell)</SelectItem>
                  <SelectItem value="lastYear">{new Date().getFullYear() - 1}</SelectItem>
                  <SelectItem value="last3Months">Letzte 3 Monate</SelectItem>
                  <SelectItem value="last6Months">Letzte 6 Monate</SelectItem>
                  <SelectItem value="all">Alle Daten</SelectItem>
                </SelectContent>
              </Select>
              <button
                type="button"
                onClick={() => {
                  if (selectedTimeRange === 'lastYear') {
                    setSelectedTimeRange('thisYear');
                  }
                }}
                className="min-h-11 min-w-11 rounded-r-lg px-2 transition-colors hover:bg-muted disabled:opacity-50"
                aria-label="Nächstes Jahr anzeigen"
                title="Nächstes Jahr"
                disabled={selectedTimeRange !== 'lastYear'}
              >
                <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
          )}
          </>}
        />

        {!tabParam ? (
          <>
            <GettingStarted />
            <DashboardClient tasks={<DailyActionsPanel compact />} />
          </>
        ) : (
        <div className="space-y-4">
        {searchParams.has("document") && ["invoices", "quotes"].includes(activeTab) && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 text-sm"><p>Ausgewähltes Dokument</p><div className="flex flex-wrap gap-2"><Button variant="outline" asChild><Link href="/dashboard/today">Zur Tagesübersicht</Link></Button><Button variant="outline" asChild><Link href={`/dashboard?tab=${activeTab}`}>Alle Dokumente anzeigen</Link></Button></div></div>}
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full space-y-6">
          {/* Ausgaben Tab */}
          <TabsContent value="expenses" className="space-y-6">
            <ExpensesTab
              isLoading={expensesIsFetching}
              isError={expensesIsError}
              entryOpen={expenseEntryOpen}
              onEntryOpenChange={setExpenseEntryOpen}
              newExpense={newExpense}
              setNewExpense={value => { if (expenseSubmission.editable()) setNewExpense(value); }}
              expenseReceipt={expenseReceipt}
              expenseReceiptInputKey={expenseReceiptInputKey}
              setExpenseReceipt={value => { if (expenseSubmission.editable()) setExpenseReceipt(value); }}
              onSubmit={handleExpenseSubmit}
              submission={{ state: expenseSubmission.state, refreshing: expensesIsFetching,
                onStopWaiting: () => { expenseSubmission.stopWaiting(); },
                onRefresh: () => { void loadExpenses(expensesPage, expensesPageSize).catch(() => {}); },
                onDiscard: () => { if (expenseSubmission.discard()) clearExpenseDraft(); },
              }}
              filters={filters.expenses}
              setFilters={(expenseFilters) => setFilters({ ...filters, expenses: expenseFilters })}
              uniqueCategories={uniqueCategories}
              expenses={filteredExpenses}
              page={expensesPage}
              pageSize={expensesPageSize}
              total={expensesTotal}
              totalPages={expensesTotalPages}
              onPageChange={setExpensesPage}
              onPageSizeChange={setExpensesPageSize}
              loadExpenses={loadExpenses}
              isExportingReceipts={isExportingReceipts}
              exportError={exportError}
              onExportReceipts={handleExportReceipts}
              onManualRecord={openManualRecord}
              onEdit={(expense) => openEditModal(expense, 'expense')}
              onDuplicate={(expense) => handleDuplicate(expense, 'expense')}
              onDelete={(id) => handleDelete(id, 'expense')}
              onViewReceipt={openReceiptModal}
              isDeleting={isDeleting}
              onOpenRecurringExpenses={() => setRecurringExpensesModalOpen(true)}
            />
          </TabsContent>

          {/* Einnahmen Tab */}
          <TabsContent value="incomes" className="space-y-6">
            <IncomesTab
              isLoading={incomesIsFetching}
              isError={incomesIsError}
              entryOpen={incomeEntryOpen}
              onEntryOpenChange={setIncomeEntryOpen}
              newIncome={newIncome}
              setNewIncome={value => { if (incomeSubmission.editable()) setNewIncome(value); }}
              onSubmit={handleIncomeSubmit}
              submission={{ state: incomeSubmission.state, refreshing: incomesIsFetching,
                onStopWaiting: () => { incomeSubmission.stopWaiting(); },
                onRefresh: () => { void loadIncomes(incomesPage, incomesPageSize).catch(() => {}); },
                onDiscard: () => { if (incomeSubmission.discard()) clearIncomeDraft(); },
              }}
              formError={incomeFormError}
              customers={customers}
              filters={filters.incomes}
              setFilters={(incomeFilters) => setFilters({ ...filters, incomes: incomeFilters })}
              uniqueCustomers={uniqueCustomers}
              incomes={filteredIncomes}
              page={incomesPage}
              pageSize={incomesPageSize}
              total={incomesTotal}
              totalPages={incomesTotalPages}
              onPageChange={setIncomesPage}
              onPageSizeChange={setIncomesPageSize}
              loadIncomes={loadIncomes}
              isExportingDocuments={isExportingIncomeDocuments}
              exportError={incomeExportError}
              onExportDocuments={handleExportIncomeDocuments}
              onManualRecord={openManualRecord}
              onEdit={(income) => openEditModal(income, 'income')}
              onDuplicate={(income) => handleDuplicate(income, 'income')}
              onDelete={(id) => handleDelete(id, 'income')}
              onInvoiceStatusChange={handleInvoiceStatusChange}
              isDeleting={isDeleting}
            />
          </TabsContent>

          {/* Rechnungen Tab */}
          <TabsContent value="invoices" className="space-y-6">
            <InvoicesTab
              selectedFile={selectedFile}
              isUploading={isUploading}
              onFileChange={handleFileChange}
              onFileUpload={handleFileUpload}
              onOpenCreateModal={() => router.push('/dashboard/invoices/new')}
              filters={filters.invoices}
              setFilters={(invoiceFilters) => setFilters({ ...filters, invoices: invoiceFilters })}
              invoices={filteredInvoices}
              page={invoicesPage}
              pageSize={invoicesPageSize}
              isLoading={invoicesIsFetching}
              isError={invoicesIsError}
              total={invoicesTotal}
              totalPages={invoicesTotalPages}
              onPageChange={setInvoicesPage}
              onPageSizeChange={setInvoicesPageSize}
              loadInvoices={loadInvoices}
              onViewReceipt={openReceiptModal}
              onOpenDetails={openInvoiceDetails}
              onStatusChange={handleInvoiceStatusChange}
              onCancel={handleInvoiceCancel}
              onDelete={handleInvoiceDelete}
              isDeleting={isDeleting}
            />
          </TabsContent>

          {/* EÜR Tab */}
          <TabsContent value="eur" className="space-y-6">
            {summaryIsLoading || summaryIsFetching || isExportingEUR ? (
              <div className="rounded-lg border p-6 text-sm text-muted-foreground" role="status">Lade EÜR-Auswertung…</div>
            ) : summaryIsError || eurExportError || !summary ? (
              <div className="space-y-3 rounded-lg border border-critical/40 bg-critical-surface p-6 text-sm text-critical-foreground" role="alert">
                <p>Die EÜR-Auswertung ist nicht verfügbar{eurExportError ? `: ${eurExportError}` : summaryError instanceof Error ? `: ${summaryError.message}` : "."} Kein Export aus zwischengespeicherten Zahlen.</p>
                <Button type="button" variant="outline" onClick={() => { setEURExportError(null); void reloadSummary().catch(() => {}); }}>Aktuellen EÜR-Stand erneut prüfen</Button>
              </div>
            ) : (
              <EURTab
                totalIncome={totalIncome}
                totalExpense={totalExpense}
                profit={profit}
                monthlyChartData={monthlyChartData}
                categoryChartData={categoryChartData}
                expenseCategories={categoryChartData}
                depreciationDetails={depreciationDetails}
                selectedTimeRange={selectedTimeRange}
                onExport={handleExportEUR}
                privateWithdrawals={privateTransactions.privateWithdrawals}
                privateDeposits={privateTransactions.privateDeposits}
              />
            )}
          </TabsContent>

          {/* GWG Verzeichnis Tab */}
          <TabsContent value="gwg" className="space-y-6">
            {assetsIsLoading ? (
              <div className="rounded-lg border p-6 text-sm text-muted-foreground" role="status">Lade Anlagendaten…</div>
            ) : assetsIsError ? (
              <div className="rounded-lg border border-critical/40 bg-critical-surface p-6 text-sm text-critical-foreground" role="alert">
                Die Anlagendaten konnten nicht geladen werden{assetsError instanceof Error ? `: ${assetsError.message}` : "."}
              </div>
            ) : (
              <GWGTab
                expensesAll={assetExpenses}
                selectedTimeRange={selectedTimeRange}
                onExport={handleExportGWG}
              />
            )}
          </TabsContent>

          {/* Angebote Tab */}
          <TabsContent value="quotes" className="space-y-6">
            <QuotesTab
              isLoading={quotesIsFetching}
              isError={quotesIsError}
              workflowCounts={quotesWorkflowCounts}
              workflowDate={quotesWorkflowDate}
              quotes={quotes}
              total={quotesTotal}
              page={quotesPage}
              pageSize={quotesPageSize}
              totalPages={quotesTotalPages}
              statusFilter={quotesStatusFilter}
              searchTerm={quotesSearchTerm}
              onPageChange={setQuotesPage}
              onPageSizeChange={setQuotesPageSize}
              onStatusFilterChange={(s) => { setQuotesStatusFilter(s); }}
              onSearchChange={(t) => { setQuotesSearchTerm(t); }}
              onResetFilters={() => {
                const params = new URLSearchParams(searchParams.toString());
                params.delete('quoteSearch'); params.delete('quoteStatus');
                router.push(`${window.location.pathname}?${params.toString()}`, { scroll: false });
              }}
              onOpenCreateModal={() => router.push('/dashboard/quotes/new')}
              onStatusChange={handleQuoteStatusChange}
              onConvertToInvoice={handleConvertToInvoice}
              onDelete={handleQuoteDelete}
              loadQuotes={loadQuotes}
            />
          </TabsContent>
        </Tabs>
        </div>
        )}

        {/* Rechnungsdetails-Modal */}
        {invoiceToPay && <FullPaymentDialog
          key={invoiceToPay.id}
          invoice={invoiceToPay}
          onClose={() => setInvoiceToPay(null)}
          onSuccess={refreshPaymentLists}
        />}
        {invoiceDetailsModalOpen && selectedInvoice && (
          <InvoiceDetailsModal
            isOpen={invoiceDetailsModalOpen}
            onClose={() => setInvoiceDetailsModalOpen(false)}
            invoice={selectedInvoice}
            onPaymentHistory={() => { setInvoiceDetailsModalOpen(false); window.requestAnimationFrame(() => setInvoiceToPay(selectedInvoice)); }}
          />
        )}

        {/* Beleganzeige-Modal */}
        {receiptModalOpen && selectedReceiptUrl && (
          <ReceiptModal
            isOpen={receiptModalOpen}
            onClose={() => setReceiptModalOpen(false)}
            receiptUrl={selectedReceiptUrl}
          />
        )}

        {/* Bearbeitungs-Modal */}
        {editModalOpen && itemToEdit && (
          <EditModal
            isOpen={editModalOpen}
            onClose={() => { if (editSubmission.editable()) { setEditModalOpen(false); setItemToEdit(null); } }}
            onSave={handleEditSave}
            data={itemToEdit}
            type={editType}
            customers={customers}
            uniqueCategories={uniqueCategories}
            submission={{ state: editSubmission.state, refreshing: editType === 'expense' ? expensesIsFetching : incomesIsFetching,
              onStopWaiting: () => { editSubmission.stopWaiting(); },
              onRefresh: () => { void (editType === 'expense' ? loadExpenses(expensesPage, expensesPageSize) : loadIncomes(incomesPage, incomesPageSize)).catch(() => {}); },
              onDiscard: () => { if (editSubmission.discard()) { setEditModalOpen(false); setItemToEdit(null); } },
            }}
          />
        )}

        {/* Lösch-Bestätigungs-Modal */}
        <DeleteConfirmationModal
          isOpen={deleteModalOpen}
          onClose={() => setDeleteModalOpen(false)}
          onConfirm={performDelete}
          title={itemToDelete?.type === 'invoice' ? 'Rechnung löschen' : itemToDelete?.type === 'income' ? 'Einnahme löschen' : 'Ausgabe löschen'}
          description={
            itemToDelete?.type === 'invoice'
              ? 'Sind Sie sicher, dass Sie diese Rechnung löschen möchten? Diese Aktion kann nicht rückgängig gemacht werden.'
              : itemToDelete?.type === 'income'
                ? 'Sind Sie sicher, dass Sie diese Einnahme löschen möchten? Diese Aktion kann nicht rückgängig gemacht werden.'
                : 'Sind Sie sicher, dass Sie diese Ausgabe löschen möchten? Diese Aktion kann nicht rückgängig gemacht werden.'
          }
          isDeleting={isDeleting}
        />

        {/* Rechnung erstellen Modal */}
        <CreateInvoiceModal
          isOpen={createInvoiceModalOpen}
          onClose={() => { setCreateInvoiceModalOpen(false); setFromQuote(null); }}
          fromQuote={fromQuote ? {
            id: fromQuote.id,
            parsedData: fromQuote.parsedData ?? {},
            customerId: fromQuote.customer?.id,
            invoiceNumber: fromQuote.invoiceNumber,
          } : undefined}
          onInvoiceCreated={async () => {
            await loadInvoices(1, invoicesPageSize);
            await loadIncomes(incomesPage, incomesPageSize);
            if (fromQuote) await loadQuotes(quotesPage, quotesPageSize);
          }}
        />

        {/* Wiederkehrende Ausgaben Modal */}
        {manualSelection && manualSelection.sessionKey === dashboardSessionKey && <ManualRecordDialog key={`${manualSelection.kind}:${manualSelection.id}`} selection={manualSelection} onClose={() => setManualSelection(null)} onRecord={observeManualRecord} onRefresh={refreshPaymentLists} />}
        <RecurringExpensesModal
          isOpen={recurringExpensesModalOpen}
          onClose={() => setRecurringExpensesModalOpen(false)}
          uniqueCategories={uniqueCategories}
          onExpensesCreated={async () => {
            await loadExpenses(expensesPage, expensesPageSize);
          }}
        />

        {/* Gutschrift-Modal (Stornierung) */}
        <CreditNoteModal
          isOpen={creditNoteModalOpen}
          onClose={() => {
            setCreditNoteModalOpen(false);
            setInvoiceToCancel(null);
          }}
          invoice={invoiceToCancel}
          onSuccess={handleCreditNoteSuccess}
        />
    </div>
  );
}
