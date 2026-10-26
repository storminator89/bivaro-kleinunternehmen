"use client";

import styles from './cashflow-workspace.module.css';

import type { ManualRecordOpener } from '@/components/manual-financial-records/manual-record-status';
import { ExpenseRowActions } from '@/components/dashboard/expense-row-actions';
import { LedgerSortControl, SortableLedgerHead } from '@/components/dashboard/ledger-sort-control';
import { DashboardIcon } from "@/components/brand/dashboard-icon";
import { ChevronDown } from "lucide-react";
import React, { useMemo } from 'react';
import { QueryFeedback } from '@/components/dashboard/query-feedback';
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
import { Combobox } from "@/components/ui/combobox";
import { AfaTableDialog } from "@/components/afa-table-dialog";
import { Expense, FilterState } from "@/types/dashboard";
import { LedgerListHeading } from "@/components/dashboard/ledger-list-heading";
import { formatCurrency } from "@/lib/dashboard-utils";
import { getRecommendedExpenseCategories } from "@/lib/eur-line-mapping";
import { ManualEntrySubmitFeedback, type ManualEntrySubmitControls } from '@/components/dashboard/manual-entry-submit-feedback';

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
  isLoading?: boolean;
  isError?: boolean;
  entryOpen: boolean;
  onEntryOpenChange: (open: boolean) => void;

  // Form state
  newExpense: NewExpense;
  setNewExpense: (expense: NewExpense) => void;
  expenseReceipt: File | null;
  expenseReceiptInputKey?: number;
  setExpenseReceipt: (file: File | null) => void;
  onSubmit: (e: React.FormEvent) => void;
  submission?: ManualEntrySubmitControls;

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
  onManualRecord?: ManualRecordOpener;
  onEdit: (expense: Expense) => void;
  onDuplicate: (expense: Expense) => void;
  onDelete: (id: number) => void;
  onViewReceipt: (url: string) => void;
  isDeleting: boolean;

  // Recurring expenses
  onOpenRecurringExpenses?: () => void;
};

