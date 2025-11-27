"use client";

import React from 'react';
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
import { Combobox } from "@/components/ui/combobox";
import { AfaTableDialog } from "@/components/afa-table-dialog";
import { Expense, FilterState } from "@/types/dashboard";
import { formatCurrency } from "@/lib/dashboard-utils";

type NewExpense = {
  description: string;
  amount: string;
  date: string;
  category: string;
  taxRelevant: boolean;
  taxDeductiblePercentage: number;
  depreciationYears: string;
};

type ExpensesTabProps = {
  // Form state
  newExpense: NewExpense;
  setNewExpense: (expense: NewExpense) => void;
  expenseReceipt: File | null;
  setExpenseReceipt: (file: File | null) => void;
  onSubmit: (e: React.FormEvent) => void;
  
  // Filter state
  filters: FilterState['expenses'];
  setFilters: (filters: FilterState['expenses']) => void;
  uniqueCategories: string[];
  
  // Data
  expenses: Expense[];
  
  // Pagination
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  loadExpenses: (page: number, pageSize: number) => Promise<void>;
  
  // Export
  isExportingReceipts: boolean;
  exportError: string | null;
  onExportReceipts: () => void;
  
  // Actions
  onEdit: (expense: Expense) => void;
  onDuplicate: (expense: Expense) => void;
  onDelete: (id: number) => void;
  onViewReceipt: (url: string) => void;
  isDeleting: boolean;
  
  // Recurring expenses
  onOpenRecurringExpenses?: () => void;
};

