"use client";

import React, { useEffect, useState } from 'react';
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
import {
  Expense,
  Income,
  Invoice,
  FilterState,
  DashboardEditData
} from "@/types/dashboard";
import { toQuery } from "@/lib/dashboard-utils";
import { EURTab, GWGTab, ExpensesTab, IncomesTab, InvoicesTab } from "@/components/dashboard/tabs";
import { useDashboardData } from "@/hooks/use-dashboard-data";
import type { DashboardTab } from "@/hooks/use-dashboard-data";

export function DashboardContent() {
  // URL-Parameter für Tab-Auswahl
  const searchParams = useSearchParams();
  const router = useRouter();
  const tabParam = searchParams.get('tab');

  // State Definitionen
  const [quotesStatusFilter, setQuotesStatusFilter] = useState('all');
  const [quotesSearchTerm, setQuotesSearchTerm] = useState('');

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

  // Deep links from the command palette should execute the requested action,
  // not only navigate to the corresponding work area.
  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    const requestedTab = normalizeTab(tabParam);

    if (requestedTab === 'invoices') {
      router.replace('/dashboard/invoices/new');
      return;
    } else if (requestedTab === 'quotes') {
      router.replace('/dashboard/quotes/new');
      return;
    } else {
      const inputId = requestedTab === 'incomes' ? 'incomeDescription' : 'description';
      window.setTimeout(() => {
        const input = document.getElementById(inputId);
        input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        input?.focus();
      }, 0);
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('new');
    router.replace(`/dashboard?${nextParams.toString()}`, { scroll: false });
  }, [router, searchParams, tabParam]);

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
    assetExpenses,
    summary,
    summaryIsLoading,
    summaryIsError,
    summaryError,
    assetsIsLoading,
    assetsIsError,
    assetsError,
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
      } else {
        const errorBody = await response.json().catch(() => null);
        alert(errorBody?.error || 'Die Rechnung konnte nicht hochgeladen werden.');
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
    const expensesByCategory = categoryChartData.map(({ name, value }) => [name, value] as const);
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
    <div className="space-y-8">
        <header className="flex flex-col gap-7 border-b border-border/80 pb-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="app-section-label text-primary">Arbeitsbereich</p>
              <time className="hidden text-xs text-muted-foreground sm:inline" dateTime={new Date().toISOString().split('T')[0]}>
                {new Date().toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
              </time>
            </div>
            <h1 className="min-w-0 [overflow-wrap:anywhere] text-4xl font-semibold tracking-[-0.04em] text-foreground md:text-5xl">
              Buchhaltung
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
              Belege erfassen, Angebote versenden und offene Rechnungen im Blick behalten.
            </p>
            <div className="mt-6 flex flex-wrap gap-2" aria-label="Schnellaktionen">
              <Button type="button" variant="ghost" onClick={() => handleTabChange('expenses')}>
                Ausgabe erfassen
              </Button>
              <Button type="button" variant="ghost" onClick={() => handleTabChange('incomes')}>
                Einnahme erfassen
              </Button>
              <Button type="button" onClick={() => router.push('/dashboard/invoices/new')}>
                Rechnung erstellen
              </Button>
            </div>
          </div>
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
                className="min-h-11 min-w-11 rounded-l-lg px-2 transition-colors hover:bg-muted"
                aria-label="Vorheriges Jahr anzeigen"
                title="Vorheriges Jahr"
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
                disabled={selectedTimeRange === 'thisYear' || selectedTimeRange === 'all'}
              >
                <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
          )}
        </header>

        {!tabParam ? (
          <DashboardClient />
        ) : (
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full space-y-6">
          <div className="lg:hidden">
            <label htmlFor="mobile-work-area" className="mb-2 block text-sm font-medium">Arbeitsbereich</label>
            <select
              id="mobile-work-area"
              value={activeTab}
              onChange={(event) => handleTabChange(event.target.value)}
              className="min-h-11 w-full rounded-md border border-input bg-card px-3 text-base"
            >
              <option value="expenses">Ausgaben</option>
              <option value="incomes">Einnahmen</option>
              <option value="invoices">Rechnungen</option>
              <option value="quotes">Angebote</option>
              <option value="eur">EÜR</option>
              <option value="gwg">GWG-Verzeichnis</option>
            </select>
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
              onOpenCreateModal={() => router.push('/dashboard/invoices/new')}
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
            {summaryIsLoading ? (
              <div className="rounded-lg border p-6 text-sm text-muted-foreground" role="status">Lade EÜR-Auswertung…</div>
            ) : summaryIsError ? (
              <div className="rounded-lg border border-critical/40 bg-critical-surface p-6 text-sm text-critical-foreground" role="alert">
                Die EÜR-Auswertung konnte nicht geladen werden{summaryError instanceof Error ? `: ${summaryError.message}` : "."}
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
              onOpenCreateModal={() => router.push('/dashboard/quotes/new')}
              onStatusChange={handleQuoteStatusChange}
              onConvertToInvoice={handleConvertToInvoice}
              onDelete={handleQuoteDelete}
              loadQuotes={loadQuotes}
            />
          </TabsContent>
        </Tabs>
        )}

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
  );
}
