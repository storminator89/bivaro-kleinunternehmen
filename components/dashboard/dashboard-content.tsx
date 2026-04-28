"use client";

import React, { useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, subMonths, startOfMonth, endOfMonth, eachMonthOfInterval, isSameMonth } from 'date-fns';
import { de } from 'date-fns/locale';
import { useSearchParams, useRouter } from 'next/navigation';
import { DashboardClient } from "@/components/dashboard/dashboard-client";
import { CreateInvoiceModal } from "@/components/dashboard/create-invoice-modal";
import { CreateQuoteModal } from "@/components/dashboard/create-quote-modal";
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
import {
  Expense,
  Income,
  Invoice,
  FilterState,
  DashboardEditData
} from "@/types/dashboard";
import { formatCurrency, toQuery } from "@/lib/dashboard-utils";
import { EURTab, GWGTab, ExpensesTab, IncomesTab, InvoicesTab } from "@/components/dashboard/tabs";
import { isPrivateWithdrawal } from "@/lib/private-categories";
import { useDashboardData } from "@/hooks/use-dashboard-data";

export function DashboardContent() {
  // URL-Parameter für Tab-Auswahl
  const searchParams = useSearchParams();
  const router = useRouter();
  const tabParam = searchParams.get('tab');

  // State Definitionen
  const [quotesStatusFilter, setQuotesStatusFilter] = useState('all');
  const [quotesSearchTerm, setQuotesSearchTerm] = useState('');
  const [createQuoteModalOpen, setCreateQuoteModalOpen] = useState(false);

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

  // Modal States
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editType, setEditType] = useState<'expense' | 'income'>('expense');
  const [itemToEdit, setItemToEdit] = useState<DashboardEditData | null>(null);
  const [invoiceDetailsModalOpen, setInvoiceDetailsModalOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [selectedReceiptUrl, setSelectedReceiptUrl] = useState<string | null>(null);
  const [_error, _setError] = useState<string | null>(null);
  const [_showCashCountModal, _setShowCashCountModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isExportingReceipts, setIsExportingReceipts] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isExportingIncomeDocuments, setIsExportingIncomeDocuments] = useState(false);
  const [incomeExportError, setIncomeExportError] = useState<string | null>(null);
  const [selectedTimeRange, setSelectedTimeRange] = useState<'all' | 'last3Months' | 'last6Months' | 'thisYear' | 'lastYear'>('thisYear');
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
    },
    incomes: {
      customer: '',
      dateRange: 'all',
      taxRelevant: 'all',
      searchTerm: '',
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
    setActiveTab(value);
    router.push(`/dashboard?tab=${value}`, { scroll: false });
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
    customerId?: number;
    taxRelevant: boolean;
  }>({
    description: '',
    amount: '',
    customerId: undefined,
    taxRelevant: true
  });

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [expenseReceipt, setExpenseReceipt] = useState<File | null>(null);

  const {
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
  } = useDashboardData({ filters, quotesStatusFilter, quotesSearchTerm });

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
  const filteredExpenses = expenses;
  const filteredIncomes = incomes;

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

    try {
      const formData = new FormData();
      formData.append('description', newExpense.description);
      formData.append('amount', newExpense.amount);
      formData.append('date', new Date(newExpense.date).toISOString());
      formData.append('category', newExpense.category);
      formData.append('taxRelevant', newExpense.taxRelevant.toString());
      formData.append('taxDeductiblePercentage', newExpense.taxDeductiblePercentage.toString());
      if (newExpense.depreciationYears) {
        formData.append('depreciationYears', newExpense.depreciationYears.toString());
      }
      if (expenseReceipt) {
        formData.append('receipt', expenseReceipt);
      }

      const response = await fetch('/api/expenses', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        await loadExpenses(1, expensesPageSize);
        setNewExpense({
          description: '',
          amount: '',
          date: new Date().toISOString().split('T')[0],
          category: '',
          taxRelevant: true,
          taxDeductiblePercentage: 100,
          depreciationYears: ''
        });
        setExpenseReceipt(null);
      }
    } catch (error) {
      console.error('Error creating expense:', error);
    }
  };

  const handleIncomeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const response = await fetch('/api/incomes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          description: newIncome.description,
          amount: parseFloat(newIncome.amount),
          customerId: newIncome.customerId,
          taxRelevant: newIncome.taxRelevant
        }),
      });

      if (response.ok) {
        await loadIncomes(1, incomesPageSize);
        setNewIncome({
          description: '',
          amount: '',
          customerId: undefined,
          taxRelevant: true
        });
      }
    } catch (error) {
      console.error('Error creating income:', error);
    }
  };

  // Bearbeitungs- und Löschfunktionen
  const openEditModal = (item: Expense | Income, type: 'expense' | 'income', isDuplicate: boolean = false) => {
    const editData: DashboardEditData = {
      ...item,
      amount: item.amount.toString()
    };

    if (isDuplicate) {
      editData.id = undefined;
      editData.date = new Date().toISOString();
      if (type === 'expense') {
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
    try {
      const isNewItem = formData.id === undefined;
      const method = isNewItem ? 'POST' : 'PUT';
      const endpoint = editType === 'expense' ? '/api/expenses' : '/api/incomes';

      const dataToSend: Record<string, unknown> = { ...formData };
      if (isNewItem) {
        delete dataToSend.id; // ID entfernen, da sie vom Backend generiert wird
        // Für duplizierte Ausgaben, die keinen Beleg haben sollen
        if (editType === 'expense') {
          delete dataToSend.receiptFileName;
          delete dataToSend.storedReceiptFileName;
        }
      }
      dataToSend.amount = parseFloat(formData.amount); // Betrag als Zahl senden
      if (typeof dataToSend.date === 'string') {
        dataToSend.date = new Date(dataToSend.date).toISOString();
      }

      const response = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(dataToSend),
      });

      if (response.ok) {
        if (editType === 'expense') {
          await loadExpenses(isNewItem ? 1 : expensesPage, expensesPageSize);
        } else { // income
          await loadIncomes(isNewItem ? 1 : incomesPage, incomesPageSize);
        }

        setEditModalOpen(false);
      } else {
        const errorData = await response.json();
        console.error(`Error ${method}ing ${editType}:`, errorData);
        alert(`Fehler beim Speichern: ${errorData.error || 'Unbekannter Fehler'}`);
      }
    } catch (error) {
      console.error(`Error ${editType}:`, error);
      alert(`Ein unerwarteter Fehler ist aufgetreten: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleDelete = (id: number, type: 'expense' | 'income') => {
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
      }
    } catch (error) {
      console.error('Error uploading invoice:', error);
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
      }
    } catch (error) {
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
      if (res.ok) await loadQuotes(quotesPage, quotesPageSize);
    } catch (err) {
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
  const { totalIncome, totalExpense, profit, depreciationDetails } = React.useMemo(() => {
    const today = new Date();

    // Einnahmen berechnen (stornierte Rechnungen ausschließen)
    const incSum = incomesAll.reduce((sum, income) => {
      // Stornierte Rechnungen nicht in EÜR berücksichtigen
      if (income.invoiceStatus === 'CANCELLED') {
        return sum;
      }

      const incomeDate = new Date(income.date);
      let includeIncome = false;
      if (selectedTimeRange === 'all') {
        includeIncome = true;
      } else if (selectedTimeRange === 'last3Months') {
        includeIncome = incomeDate >= subMonths(today, 3);
      } else if (selectedTimeRange === 'last6Months') {
        includeIncome = incomeDate >= subMonths(today, 6);
      } else if (selectedTimeRange === 'thisYear') {
        includeIncome = incomeDate.getFullYear() === today.getFullYear();
      } else if (selectedTimeRange === 'lastYear') {
        includeIncome = incomeDate.getFullYear() === today.getFullYear() - 1;
      }
      return income.taxRelevant && includeIncome ? sum + income.amount : sum;
    }, 0);

    // Ausgaben und Abschreibungen berechnen
    const depDetails: Array<{
      id: number;
      description: string;
      date: string;
      totalAmount: number;
      years: number;
      currentYearAmount: number;
      remainingAmount: number;
      calculationExplanation: string;
    }> = [];

    const expSum = expensesAll.reduce((sum, expense) => {
      const expenseDate = new Date(expense.date);

      // Wenn ein Jahreszeitraum gewählt ist, AfA berücksichtigen
      if (selectedTimeRange === 'thisYear' || selectedTimeRange === 'lastYear') {
        if (!expense.taxRelevant) return sum;

        let targetYear = today.getFullYear();
        if (selectedTimeRange === 'lastYear') {
          targetYear = today.getFullYear() - 1;
        }

        let deductibleAmount = 0;

        if (expense.depreciationYears && expense.depreciationYears > 0) {
          const expenseYear = expenseDate.getFullYear();
          const endYear = expenseYear + expense.depreciationYears;

          // Prüfen, ob das Asset im Zieljahr abgeschrieben wird
          if (targetYear >= expenseYear && targetYear < endYear) {
            const yearlyDepreciation = expense.amount / expense.depreciationYears;
            let calculationExplanation = "";

            if (targetYear === expenseYear) {
              // Erstes Jahr: Pro rata temporis
              const monthsLeft = 12 - expenseDate.getMonth();
              deductibleAmount = (yearlyDepreciation / 12) * monthsLeft;
              calculationExplanation = `${formatCurrency(yearlyDepreciation)} / 12 * ${monthsLeft} Mon.`;
            } else {
              // Folgejahre
              deductibleAmount = yearlyDepreciation;
              calculationExplanation = `${formatCurrency(expense.amount)} / ${expense.depreciationYears} Jahre`;
            }

            // Details speichern
            depDetails.push({
              id: expense.id,
              description: expense.description,
              date: expense.date,
              totalAmount: expense.amount,
              years: expense.depreciationYears,
              currentYearAmount: deductibleAmount,
              remainingAmount: Math.max(0, expense.amount - (yearlyDepreciation * (targetYear - expenseYear + 1))), // Grobe Schätzung Restwert
              calculationExplanation
            });
          }
        } else {
          // Sofortabschreibung
          if (expenseDate.getFullYear() === targetYear) {
            deductibleAmount = expense.amount;
          }
        }

        return sum + (deductibleAmount * (expense.taxDeductiblePercentage || 100) / 100);
      }

      // Fallback für andere Zeiträume
      let includeExpense = false;
      if (selectedTimeRange === 'all') {
        includeExpense = true;
      } else if (selectedTimeRange === 'last3Months') {
        includeExpense = expenseDate >= subMonths(today, 3);
      } else if (selectedTimeRange === 'last6Months') {
        includeExpense = expenseDate >= subMonths(today, 6);
      }

      return expense.taxRelevant && includeExpense ? sum + (expense.amount * (expense.taxDeductiblePercentage || 100) / 100) : sum;
    }, 0);

    return {
      totalIncome: incSum,
      totalExpense: expSum,
      profit: incSum - expSum,
      depreciationDetails: depDetails
    };
  }, [incomesAll, expensesAll, selectedTimeRange]);

  // Private transactions calculation (Privatentnahmen / Privateinlagen)
  const privateTransactions = React.useMemo(() => {
    const today = new Date();

    // Calculate Privatentnahmen (withdrawals from business to private)
    const withdrawals = expensesAll.reduce((sum, expense) => {
      if (!isPrivateWithdrawal(expense.category)) return sum;

      const expenseDate = new Date(expense.date);
      let include = false;
      if (selectedTimeRange === 'all') include = true;
      else if (selectedTimeRange === 'thisYear') include = expenseDate.getFullYear() === today.getFullYear();
      else if (selectedTimeRange === 'lastYear') include = expenseDate.getFullYear() === today.getFullYear() - 1;
      else if (selectedTimeRange === 'last3Months') include = expenseDate >= subMonths(today, 3);
      else if (selectedTimeRange === 'last6Months') include = expenseDate >= subMonths(today, 6);

      return include ? sum + expense.amount : sum;
    }, 0);

    // Calculate Privateinlagen (deposits from private to business)
    const deposits = incomesAll.reduce((sum, income) => {
      // Note: Income doesn't have category field in the same way
      // We'll check the description for "Privateinlage" or non-tax-relevant status
      const isPrivateDeposit_ = income.description?.toLowerCase().includes('privateinlage') ||
        (!income.taxRelevant && income.description?.toLowerCase().includes('privat'));
      if (!isPrivateDeposit_) return sum;

      const incomeDate = new Date(income.date);
      let include = false;
      if (selectedTimeRange === 'all') include = true;
      else if (selectedTimeRange === 'thisYear') include = incomeDate.getFullYear() === today.getFullYear();
      else if (selectedTimeRange === 'lastYear') include = incomeDate.getFullYear() === today.getFullYear() - 1;
      else if (selectedTimeRange === 'last3Months') include = incomeDate >= subMonths(today, 3);
      else if (selectedTimeRange === 'last6Months') include = incomeDate >= subMonths(today, 6);

      return include ? sum + income.amount : sum;
    }, 0);

    return {
      privateWithdrawals: withdrawals,
      privateDeposits: deposits,
      privateBalance: deposits - withdrawals
    };
  }, [expensesAll, incomesAll, selectedTimeRange]);

  // Chart Data Preparation
  const { monthlyChartData, categoryChartData } = React.useMemo(() => {
    const today = new Date();
    let start = startOfMonth(new Date(today.getFullYear(), 0, 1)); // Default to this year start
    let end = endOfMonth(today);

    if (selectedTimeRange === 'last3Months') {
      start = startOfMonth(subMonths(today, 2));
      end = endOfMonth(today);
    } else if (selectedTimeRange === 'last6Months') {
      start = startOfMonth(subMonths(today, 5));
      end = endOfMonth(today);
    } else if (selectedTimeRange === 'thisYear') {
      start = startOfMonth(new Date(today.getFullYear(), 0, 1));
      end = endOfMonth(new Date(today.getFullYear(), 11, 31));
    } else if (selectedTimeRange === 'lastYear') {
      start = startOfMonth(new Date(today.getFullYear() - 1, 0, 1));
      end = endOfMonth(new Date(today.getFullYear() - 1, 11, 31));
    }

    const months = eachMonthOfInterval({ start, end });

    const monthlyData = months.map(month => {
      const monthIncomes = incomesAll
        .filter(i => i.taxRelevant && i.invoiceStatus !== 'CANCELLED' && isSameMonth(new Date(i.date), month))
        .reduce((sum, i) => sum + i.amount, 0);

      const monthExpenses = expensesAll
        .filter(e => e.taxRelevant && isSameMonth(new Date(e.date), month))
        .reduce((sum, e) => sum + e.amount, 0);

      return {
        name: format(month, 'MMM', { locale: de }),
        fullName: format(month, 'MMMM yyyy', { locale: de }),
        Einnahmen: monthIncomes,
        Ausgaben: monthExpenses
      };
    });

    // Category Data for Pie Chart
    const catMap = new Map<string, number>();
    expensesAll.forEach(expense => {
      if (!expense.taxRelevant) return;
      const expenseDate = new Date(expense.date);

      // Simple filter for the selected range
      let include = false;
      if (selectedTimeRange === 'all') include = true;
      else if (selectedTimeRange === 'thisYear') include = expenseDate.getFullYear() === today.getFullYear();
      else if (selectedTimeRange === 'lastYear') include = expenseDate.getFullYear() === today.getFullYear() - 1;
      else if (selectedTimeRange === 'last3Months') include = expenseDate >= subMonths(today, 3);
      else if (selectedTimeRange === 'last6Months') include = expenseDate >= subMonths(today, 6);

      if (include) {
        const cat = expense.category || 'Sonstiges';
        catMap.set(cat, (catMap.get(cat) || 0) + expense.amount);
      }
    });

    const categoryData = Array.from(catMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    return { monthlyChartData: monthlyData, categoryChartData: categoryData };
  }, [incomesAll, expensesAll, selectedTimeRange]);

  const _COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#8dd1e1'];



  // CSV-Export für die EÜR
  const handleExportEUR = () => {
    // Aktuelles Datum für den Dateinamen
    const date = new Date().toISOString().split('T')[0];
    const fileName = `eur-export-${date}.csv`;

    // CSV-Header
    let csvContent = "Kategorie;Betrag (EUR)\n";

    // Einnahmen hinzufügen
    csvContent += "BETRIEBSEINNAHMEN;\n";
    csvContent += `Einnahmen (steuerpflichtig);${totalIncome.toFixed(2).replace('.', ',')}\n`;
    csvContent += `Summe Betriebseinnahmen;${totalIncome.toFixed(2).replace('.', ',')}\n\n`;

    // Ausgaben nach Kategorie hinzufügen
    csvContent += "BETRIEBSAUSGABEN;\n";

    // Gruppierte Ausgaben nach Kategorie
    const expensesByCategory = Array.from(
      expensesAll.reduce((acc, expense) => {
        if (!expense.taxRelevant) return acc;
        const category = expense.category || 'Sonstiges';
        // Use the same logic as displayed in the table (simplified for export or full logic?)
        // For consistency, let's use the simple sum here, or replicate the full logic if needed.
        // The previous code used simple sum. Let's stick to simple sum of taxRelevant expenses for now, 
        // but ideally it should match the EÜR logic (depreciation etc).
        // Given the complexity, let's use the simple sum for now as it was before, but on expensesAll.
        const deductibleAmount = expense.amount * (expense.taxDeductiblePercentage || 100) / 100;
        acc.set(category, (acc.get(category) || 0) + deductibleAmount);
        return acc;
      }, new Map<string, number>())
    );

    // Alle Ausgabenkategorien hinzufügen
    expensesByCategory.forEach(([category, amount]) => {
      csvContent += `${category};${amount.toFixed(2).replace('.', ',')}\n`;
    });

    csvContent += `Summe Betriebsausgaben;${totalExpense.toFixed(2).replace('.', ',')}\n\n`;

    // Gewinn/Verlust hinzufügen
    csvContent += `GEWINN/VERLUST;${profit.toFixed(2).replace('.', ',')}\n`;

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

  // CSV-Export für das GWG-Verzeichnis
  const handleExportGWG = () => {
    // Aktuelles Datum für den Dateinamen
    const date = new Date().toISOString().split('T')[0];
    const fileName = `gwg-verzeichnis-${date}.csv`;

    // CSV-Header
    let csvContent = "Datum;Beschreibung;Kategorie;Betrag (Netto)\n";

    // Gefilterte GWG-Ausgaben
    const gwgExpenses = expensesAll.filter(expense => {
      if (!expense.taxRelevant) return false;
      if (expense.amount <= 250 || expense.amount > 1000) return false;

      const expenseDate = new Date(expense.date);
      const today = new Date();
      if (selectedTimeRange === 'thisYear') {
        return expenseDate.getFullYear() === today.getFullYear();
      } else if (selectedTimeRange === 'lastYear') {
        return expenseDate.getFullYear() === today.getFullYear() - 1;
      }
      return true;
    });

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
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8">
          <div>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-2 bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
              Buchhaltung für Kleinunternehmer
            </h1>
            <p className="text-muted-foreground">
              Verwalten Sie Ihre Finanzen einfach und effizient
            </p>
          </div>
          <div className="mt-4 md:mt-0 flex items-center gap-3">
            {/* Year Selector */}
            <div className="flex items-center gap-1 bg-card border rounded-lg shadow-sm">
              <button
                onClick={() => {
                  if (selectedTimeRange === 'thisYear') {
                    setSelectedTimeRange('lastYear');
                  }
                }}
                className="px-2 py-2 hover:bg-muted rounded-l-lg transition-colors"
                title="Vorheriges Jahr"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <Select
                value={selectedTimeRange}
                onValueChange={(value) => setSelectedTimeRange(value as typeof selectedTimeRange)}
              >
                <SelectTrigger className="border-0 shadow-none bg-transparent min-w-[140px] h-9">
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
                onClick={() => {
                  if (selectedTimeRange === 'lastYear') {
                    setSelectedTimeRange('thisYear');
                  }
                }}
                className="px-2 py-2 hover:bg-muted rounded-r-lg transition-colors disabled:opacity-50"
                title="Nächstes Jahr"
                disabled={selectedTimeRange === 'thisYear' || selectedTimeRange === 'all'}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            {/* Current Date Display */}
            <div className="bg-card border rounded-lg px-4 py-2 shadow-sm">
              <span className="text-foreground font-medium">
                {new Date().toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
              </span>
            </div>
          </div>
        </header>

        <DashboardClient />

        {/* Tabs für verschiedene Sektionen */}
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full space-y-6 mt-8">
          <div className="bg-card rounded-xl p-2 shadow-sm border">
            <TabsList className="w-full flex justify-between gap-1 bg-muted/50 p-1 rounded-lg">
              <TabsTrigger
                value="expenses"
                className="data-[state=active]:bg-white data-[state=active]:text-foreground data-[state=active]:shadow-sm rounded-md transition-all duration-200 relative overflow-hidden group flex-1 py-3"
              >
                <div className="flex items-center justify-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="font-medium whitespace-nowrap">Ausgaben</span>
                </div>
              </TabsTrigger>
              <TabsTrigger
                value="incomes"
                className="data-[state=active]:bg-white data-[state=active]:text-foreground data-[state=active]:shadow-sm rounded-md transition-all duration-200 relative overflow-hidden group flex-1 py-3"
              >
                <div className="flex items-center justify-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="font-medium whitespace-nowrap">Einnahmen</span>
                </div>
              </TabsTrigger>
              <TabsTrigger
                value="invoices"
                className="data-[state=active]:bg-white data-[state=active]:text-foreground data-[state=active]:shadow-sm rounded-md transition-all duration-200 relative overflow-hidden group flex-1 py-3"
              >
                <div className="flex items-center justify-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0121 9.414V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="font-medium whitespace-nowrap">Rechnungen</span>
                </div>
              </TabsTrigger>
              <TabsTrigger
                value="eur"
                className="data-[state=active]:bg-white data-[state=active]:text-foreground data-[state=active]:shadow-sm rounded-md transition-all duration-200 relative overflow-hidden group flex-1 py-3"
              >
                <div className="flex items-center justify-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  <span className="font-medium whitespace-nowrap">EÜR</span>
                </div>
              </TabsTrigger>
              <TabsTrigger
                value="gwg"
                className="data-[state=active]:bg-white data-[state=active]:text-foreground data-[state=active]:shadow-sm rounded-md transition-all duration-200 relative overflow-hidden group flex-1 py-3"
              >
                <div className="flex items-center justify-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  <span className="font-medium whitespace-nowrap">GWG</span>
                </div>
              </TabsTrigger>
              <TabsTrigger
                value="quotes"
                className="data-[state=active]:bg-white data-[state=active]:text-foreground data-[state=active]:shadow-sm rounded-md transition-all duration-200 relative overflow-hidden group flex-1 py-3"
              >
                <div className="flex items-center justify-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414A1 1 0 0121 8.414V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                  </svg>
                  <span className="font-medium whitespace-nowrap">Angebote</span>
                </div>
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Ausgaben Tab */}
          <TabsContent value="expenses" className="space-y-6">
            <ExpensesTab
              newExpense={newExpense}
              setNewExpense={setNewExpense}
              expenseReceipt={expenseReceipt}
              setExpenseReceipt={setExpenseReceipt}
              onSubmit={handleExpenseSubmit}
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
              newIncome={newIncome}
              setNewIncome={setNewIncome}
              onSubmit={handleIncomeSubmit}
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
              onOpenCreateModal={() => setCreateInvoiceModalOpen(true)}
              filters={filters.invoices}
              setFilters={(invoiceFilters) => setFilters({ ...filters, invoices: invoiceFilters })}
              invoices={filteredInvoices}
              page={invoicesPage}
              pageSize={invoicesPageSize}
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
            <EURTab
              totalIncome={totalIncome}
              totalExpense={totalExpense}
              profit={profit}
              monthlyChartData={monthlyChartData}
              categoryChartData={categoryChartData}
              expensesAll={expensesAll}
              depreciationDetails={depreciationDetails}
              selectedTimeRange={selectedTimeRange}
              onExport={handleExportEUR}
              privateWithdrawals={privateTransactions.privateWithdrawals}
              privateDeposits={privateTransactions.privateDeposits}
            />
          </TabsContent>

          {/* GWG Verzeichnis Tab */}
          <TabsContent value="gwg" className="space-y-6">
            <GWGTab
              expensesAll={expensesAll}
              selectedTimeRange={selectedTimeRange}
              onExport={handleExportGWG}
            />
          </TabsContent>

          {/* Angebote Tab */}
          <TabsContent value="quotes" className="space-y-6">
            <QuotesTab
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
              onOpenCreateModal={() => setCreateQuoteModalOpen(true)}
              onStatusChange={handleQuoteStatusChange}
              onConvertToInvoice={handleConvertToInvoice}
              onDelete={handleQuoteDelete}
              loadQuotes={loadQuotes}
            />
          </TabsContent>
        </Tabs>

        {/* Rechnungsdetails-Modal */}
        {invoiceDetailsModalOpen && selectedInvoice && (
          <InvoiceDetailsModal
            isOpen={invoiceDetailsModalOpen}
            onClose={() => setInvoiceDetailsModalOpen(false)}
            invoice={selectedInvoice}
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
            onClose={() => setEditModalOpen(false)}
            onSave={handleEditSave}
            data={itemToEdit}
            type={editType}
            customers={customers}
            uniqueCategories={uniqueCategories}
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

        {/* Angebot erstellen Modal */}
        <CreateQuoteModal
          isOpen={createQuoteModalOpen}
          onClose={() => setCreateQuoteModalOpen(false)}
          onQuoteCreated={() => loadQuotes(1, quotesPageSize)}
        />

        {/* Wiederkehrende Ausgaben Modal */}
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
    </div>
  );
}