export function ExpensesTab({
  isLoading = false,
  isError = false,
  entryOpen,
  onEntryOpenChange,
  newExpense,
  setNewExpense,
  expenseReceipt,
  expenseReceiptInputKey,
  setExpenseReceipt,
  onSubmit,
  submission,
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
  onManualRecord,
  onEdit,
  onDuplicate,
  onDelete,
  onViewReceipt,
  isDeleting,
  onOpenRecurringExpenses,
}: ExpensesTabProps) {
  // Combine user's existing categories with EÜR-recommended categories
  // Filter out user categories that are synonyms (already mapped to EÜR lines)
  const allCategories = useMemo(() => {
    const eurCategories = getRecommendedExpenseCategories();
    const eurCategorySet = new Set(eurCategories.map(c => c.toLowerCase()));

    // Only add user categories that are NOT already in the EÜR list
    // and are truly custom (not synonyms that would map to the same line)
    const customUserCategories = uniqueCategories.filter(userCat => {
      const lowerCat = userCat.toLowerCase();
      // Skip if it's already an EÜR primary category
      if (eurCategorySet.has(lowerCat)) return false;
      // Skip common synonyms that users might have used before
      const synonymsToSkip = [
        'telefon', 'internet', 'mobilfunk', 'handy', 'telekommunikation',
        'miete', 'raumkosten', 'büromiete', 'nebenkosten',
        'werbung', 'marketing', 'werbekosten',
        'versicherung', 'versicherungen', 'beiträge', 'gebühren', 'ihk',
        'porto', 'versand', 'paket',
        'steuerberater', 'beratung', 'rechtsanwalt', 'beratungskosten',
        'abschreibung', 'abschreibungen', 'afa',
        'waren', 'material', 'materialkosten', 'rohstoffe', 'einkauf',
        'fremdleistung', 'subunternehmer',
        'personal', 'löhne', 'gehälter', 'lohn', 'minijob',
        'kfz', 'fahrzeugkosten', 'benzin', 'tankkosten',
        'sonstiges', 'sonstige kosten', 'verschiedenes'
      ];
      return !synonymsToSkip.includes(lowerCat);
    });

    const combined = new Set([...eurCategories, ...customUserCategories]);
    return Array.from(combined).sort((a, b) => a.localeCompare(b, 'de'));
  }, [uniqueCategories]);

  const sort = { sortBy: filters.sortBy ?? 'date', sortOrder: filters.sortOrder ?? 'desc' };
  const hasFilters = Boolean(filters.searchTerm || filters.dateRange !== 'all' || filters.taxRelevant !== 'all' || filters.category || filters.hasReceipt !== 'all');
  const entryLocked = Boolean(submission && submission.state.phase !== 'idle');
  const entryPending = submission?.state.phase === 'pending';
  return (
    <div className={`bookkeeping-workspace ${styles.workspace}`}>
      <details id="expense-entry" hidden={!entryOpen} className="entry-panel overflow-hidden rounded-xl border bg-card" open={entryOpen} onToggle={event => onEntryOpenChange(event.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 sm:px-6">
          <span className="flex min-w-0 items-center gap-3"><span className="entry-symbol"><DashboardIcon name="tile-expenses" size={44} /></span><span><span className="block text-sm font-semibold">Neue Ausgabe</span></span></span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </summary>
        <div className="border-t p-4 sm:p-6">
          {onOpenRecurringExpenses && <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><Button variant="outline" size="sm" disabled={entryLocked} onClick={onOpenRecurringExpenses}>Wiederkehrende Ausgaben</Button></div>}
          <form onSubmit={onSubmit} aria-busy={entryPending}>
            <fieldset disabled={entryLocked} inert={entryLocked} className="min-w-0 space-y-6">
            <div className={styles.entryFields}>
              <div className={styles.entryDescription}>
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
                  options={allCategories}
                  placeholder="z.B. Bürobedarf, Telefon, Werbung..."
                  allowCustom={true}
                />

              </div>
              <div className={styles.attachmentField}>
                <Label htmlFor="receipt" className="text-sm font-medium">Beleg hochladen (optional)</Label>
                <div className={styles.attachment}>
                  <Input
                    key={expenseReceiptInputKey}
                    id="receipt"
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={(e) => setExpenseReceipt(e.target.files ? e.target.files[0] : null)}
                    className={styles.fileInput}
                  />
                  <Label
                    htmlFor="receipt"
                    className={styles.attachmentLabel}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-muted-foreground mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <span className="text-foreground font-medium">
                      {expenseReceipt ? expenseReceipt.name : 'Datei auswählen'}
                    </span>
                    <span className="text-sm text-muted-foreground mt-1">
                      PDF · JPG · PNG
                    </span>
                  </Label>
                </div>

              </div>
              <div className={styles.taxToggle}>
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
              <div className={styles.taxFields}>
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

                </div>
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
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
                    Bis 800 € netto: leer lassen.
                  </p>
                </div>
              </div>
            </div>
            <div>
              <Button type="submit" disabled={entryLocked} aria-busy={entryPending}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                {entryPending ? 'Ausgabe wird gespeichert …' : 'Ausgabe speichern'}
              </Button>
            </div>
            </fieldset>
          </form>
          <ManualEntrySubmitFeedback controls={submission} nextLabel="Weitere Ausgabe erfassen" />
        </div>
      </details>

      {/* Expenses List */}
      <div className={`ledger-list ${styles.ledger}`}>
        <div className={styles.ledgerHeader}>
          <LedgerListHeading icon="nav-expenses" isLoading={isLoading} isError={isError} title="Ihre Ausgaben" total={total} amounts={isError || isLoading ? [] : expenses.map(item => item.amount)} />
          <div className="ledger-filters">
            <div className={styles.filters}>
              {/* Search */}
              <div className={styles.search}>
                <Label htmlFor="expense-search" className="text-xs font-medium block mb-1.5 text-muted-foreground">Suche</Label>
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
                      type="button"
                      aria-label="Suche leeren"
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

              {/* Category Filter */}
              <div>
                <Label htmlFor="expense-category-filter" className="text-xs font-medium block mb-1.5 text-muted-foreground">Kategorie</Label>
                <div className="relative">
                  <select
                    id="expense-category-filter"
                    className="h-11 w-full cursor-pointer appearance-none rounded-md border border-input bg-background py-2 pl-3 pr-8 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
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
                <Label htmlFor="expense-date-filter" className="text-xs font-medium block mb-1.5 text-muted-foreground">Zeitraum</Label>
                <div className="relative">
                  <select
                    id="expense-date-filter"
                    className="h-11 w-full cursor-pointer appearance-none rounded-md border border-input bg-background py-2 pl-3 pr-8 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
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
                <Label htmlFor="expense-tax-filter" className="text-xs font-medium block mb-1.5 text-muted-foreground">Steuerlich relevant</Label>
                <div className="relative">
                  <select
                    id="expense-tax-filter"
                    className="h-11 w-full cursor-pointer appearance-none rounded-md border border-input bg-background py-2 pl-3 pr-8 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
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
                <Label htmlFor="expense-receipt-filter" className="text-xs font-medium block mb-1.5 text-muted-foreground">Beleg vorhanden</Label>
                <div className="relative">
                  <select
                    id="expense-receipt-filter"
                    className="h-11 w-full cursor-pointer appearance-none rounded-md border border-input bg-background py-2 pl-3 pr-8 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
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


            </div>

            {/* Filter Actions */}
            <div className={styles.filterActions}>
              <div className="ledger-result-summary">
                <div className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{expenses.length}</span> Ausgaben auf dieser Seite
                </div>
                <LedgerSortControl id="expenses-sort" sort={sort} onChange={next => setFilters({ ...filters, ...next })} />
                {exportError && (
                  <p className="mt-1 text-xs text-critical">
                    {exportError}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  variant="outline"
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
                    sortBy: 'date',
                    sortOrder: 'desc',
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
          {(isLoading || isError) && <QueryFeedback noun="Ausgaben" isError={isError} onRetry={() => loadExpenses(page, pageSize)} />}
          <div hidden={isLoading || isError}>
          <div className="divide-y xl:hidden" aria-label="Ausgabenliste">
            {expenses.length > 0 ? expenses.map((expense) => (
              <article key={expense.id} className={`ledger-record ${styles.record}`}>
                <div className={styles.recordHeading}>
                  <div className="min-w-0">
                    <h3 className={styles.recordTitle}>{expense.description}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {new Date(expense.date).toLocaleDateString('de-DE')} · {expense.category || 'Sonstiges'}
                    </p>
                  </div>
                  <p className={`${styles.recordAmount} text-critical`}>{formatCurrency(expense.amount)}</p>
                </div>
                <p className="text-xs text-muted-foreground">{expense.taxRelevant ? 'Steuerrelevant' : 'Nicht steuerrelevant'}</p>
                <div className={styles.recordActions}><ExpenseRowActions expense={expense} onManualRecord={onManualRecord} onEdit={onEdit} onDuplicate={onDuplicate} onDelete={onDelete} onViewReceipt={onViewReceipt} isDeleting={isDeleting} /></div>
              </article>
            )) : (
              <p className="p-6 text-center text-sm text-muted-foreground">Noch keine Ausgaben.</p>
            )}
          </div>
          <div className={`hidden xl:block ${styles.desktopList}`}>
            <Table>
              <TableCaption className="sr-only">Ausgaben passend zu den ausgewählten Filtern</TableCaption>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <SortableLedgerHead field="date" label="Datum" sort={sort} onChange={next => setFilters({ ...filters, ...next })} />
                  <SortableLedgerHead field="description" label="Beschreibung" sort={sort} onChange={next => setFilters({ ...filters, ...next })} />
                  <TableHead className="font-medium">Kategorie</TableHead>
                  <SortableLedgerHead field="amount" label="Betrag" sort={sort} onChange={next => setFilters({ ...filters, ...next })} numeric />
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
                      <TableCell className="text-right font-medium text-critical">{formatCurrency(expense.amount)}</TableCell>
                      <TableCell className="text-center">
                        {expense.taxRelevant ? (
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-positive-surface">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-positive" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          </span>
                        ) : (
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-critical-surface">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-critical" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414z" clipRule="evenodd" />
                            </svg>
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <ExpenseRowActions expense={expense} onManualRecord={onManualRecord} onEdit={onEdit} onDuplicate={onDuplicate} onDelete={onDelete} onViewReceipt={onViewReceipt} isDeleting={isDeleting} compact />
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
                        <span>{hasFilters ? 'Keine passenden Ausgaben. Ändern Sie die Suche oder setzen Sie die Filter zurück.' : 'Keine Ausgaben vorhanden. Erfassen Sie Ihre erste Ausgabe oben.'}</span>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          </div>
          {/* Pagination */}
          <div className={styles.pagination}>
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
