"use client";

import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
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
import { Combobox } from "@/components/ui/combobox";

type RecurringExpense = {
  id: number;
  description: string;
  amount: number;
  category: string | null;
  taxRelevant: boolean;
  taxDeductiblePercentage: number | null;
  interval: string;
  dayOfMonth: number;
  startDate: string;
  endDate: string | null;
  lastExecuted: string | null;
  nextExecution: string;
  isActive: boolean;
  dueCount?: number; // Anzahl der fälligen Ausführungen
};

type RecurringExpensesModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onExpensesCreated?: () => void;
  uniqueCategories?: string[];
};

const INTERVAL_LABELS: Record<string, string> = {
  MONTHLY: 'Monatlich',
  QUARTERLY: 'Vierteljährlich',
  YEARLY: 'Jährlich',
};

export function RecurringExpensesModal({ isOpen, onClose, onExpensesCreated, uniqueCategories = [] }: RecurringExpensesModalProps) {
  const [recurringExpenses, setRecurringExpenses] = useState<RecurringExpense[]>([]);
  const [dueCount, setDueCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [availableCategories, setAvailableCategories] = useState<string[]>(uniqueCategories);
  
  // Bestätigungsdialog State
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });
  
  // Success/Error Message State
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    description: '',
    amount: '',
    category: '',
    taxRelevant: true,
    taxDeductiblePercentage: '100',
    interval: 'MONTHLY',
    dayOfMonth: '1',
    startDate: new Date().toISOString().split('T')[0],
    endDate: '',
  });

  // Update available categories when props change
  useEffect(() => {
    setAvailableCategories(uniqueCategories);
  }, [uniqueCategories]);

  const loadRecurringExpenses = async () => {
    setIsLoading(true);
    try {
      const [expensesRes, dueRes] = await Promise.all([
        fetch('/api/recurring-expenses'),
        fetch('/api/recurring-expenses/execute'),
      ]);
      
      let allExpenses: RecurringExpense[] = [];
      let dueItemsMap: Map<number, number> = new Map();
      
      if (expensesRes.ok) {
        allExpenses = await expensesRes.json();
      }
      
      if (dueRes.ok) {
        const dueData = await dueRes.json();
        setDueCount(dueData.count);
        // Map der fälligen Counts erstellen
        dueData.items?.forEach((item: RecurringExpense) => {
          if (item.dueCount) {
            dueItemsMap.set(item.id, item.dueCount);
          }
        });
      }
      
      // dueCount in die Hauptliste mergen
      const expensesWithDueCount = allExpenses.map(expense => ({
        ...expense,
        dueCount: dueItemsMap.get(expense.id) || 0,
      }));
      
      setRecurringExpenses(expensesWithDueCount);
    } catch (error) {
      console.error('Error loading recurring expenses:', error);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    if (isOpen) {
      loadRecurringExpenses();
    }
  }, [isOpen]);

  const resetForm = () => {
    setFormData({
      description: '',
      amount: '',
      category: '',
      taxRelevant: true,
      taxDeductiblePercentage: '100',
      interval: 'MONTHLY',
      dayOfMonth: '1',
      startDate: new Date().toISOString().split('T')[0],
      endDate: '',
    });
    setEditingId(null);
    setShowAddForm(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const payload = {
        ...(editingId && { id: editingId }),
        description: formData.description,
        amount: parseFloat(formData.amount),
        category: formData.category || null,
        taxRelevant: formData.taxRelevant,
        taxDeductiblePercentage: parseFloat(formData.taxDeductiblePercentage),
        interval: formData.interval,
        dayOfMonth: parseInt(formData.dayOfMonth),
        startDate: formData.startDate,
        endDate: formData.endDate || null,
      };

      const response = await fetch('/api/recurring-expenses', {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        resetForm();
        await loadRecurringExpenses();
      } else {
        const error = await response.json();
        alert(`Fehler: ${error.error}`);
      }
    } catch (error) {
      console.error('Error saving recurring expense:', error);
      alert('Fehler beim Speichern');
    }
    setIsLoading(false);
  };

  const handleEdit = (expense: RecurringExpense) => {
    setFormData({
      description: expense.description,
      amount: expense.amount.toString(),
      category: expense.category || '',
      taxRelevant: expense.taxRelevant,
      taxDeductiblePercentage: (expense.taxDeductiblePercentage || 100).toString(),
      interval: expense.interval,
      dayOfMonth: expense.dayOfMonth.toString(),
      startDate: new Date(expense.startDate).toISOString().split('T')[0],
      endDate: expense.endDate ? new Date(expense.endDate).toISOString().split('T')[0] : '',
    });
    setEditingId(expense.id);
    setShowAddForm(true);
  };

  const handleDelete = async (id: number) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Wiederkehrende Ausgabe löschen',
      message: 'Möchten Sie diese wiederkehrende Ausgabe wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.',
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));
        try {
          const response = await fetch(`/api/recurring-expenses?id=${id}`, {
            method: 'DELETE',
          });
          
          if (response.ok) {
            await loadRecurringExpenses();
          }
        } catch (error) {
          console.error('Error deleting recurring expense:', error);
        }
      },
    });
  };

  const handleToggleActive = async (expense: RecurringExpense) => {
    try {
      const response = await fetch('/api/recurring-expenses', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: expense.id, isActive: !expense.isActive }),
      });
      
      if (response.ok) {
        await loadRecurringExpenses();
      }
    } catch (error) {
      console.error('Error toggling recurring expense:', error);
    }
  };

  const handleExecuteAll = async () => {
    setConfirmDialog({
      isOpen: true,
      title: 'Ausgaben erstellen',
      message: `Möchten Sie ${dueCount} fällige Ausgabe(n) jetzt erstellen? Die Ausgaben werden mit den jeweiligen Fälligkeitsdaten in Ihrer Buchhaltung erfasst.`,
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));
        setIsExecuting(true);
        try {
          const response = await fetch('/api/recurring-expenses/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
          
          if (response.ok) {
            const result = await response.json();
            await loadRecurringExpenses();
            onExpensesCreated?.();
            // Erfolgsmeldung als Toast/Banner statt alert
            setSuccessMessage(`${result.created} Ausgabe(n) erfolgreich erstellt!`);
            setTimeout(() => setSuccessMessage(null), 5000);
          }
        } catch (error) {
          console.error('Error executing recurring expenses:', error);
          setErrorMessage('Fehler beim Ausführen der wiederkehrenden Ausgaben');
          setTimeout(() => setErrorMessage(null), 5000);
        }
        setIsExecuting(false);
      },
    });
  };

  const handleExecuteSingle = async (id: number, expense: RecurringExpense) => {
    const count = expense.dueCount || 1;
    setConfirmDialog({
      isOpen: true,
      title: 'Ausgabe erstellen',
      message: count > 1 
        ? `${count} fällige Ausführungen für "${expense.description}" jetzt erstellen?`
        : `Ausgabe "${expense.description}" jetzt erstellen?`,
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));
        setIsExecuting(true);
        try {
          const response = await fetch('/api/recurring-expenses/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id }),
          });
          
          if (response.ok) {
            const result = await response.json();
            if (result.created > 0) {
              await loadRecurringExpenses();
              onExpensesCreated?.();
              setSuccessMessage(`${result.created} Ausgabe(n) erfolgreich erstellt!`);
              setTimeout(() => setSuccessMessage(null), 5000);
            } else {
              setErrorMessage('Diese Ausgabe ist noch nicht fällig.');
              setTimeout(() => setErrorMessage(null), 5000);
            }
          }
        } catch (error) {
          console.error('Error executing recurring expense:', error);
        }
        setIsExecuting(false);
      },
    });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Wiederkehrende Ausgaben
          </DialogTitle>
          <DialogDescription>
            Verwalten Sie regelmäßige Ausgaben wie Miete, Abonnements oder Versicherungen.
          </DialogDescription>
        </DialogHeader>

        {/* Fällige Ausgaben Banner */}
        {dueCount > 0 && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="font-medium text-amber-800 dark:text-amber-200">
                {dueCount} fällige Ausgabe(n)
              </span>
            </div>
            <Button
              size="sm"
              onClick={handleExecuteAll}
              disabled={isExecuting}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {isExecuting ? 'Wird erstellt...' : 'Alle erstellen'}
            </Button>
          </div>
        )}

        {/* Add/Edit Form */}
        {showAddForm ? (
          <form onSubmit={handleSubmit} className="space-y-4 border rounded-lg p-4 bg-muted/30">
            <h3 className="font-medium">{editingId ? 'Bearbeiten' : 'Neue wiederkehrende Ausgabe'}</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="description">Beschreibung *</Label>
                <Input
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="z.B. Büromiete"
                  required
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="amount">Betrag (€) *</Label>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  placeholder="0.00"
                  required
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="category">Kategorie</Label>
                <Combobox
                  id="category"
                  value={formData.category}
                  onChange={(value) => setFormData({ ...formData, category: value })}
                  options={availableCategories}
                  placeholder="z.B. Miete, Software, Versicherung"
                  allowCustom={true}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="interval">Intervall *</Label>
                <select
                  id="interval"
                  value={formData.interval}
                  onChange={(e) => setFormData({ ...formData, interval: e.target.value })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="MONTHLY">Monatlich</option>
                  <option value="QUARTERLY">Vierteljährlich</option>
                  <option value="YEARLY">Jährlich</option>
                </select>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="dayOfMonth">Tag des Monats</Label>
                <Input
                  id="dayOfMonth"
                  type="number"
                  min="1"
                  max="31"
                  value={formData.dayOfMonth}
                  onChange={(e) => setFormData({ ...formData, dayOfMonth: e.target.value })}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="taxDeductiblePercentage">Steuerlich ansetzbar (%)</Label>
                <Input
                  id="taxDeductiblePercentage"
                  type="number"
                  min="0"
                  max="100"
                  value={formData.taxDeductiblePercentage}
                  onChange={(e) => setFormData({ ...formData, taxDeductiblePercentage: e.target.value })}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="startDate">Startdatum</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="endDate">Enddatum (optional)</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={formData.endDate}
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                />
              </div>
            </div>
            
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="taxRelevant"
                checked={formData.taxRelevant}
                onChange={(e) => setFormData({ ...formData, taxRelevant: e.target.checked })}
                className="h-4 w-4 rounded border-input"
              />
              <Label htmlFor="taxRelevant" className="font-normal">Steuerlich relevant</Label>
            </div>
            
            <div className="flex gap-2">
              <Button type="submit" disabled={isLoading}>
                {isLoading ? 'Speichern...' : 'Speichern'}
              </Button>
              <Button type="button" variant="outline" onClick={resetForm}>
                Abbrechen
              </Button>
            </div>
          </form>
        ) : (
          <Button onClick={() => setShowAddForm(true)} className="w-full md:w-auto">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Neue wiederkehrende Ausgabe
          </Button>
        )}

        {/* Table */}
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>Beschreibung</TableHead>
                <TableHead>Betrag</TableHead>
                <TableHead>Intervall</TableHead>
                <TableHead>Nächste Ausführung</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">Laden...</TableCell>
                </TableRow>
              ) : recurringExpenses.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    Keine wiederkehrenden Ausgaben vorhanden
                  </TableCell>
                </TableRow>
              ) : (
                recurringExpenses.map((expense) => {
                  const isDue = new Date(expense.nextExecution) <= new Date();
                  return (
                    <TableRow key={expense.id} className={!expense.isActive ? 'opacity-50' : ''}>
                      <TableCell>
                        <div>
                          <span className="font-medium">{expense.description}</span>
                          {expense.category && (
                            <span className="ml-2 text-xs bg-muted px-2 py-0.5 rounded">{expense.category}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">{formatCurrency(expense.amount)}</TableCell>
                      <TableCell>{INTERVAL_LABELS[expense.interval]}</TableCell>
                      <TableCell>
                        <span className={isDue && expense.isActive ? 'text-amber-600 font-medium' : ''}>
                          {new Date(expense.nextExecution).toLocaleDateString('de-DE')}
                        </span>
                        {isDue && expense.isActive && (
                          <span className="ml-2 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded">
                            {expense.dueCount && expense.dueCount > 1 
                              ? `${expense.dueCount}x fällig` 
                              : 'Fällig'}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <button
                          onClick={() => handleToggleActive(expense)}
                          className={`px-2 py-1 text-xs rounded ${
                            expense.isActive 
                              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' 
                              : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                          }`}
                        >
                          {expense.isActive ? 'Aktiv' : 'Pausiert'}
                        </button>
                      </TableCell>
                      <TableCell className="text-right">
                        <TooltipProvider>
                          <div className="flex justify-end gap-1">
                            {expense.isActive && isDue && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => handleExecuteSingle(expense.id, expense)}
                                    disabled={isExecuting}
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Jetzt ausführen</TooltipContent>
                              </Tooltip>
                            )}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => handleEdit(expense)}
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                  </svg>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Bearbeiten</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="icon"
                                  className="h-8 w-8 text-red-600 border-red-200 hover:bg-red-50"
                                  onClick={() => handleDelete(expense.id)}
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Löschen</TooltipContent>
                            </Tooltip>
                          </div>
                        </TooltipProvider>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Schließen</Button>
        </DialogFooter>

        {/* Success/Error Messages */}
        {successMessage && (
          <div className="fixed bottom-4 right-4 bg-green-100 dark:bg-green-900/30 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200 px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-in slide-in-from-bottom-5">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {successMessage}
            <button onClick={() => setSuccessMessage(null)} className="ml-2 hover:opacity-70">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        {errorMessage && (
          <div className="fixed bottom-4 right-4 bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-in slide-in-from-bottom-5">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {errorMessage}
            <button onClick={() => setErrorMessage(null)} className="ml-2 hover:opacity-70">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </DialogContent>

      {/* Bestätigungsdialog */}
      <Dialog open={confirmDialog.isOpen} onOpenChange={(open) => !open && setConfirmDialog(prev => ({ ...prev, isOpen: false }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              {confirmDialog.title}
            </DialogTitle>
            <DialogDescription className="pt-2">
              {confirmDialog.message}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}>
              Abbrechen
            </Button>
            <Button onClick={confirmDialog.onConfirm}>
              Bestätigen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
