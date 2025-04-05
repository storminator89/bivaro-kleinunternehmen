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

  // Hauptkomponente rendern
  return (
    <div className="container py-8">
      <h1 className="text-3xl font-bold mb-8">Buchhaltung für Kleinunternehmer</h1>
      
      {/* Übersichtskarte */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Finanzübersicht</CardTitle>
          <CardDescription>Stand: {new Date().toLocaleDateString('de-DE')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-green-50 rounded-lg">
              <h3 className="text-lg font-medium text-green-800">Einnahmen</h3>
              <p className="text-2xl font-bold text-green-600">{formatCurrency(totalIncome)}</p>
            </div>
            <div className="p-4 bg-red-50 rounded-lg">
              <h3 className="text-lg font-medium text-red-800">Ausgaben</h3>
              <p className="text-2xl font-bold text-red-600">{formatCurrency(totalExpense)}</p>
            </div>
            <div className="p-4 bg-blue-50 rounded-lg">
              <h3 className="text-lg font-medium text-blue-800">Gewinn</h3>
              <p className={`text-2xl font-bold ${profit >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                {formatCurrency(profit)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Tabs für verschiedene Sektionen */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="expenses">Ausgaben</TabsTrigger>
          <TabsTrigger value="incomes">Einnahmen</TabsTrigger>
          <TabsTrigger value="invoices">Rechnungen</TabsTrigger>
          <TabsTrigger value="eur">EÜR</TabsTrigger>
        </TabsList>
        
        {/* Ausgaben Tab */}
        <TabsContent value="expenses" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Neue Ausgabe erfassen</CardTitle>
              <CardDescription>
                Erfassen Sie hier Ihre geschäftlichen Ausgaben.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleExpenseSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="description">Beschreibung</Label>
                    <Input 
                      id="description" 
                      value={newExpense.description}
                      onChange={(e) => setNewExpense({...newExpense, description: e.target.value})}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="amount">Betrag (€)</Label>
                    <Input 
                      id="amount" 
                      type="number"
                      step="0.01"
                      value={newExpense.amount}
                      onChange={(e) => setNewExpense({...newExpense, amount: e.target.value})}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="category">Kategorie</Label>
                    <Input 
                      id="category" 
                      value={newExpense.category}
                      onChange={(e) => setNewExpense({...newExpense, category: e.target.value})}
                    />
                  </div>
                  <div className="flex items-center space-x-2 pt-8">
                    <input
                      type="checkbox"
                      id="taxRelevant"
                      className="h-4 w-4"
                      checked={newExpense.taxRelevant}
                      onChange={(e) => setNewExpense({...newExpense, taxRelevant: e.target.checked})}
                    />
                    <Label htmlFor="taxRelevant" className="font-normal">Steuerlich relevant</Label>
                  </div>
                </div>
                <Button type="submit">Ausgabe speichern</Button>
              </form>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle>Ihre Ausgaben</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableCaption>Alle erfassten Geschäftsausgaben</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Datum</TableHead>
                    <TableHead>Beschreibung</TableHead>
                    <TableHead>Kategorie</TableHead>
                    <TableHead className="text-right">Betrag</TableHead>
                    <TableHead className="text-center">Steuerrelevant</TableHead>
                    <TableHead className="text-right">Aktionen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expenses.length > 0 ? (
                    expenses.map((expense) => (
                      <TableRow key={expense.id}>
                        <TableCell>{new Date(expense.date).toLocaleDateString('de-DE')}</TableCell>
                        <TableCell>{expense.description}</TableCell>
                        <TableCell>{expense.category || 'Sonstiges'}</TableCell>
                        <TableCell className="text-right">{formatCurrency(expense.amount)}</TableCell>
                        <TableCell className="text-center">{expense.taxRelevant ? '✓' : '✗'}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end space-x-2">
                            <Button 
                              variant="outline" 
                              size="sm" 
                              onClick={() => openEditModal(expense, 'expense')}
                            >
                              Bearbeiten
                            </Button>
                            <Button 
                              variant="outline" 
                              size="sm"
                              className="text-red-600 hover:text-red-800"
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
                      <TableCell colSpan={6} className="text-center">
                        Keine Ausgaben vorhanden. Erfassen Sie Ihre erste Ausgabe oben.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        
        {/* Einnahmen Tab */}
        <TabsContent value="incomes" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Neue Einnahme erfassen</CardTitle>
              <CardDescription>
                Erfassen Sie hier Ihre geschäftlichen Einnahmen.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleIncomeSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="incomeDescription">Beschreibung</Label>
                    <Input 
                      id="incomeDescription" 
                      value={newIncome.description}
                      onChange={(e) => setNewIncome({...newIncome, description: e.target.value})}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="incomeAmount">Betrag (€)</Label>
                    <Input 
                      id="incomeAmount" 
                      type="number"
                      step="0.01"
                      value={newIncome.amount}
                      onChange={(e) => setNewIncome({...newIncome, amount: e.target.value})}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="customer">Kunde/Auftraggeber</Label>
                    <Input 
                      id="customer" 
                      value={newIncome.customer}
                      onChange={(e) => setNewIncome({...newIncome, customer: e.target.value})}
                    />
                  </div>
                  <div className="flex items-center space-x-2 pt-8">
                    <input
                      type="checkbox"
                      id="incomeTaxRelevant"
                      className="h-4 w-4"
                      checked={newIncome.taxRelevant}
                      onChange={(e) => setNewIncome({...newIncome, taxRelevant: e.target.checked})}
                    />
                    <Label htmlFor="incomeTaxRelevant" className="font-normal">Steuerlich relevant</Label>
                  </div>
                </div>
                <Button type="submit">Einnahme speichern</Button>
              </form>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle>Ihre Einnahmen</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableCaption>Alle erfassten Geschäftseinnahmen</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Datum</TableHead>
                    <TableHead>Beschreibung</TableHead>
                    <TableHead>Kunde</TableHead>
                    <TableHead className="text-right">Betrag</TableHead>
                    <TableHead className="text-center">Steuerrelevant</TableHead>
                    <TableHead className="text-right">Aktionen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {incomes.length > 0 ? (
                    incomes.map((income) => (
                      <TableRow key={income.id}>
                        <TableCell>{new Date(income.date).toLocaleDateString('de-DE')}</TableCell>
                        <TableCell>{income.description}</TableCell>
                        <TableCell>{income.customer || '-'}</TableCell>
                        <TableCell className="text-right">{formatCurrency(income.amount)}</TableCell>
                        <TableCell className="text-center">{income.taxRelevant ? '✓' : '✗'}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end space-x-2">
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
                              className="text-red-600 hover:text-red-800"
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
                      <TableCell colSpan={6} className="text-center">
                        Keine Einnahmen vorhanden. Erfassen Sie Ihre erste Einnahme oben.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        
        {/* Rechnungen Tab */}
        <TabsContent value="invoices" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>ZUGFeRD-Rechnung hochladen</CardTitle>
              <CardDescription>
                Laden Sie Ihre ZUGFeRD-kompatiblen PDF-Rechnungen hoch. 
                Die Daten werden automatisch extrahiert und verarbeitet.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="grid w-full max-w-sm items-center gap-1.5">
                  <Label htmlFor="invoiceFile">Rechnung (PDF)</Label>
                  <Input 
                    id="invoiceFile" 
                    type="file" 
                    accept=".pdf"
                    onChange={handleFileChange}
                  />
                </div>
                <Button 
                  onClick={handleFileUpload} 
                  disabled={!selectedFile || isUploading}
                >
                  {isUploading ? 'Wird hochgeladen...' : 'Rechnung hochladen'}
                </Button>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle>Ihre Rechnungen</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableCaption>Alle hochgeladenen Rechnungen</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Datum</TableHead>
                    <TableHead>Rechnungsnummer</TableHead>
                    <TableHead>Dateiname</TableHead>
                    <TableHead className="text-right">Betrag</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="text-right">Aktionen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.length > 0 ? (
                    invoices.map((invoice) => (
                      <TableRow key={invoice.id}>
                        <TableCell>
                          {invoice.invoiceDate 
                            ? new Date(invoice.invoiceDate).toLocaleDateString('de-DE') 
                            : new Date(invoice.uploadedAt).toLocaleDateString('de-DE')}
                        </TableCell>
                        <TableCell>{invoice.invoiceNumber || '-'}</TableCell>
                        <TableCell>{invoice.fileName}</TableCell>
                        <TableCell className="text-right">
                          {invoice.totalAmount 
                            ? formatCurrency(invoice.totalAmount) 
                            : '-'}
                        </TableCell>
                        <TableCell className="text-center">
                          <button 
                            className={`px-2 py-1 rounded-full text-xs cursor-pointer hover:opacity-80 transition-opacity ${
                              invoice.paidStatus 
                                ? 'bg-green-100 text-green-800 hover:bg-green-200' 
                                : 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
                            }`}
                            onClick={() => handleToggleInvoiceStatus(invoice.id, invoice.paidStatus)}
                            title={`Klicken, um Status auf "${invoice.paidStatus ? 'Offen' : 'Bezahlt'}" zu ändern`}
                          >
                            {invoice.paidStatus ? 'Bezahlt' : 'Offen'}
                          </button>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end space-x-2">
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => {
                                // Direkter Download der Rechnung über den neuen API-Endpunkt
                                window.open(`/api/invoices/download?id=${invoice.id}`, '_blank');
                              }}
                            >
                              Download
                            </Button>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => {
                                // In einer erweiterten Version könnte hier ein Modal 
                                // zur Bearbeitung der Rechnungsdaten geöffnet werden
                                alert('Rechnungsdetails anzeigen - In einer zukünftigen Version verfügbar');
                              }}
                            >
                              Details
                            </Button>
                            <Button 
                              variant="outline" 
                              size="sm"
                              className="text-red-600 hover:text-red-800"
                              onClick={() => handleInvoiceDelete(invoice.id)}
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
                      <TableCell colSpan={6} className="text-center">
                        Keine Rechnungen vorhanden. Laden Sie Ihre erste Rechnung oben hoch.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        
        {/* EÜR Tab */}
        <TabsContent value="eur" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Einnahmen-Überschuss-Rechnung</CardTitle>
              <CardDescription>
                Ihre EÜR-Übersicht für steuerliche Zwecke.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-medium mb-2">Betriebseinnahmen</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Kategorie</TableHead>
                        <TableHead className="text-right">Betrag</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell>Einnahmen (steuerpflichtig)</TableCell>
                        <TableCell className="text-right">{formatCurrency(totalIncome)}</TableCell>
                      </TableRow>
                      <TableRow className="font-bold">
                        <TableCell>Summe Betriebseinnahmen</TableCell>
                        <TableCell className="text-right">{formatCurrency(totalIncome)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
                
                <div>
                  <h3 className="text-lg font-medium mb-2">Betriebsausgaben</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Kategorie</TableHead>
                        <TableHead className="text-right">Betrag</TableHead>
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
                        <TableRow key={category}>
                          <TableCell>{category}</TableCell>
                          <TableCell className="text-right">{formatCurrency(amount)}</TableCell>
                        </TableRow>
                      ))}
                      
                      <TableRow className="font-bold">
                        <TableCell>Summe Betriebsausgaben</TableCell>
                        <TableCell className="text-right">{formatCurrency(totalExpense)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
                
                <div className="border-t pt-4">
                  <Table>
                    <TableBody>
                      <TableRow className="font-bold text-lg">
                        <TableCell>Gewinn/Verlust</TableCell>
                        <TableCell className="text-right">
                          <span className={profit >= 0 ? 'text-green-600' : 'text-red-600'}>
                            {formatCurrency(profit)}
                          </span>
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Button>EÜR exportieren</Button>
            </CardFooter>
          </Card>
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
  );
}
