"use client";

import React, { useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Table, 
  TableBody, 
  TableCaption, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { format, subMonths, startOfMonth, getMonth, getYear } from 'date-fns';
import { useSearchParams, useRouter } from 'next/navigation';
import { StatusBadge } from "@/components/dashboard/status-badge";
import { DashboardClient } from "@/components/dashboard/dashboard-client";

// Typdefinitionen
type Expense = {
  id: number;
  description: string;
  amount: number;
  date: string;
  category?: string;
  taxRelevant: boolean;
  taxDeductiblePercentage?: number; // Steuerlich ansetzbarer Anteil
  receiptFileName?: string;  // Name der hochgeladenen Belegdatei
  storedReceiptFileName?: string;  // Gespeicherter Dateiname des Belegs
};

type Income = {
  id: number;
  description: string;
  amount: number;
  date: string;
  customerId?: number; // Verknüpfung zur Customer ID
  customerName?: string; // Name des verknüpften Kunden
  taxRelevant: boolean;
  invoicePaidStatus?: boolean; // Hinzugefügt: Status der zugehörigen Rechnung
};

type Customer = {
  id: number;
  name: string;
  email?: string;
  address?: string;
  taxNumber?: string;
  createdAt: string;
};

type Invoice = {
  id: number;
  fileName: string;
  uploadedAt: string;
  invoiceNumber?: string;
  totalAmount?: number;
  status: string;
  invoiceDate?: string;
  dueDate?: string;
};

// Filter-Typen für die Tabellenansichten
type FilterState = {
  expenses: {
    category: string;
    dateRange: 'all' | 'thisMonth' | 'lastMonth' | 'thisYear';
    taxRelevant: 'all' | 'yes' | 'no';
    hasReceipt: 'all' | 'yes' | 'no';
    searchTerm: string;
  };
  incomes: {
    customer: string;
    dateRange: 'all' | 'thisMonth' | 'lastMonth' | 'thisYear';
    taxRelevant: 'all' | 'yes' | 'no';
    searchTerm: string;
  };
  invoices: {
    paidStatus: 'all' | 'paid' | 'unpaid';
    dateRange: 'all' | 'thisMonth' | 'lastMonth' | 'thisYear';
    searchTerm: string;
  };
};

// Das Modal für die Bearbeitung
type EditModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: any) => void;
  data: any;
  type: 'expense' | 'income';
  customers: Customer[]; // Kundenliste als Customer-Objekte
};