export function ExpensesTab({
  newExpense,
  setNewExpense,
  expenseReceipt,
  setExpenseReceipt,
  onSubmit,
  filters,
  setFilters,
  uniqueCategories,
  expenses,
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  onPageSizeChange,
  loadExpenses,
  isExportingReceipts,
  exportError,
  onExportReceipts,
  onEdit,
  onDuplicate,
  onDelete,
  onViewReceipt,
  isDeleting,
  onOpenRecurringExpenses,
}: ExpensesTabProps) {
  return (
    <div className="space-y-6">
      {/* New Expense Form */}
      <div className="bg-card rounded-xl shadow-sm border overflow-hidden transition-all duration-300 hover:shadow-md">
        <div className="px-6 pt-6 pb-4 border-b bg-gradient-to-r from-red-50/50 to-red-50/30 dark:from-red-900/10 dark:to-red-900/5">
          <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
            <div>
              <h2 className="text-xl font-semibold mb-1 flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Neue Ausgabe erfassen
              </h2>
              <p className="text-sm text-muted-foreground">
                Erfassen Sie hier Ihre geschäftlichen Ausgaben
              </p>
            </div>
            <div className="flex items-center gap-2">
              {onOpenRecurringExpenses && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onOpenRecurringExpenses}
                  className="flex items-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Wiederkehrende Ausgaben
                </Button>
              )}
              <div className="flex items-center text-xs text-muted-foreground bg-muted rounded-lg px-3 py-1.5">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Steuerlich relevante Ausgaben werden in der EÜR berücksichtigt
              </div>
            </div>
          </div>
        </div>
        <div className="p-6">
          <form onSubmit={onSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="description" className="text-sm font-medium">Beschreibung</Label>
                <Input
                  id="description"
                  value={newExpense.description}
                  onChange={(e) => setNewExpense({ ...newExpense, description: e.target.value })}
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
                  onChange={(e) => setNewExpense({ ...newExpense, amount: e.target.value })}
                  placeholder="0.00"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="date" className="text-sm font-medium">Datum</Label>
                <Input
                  id="date"
                  type="date"
                  value={newExpense.date}
                  onChange={(e) => setNewExpense({ ...newExpense, date: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="category" className="text-sm font-medium">Kategorie</Label>
                <Combobox
                  id="category"
                  value={newExpense.category}
                  onChange={(value) => setNewExpense({ ...newExpense, category: value })}
                  options={uniqueCategories}
                  placeholder="z.B. Bürobedarf"
                  allowCustom={true}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="receipt" className="text-sm font-medium">Beleg hochladen (optional)</Label>
                <div className="border-2 border-dashed border-muted rounded-lg p-6 text-center transition-colors hover:border-primary/50 hover:bg-muted/50">
                  <Input
                    id="receipt"
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={(e) => setExpenseReceipt(e.target.files ? e.target.files[0] : null)}
                    className="hidden"
                  />
                  <Label
                    htmlFor="receipt"
                    className="cursor-pointer flex flex-col items-center justify-center"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-muted-foreground mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <span className="text-foreground font-medium">
                      {expenseReceipt ? expenseReceipt.name : 'Klicken Sie hier, um eine Datei auszuwählen'}
                    </span>
                    <span className="text-sm text-muted-foreground mt-1">
                      Unterstützt wird: PDF, JPG, PNG
                    </span>
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Bei geschäftlichen Ausgaben hilft der Beleg bei der Steuererklärung
                </p>
              </div>
              <div className="flex items-center space-x-2 h-full pt-6">
                <div className="relative inline-flex items-center">
                  <input
                    type="checkbox"
                    id="taxRelevant"
                    className="rounded border-input text-primary h-4 w-4"
                    checked={newExpense.taxRelevant}
                    onChange={(e) => setNewExpense({ ...newExpense, taxRelevant: e.target.checked })}
                  />
                  <Label htmlFor="taxRelevant" className="ml-2 text-sm font-medium">Steuerlich relevant</Label>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="taxDeductiblePercentage" className="text-sm font-medium">Steuerlich ansetzbar (%)</Label>
                  <Input
                    id="taxDeductiblePercentage"
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={newExpense.taxDeductiblePercentage}
                    onChange={(e) => setNewExpense({ ...newExpense, taxDeductiblePercentage: parseInt(e.target.value) || 0 })}
                    placeholder="100"
                  />
                  <p className="text-xs text-muted-foreground">
                    Geschäftlicher Anteil
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="depreciationYears" className="text-sm font-medium">Abschreibung (Jahre)</Label>
                    <AfaTableDialog onSelect={(years) => setNewExpense({ ...newExpense, depreciationYears: years.toString() })} />
                  </div>
                  <Input
                    id="depreciationYears"
                    type="number"
                    min="0"
                    step="1"
                    value={newExpense.depreciationYears}
                    onChange={(e) => setNewExpense({ ...newExpense, depreciationYears: e.target.value })}
                    placeholder="Optional (z.B. 3)"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Für Wirtschaftsgüter über 800€ (netto). Unter 800€: Feld leer lassen.
                  </p>
                </div>
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

      {/* Expenses List */}
      <div className="bg-card rounded-xl shadow-sm border overflow-hidden">
        <div className="px-6 pt-6 pb-4 border-b">
          <h2 className="text-xl font-semibold mb-2">Ihre Ausgaben</h2>
          <p className="text-sm text-muted-foreground mb-4">Filtern Sie Ihre Ausgaben nach verschiedenen Kriterien.</p>
          <div className="bg-muted/40 rounded-xl p-4 border">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              {/* Category Filter */}
              <div>
                <Label htmlFor="expense-category-filter" className="text-xs font-medium uppercase tracking-wide block mb-1.5 text-muted-foreground">Kategorie</Label>
                <div className="relative">
                  <select
                    id="expense-category-filter"
                    className="w-full h-10 rounded-md border border-input pl-3 pr-8 py-2 bg-background text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary transition-all cursor-pointer"
                    value={filters.category}
                    onChange={(e) => setFilters({ ...filters, category: e.target.value })}
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

              {/* Date Range Filter */}
              <div>
                <Label htmlFor="expense-date-filter" className="text-xs font-medium uppercase tracking-wide block mb-1.5 text-muted-foreground">Zeitraum</Label>
                <div className="relative">
                  <select
                    id="expense-date-filter"
                    className="w-full h-10 rounded-md border border-input pl-3 pr-8 py-2 bg-background text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary transition-all cursor-pointer"
                    value={filters.dateRange}
                    onChange={(e) => setFilters({ ...filters, dateRange: e.target.value as FilterState['expenses']['dateRange'] })}
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

              {/* Tax Relevant Filter */}
              <div>
                <Label htmlFor="expense-tax-filter" className="text-xs font-medium uppercase tracking-wide block mb-1.5 text-muted-foreground">Steuerlich relevant</Label>
                <div className="relative">
                  <select
                    id="expense-tax-filter"
                    className="w-full h-10 rounded-md border border-input pl-3 pr-8 py-2 bg-background text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary transition-all cursor-pointer"
                    value={filters.taxRelevant}
                    onChange={(e) => setFilters({ ...filters, taxRelevant: e.target.value as FilterState['expenses']['taxRelevant'] })}
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

              {/* Has Receipt Filter */}
              <div>
                <Label htmlFor="expense-receipt-filter" className="text-xs font-medium uppercase tracking-wide block mb-1.5 text-muted-foreground">Beleg vorhanden</Label>
                <div className="relative">
                  <select
                    id="expense-receipt-filter"
                    className="w-full h-10 rounded-md border border-input pl-3 pr-8 py-2 bg-background text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary transition-all cursor-pointer"
                    value={filters.hasReceipt}
                    onChange={(e) => setFilters({ ...filters, hasReceipt: e.target.value as FilterState['expenses']['hasReceipt'] })}
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

              {/* Search */}
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
                    value={filters.searchTerm}
                    className="pl-9 pr-8 h-10"
                    onChange={(e) => setFilters({ ...filters, searchTerm: e.target.value })}
                  />
                  {filters.searchTerm && (
                    <button
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-none"
                      onClick={() => setFilters({ ...filters, searchTerm: '' })}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Filter Actions */}
            <div className="flex flex-col gap-3 mt-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{expenses.length}</span> Ausgaben gefunden
                </div>
                {exportError && (
                  <p className="mt-1 text-xs text-red-600">
                    {exportError}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  onClick={onExportReceipts}
                  disabled={isExportingReceipts}
                >
                  {isExportingReceipts ? (
                    <>
                      <svg className="animate-spin h-3.5 w-3.5 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                      </svg>
                      Export läuft...
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M7 10l5 5m0 0l5-5m-5 5V4" />
                      </svg>
                      Belege exportieren
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setFilters({
                    category: '',
                    dateRange: 'all',
                    taxRelevant: 'all',
                    hasReceipt: 'all',
                    searchTerm: '',
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
        </div>

        {/* Expenses Table */}
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
                {expenses.length > 0 ? (
                  expenses.map((expense) => (
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
                                      onClick={() => onViewReceipt(`/api/expenses/download?id=${expense.id}`)}
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
                                        window.open(`/api/expenses/download?id=${expense.id}&download=true`, 'Beleg Download', 'width=800,height=600,scrollbars=yes,resizable=yes');
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
                                  onClick={() => onDuplicate(expense)}
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
                                  onClick={() => onEdit(expense)}
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
                                  onClick={() => onDelete(expense.id)}
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

          {/* Pagination */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-6 pb-6">
            <div className="text-sm text-muted-foreground">
              Seite {page} von {totalPages} · {total} Einträge
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="expenses-page-size" className="text-sm">Pro Seite</Label>
              <select
                id="expenses-page-size"
                value={pageSize}
                onChange={async (e) => {
                  const size = parseInt(e.target.value);
                  onPageSizeChange(size);
                  onPageChange(1);
                  await loadExpenses(1, size);
                }}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={async () => {
                  const p = Math.max(1, page - 1);
                  onPageChange(p);
                  await loadExpenses(p, pageSize);
                }}
              >Zurück</Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={async () => {
                  const p = Math.min(totalPages, page + 1);
                  onPageChange(p);
                  await loadExpenses(p, pageSize);
                }}
              >Weiter</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
