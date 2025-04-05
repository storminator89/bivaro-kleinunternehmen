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
import { format } from 'date-fns';
import { useSearchParams, useRouter } from 'next/navigation';

// Typdefinitionen
type Expense = {
  id: number;
  description: string;
  amount: number;
  date: string;
  category?: string;
  taxRelevant: boolean;
};

type Income = {
  id: number;
  description: string;
  amount: number;
  date: string;
  customer?: string;
  taxRelevant: boolean;
};

type Invoice = {
  id: number;
  fileName: string;
  uploadedAt: string;
  invoiceNumber?: string;
  totalAmount?: number;
  paidStatus: boolean;
  invoiceDate?: string;
  dueDate?: string;
};

// Das Modal für die Bearbeitung
type EditModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: any) => void;
  data: any;
  type: 'expense' | 'income';
};

// Einfache Modal-Komponente für die Bearbeitung
const EditModal = ({ isOpen, onClose, onSave, data, type }: EditModalProps) => {
  const [formData, setFormData] = useState(data);
  
  if (!isOpen) return null;
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
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
            />
          </div>
          
          {type === 'expense' && (
            <div className="space-y-2">
              <Label htmlFor="edit-category">Kategorie</Label>
              <Input 
                id="edit-category" 
                value={formData.category || ''}
                onChange={(e) => setFormData({...formData, category: e.target.value})}
              />
            </div>
          )}
          
          {type === 'income' && (
            <div className="space-y-2">
              <Label htmlFor="edit-customer">Kunde</Label>
              <Input 
                id="edit-customer" 
                value={formData.customer || ''}
                onChange={(e) => setFormData({...formData, customer: e.target.value})}
              />
            </div>
          )}
          
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="edit-taxRelevant"
              className="h-4 w-4"
              checked={formData.taxRelevant}
              onChange={(e) => setFormData({...formData, taxRelevant: e.target.checked})}
            />
            <Label htmlFor="edit-taxRelevant" className="font-normal">Steuerlich relevant</Label>
          </div>
          
          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Abbrechen
            </Button>
            <Button type="submit">
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
    taxRelevant: true
  });
  
  const [newIncome, setNewIncome] = useState({
    description: '',
    amount: '',
    customer: '',
    taxRelevant: true
  });
  
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

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
      const response = await fetch('/api/expenses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          description: newExpense.description,
          amount: parseFloat(newExpense.amount),
          category: newExpense.category,
          taxRelevant: newExpense.taxRelevant
        }),
      });

      if (response.ok) {
        const createdExpense = await response.json();
        setExpenses([createdExpense, ...expenses]);
        setNewExpense({
          description: '',
          amount: '',
          category: 'Sonstiges',
          taxRelevant: true
        });
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
          customer: newIncome.customer,
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
  const openEditModal = (item: any, type: 'expense' | 'income') => {
    setItemToEdit({...item, amount: item.amount.toString()});
    setEditType(type);
    setEditModalOpen(true);
  };
  
  const handleEditSave = async (formData: any) => {
    try {
      const endpoint = editType === 'expense' ? '/api/expenses' : '/api/incomes';
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        const updatedItem = await response.json();
        
        if (editType === 'expense') {
          setExpenses(expenses.map(item => item.id === updatedItem.id ? updatedItem : item));
        } else {
          setIncomes(incomes.map(item => item.id === updatedItem.id ? updatedItem : item));
        }
        
        setEditModalOpen(false);
      }
    } catch (error) {
      console.error(`Error updating ${editType}:`, error);
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

  // Handler zur Änderung des Zahlungsstatus einer Rechnung
  const handleToggleInvoiceStatus = async (id: number, currentStatus: boolean) => {
    try {
      const response = await fetch('/api/invoices', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id,
          paidStatus: !currentStatus, // Status umkehren
        }),
      });

      if (response.ok) {
        const updatedInvoice = await response.json();
        // Aktualisiere die Rechnung in der lokalen Liste
        setInvoices(invoices.map(invoice => 
          invoice.id === id ? updatedInvoice : invoice
        ));
      }
    } catch (error) {
      console.error('Error updating invoice status:', error);
    }
  };

  // Berechnungen für EÜR
  const totalIncome = incomes.reduce((sum, income) => 
    income.taxRelevant ? sum + income.amount : sum, 0);
  
  const totalExpense = expenses.reduce((sum, expense) => 
    expense.taxRelevant ? sum + expense.amount : sum, 0);
  
  const profit = totalIncome - totalExpense;

  // Formatierungsfunktion
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('de-DE', { 
      style: 'currency', 
      currency: 'EUR' 
    }).format(amount);
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
        acc.set(category, (acc.get(category) || 0) + expense.amount);
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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-slate-100 dark:from-gray-900 dark:to-gray-800">
      <div className="container max-w-7xl mx-auto px-4 py-10">
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10">
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-500 to-purple-600 mb-2">
              Buchhaltung für Kleinunternehmer
            </h1>
            <p className="text-gray-500 dark:text-gray-400">
              Verwalten Sie Ihre Finanzen einfach und effizient
            </p>
          </div>
          <div className="mt-4 md:mt-0">
            <span className="bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 px-3 py-1 rounded-md text-sm font-medium">
              {new Date().toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })}
            </span>
          </div>
        </header>
      
        {/* Übersichtskarte */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
          <div className="lg:col-span-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden transition-all hover:shadow-md">
              <div className="px-6 pt-6 pb-4">
                <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-1">
                  Finanzübersicht
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Stand: {new Date().toLocaleDateString('de-DE')}
                </p>
              </div>
              <div className="p-6 pt-2">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-5 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-emerald-900/20 dark:to-green-900/30 dark:bg-gray-800 rounded-xl border border-green-100 dark:border-emerald-800/30">
                    <div className="flex items-center">
                      <div className="mr-4 bg-green-100 dark:bg-emerald-800/30 p-3 rounded-lg">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div>
                        <h3 className="font-medium text-green-700 dark:text-green-400 mb-1">Einnahmen</h3>
                        <p className="text-2xl font-bold text-green-600 dark:text-green-300">{formatCurrency(totalIncome)}</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-5 bg-gradient-to-br from-red-50 to-rose-50 dark:from-rose-900/20 dark:to-red-900/30 dark:bg-gray-800 rounded-xl border border-red-100 dark:border-red-800/30">
                    <div className="flex items-center">
                      <div className="mr-4 bg-red-100 dark:bg-red-800/30 p-3 rounded-lg">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div>
                        <h3 className="font-medium text-red-700 dark:text-red-400 mb-1">Ausgaben</h3>
                        <p className="text-2xl font-bold text-red-600 dark:text-red-300">{formatCurrency(totalExpense)}</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-5 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-indigo-900/20 dark:to-blue-900/30 dark:bg-gray-800 rounded-xl border border-blue-100 dark:border-blue-800/30">
                    <div className="flex items-center">
                      <div className="mr-4 bg-blue-100 dark:bg-blue-800/30 p-3 rounded-lg">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <div>
                        <h3 className="font-medium text-blue-700 dark:text-blue-400 mb-1">Gewinn</h3>
                        <p className={`text-2xl font-bold ${profit >= 0 ? 'text-blue-600 dark:text-blue-300' : 'text-red-600 dark:text-red-300'}`}>
                          {formatCurrency(profit)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      
        {/* Tabs für verschiedene Sektionen */}
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full space-y-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-1 shadow-sm border border-gray-100 dark:border-gray-700">
            <TabsList className="w-full grid grid-cols-4 gap-2 bg-transparent">
              <TabsTrigger 
                value="expenses" 
                className="data-[state=active]:bg-indigo-50 data-[state=active]:text-indigo-700 dark:data-[state=active]:bg-indigo-900/30 dark:data-[state=active]:text-indigo-300 rounded-lg"
              >
                Ausgaben
              </TabsTrigger>
              <TabsTrigger 
                value="incomes" 
                className="data-[state=active]:bg-indigo-50 data-[state=active]:text-indigo-700 dark:data-[state=active]:bg-indigo-900/30 dark:data-[state=active]:text-indigo-300 rounded-lg"
              >
                Einnahmen
              </TabsTrigger>
              <TabsTrigger 
                value="invoices" 
                className="data-[state=active]:bg-indigo-50 data-[state=active]:text-indigo-700 dark:data-[state=active]:bg-indigo-900/30 dark:data-[state=active]:text-indigo-300 rounded-lg"
              >
                Rechnungen
              </TabsTrigger>
              <TabsTrigger 
                value="eur" 
                className="data-[state=active]:bg-indigo-50 data-[state=active]:text-indigo-700 dark:data-[state=active]:bg-indigo-900/30 dark:data-[state=active]:text-indigo-300 rounded-lg"
              >
                EÜR
              </TabsTrigger>
            </TabsList>
          </div>
        
          {/* Ausgaben Tab */}
          <TabsContent value="expenses" className="space-y-6">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
              <div className="px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-700">
                <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-800 dark:text-white">Neue Ausgabe erfassen</h2>
                    <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
                      Erfassen Sie hier Ihre geschäftlichen Ausgaben
                    </p>
                  </div>
                  <div className="flex items-center text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 py-1.5">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                        className="bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-700"
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
                        className="bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-700"
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
                        className="bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-700"
                        placeholder="z.B. Bürobedarf"
                      />
                    </div>
                    <div className="flex items-center space-x-2 h-full pt-6">
                      <div className="relative inline-flex items-center">
                        <input
                          type="checkbox"
                          id="taxRelevant"
                          className="rounded border-gray-300 text-indigo-600 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50 h-4 w-4"
                          checked={newExpense.taxRelevant}
                          onChange={(e) => setNewExpense({...newExpense, taxRelevant: e.target.checked})}
                        />
                        <Label htmlFor="taxRelevant" className="ml-2 text-sm font-medium">Steuerlich relevant</Label>
                      </div>
                    </div>
                  </div>
                  <div>
                    <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                      Ausgabe speichern
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
              <div className="px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-700">
                <h2 className="text-xl font-semibold text-gray-800 dark:text-white">Ihre Ausgaben</h2>
              </div>
              <div className="overflow-hidden">
                <div className="overflow-x-auto">
                  <Table>
                    <TableCaption>Alle erfassten Geschäftsausgaben</TableCaption>
                    <TableHeader>
                      <TableRow className="bg-gray-50 dark:bg-gray-700/50">
                        <TableHead className="font-medium">Datum</TableHead>
                        <TableHead className="font-medium">Beschreibung</TableHead>
                        <TableHead className="font-medium">Kategorie</TableHead>
                        <TableHead className="text-right font-medium">Betrag</TableHead>
                        <TableHead className="text-center font-medium">Steuerrelevant</TableHead>
                        <TableHead className="text-right font-medium">Aktionen</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {expenses.length > 0 ? (
                        expenses.map((expense) => (
                          <TableRow key={expense.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                            <TableCell className="text-gray-600 dark:text-gray-300">{new Date(expense.date).toLocaleDateString('de-DE')}</TableCell>
                            <TableCell className="font-medium text-gray-900 dark:text-white">{expense.description}</TableCell>
                            <TableCell className="text-gray-600 dark:text-gray-300">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300">
                                {expense.category || 'Sonstiges'}
                              </span>
                            </TableCell>
                            <TableCell className="text-right font-medium text-gray-900 dark:text-white">{formatCurrency(expense.amount)}</TableCell>
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
                                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                  </svg>
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end space-x-2">
                                <Button 
                                  variant="outline" 
                                  size="sm"
                                  className="text-gray-600 border-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700/50 h-8" 
                                  onClick={() => openEditModal(expense, 'expense')}
                                >
                                  Bearbeiten
                                </Button>
                                <Button 
                                  variant="outline" 
                                  size="sm"
                                  className="text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-900/50 dark:hover:bg-red-900/20 h-8"
                                  onClick={() => handleDelete(expense.id, 'expense')}
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
                          <TableCell colSpan={6} className="text-center py-8 text-gray-500 dark:text-gray-400">
                            <div className="flex flex-col items-center justify-center">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-300 dark:text-gray-600 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
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
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
              <div className="px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-700">
                <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-800 dark:text-white">Neue Einnahme erfassen</h2>
                    <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
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
                        className="bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-700"
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
                        className="bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-700"
                        placeholder="0.00"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="customer" className="text-sm font-medium">Kunde/Auftraggeber</Label>
                      <Input 
                        id="customer" 
                        value={newIncome.customer}
                        onChange={(e) => setNewIncome({...newIncome, customer: e.target.value})}
                        className="bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-700"
                        placeholder="z.B. Firma XYZ GmbH"
                      />
                    </div>
                    <div className="flex items-center space-x-2 h-full pt-6">
                      <div className="relative inline-flex items-center">
                        <input
                          type="checkbox"
                          id="incomeTaxRelevant"
                          className="rounded border-gray-300 text-indigo-600 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50 h-4 w-4"
                          checked={newIncome.taxRelevant}
                          onChange={(e) => setNewIncome({...newIncome, taxRelevant: e.target.checked})}
                        />
                        <Label htmlFor="incomeTaxRelevant" className="ml-2 text-sm font-medium">Steuerlich relevant</Label>
                      </div>
                    </div>
                  </div>
                  <div>
                    <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                      Einnahme speichern
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
              <div className="px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-700">
                <h2 className="text-xl font-semibold text-gray-800 dark:text-white">Ihre Einnahmen</h2>
              </div>
              <div className="overflow-hidden">
                <div className="overflow-x-auto">
                  <Table>
                    <TableCaption>Alle erfassten Geschäftseinnahmen</TableCaption>
                    <TableHeader>
                      <TableRow className="bg-gray-50 dark:bg-gray-700/50">
                        <TableHead className="font-medium">Datum</TableHead>
                        <TableHead className="font-medium">Beschreibung</TableHead>
                        <TableHead className="font-medium">Kunde</TableHead>
                        <TableHead className="text-right font-medium">Betrag</TableHead>
                        <TableHead className="text-center font-medium">Steuerrelevant</TableHead>
                        <TableHead className="text-right font-medium">Aktionen</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {incomes.length > 0 ? (
                        incomes.map((income) => (
                          <TableRow key={income.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                            <TableCell className="text-gray-600 dark:text-gray-300">{new Date(income.date).toLocaleDateString('de-DE')}</TableCell>
                            <TableCell className="font-medium text-gray-900 dark:text-white">{income.description}</TableCell>
                            <TableCell className="text-gray-600 dark:text-gray-300">
                              {income.customer ? (
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-800/30 text-blue-800 dark:text-blue-300">
                                  {income.customer}
                                </span>
                              ) : "-"}
                            </TableCell>
                            <TableCell className="text-right font-medium text-green-600 dark:text-green-400">{formatCurrency(income.amount)}</TableCell>
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
                                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                  </svg>
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end space-x-2">
                                <Button 
                                  variant="outline" 
                                  size="sm"
                                  className="text-gray-600 border-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700/50 h-8"
                                  onClick={() => openEditModal(income, 'income')}
                                >
                                  Bearbeiten
                                </Button>
                                <Button 
                                  variant="outline" 
                                  size="sm"
                                  className="text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-900/50 dark:hover:bg-red-900/20 h-8"
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
                          <TableCell colSpan={6} className="text-center py-8 text-gray-500 dark:text-gray-400">
                            <div className="flex flex-col items-center justify-center">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-300 dark:text-gray-600 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
              <div className="px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-700">
                <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-800 dark:text-white">ZUGFeRD-Rechnung hochladen</h2>
                    <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
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
                      <div className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg p-6 text-center">
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
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-gray-400 dark:text-gray-500 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                          </svg>
                          <span className="text-gray-600 dark:text-gray-400 font-medium">
                            {selectedFile ? selectedFile.name : 'Klicken Sie hier, um eine Datei auszuwählen'}
                          </span>
                          <span className="text-sm text-gray-500 dark:text-gray-500 mt-1">
                            Unterstützt wird das PDF-Format
                          </span>
                        </Label>
                      </div>
                    </div>
                    <div className="flex flex-col justify-center">
                      <Button 
                        onClick={handleFileUpload} 
                        disabled={!selectedFile || isUploading}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white w-full h-12 text-base"
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
                      <p className="text-xs text-gray-500 dark:text-gray-400 text-center mt-3">
                        Die Daten werden automatisch extrahiert und in Ihre Buchhaltung übernommen
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
              <div className="px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-700">
                <h2 className="text-xl font-semibold text-gray-800 dark:text-white">Ihre Rechnungen</h2>
              </div>
              <div className="overflow-hidden">
                <div className="overflow-x-auto">
                  <Table>
                    <TableCaption>Alle hochgeladenen Rechnungen</TableCaption>
                    <TableHeader>
                      <TableRow className="bg-gray-50 dark:bg-gray-700/50">
                        <TableHead className="font-medium">Datum</TableHead>
                        <TableHead className="font-medium">Rechnungsnummer</TableHead>
                        <TableHead className="font-medium">Dateiname</TableHead>
                        <TableHead className="text-right font-medium">Betrag</TableHead>
                        <TableHead className="text-center font-medium">Status</TableHead>
                        <TableHead className="text-right font-medium">Aktionen</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoices.length > 0 ? (
                        invoices.map((invoice) => (
                          <TableRow key={invoice.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                            <TableCell className="text-gray-600 dark:text-gray-300">
                              {invoice.invoiceDate 
                                ? new Date(invoice.invoiceDate).toLocaleDateString('de-DE') 
                                : new Date(invoice.uploadedAt).toLocaleDateString('de-DE')}
                            </TableCell>
                            <TableCell className="font-medium text-gray-900 dark:text-white">
                              {invoice.invoiceNumber || 
                                <span className="text-gray-400 dark:text-gray-500 italic text-xs">Nicht verfügbar</span>}
                            </TableCell>
                            <TableCell className="text-gray-600 dark:text-gray-300 max-w-[200px] truncate">
                              <div className="flex items-center">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-red-500 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                </svg>
                                {invoice.fileName}
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-medium text-gray-900 dark:text-white">
                              {invoice.totalAmount 
                                ? formatCurrency(invoice.totalAmount) 
                                : <span className="text-gray-400 dark:text-gray-500 italic text-xs">Nicht verfügbar</span>}
                            </TableCell>
                            <TableCell className="text-center">
                              <button 
                                className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium 
                                  ${invoice.paidStatus 
                                    ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' 
                                    : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                                  } hover:bg-opacity-80 transition-colors`}
                                onClick={() => handleToggleInvoiceStatus(invoice.id, invoice.paidStatus)}
                                title={`Klicken, um Status auf "${invoice.paidStatus ? 'Offen' : 'Bezahlt'}" zu ändern`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full mr-1.5 inline-block
                                  ${invoice.paidStatus ? 'bg-green-500 dark:bg-green-400' : 'bg-yellow-500 dark:bg-yellow-400'}`}>
                                </span>
                                {invoice.paidStatus ? 'Bezahlt' : 'Offen'}
                              </button>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end space-x-2">
                                <Button 
                                  variant="outline" 
                                  size="sm"
                                  className="text-gray-600 border-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700/50 h-8"
                                  onClick={() => {
                                    window.open(`/api/invoices/download?id=${invoice.id}`, '_blank');
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
                                  className="text-gray-600 border-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700/50 h-8"
                                  onClick={() => {
                                    alert('Rechnungsdetails anzeigen - In einer zukünftigen Version verfügbar');
                                  }}
                                >
                                  Details
                                </Button>
                                <Button 
                                  variant="outline" 
                                  size="sm"
                                  className="text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-900/50 dark:hover:bg-red-900/20 h-8"
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
                          <TableCell colSpan={6} className="text-center py-8 text-gray-500 dark:text-gray-400">
                            <div className="flex flex-col items-center justify-center">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-300 dark:text-gray-600 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
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
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
              <div className="px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-700">
                <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-800 dark:text-white">Einnahmen-Überschuss-Rechnung</h2>
                    <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
                      Ihre EÜR-Übersicht für steuerliche Zwecke
                    </p>
                  </div>
                  <Button 
                    onClick={handleExportEUR} 
                    className="bg-indigo-600 hover:bg-indigo-700 text-white self-start"
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
                  <div className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/10 dark:to-emerald-900/10 rounded-lg p-6 border border-green-100 dark:border-green-800/20">
                    <h3 className="text-base sm:text-lg font-semibold text-green-800 dark:text-green-400 flex items-center mb-4">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Betriebseinnahmen
                    </h3>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-green-200 dark:border-green-800/30 bg-green-100/50 dark:bg-green-900/20">
                            <TableHead className="font-medium text-green-800 dark:text-green-400">Kategorie</TableHead>
                            <TableHead className="text-right font-medium text-green-800 dark:text-green-400">Betrag</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          <TableRow className="border-green-200 dark:border-green-800/30">
                            <TableCell className="text-green-700 dark:text-green-300">Einnahmen (steuerpflichtig)</TableCell>
                            <TableCell className="text-right font-medium text-green-700 dark:text-green-300">{formatCurrency(totalIncome)}</TableCell>
                          </TableRow>
                          <TableRow className="font-bold border-green-200 dark:border-green-800/30 bg-green-100/50 dark:bg-green-900/20">
                            <TableCell className="text-green-800 dark:text-green-400">Summe Betriebseinnahmen</TableCell>
                            <TableCell className="text-right text-green-800 dark:text-green-400">{formatCurrency(totalIncome)}</TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                  
                  <div className="bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-900/10 dark:to-rose-900/10 rounded-lg p-6 border border-red-100 dark:border-red-800/20">
                    <h3 className="text-base sm:text-lg font-semibold text-red-800 dark:text-red-400 flex items-center mb-4">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Betriebsausgaben
                    </h3>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-red-200 dark:border-red-800/30 bg-red-100/50 dark:bg-red-900/20">
                            <TableHead className="font-medium text-red-800 dark:text-red-400">Kategorie</TableHead>
                            <TableHead className="text-right font-medium text-red-800 dark:text-red-400">Betrag</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {/* Gruppiere Ausgaben nach Kategorie */}
                          {Array.from(
                            expenses.reduce((acc, expense) => {
                              if (!expense.taxRelevant) return acc;
                              const category = expense.category || 'Sonstiges';
                              acc.set(category, (acc.get(category) || 0) + expense.amount);
                              return acc;
                            }, new Map<string, number>())
                          ).map(([category, amount]) => (
                            <TableRow key={category} className="border-red-200 dark:border-red-800/30">
                              <TableCell className="text-red-700 dark:text-red-300">{category}</TableCell>
                              <TableCell className="text-right font-medium text-red-700 dark:text-red-300">{formatCurrency(amount)}</TableCell>
                            </TableRow>
                          ))}
                          
                          <TableRow className="font-bold border-red-200 dark:border-red-800/30 bg-red-100/50 dark:bg-red-900/20">
                            <TableCell className="text-red-800 dark:text-red-400">Summe Betriebsausgaben</TableCell>
                            <TableCell className="text-right text-red-800 dark:text-red-400">{formatCurrency(totalExpense)}</TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                  
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/10 dark:to-indigo-900/10 rounded-lg p-6 border border-blue-100 dark:border-blue-800/20">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableBody>
                          <TableRow className="font-bold text-lg border-blue-200 dark:border-blue-800/30 bg-blue-100/50 dark:bg-blue-900/20">
                            <TableCell className="text-blue-800 dark:text-blue-400">Gewinn/Verlust</TableCell>
                            <TableCell className="text-right">
                              <span className={`text-lg font-bold ${profit >= 0 ? 'text-blue-600 dark:text-blue-300' : 'text-red-600 dark:text-red-300'}`}>
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
          />
        )}
      </div>
    </div>
  );
}