// Einfache Modal-Komponente für die Bearbeitung
const EditModal = ({ isOpen, onClose, onSave, data, type, customers = [] }: EditModalProps) => {
  const [formData, setFormData] = useState(data);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 dark:text-gray-200 rounded-lg p-6 w-full max-w-md">
        <h2 className="text-xl font-bold mb-4">
          {type === 'expense' ? 'Ausgabe bearbeiten' : 'Einnahme bearbeiten'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-description">Beschreibung</Label>
            <Input 
              id="edit-description" 
              value={formData.description}
              onChange={(e) => setFormData({...formData, description: e.target.value})}
              required
              className="dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-amount">Betrag (€)</Label>
            <Input 
              id="edit-amount" 
              type="number"
              step="0.01"
              value={formData.amount}
              onChange={(e) => setFormData({...formData, amount: e.target.value})}
              required
              className="dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400"
            />
          </div>

          {type === 'expense' && (
            <div className="space-y-2">
              <Label htmlFor="edit-category">Kategorie</Label>
              <Input 
                id="edit-category" 
                value={formData.category || ''}
                onChange={(e) => setFormData({...formData, category: e.target.value})}
                className="dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400"
              />
            </div>
          )}

          {type === 'income' && (
            <div className="space-y-2">
              <Label htmlFor="edit-customer">Kunde</Label>
              <select
                id="edit-customer"
                value={formData.customerId || ''}
                onChange={(e) => setFormData({...formData, customerId: e.target.value ? parseInt(e.target.value) : undefined})}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400"
              >
                <option value="">Kunde auswählen (optional)</option>
                {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="edit-taxRelevant"
              className="h-4 w-4 dark:bg-gray-700 dark:border-gray-600"
              checked={formData.taxRelevant}
              onChange={(e) => setFormData({...formData, taxRelevant: e.target.checked})}
            />
            <Label htmlFor="edit-taxRelevant" className="font-normal">Steuerlich relevant</Label>
          </div>

          {type === 'expense' && (
            <div className="space-y-2">
              <Label htmlFor="edit-taxDeductiblePercentage">Steuerlich ansetzbarer Anteil (%)</Label>
              <Input 
                id="edit-taxDeductiblePercentage" 
                type="number"
                min="0"
                max="100"
                step="1"
                value={formData.taxDeductiblePercentage || 100}
                onChange={(e) => setFormData({...formData, taxDeductiblePercentage: parseInt(e.target.value) || 100})}
                placeholder="100"
                className="dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400"
              />
              <p className="text-xs text-muted-foreground dark:text-gray-400">
                Bei gemischter privater/geschäftlicher Nutzung: Prozentsatz des geschäftlich nutzbaren Anteils
              </p>
            </div>
          )}

          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose} className="dark:bg-gray-700 dark:border-gray-600">
              Abbrechen
            </Button>
            <Button type="submit" className="dark:bg-blue-600 dark:hover:bg-blue-700">
              Speichern
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default function Dashboard() {
  // URL-Parameter für Tab-Auswahl
  const searchParams = useSearchParams();
  const router = useRouter();
  const tabParam = searchParams.get('tab');
  
  // State Definitionen
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  
  // Tabs-State
  const [activeTab, setActiveTab] = useState(
    tabParam === 'expenses' || tabParam === 'incomes' || tabParam === 'invoices' || tabParam === 'eur'
      ? tabParam
      : 'expenses'
  );
  
  // Modal States
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editType, setEditType] = useState<'expense' | 'income'>('expense');
  const [itemToEdit, setItemToEdit] = useState<any>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedTimeRange, setSelectedTimeRange] = useState<'all' | 'last3Months' | 'last6Months' | 'thisYear' | 'lastYear'>('last6Months');

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
    }
  });

  // Gefilterte Daten
  const filteredExpenses = expenses.filter(expense => {
    // Kategoriefilter
    if (filters.expenses.category && expense.category !== filters.expenses.category) {
      return false;
    }
    
    // Steuerrelevanzfilter
    if (filters.expenses.taxRelevant === 'yes' && !expense.taxRelevant) {
      return false;
    }
    if (filters.expenses.taxRelevant === 'no' && expense.taxRelevant) {
      return false;
    }
    
    // Belegfilter
    if (filters.expenses.hasReceipt === 'yes' && !expense.storedReceiptFileName) {
      return false;
    }
    if (filters.expenses.hasReceipt === 'no' && expense.storedReceiptFileName) {
      return false;
    }
    
    // Datumsfilter
    if (filters.expenses.dateRange !== 'all') {
      const expenseDate = new Date(expense.date);
      const now = new Date();
      const thisMonth = now.getMonth();
      const thisYear = now.getFullYear();
      
      if (filters.expenses.dateRange === 'thisMonth' && 
          (expenseDate.getMonth() !== thisMonth || expenseDate.getFullYear() !== thisYear)) {
        return false;
      }
      
      if (filters.expenses.dateRange === 'lastMonth') {
        const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;
        const lastMonthYear = thisMonth === 0 ? thisYear - 1 : thisYear;
        if (expenseDate.getMonth() !== lastMonth || expenseDate.getFullYear() !== lastMonthYear) {
          return false;
        }
      }
      
      if (filters.expenses.dateRange === 'thisYear' && expenseDate.getFullYear() !== thisYear) {
        return false;
      }
    }
    
    // Suchbegriff
    if (filters.expenses.searchTerm) {
      const searchTerm = filters.expenses.searchTerm.toLowerCase();
      return expense.description.toLowerCase().includes(searchTerm) || 
             (expense.category && expense.category.toLowerCase().includes(searchTerm));
    }
    
    return true;
  });

  const filteredIncomes = incomes.filter(income => {
    // Kundenfilter
    if (filters.incomes.customer && income.customerName !== filters.incomes.customer) {
      return false;
    }
    
    // Steuerrelevanzfilter
    if (filters.incomes.taxRelevant === 'yes' && !income.taxRelevant) {
      return false;
    }
    if (filters.incomes.taxRelevant === 'no' && income.taxRelevant) {
      return false;
    }
    
    // Datumsfilter
    if (filters.incomes.dateRange !== 'all') {
      const incomeDate = new Date(income.date);
      const now = new Date();
      const thisMonth = now.getMonth();
      const thisYear = now.getFullYear();
      
      if (filters.incomes.dateRange === 'thisMonth' && 
          (incomeDate.getMonth() !== thisMonth || incomeDate.getFullYear() !== thisYear)) {
        return false;
      }
      
      if (filters.incomes.dateRange === 'lastMonth') {
        const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;
        const lastMonthYear = thisMonth === 0 ? thisYear - 1 : thisYear;
        if (incomeDate.getMonth() !== lastMonth || incomeDate.getFullYear() !== lastMonthYear) {
          return false;
        }
      }
      
      if (filters.incomes.dateRange === 'thisYear' && incomeDate.getFullYear() !== thisYear) {
        return false;
      }
    }
    
    // Suchbegriff
    if (filters.incomes.searchTerm) {
      const searchTerm = filters.incomes.searchTerm.toLowerCase();
      return income.description.toLowerCase().includes(searchTerm) || 
             (income.customerName && income.customerName.toLowerCase().includes(searchTerm));
    }
    
    return true;
  });

  const filteredInvoices = invoices.filter(invoice => {
    // Bezahlstatusfilter
    if (filters.invoices.paidStatus === 'paid' && !invoice.paidStatus) {
      return false;
    }
    if (filters.invoices.paidStatus === 'unpaid' && invoice.paidStatus) {
      return false;
    }
    
    // Datumsfilter
    if (filters.invoices.dateRange !== 'all') {
      let invoiceDate;
      if (invoice.invoiceDate) {
        invoiceDate = new Date(invoice.invoiceDate);
      } else {
        invoiceDate = new Date(invoice.uploadedAt);
      }
      
      const now = new Date();
      const thisMonth = now.getMonth();
      const thisYear = now.getFullYear();
      
      if (filters.invoices.dateRange === 'thisMonth' && 
          (invoiceDate.getMonth() !== thisMonth || invoiceDate.getFullYear() !== thisYear)) {
        return false;
      }
      
      if (filters.invoices.dateRange === 'lastMonth') {
        const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;
        const lastMonthYear = thisMonth === 0 ? thisYear - 1 : thisYear;
        if (invoiceDate.getMonth() !== lastMonth || invoiceDate.getFullYear() !== lastMonthYear) {
          return false;
        }
      }
      
      if (filters.invoices.dateRange === 'thisYear' && invoiceDate.getFullYear() !== thisYear) {
        return false;
      }
    }
    
    // Suchbegriff
    if (filters.invoices.searchTerm) {
      const searchTerm = filters.invoices.searchTerm.toLowerCase();
      return invoice.fileName.toLowerCase().includes(searchTerm) || 
             (invoice.invoiceNumber && invoice.invoiceNumber.toLowerCase().includes(searchTerm));
    }
    
    return true;
  });

  // Einzigartige Kategorien und Kunden für Filter
  const uniqueCategories = Array.from(new Set(expenses.map(expense => expense.category || 'Sonstiges')));
  const uniqueCustomers = Array.from(new Set(incomes.map(income => income.customerName || '').filter(Boolean)));

  // Tab-Änderung
  const handleTabChange = (value: string) => {
    setActiveTab(value);
    router.push(`/dashboard?tab=${value}`, { scroll: false });
  };
  
  // Form States
  const [newExpense, setNewExpense] = useState({
    description: '',
    amount: '',
    category: 'Sonstiges',
    taxRelevant: true,
    taxDeductiblePercentage: 100
  });
  
  const [newIncome, setNewIncome] = useState({
    description: '',
    amount: '',
    customerId: undefined, // customerId statt customer
    taxRelevant: true
  });
  
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [expenseReceipt, setExpenseReceipt] = useState<File | null>(null);

  // Daten laden
  useEffect(() => {
    async function fetchData() {
      try {
        const expensesResponse = await fetch('/api/expenses');
        const incomesResponse = await fetch('/api/incomes');
        const invoicesResponse = await fetch('/api/invoices');

        if (expensesResponse.ok) {
          setExpenses(await expensesResponse.json());
        }

        if (incomesResponse.ok) {
          setIncomes(await incomesResponse.json());
        }

        if (invoicesResponse.ok) {
          setInvoices(await invoicesResponse.json());
        }

        const customersResponse = await fetch('/api/customers');
        if (customersResponse.ok) {
          setCustomers(await customersResponse.json());
        }
      } catch (error) {
        console.error('Error fetching data:', error);
      }
    }

    fetchData();
  }, []);

  // Handlers
  const handleExpenseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const formData = new FormData();
      formData.append('description', newExpense.description);
      formData.append('amount', newExpense.amount);
      formData.append('category', newExpense.category);
      formData.append('taxRelevant', newExpense.taxRelevant.toString());
      formData.append('taxDeductiblePercentage', newExpense.taxDeductiblePercentage.toString());
      if (expenseReceipt) {
        formData.append('receipt', expenseReceipt);
      }

      const response = await fetch('/api/expenses', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const createdExpense = await response.json();
        setExpenses([createdExpense, ...expenses]);
        setNewExpense({
          description: '',
          amount: '',
          category: 'Sonstiges',
          taxRelevant: true,
          taxDeductiblePercentage: 100
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
        const createdIncome = await response.json();
        setIncomes([createdIncome, ...incomes]);
        setNewIncome({
          description: '',
          amount: '',
          customer: '',
          taxRelevant: true
        });
      }
    } catch (error) {
      console.error('Error creating income:', error);
    }
  };

  // Bearbeitungs- und Löschfunktionen
  const openEditModal = (item: any, type: 'expense' | 'income', isDuplicate: boolean = false) => {
    if (isDuplicate) {
      const duplicatedItem = {
        ...item,
        id: undefined, // Backend sollte neue ID generieren
        date: new Date().toISOString(),
        receiptFileName: undefined, // Beleg nicht duplizieren
        storedReceiptFileName: undefined, // Beleg nicht duplizieren
        customerId: item.customerId, // customerId beibehalten
      };
      setItemToEdit({...duplicatedItem, amount: duplicatedItem.amount.toString()});
    } else {
      setItemToEdit({...item, amount: item.amount.toString()});
    }
    setEditType(type);
    setEditModalOpen(true);
  };

  const handleDuplicate = (item: any, type: 'expense' | 'income') => {
    openEditModal(item, type, true);
  };
  
  const handleEditSave = async (formData: any) => {
    try {
      const isNewItem = formData.id === undefined;
      const method = isNewItem ? 'POST' : 'PUT';
      const endpoint = editType === 'expense' ? '/api/expenses' : '/api/incomes';

      const dataToSend = { ...formData };
      if (isNewItem) {
        delete dataToSend.id; // ID entfernen, da sie vom Backend generiert wird
        // Für duplizierte Ausgaben, die keinen Beleg haben sollen
        if (editType === 'expense') {
          delete dataToSend.receiptFileName;
          delete dataToSend.storedReceiptFileName;
        }
      }
      dataToSend.amount = parseFloat(dataToSend.amount); // Betrag als Zahl senden

      const response = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(dataToSend),
      });

      if (response.ok) {
        const updatedItem = await response.json();
        
        if (editType === 'expense') {
          if (isNewItem) {
            setExpenses([updatedItem, ...expenses]); // Neue Ausgabe hinzufügen
          } else {
            setExpenses(expenses.map(item => item.id === updatedItem.id ? updatedItem : item));
          }
        } else { // income
          if (isNewItem) {
            setIncomes([updatedItem, ...incomes]); // Neue Einnahme hinzufügen
          } else {
            setIncomes(incomes.map(item => item.id === updatedItem.id ? updatedItem : item));
          }
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
  
  const handleDelete = async (id: number, type: 'expense' | 'income') => {
    if (!confirm(`Sind Sie sicher, dass Sie diese ${type === 'expense' ? 'Ausgabe' : 'Einnahme'} löschen möchten?`)) {
      return;
    }
    
    setIsDeleting(true);
    
    try {
      const endpoint = type === 'expense' ? `/api/expenses?id=${id}` : `/api/incomes?id=${id}`;
      const response = await fetch(endpoint, {
        method: 'DELETE',
      });

      if (response.ok) {
        if (type === 'expense') {
          setExpenses(expenses.filter(item => item.id !== id));
        } else {
          setIncomes(incomes.filter(item => item.id !== id));
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
        const newInvoice = await response.json();
        setInvoices([newInvoice, ...invoices]);
        setSelectedFile(null);
        
        // Wenn die Rechnung automatisch eine Einnahme erstellt hat
        const incomesResponse = await fetch('/api/incomes');
        if (incomesResponse.ok) {
          setIncomes(await incomesResponse.json());
        }
      }
    } catch (error) {
      console.error('Error uploading invoice:', error);
    } finally {
      setIsUploading(false);
    }
  };

  const handleInvoiceDelete = async (id: number) => {
    if (!confirm('Sind Sie sicher, dass Sie diese Rechnung löschen möchten?')) {
      return;
    }

    setIsDeleting(true);

    try {
      const response = await fetch(`/api/invoices?id=${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setInvoices(invoices.filter(invoice => invoice.id !== id));
      }
    } catch (error) {
      console.error('Error deleting invoice:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleInvoiceStatusChange = async (id: number, newStatus: string) => {
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
        const updatedInvoice = await response.json();
        setInvoices(invoices.map(invoice => 
          invoice.id === id ? updatedInvoice : invoice
        ));
      }
    } catch (error) {
      console.error('Error updating invoice status:', error);
    }
  };

  // Berechnungen für EÜR
  const totalIncome = incomes.reduce((sum, income) => {
    const incomeDate = new Date(income.date);
    const today = new Date();

    let includeIncome = false;
    if (selectedTimeRange === 'all') {
      includeIncome = true;
    } else if (selectedTimeRange === 'last3Months') {
      const threeMonthsAgo = subMonths(today, 3);
      includeIncome = incomeDate >= threeMonthsAgo;
    } else if (selectedTimeRange === 'last6Months') {
      const sixMonthsAgo = subMonths(today, 6);
      includeIncome = incomeDate >= sixMonthsAgo;
    } else if (selectedTimeRange === 'thisYear') {
      includeIncome = incomeDate.getFullYear() === today.getFullYear();
    } else if (selectedTimeRange === 'lastYear') {
      includeIncome = incomeDate.getFullYear() === today.getFullYear() - 1 && incomeDate.getFullYear() === today.getFullYear() - 1;
    }

    return income.taxRelevant && includeIncome ? sum + income.amount : sum;
  }, 0);
  
  const totalExpense = expenses.reduce((sum, expense) => {
    const expenseDate = new Date(expense.date);
    const today = new Date();

    let includeExpense = false;
    if (selectedTimeRange === 'all') {
      includeExpense = true;
    } else if (selectedTimeRange === 'last3Months') {
      const threeMonthsAgo = subMonths(today, 3);
      includeExpense = expenseDate >= threeMonthsAgo;
    } else if (selectedTimeRange === 'last6Months') {
      const sixMonthsAgo = subMonths(today, 6);
      includeExpense = expenseDate >= sixMonthsAgo;
    } else if (selectedTimeRange === 'thisYear') {
      includeExpense = expenseDate.getFullYear() === today.getFullYear();
    } else if (selectedTimeRange === 'lastYear') {
      includeExpense = expenseDate.getFullYear() === today.getFullYear() - 1 && expenseDate.getFullYear() === today.getFullYear() - 1;
    }

    return expense.taxRelevant && includeExpense ? sum + (expense.amount * (expense.taxDeductiblePercentage || 100) / 100) : sum;
  }, 0);
  
  const profit = totalIncome - totalExpense;

  // Daten für das Monatsdiagramm vorbereiten
  const [chartData, setChartData] = useState<ChartData[]>([]);

  useEffect(() => {
    const prepareChartData = () => {
      const monthlyData: { [key: string]: { Einnahmen: number; Ausgaben: number } } = {};
      const today = new Date();
      let startDate = new Date();
      let endDate = today;

      if (selectedTimeRange === 'last3Months') {
        startDate = subMonths(today, 3);
      } else if (selectedTimeRange === 'last6Months') {
        startDate = subMonths(today, 6);
      } else if (selectedTimeRange === 'thisYear') {
        startDate = new Date(today.getFullYear(), 0, 1);
      } else if (selectedTimeRange === 'lastYear') {
        startDate = new Date(today.getFullYear() - 1, 0, 1);
        endDate = new Date(today.getFullYear() - 1, 11, 31); // End of last year
      } else { // 'all'
        const allDates = [...incomes.map(i => new Date(i.date)), ...expenses.map(e => new Date(e.date))];
        if (allDates.length > 0) {
          startDate = new Date(Math.min(...allDates.map(d => d.getTime())));
        } else {
          startDate = today; // No data, start from today
        }
      }

      // Initialisiere Daten für die relevanten Monate
      let currentDate = startOfMonth(startDate);
      while (currentDate <= endDate) {
        const monthYear = format(currentDate, 'MMM yy');
        monthlyData[monthYear] = { Einnahmen: 0, Ausgaben: 0 };
        currentDate = subMonths(currentDate, -1); // Go to next month
      }

      // Aggregiere Einnahmen
      incomes.forEach(income => {
        const incomeDate = new Date(income.date);
        if (income.taxRelevant && incomeDate >= startDate && incomeDate <= endDate) {
          const monthYear = format(incomeDate, 'MMM yy');
          if (monthlyData[monthYear]) {
            monthlyData[monthYear].Einnahmen += income.amount;
          }
        }
      });

      // Aggregiere Ausgaben
      expenses.forEach(expense => {
        const expenseDate = new Date(expense.date);
        if (expense.taxRelevant && expenseDate >= startDate && expenseDate <= endDate) {
          const monthYear = format(expenseDate, 'MMM yy');
          if (monthlyData[monthYear]) {
            monthlyData[monthYear].Ausgaben += expense.amount * (expense.taxDeductiblePercentage || 100) / 100;
          }
        }
      });

      // Konvertiere zu Array und sortiere chronologisch
      const sortedData = Object.keys(monthlyData)
        .sort((a, b) => {
          const [monthA, yearA] = a.split(' ');
          const [monthB, yearB] = b.split(' ');
          const dateA = new Date(`01 ${monthA} ${yearA}`);
          const dateB = new Date(`01 ${monthB} ${yearB}`);
          return dateA.getTime() - dateB.getTime();
        })
        .map(monthYear => ({
          name: monthYear,
          Einnahmen: parseFloat(monthlyData[monthYear].Einnahmen.toFixed(2)),
          Ausgaben: parseFloat(monthlyData[monthYear].Ausgaben.toFixed(2)),
        }));
      
      setChartData(sortedData);
    };

    prepareChartData();
  }, [expenses, incomes, selectedTimeRange]);

  // Formatierungsfunktion
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('de-DE', { 
      style: 'currency', 
      currency: 'EUR' 
    }).format(amount);
  };

  // Typdefinition für ChartData
type ChartData = {
  name: string;
  Einnahmen: number;
  Ausgaben: number;
};

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
      expenses.reduce((acc, expense) => {
        if (!expense.taxRelevant) return acc;
        const category = expense.category || 'Sonstiges';
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

  // Hauptkomponente rendern
  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-7xl mx-auto px-4 py-10">
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10">
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight mb-2">
              Buchhaltung für Kleinunternehmer
            </h1>
            <p className="text-muted-foreground">
              Verwalten Sie Ihre Finanzen einfach und effizient
            </p>
          </div>
          <div className="mt-4 md:mt-0">
            <span className="bg-muted text-muted-foreground px-3 py-1 rounded-md text-sm font-medium">
              {new Date().toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })}
            </span>
          </div>
        </header>
      
        <DashboardClient />
      
        {/* Tabs für verschiedene Sektionen */}
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full space-y-6">
          <div className="bg-card rounded-xl p-1 shadow-sm border">
            <TabsList className="w-full grid grid-cols-4 gap-2 bg-transparent">
              <TabsTrigger 
                value="expenses" 
                className="data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-lg"
              >
                Ausgaben
              </TabsTrigger>
              <TabsTrigger 
                value="incomes" 
                className="data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-lg"
              >
                Einnahmen
              </TabsTrigger>
              <TabsTrigger 
                value="invoices" 
                className="data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-lg"
              >
                Rechnungen
              </TabsTrigger>
              <TabsTrigger 
                value="eur" 
                className="data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-lg"
              >
                EÜR
              </TabsTrigger>
            </TabsList>
          </div>
        
          {/* Ausgaben Tab */}
          <TabsContent value="expenses" className="space-y-6">
            <div className="bg-card rounded-xl shadow-sm border overflow-hidden">
              <div className="px-6 pt-6 pb-4 border-b">
                <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
                  <div>
                    <h2 className="text-xl font-semibold mb-1">Neue Ausgabe erfassen</h2>
                    <p className="text-sm text-muted-foreground">
                      Erfassen Sie hier Ihre geschäftlichen Ausgaben
                    </p>
                  </div>
                  <div className="flex items-center text-xs text-muted-foreground bg-muted rounded-lg px-3 py-1.5">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Steuerlich relevante Ausgaben werden in der EÜR berücksichtigt
                  </div>
                </div>
              </div>
              <div className="p-6">
                <form onSubmit={handleExpenseSubmit} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label htmlFor="description" className="text-sm font-medium">Beschreibung</Label>
                      <Input 
                        id="description" 
                        value={newExpense.description}
                        onChange={(e) => setNewExpense({...newExpense, description: e.target.value})}
                        placeholder="z.B. Büromaterial"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="amount" className="text-sm font-medium">Betrag (€)</Label>
                      <Input 
                        id="amount" 
                        type="number"
                        step="0.01"
                        value={newExpense.amount}
                        onChange={(e) => setNewExpense({...newExpense, amount: e.target.value})}
                        placeholder="0.00"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="category" className="text-sm font-medium">Kategorie</Label>
                      <Input 
                        id="category" 
                        value={newExpense.category}
                        onChange={(e) => setNewExpense({...newExpense, category: e.target.value})}
                        placeholder="z.B. Bürobedarf"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="receipt" className="text-sm font-medium">Beleg hochladen (optional)</Label>
                      <Input
                        id="receipt"
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        onChange={(e) => setExpenseReceipt(e.target.files ? e.target.files[0] : null)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Unterstützte Formate: PDF, JPG, PNG
                      </p>
                    </div>
                    <div className="flex items-center space-x-2 h-full pt-6">
                      <div className="relative inline-flex items-center">
                        <input
                          type="checkbox"
                          id="taxRelevant"
                          className="rounded border-input text-primary h-4 w-4"
                          checked={newExpense.taxRelevant}
                          onChange={(e) => setNewExpense({...newExpense, taxRelevant: e.target.checked})}
                        />
                        <Label htmlFor="taxRelevant" className="ml-2 text-sm font-medium">Steuerlich relevant</Label>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="taxDeductiblePercentage" className="text-sm font-medium">Steuerlich ansetzbarer Anteil (%)</Label>
                      <Input
                        id="taxDeductiblePercentage"
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={newExpense.taxDeductiblePercentage}
                        onChange={(e) => setNewExpense({...newExpense, taxDeductiblePercentage: parseInt(e.target.value) || 100})}
                        placeholder="100"
                      />
                      <p className="text-xs text-muted-foreground">
                        Bei gemischter privater/geschäftlicher Nutzung: Prozentsatz des geschäftlich nutzbaren Anteils
                      </p>
                    </div>
                  </div>
                  <div>
                    <Button type="submit" className="text-white bg-red-600 hover:bg-red-700">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                      Ausgabe speichern
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          
            <div className="bg-card rounded-xl shadow-sm border overflow-hidden">
              <div className="px-6 pt-6 pb-4 border-b">
                <h2 className="text-xl font-semibold mb-2">Ihre Ausgaben</h2>
                <p className="text-sm text-muted-foreground mb-4">Filtern Sie Ihre Ausgaben nach verschiedenen Kriterien.</p>
                <div className="bg-muted/40 rounded-xl p-4 border">
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                    <div>
                      <Label htmlFor="expense-category-filter" className="text-xs font-medium uppercase tracking-wide block mb-1.5 text-muted-foreground">Kategorie</Label>
                      <div className="relative">
                        <select 
                          id="expense-category-filter"
                          className="w-full h-10 rounded-md border border-input pl-3 pr-8 py-2 bg-background text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary transition-all cursor-pointer"
                          value={filters.expenses.category}
                          onChange={(e) => setFilters({
                            ...filters,
                            expenses: {
                              ...filters.expenses,
                              category: e.target.value
                            }
                          })}
                        >
                          <option value="">Alle Kategorien</option>
                          {uniqueCategories.map(category => (
                            <option key={category} value={category}>{category}</option>
                          ))}
                        </select>
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                    </div>
                    
                    <div>
                      <Label htmlFor="expense-date-filter" className="text-xs font-medium uppercase tracking-wide block mb-1.5 text-muted-foreground">Zeitraum</Label>
                      <div className="relative">
                        <select 
                          id="expense-date-filter"
                          className="w-full h-10 rounded-md border border-input pl-3 pr-8 py-2 bg-background text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary transition-all cursor-pointer"
                          value={filters.expenses.dateRange}
                          onChange={(e) => setFilters({
                            ...filters,
                            expenses: {
                              ...filters.expenses,
                              dateRange: e.target.value as any
                            }
                          })}
                        >
                          <option value="all">Alle Zeiträume</option>
                          <option value="thisMonth">Aktueller Monat</option>
                          <option value="lastMonth">Letzter Monat</option>
                          <option value="thisYear">Aktuelles Jahr</option>
                        </select>
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                    </div>
                    
                    <div>
                      <Label htmlFor="expense-tax-filter" className="text-xs font-medium uppercase tracking-wide block mb-1.5 text-muted-foreground">Steuerlich relevant</Label>
                      <div className="relative">
                        <select 
                          id="expense-tax-filter"
                          className="w-full h-10 rounded-md border border-input pl-3 pr-8 py-2 bg-background text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary transition-all cursor-pointer"
                          value={filters.expenses.taxRelevant}
                          onChange={(e) => setFilters({
                            ...filters,
                            expenses: {
                              ...filters.expenses,
                              taxRelevant: e.target.value as any
                            }
                          })}
                        >
                          <option value="all">Alle</option>
                          <option value="yes">Ja</option>
                          <option value="no">Nein</option>
                        </select>
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                    </div>
                    
                    <div>
                      <Label htmlFor="expense-receipt-filter" className="text-xs font-medium uppercase tracking-wide block mb-1.5 text-muted-foreground">Beleg vorhanden</Label>
                      <div className="relative">
                        <select 
                          id="expense-receipt-filter"
                          className="w-full h-10 rounded-md border border-input pl-3 pr-8 py-2 bg-background text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary transition-all cursor-pointer"
                          value={filters.expenses.hasReceipt}
                          onChange={(e) => setFilters({
                            ...filters,
                            expenses: {
                              ...filters.expenses,
                              hasReceipt: e.target.value as any
                            }
                          })}
                        >
                          <option value="all">Alle</option>
                          <option value="yes">Ja</option>
                          <option value="no">Nein</option>
                        </select>
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                    </div>
                    
                    <div>
                      <Label htmlFor="expense-search" className="text-xs font-medium uppercase tracking-wide block mb-1.5 text-muted-foreground">Suche</Label>
                      <div className="relative">
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                        </div>
                        <Input 
                          id="expense-search"
                          type="text"
                          placeholder="Beschreibung, Kategorie..."
                          value={filters.expenses.searchTerm}
                          className="pl-9 pr-8 h-10"
                          onChange={(e) => setFilters({
                            ...filters,
                            expenses: {
                              ...filters.expenses,
                              searchTerm: e.target.value
                            }
                          })}
                        />
                        {filters.expenses.searchTerm && (
                          <button 
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-none"
                            onClick={() => setFilters({
                              ...filters,
                              expenses: {
                                ...filters.expenses,
                                searchTerm: ''
                              }
                            })}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex mt-4 items-center justify-between">
                    <div className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">{filteredExpenses.length}</span> Ausgaben gefunden
                    </div>
                    
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="h-8 text-xs"
                      onClick={() => setFilters({
                        ...filters,
                        expenses: {
                          category: '',
                          dateRange: 'all',
                          taxRelevant: 'all',
                          hasReceipt: 'all',
                          searchTerm: '',
                        }
                      })}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Filter zurücksetzen
                    </Button>
                  </div>
                </div>
              </div>
              <div className="overflow-hidden">
                <div className="overflow-x-auto p-6">
                  <Table>
                    <TableCaption>Alle erfassten Geschäftsausgaben</TableCaption>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="font-medium">Datum</TableHead>
                        <TableHead className="font-medium">Beschreibung</TableHead>
                        <TableHead className="font-medium">Kategorie</TableHead>
                        <TableHead className="text-right font-medium">Betrag</TableHead>
                        <TableHead className="text-center font-medium">Steuerrelevant</TableHead>
                        <TableHead className="text-right font-medium"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredExpenses.length > 0 ? (
                        filteredExpenses.map((expense) => (
                          <TableRow key={expense.id} className="hover:bg-muted/50 transition-colors">
                            <TableCell className="text-muted-foreground">{new Date(expense.date).toLocaleDateString('de-DE')}</TableCell>
                            <TableCell className="font-medium text-base">{expense.description}</TableCell>
                            <TableCell className="text-muted-foreground text-base">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium bg-muted text-foreground">
                                {expense.category || 'Sonstiges'}
                              </span>
                            </TableCell>
                            <TableCell className="text-right font-medium text-red-600 dark:text-red-500">{formatCurrency(expense.amount)}</TableCell>
                            <TableCell className="text-center">
                              {expense.taxRelevant ? (
                                <span className="inline-flex items-center justify-center w-5 h-5 bg-green-100 dark:bg-green-800/30 rounded-full">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-green-600 dark:text-green-400" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                </span>
                              ) : (
                                <span className="inline-flex items-center justify-center w-5 h-5 bg-red-100 dark:bg-red-800/30 rounded-full">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-red-600 dark:text-red-400" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414z" clipRule="evenodd" />
                                  </svg>
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <TooltipProvider>
                                <div className="flex justify-end space-x-2">
                                  {expense.storedReceiptFileName && (
                                    <>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button 
                                            variant="outline" 
                                            size="icon"
                                            onClick={() => {
                                              window.open(`/api/expenses/download?id=${expense.id}`, '_blank');
                                            }}
                                          >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                            </svg>
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          <p>Beleg anzeigen</p>
                                        </TooltipContent>
                                      </Tooltip>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button 
                                            variant="outline" 
                                            size="icon"
                                            onClick={() => {
                                              window.open(`/api/expenses/download?id=${expense.id}&download=true`, '_blank');
                                            }}
                                          >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4-4m0 0l-4 4m4-4V4" />
                                            </svg>
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          <p>Beleg herunterladen</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    </>
                                  )}
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button 
                                        variant="outline" 
                                        size="icon"
                                        onClick={() => handleDuplicate(expense, 'expense')}
                                      >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h6a2 2 0 002-2v-8a2 2 0 00-2-2h-6a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                        </svg>
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p>Duplizieren</p>
                                    </TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button 
                                        variant="outline" 
                                        size="icon"
                                        onClick={() => openEditModal(expense, 'expense')}
                                      >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                        </svg>
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p>Bearbeiten</p>
                                    </TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button 
                                        variant="outline" 
                                        size="icon"
                                        className="text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-900/50 dark:hover:bg-red-900/20"
                                        onClick={() => handleDelete(expense.id, 'expense')}
                                        disabled={isDeleting}
                                      >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p>Löschen</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                              </TooltipProvider>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                            <div className="flex flex-col items-center justify-center">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-muted-foreground/30 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 00-2-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                              <span>Keine Ausgaben vorhanden. Erfassen Sie Ihre erste Ausgabe oben.</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          </TabsContent>
        
          {/* Einnahmen Tab */}
          <TabsContent value="incomes" className="space-y-6">
            <div className="bg-card rounded-xl shadow-sm border overflow-hidden">
              <div className="px-6 pt-6 pb-4 border-b">
                <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
                  <div>
                    <h2 className="text-xl font-semibold mb-1">Neue Einnahme erfassen</h2>
                    <p className="text-sm text-muted-foreground">
                      Erfassen Sie hier Ihre geschäftlichen Einnahmen
                    </p>
                  </div>
                </div>
              </div>
              <div className="p-6">
                <form onSubmit={handleIncomeSubmit} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label htmlFor="incomeDescription" className="text-sm font-medium">Beschreibung</Label>
                      <Input 
                        id="incomeDescription" 
                        value={newIncome.description}
                        onChange={(e) => setNewIncome({...newIncome, description: e.target.value})}
                        placeholder="z.B. Beratungsleistung"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="incomeAmount" className="text-sm font-medium">Betrag (€)</Label>
                      <Input 
                        id="incomeAmount" 
                        type="number"
                        step="0.01"
                        value={newIncome.amount}
                        onChange={(e) => setNewIncome({...newIncome, amount: e.target.value})}
                        placeholder="0.00"
                        required
                      />
                    </div>
                    <div className="space-y-2">
            <Label htmlFor="customer">Kunde/Auftraggeber</Label>
            <select
              id="customer"
              value={newIncome.customerId || ''}
              onChange={(e) => setNewIncome({...newIncome, customerId: e.target.value ? parseInt(e.target.value) : undefined})}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">Kunde auswählen (optional)</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </div>
                    <div className="flex items-center space-x-2 h-full pt-6">
                      <div className="relative inline-flex items-center">
                        <input
                          type="checkbox"
                          id="incomeTaxRelevant"
                          className="rounded border-input text-primary h-4 w-4"
                          checked={newIncome.taxRelevant}
                          onChange={(e) => setNewIncome({...newIncome, taxRelevant: e.target.checked})}
                        />
                        <Label htmlFor="incomeTaxRelevant" className="ml-2 text-sm font-medium">Steuerlich relevant</Label>
                      </div>
                    </div>
                  </div>
                  <div>
                    <Button type="submit" className="text-white bg-green-600 hover:bg-green-700">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                      Einnahme speichern
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          
            <div className="bg-card rounded-xl shadow-sm border overflow-hidden">
              <div className="px-6 pt-6 pb-4 border-b">
                <h2 className="text-xl font-semibold mb-2">Ihre Einnahmen</h2>
                <p className="text-sm text-muted-foreground mb-4">Filtern Sie Ihre Einnahmen nach verschiedenen Kriterien.</p>
                <div className="bg-muted/40 rounded-xl p-4 border">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                      <Label htmlFor="income-customer-filter" className="text-xs font-medium uppercase tracking-wide block mb-1.5 text-muted-foreground">Kunde</Label>
                      <div className="relative">
                        <select 
                          id="income-customer-filter"
                          className="w-full h-10 rounded-md border border-input pl-3 pr-8 py-2 bg-background text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary transition-all cursor-pointer"
                          value={filters.incomes.customer}
                          onChange={(e) => setFilters({
                            ...filters,
                            incomes: {
                              ...filters.incomes,
                              customer: e.target.value
                            }
                          })}
                        >
                          <option value="">Alle Kunden</option>
                          {uniqueCustomers.map(customer => (
                            <option key={customer} value={customer}>{customer}</option>
                          ))}
                        </select>
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                    </div>
                    
                    <div>
                      <Label htmlFor="income-date-filter" className="text-xs font-medium uppercase tracking-wide block mb-1.5 text-muted-foreground">Zeitraum</Label>
                      <div className="relative">
                        <select 
                          id="income-date-filter"
                          className="w-full h-10 rounded-md border border-input pl-3 pr-8 py-2 bg-background text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary transition-all cursor-pointer"
                          value={filters.incomes.dateRange}
                          onChange={(e) => setFilters({
                            ...filters,
                            incomes: {
                              ...filters.incomes,
                              dateRange: e.target.value as any
                            }
                          })}
                        >
                          <option value="all">Alle Zeiträume</option>
                          <option value="thisMonth">Aktueller Monat</option>
                          <option value="lastMonth">Letzter Monat</option>
                          <option value="thisYear">Aktuelles Jahr</option>
                        </select>
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                    </div>
                    
                    <div>
                      <Label htmlFor="income-tax-filter" className="text-xs font-medium uppercase tracking-wide block mb-1.5 text-muted-foreground">Steuerlich relevant</Label>
                      <div className="relative">
                        <select 
                          id="income-tax-filter"
                          className="w-full h-10 rounded-md border border-input pl-3 pr-8 py-2 bg-background text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary transition-all cursor-pointer"
                          value={filters.incomes.taxRelevant}
                          onChange={(e) => setFilters({
                            ...filters,
                            incomes: {
                              ...filters.incomes,
                              taxRelevant: e.target.value as any
                            }
                          })}
                        >
                          <option value="all">Alle</option>
                          <option value="yes">Ja</option>
                          <option value="no">Nein</option>
                        </select>
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                    </div>
                    
                    <div>
                      <Label htmlFor="income-search" className="text-xs font-medium uppercase tracking-wide block mb-1.5 text-muted-foreground">Suche</Label>
                      <div className="relative">
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                        </div>
                        <Input 
                          id="income-search"
                          type="text"
                          placeholder="Beschreibung, Kunde..."
                          value={filters.incomes.searchTerm}
                          className="pl-9 pr-8 h-10"
                          onChange={(e) => setFilters({
                            ...filters,
                            incomes: {
                              ...filters.incomes,
                              searchTerm: e.target.value
                            }
                          })}
                        />
                        {filters.incomes.searchTerm && (
                          <button 
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-none"
                            onClick={() => setFilters({
                              ...filters,
                              incomes: {
                                ...filters.incomes,
                                searchTerm: ''
                              }
                            })}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex mt-4 items-center justify-between">
                    <div className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">{filteredIncomes.length}</span> Einnahmen gefunden
                    </div>
                    
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="h-8 text-xs"
                      onClick={() => setFilters({
                        ...filters,
                        incomes: {
                          customer: '',
                          dateRange: 'all',
                          taxRelevant: 'all',
                          searchTerm: '',
                        }
                      })}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Filter zurücksetzen
                    </Button>
                  </div>
                </div>
              </div>
              <div className="overflow-hidden">
                <div className="overflow-x-auto p-6">
                  <Table>
                    <TableCaption>Alle erfassten Geschäftseinnahmen</TableCaption>
                    <TableHeader>
                      <TableRow className="bg-muted/50"><TableHead className="font-medium">Datum</TableHead><TableHead className="font-medium">Beschreibung</TableHead><TableHead className="font-medium">Kunde</TableHead><TableHead className="text-center font-medium">Steuerrelevant</TableHead><TableHead className="text-center font-medium">Rechnungsstatus</TableHead><TableHead className="text-right font-medium">Betrag</TableHead><TableHead className="text-right font-medium">Aktionen</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredIncomes.length > 0 ? (
                        filteredIncomes.map((income) => (
                          <TableRow key={income.id} className="hover:bg-muted/50 transition-colors">
                            <TableCell className="text-muted-foreground">{new Date(income.date).toLocaleDateString('de-DE')}</TableCell>
                            <TableCell className="font-medium">{income.description}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {income.customerName ? (
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-foreground">
                                  {income.customerName}
                                </span>
                              ) : "-"}
                            </TableCell>
                            <TableCell className="text-center">
                              {income.taxRelevant ? (
                                <span className="inline-flex items-center justify-center w-5 h-5 bg-green-100 dark:bg-green-800/30 rounded-full">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-green-600 dark:text-green-400" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                </span>
                              ) : (
                                <span className="inline-flex items-center justify-center w-5 h-5 bg-red-100 dark:bg-red-800/30 rounded-full">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-red-600 dark:text-red-400" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414z" clipRule="evenodd" />
                                  </svg>
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              {income.invoiceStatus ? (
                                <StatusBadge 
                                  status={income.invoiceStatus} 
                                  onStatusChange={(newStatus) => handleInvoiceStatusChange(income.invoiceId, newStatus)}
                                />
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-medium text-green-600 dark:text-green-500">{formatCurrency(income.amount)}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end space-x-2">
                                <Button 
                                  variant="outline" 
                                  size="sm"
                                  onClick={() => handleDuplicate(income, 'income')}
                                >
                                  Duplizieren
                                </Button>
                                <Button 
                                  variant="outline" 
                                  size="sm"
                                  onClick={() => openEditModal(income, 'income')}
                                >
                                  Bearbeiten
                                </Button>
                                <Button 
                                  variant="outline" 
                                  size="sm"
                                  className="text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-900/50 dark:hover:bg-red-900/20"
                                  onClick={() => handleDelete(income.id, 'income')}
                                  disabled={isDeleting}
                                >
                                  Löschen
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                            <div className="flex flex-col items-center justify-center">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-muted-foreground/30 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2z" />
                              </svg>
                              <span>Keine Einnahmen vorhanden. Erfassen Sie Ihre erste Einnahme oben.</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          </TabsContent>
        
          {/* Rechnungen Tab */}
          <TabsContent value="invoices" className="space-y-6">
            <div className="bg-card rounded-xl shadow-sm border overflow-hidden">
              <div className="px-6 pt-6 pb-4 border-b">
                <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
                  <div>
                    <h2 className="text-xl font-semibold mb-1">ZUGFeRD-Rechnung hochladen</h2>
                    <p className="text-sm text-muted-foreground">
                      Laden Sie Ihre ZUGFeRD-kompatiblen PDF-Rechnungen hoch. 
                      Die Daten werden automatisch extrahiert und verarbeitet.
                    </p>
                  </div>
                </div>
              </div>
              <div className="p-6">
                <div className="space-y-6">
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2">
                      <div className="border-2 border-dashed border-muted rounded-lg p-6 text-center">
                        <Input 
                          id="invoiceFile" 
                          type="file" 
                          accept=".pdf"
                          onChange={handleFileChange}
                          className="hidden"
                        />
                        <Label 
                          htmlFor="invoiceFile" 
                          className="cursor-pointer flex flex-col items-center justify-center h-full"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-muted-foreground/50 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                          </svg>
                          <span className="text-foreground font-medium">
                            {selectedFile ? selectedFile.name : 'Klicken Sie hier, um eine Datei auszuwählen'}
                          </span>
                          <span className="text-sm text-muted-foreground mt-1">
                            Unterstützt wird das PDF-Format
                          </span>
                        </Label>
                      </div>
                    </div>
                    <div className="flex flex-col justify-center">
                      <Button 
                        onClick={handleFileUpload} 
                        disabled={!selectedFile || isUploading}
                        className="w-full h-12 text-base"
                      >
                        {isUploading ? (
                          <>
                            <svg className="animate-spin h-5 w-5 mr-2 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Wird hochgeladen...
                          </>
                        ) : (
                          <>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4-4m0 0l-4 4m4-4V4" />
                            </svg>
                            Rechnung hochladen
                          </>
                        )}
                      </Button>
                      <p className="text-xs text-muted-foreground text-center mt-3">
                        Die Daten werden automatisch extrahiert und in Ihre Buchhaltung übernommen
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          
            <div className="bg-card rounded-xl shadow-sm border overflow-hidden">
              <div className="px-6 pt-6 pb-4 border-b">
                <h2 className="text-xl font-semibold">Ihre Rechnungen</h2>
                <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="invoice-status-filter" className="text-sm">Zahlungsstatus</Label>
                    <select 
                      id="invoice-status-filter"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={filters.invoices.paidStatus}
                      onChange={(e) => setFilters({
                        ...filters,
                        invoices: {
                          ...filters.invoices,
                          paidStatus: e.target.value as any
                        }
                      })}
                    >
                      <option value="all">Alle</option>
                      <option value="paid">Bezahlt</option>
                      <option value="unpaid">Offen</option>
                    </select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="invoice-date-filter" className="text-sm">Zeitraum</Label>
                    <select 
                      id="invoice-date-filter"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={filters.invoices.dateRange}
                      onChange={(e) => setFilters({
                        ...filters,
                        invoices: {
                          ...filters.invoices,
                          dateRange: e.target.value as any
                        }
                      })}
                    >
                      <option value="all">Alle Zeiträume</option>
                      <option value="thisMonth">Aktueller Monat</option>
                      <option value="lastMonth">Letzter Monat</option>
                      <option value="thisYear">Aktuelles Jahr</option>
                    </select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="invoice-search" className="text-sm">Suche</Label>
                    <div className="relative">
                      <Input 
                        id="invoice-search"
                        type="text"
                        placeholder="Rechnungsnummer oder Dateiname suchen..."
                        value={filters.invoices.searchTerm}
                        onChange={(e) => setFilters({
                          ...filters,
                          invoices: {
                            ...filters.invoices,
                            searchTerm: e.target.value
                          }
                        })}
                      />
                      {filters.invoices.searchTerm && (
                        <button 
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          onClick={() => setFilters({
                            ...filters,
                            invoices: {
                              ...filters.invoices,
                              searchTerm: ''
                            }
                          })}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="overflow-hidden">
                <div className="overflow-x-auto p-6">
                  <Table>
                    <TableCaption>Alle hochgeladenen Rechnungen</TableCaption>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="font-medium">Datum</TableHead>
                        <TableHead className="font-medium">Rechnungsnummer</TableHead>
                        <TableHead className="font-medium">Dateiname</TableHead>
                        <TableHead className="text-right font-medium">Betrag</TableHead>
                        <TableHead className="text-center font-medium">Status</TableHead>
                        <TableHead className="text-right font-medium">Aktionen</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredInvoices.length > 0 ? (
                        filteredInvoices.map((invoice) => (
                          <TableRow key={invoice.id} className="hover:bg-muted/50 transition-colors">
                            <TableCell className="text-muted-foreground">
                              {invoice.invoiceDate 
                                ? new Date(invoice.invoiceDate).toLocaleDateString('de-DE') 
                                : new Date(invoice.uploadedAt).toLocaleDateString('de-DE')}
                            </TableCell>
                            <TableCell className="font-medium">
                              {invoice.invoiceNumber || 
                                <span className="text-muted-foreground italic text-xs">Nicht verfügbar</span>}
                            </TableCell>
                            <TableCell className="text-muted-foreground max-w-[200px] truncate">
                              <div className="flex items-center">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-red-500 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                {invoice.fileName}
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {invoice.totalAmount 
                                ? formatCurrency(invoice.totalAmount) 
                                : <span className="text-muted-foreground italic text-xs">Nicht verfügbar</span>}
                            </TableCell>
                            <TableCell className="text-center">
                              <StatusBadge 
                                status={invoice.status} 
                                onStatusChange={(newStatus) => handleInvoiceStatusChange(invoice.id, newStatus)}
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end space-x-2">
                                <Button 
                                  variant="outline" 
                                  size="sm"
                                  onClick={() => {
                                    window.open(`/api/invoices/download?id=${invoice.id}`, '_blank');
                                  }}
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                  </svg>
                                  Anzeigen
                                </Button>
                                <Button 
                                  variant="outline" 
                                  size="sm"
                                  onClick={() => {
                                    window.open(`/api/invoices/download?id=${invoice.id}&download=true`, '_blank');
                                  }}
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4-4m0 0l-4 4m4-4V4" />
                                  </svg>
                                  Download
                                </Button>
                                <Button 
                                  variant="outline" 
                                  size="sm"
                                  onClick={() => {
                                    alert('Rechnungsdetails anzeigen - In einer zukünftigen Version verfügbar');
                                  }}
                                >
                                  Details
                                </Button>
                                <Button 
                                  variant="outline" 
                                  size="sm"
                                  className="text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-900/50 dark:hover:bg-red-900/20"
                                  onClick={() => handleInvoiceDelete(invoice.id)}
                                  disabled={isDeleting}
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                  Löschen
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                            <div className="flex flex-col items-center justify-center">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-muted-foreground/30 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 00-2-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                              <span>Keine Rechnungen vorhanden. Laden Sie Ihre erste Rechnung oben hoch.</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          </TabsContent>
        
          {/* EÜR Tab */}
          <TabsContent value="eur" className="space-y-6">
            <div className="bg-card rounded-xl shadow-sm border overflow-hidden">
              <div className="px-6 pt-6 pb-4 border-b">
                <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
                  <div>
                    <h2 className="text-xl font-semibold mb-1">Einnahmen-Überschuss-Rechnung</h2>
                    <p className="text-sm text-muted-foreground">
                      Ihre EÜR-Übersicht für steuerliche Zwecke
                    </p>
                  </div>
                  <Button 
                    onClick={handleExportEUR} 
                    className="self-start"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4-4m0 0l-4 4m4-4V4" />
                    </svg>
                    EÜR als CSV exportieren
                  </Button>
                </div>
              </div>
              <div className="p-6">
                <div className="space-y-8">
                  <div className="bg-muted rounded-lg p-6 border border-green-100 dark:border-green-800/20">
                    <h3 className="text-base sm:text-lg font-semibold text-green-700 flex items-center mb-4">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Betriebseinnahmen
                    </h3>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/70 border-border">
                            <TableHead className="font-medium">Kategorie</TableHead>
                            <TableHead className="text-right font-medium">Betrag</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          <TableRow className="border-border">
                            <TableCell className="text-foreground">Einnahmen (steuerpflichtig)</TableCell>
                            <TableCell className="text-right font-medium text-green-600">{formatCurrency(totalIncome)}</TableCell>
                          </TableRow>
                          <TableRow className="font-bold bg-muted/70 border-border">
                            <TableCell className="text-foreground">Summe Betriebseinnahmen</TableCell>
                            <TableCell className="text-right text-green-600">{formatCurrency(totalIncome)}</TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                  
                  <div className="bg-muted rounded-lg p-6 border border-red-100 dark:border-red-800/20">
                    <h3 className="text-base sm:text-lg font-semibold text-red-700 flex items-center mb-4">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Betriebsausgaben
                    </h3>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/70 border-border">
                            <TableHead className="font-medium">Kategorie</TableHead>
                            <TableHead className="text-right font-medium">Betrag</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {/* Gruppiere Ausgaben nach Kategorie */}
                          {Array.from(
                            expenses.reduce((acc, expense) => {
                              if (!expense.taxRelevant) return acc;
                              const category = expense.category || 'Sonstiges';
                              const deductibleAmount = expense.amount * (expense.taxDeductiblePercentage || 100) / 100;
                              acc.set(category, (acc.get(category) || 0) + deductibleAmount);
                              return acc;
                            }, new Map<string, number>())
                          ).map(([category, amount]) => (
                            <TableRow key={category} className="border-border">
                              <TableCell className="text-foreground">{category}</TableCell>
                              <TableCell className="text-right font-medium text-red-600">{formatCurrency(amount)}</TableCell>
                            </TableRow>
                          ))}
                          
                          <TableRow className="font-bold bg-muted/70 border-border">
                            <TableCell className="text-foreground">Summe Betriebsausgaben</TableCell>
                            <TableCell className="text-right text-red-600">{formatCurrency(totalExpense)}</TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                  
                  <div className="bg-muted rounded-lg p-6 border">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableBody>
                          <TableRow className="font-bold text-lg bg-muted/70 border-border">
                            <TableCell className="text-foreground">Gewinn/Verlust</TableCell>
                            <TableCell className="text-right">
                              <span className={`text-lg font-bold ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {formatCurrency(profit)}
                              </span>
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      
        {/* Bearbeitungs-Modal */}
        {editModalOpen && itemToEdit && (
          <EditModal 
            isOpen={editModalOpen}
            onClose={() => setEditModalOpen(false)}
            onSave={handleEditSave}
            data={itemToEdit}
            type={editType}
            customers={uniqueCustomers}
          />
        )}
      </div>
    </div>
  );
}
