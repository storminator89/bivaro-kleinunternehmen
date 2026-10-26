"use client";

import { ManualEntrySubmitFeedback, type ManualEntrySubmitControls } from '@/components/dashboard/manual-entry-submit-feedback';

import styles from './cashflow-workspace.module.css';

import { LedgerSortControl, SortableLedgerHead } from '@/components/dashboard/ledger-sort-control';
import React from 'react';
import { IncomeRowActions } from '@/components/manual-financial-records/income-row-actions';
import type { ManualRecordOpener } from '@/components/manual-financial-records/manual-record-status';
import Link from 'next/link';
import { QueryFeedback } from '@/components/dashboard/query-feedback';
import { DashboardIcon } from "@/components/brand/dashboard-icon";
import { ChevronDown } from "lucide-react";
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
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Income, Customer, FilterState } from "@/types/dashboard";
import { LedgerListHeading } from "@/components/dashboard/ledger-list-heading";
import { formatCurrency } from "@/lib/dashboard-utils";
import { formatBusinessDateDisplay } from "@/lib/business-date";

/** Income remains immutable origin cash; invoice allocation is a separate live view. */
export function IncomeInvoiceAttribution({ income }: { income: Income }) {
  if (!income.originInvoiceId) return null;
  return <div className="mt-1 space-y-1 text-xs font-normal text-muted-foreground"><p>Originaleingang: <Link className="text-primary underline underline-offset-4" href={`/history?invoiceId=${income.originInvoiceId}`}>{income.originInvoiceNumber || `Rechnung #${income.originInvoiceId}`}</Link></p>{income.paymentAllocationReviewRequired ? <p role="status">Aktuelle Zuordnung prüfen</p> : income.allocatedInvoiceId ? <p>Aktuell zugeordnet: <Link className="text-primary underline underline-offset-4" href={`/history?invoiceId=${income.allocatedInvoiceId}`}>{income.allocatedInvoiceNumber || `Rechnung #${income.allocatedInvoiceId}`}</Link>{income.allocationRevision !== null && income.allocationRevision !== undefined ? ` · Stand ${income.allocationRevision}` : ''}</p> : null}</div>;
}

type NewIncome = {
  description: string;
  amount: string;
  date: string;
  customerId?: number;
  taxRelevant: boolean;
};

type IncomesTabProps = {
  isLoading?: boolean;
  isError?: boolean;
  entryOpen: boolean;
  onEntryOpenChange: (open: boolean) => void;

  // Form state
  newIncome: NewIncome;
  setNewIncome: React.Dispatch<React.SetStateAction<NewIncome>>;
  onSubmit: (e: React.FormEvent) => void;
  submission?: ManualEntrySubmitControls;
  formError: { field?: string; message: string } | null;
  customers: Customer[];

  // Filter state
  filters: FilterState['incomes'];
  setFilters: (filters: FilterState['incomes']) => void;
  uniqueCustomers: string[];

  // Data
  incomes: Income[];

  // Pagination
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  loadIncomes: (page: number, pageSize: number) => Promise<void>;

  // Export
  isExportingDocuments: boolean;
  exportError: string | null;
  onExportDocuments: () => void;

  // Actions
  onManualRecord?: ManualRecordOpener;
  onEdit: (income: Income) => void;
  onDuplicate: (income: Income) => void;
  onDelete: (id: number) => void;
  onInvoiceStatusChange: (invoiceId: number | undefined, newStatus: string) => void;
  isDeleting: boolean;
};

export function IncomesTab({
  isLoading = false,
  isError = false,
  entryOpen,
  onEntryOpenChange,
  newIncome,
  setNewIncome,
  onSubmit,
  submission,
  formError,
  customers,
  filters,
  setFilters,
  uniqueCustomers,
  incomes,
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  onPageSizeChange,
  loadIncomes,
  isExportingDocuments,
  exportError,
  onExportDocuments,
  onManualRecord,
  onEdit,
  onDuplicate,
  onDelete,
  onInvoiceStatusChange,
  isDeleting,
}: IncomesTabProps) {
  const sort = { sortBy: filters.sortBy ?? 'date', sortOrder: filters.sortOrder ?? 'desc' };
  const hasFilters = Boolean(filters.searchTerm || filters.dateRange !== 'all' || filters.taxRelevant !== 'all' || filters.customer);
  const entryLocked = Boolean(submission && submission.state.phase !== 'idle');
  const entryPending = submission?.state.phase === 'pending';
  return (
    <div className={`bookkeeping-workspace ${styles.workspace}`}>
      <details id="income-entry" hidden={!entryOpen} className="entry-panel overflow-hidden rounded-xl border bg-card" open={entryOpen} onToggle={event => onEntryOpenChange(event.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 sm:px-6">
          <span className="flex min-w-0 items-center gap-3"><span className="entry-symbol"><DashboardIcon name="tile-incomes" size={44} /></span><span><span className="block text-sm font-semibold">Neue Einnahme</span></span></span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </summary>
        <div className="border-t p-4 sm:p-6">
          <form onSubmit={onSubmit} aria-busy={entryPending}>
            <fieldset disabled={entryLocked} inert={entryLocked} className="min-w-0 space-y-6">
            <div className={styles.entryFields}>
              <div className={styles.entryDescription}>
                <Label htmlFor="incomeDescription" className="text-sm font-medium">Beschreibung</Label>
                <Input
                  id="incomeDescription"
                  value={newIncome.description}
                  onChange={(e) => setNewIncome({ ...newIncome, description: e.target.value })}
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
                  onChange={(e) => setNewIncome({ ...newIncome, amount: e.target.value })}
                  placeholder="0.00"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="income-date" className="text-sm font-medium">Zahlungsdatum</Label>
                <Input
                  id="income-date"
                  type="date"
                  value={newIncome.date}
                  onChange={(e) => setNewIncome({ ...newIncome, date: e.target.value })}
                  aria-invalid={formError?.field === 'date'}
                  aria-describedby={formError?.field === 'date' ? 'income-date-error' : undefined}
                  required
                />
                {formError?.field === 'date' && (
                  <p id="income-date-error" role="alert" className="text-sm text-destructive">
                    {formError.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="customer">Kunde/Auftraggeber</Label>
                <select
                  id="customer"
                  value={newIncome.customerId || ''}
                  onChange={(e) => setNewIncome({ ...newIncome, customerId: e.target.value ? parseInt(e.target.value) : undefined })}
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
              <div className={styles.taxToggle}>
                <div className="relative inline-flex items-center">
                  <input
                    type="checkbox"
                    id="incomeTaxRelevant"
                    className="rounded border-input text-primary h-4 w-4"
                    checked={newIncome.taxRelevant}
                    onChange={(e) => setNewIncome({ ...newIncome, taxRelevant: e.target.checked })}
                  />
                  <Label htmlFor="incomeTaxRelevant" className="ml-2 text-sm font-medium">Steuerlich relevant</Label>
                </div>
              </div>
            </div>
            <div>
              <Button type="submit" disabled={entryLocked} aria-busy={entryPending}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                {entryPending ? 'Einnahme wird gespeichert …' : 'Einnahme speichern'}
              </Button>
            </div>
            </fieldset>
          </form>
          <ManualEntrySubmitFeedback controls={submission} nextLabel="Weitere Einnahme erfassen" />
          {formError && formError.field !== 'date' && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {formError.message}
            </p>
          )}
        </div>
      </details>

      {/* Incomes List */}
      <div className={`ledger-list ${styles.ledger}`}>
        <div className={styles.ledgerHeader}>
          <LedgerListHeading icon="nav-incomes" isLoading={isLoading} isError={isError} title="Ihre Einnahmen" total={total} amounts={isError || isLoading ? [] : incomes.map(item => item.amount)} />
          <div className="ledger-filters">
            <div className={styles.filters}>
              {/* Search */}
              <div className={styles.search}>
                <Label htmlFor="income-search" className="text-xs font-medium block mb-1.5 text-muted-foreground">Suche</Label>
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

              {/* Customer Filter */}
              <div>
                <Label htmlFor="income-customer-filter" className="text-xs font-medium block mb-1.5 text-muted-foreground">Kunde</Label>
                <div className="relative">
                  <select
                    id="income-customer-filter"
                    className="h-11 w-full cursor-pointer appearance-none rounded-md border border-input bg-background py-2 pl-3 pr-8 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
                    value={filters.customer}
                    onChange={(e) => setFilters({ ...filters, customer: e.target.value })}
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

              {/* Date Range Filter */}
              <div>
                <Label htmlFor="income-date-filter" className="text-xs font-medium block mb-1.5 text-muted-foreground">Zeitraum</Label>
                <div className="relative">
                  <select
                    id="income-date-filter"
                    className="h-11 w-full cursor-pointer appearance-none rounded-md border border-input bg-background py-2 pl-3 pr-8 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
                    value={filters.dateRange}
                    onChange={(e) => setFilters({ ...filters, dateRange: e.target.value as FilterState['incomes']['dateRange'] })}
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
                <Label htmlFor="income-tax-filter" className="text-xs font-medium block mb-1.5 text-muted-foreground">Steuerlich relevant</Label>
                <div className="relative">
                  <select
                    id="income-tax-filter"
                    className="h-11 w-full cursor-pointer appearance-none rounded-md border border-input bg-background py-2 pl-3 pr-8 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
                    value={filters.taxRelevant}
                    onChange={(e) => setFilters({ ...filters, taxRelevant: e.target.value as FilterState['incomes']['taxRelevant'] })}
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
                  <span className="font-medium text-foreground">{incomes.length}</span> Einnahmen auf dieser Seite
                </div>
                <LedgerSortControl id="incomes-sort" sort={sort} onChange={next => setFilters({ ...filters, ...next })} />
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
                  onClick={onExportDocuments}
                  disabled={isExportingDocuments}
                >
                  {isExportingDocuments ? (
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
                      Rechnungen exportieren
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setFilters({
                    customer: '',
                    dateRange: 'all',
                    taxRelevant: 'all',
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

        {/* Incomes Table */}
        <div className="overflow-hidden">
          {(isLoading || isError) && <QueryFeedback noun="Einnahmen" isError={isError} onRetry={() => loadIncomes(page, pageSize)} />}
          <div hidden={isLoading || isError}>
          <div className="divide-y xl:hidden" aria-label="Einnahmenliste">
            {incomes.length > 0 ? incomes.map((income) => (
              <article key={income.id} className={`ledger-record ${styles.record}`}>
                <div className={styles.recordHeading}>
                  <div className="min-w-0">
                    <h3 className={styles.recordTitle}>{income.description}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {formatBusinessDateDisplay(income.date)}{income.customerName ? ` · ${income.customerName}` : ''}
                    </p>
                  </div>
                  <p className={`${styles.recordAmount} text-positive`}>{formatCurrency(income.amount)}</p>
                </div>
                <IncomeInvoiceAttribution income={income} /><p className="text-xs text-muted-foreground">{income.taxRelevant ? 'Steuerrelevant' : 'Nicht steuerrelevant'}</p>
                <div className={styles.recordActions}>
                  <IncomeRowActions income={income} onEdit={onEdit} onDuplicate={onDuplicate} onDelete={onDelete} isDeleting={isDeleting} onManualRecord={onManualRecord} />
                </div>
              </article>
            )) : (
              <p className="p-6 text-center text-sm text-muted-foreground">{hasFilters ? 'Keine passenden Einnahmen.' : 'Noch keine Einnahmen.'}</p>
            )}
          </div>
          <div className={`hidden xl:block ${styles.desktopList}`}>
            <Table>
              <TableCaption className="sr-only">Einnahmen passend zu den ausgewählten Filtern</TableCaption>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <SortableLedgerHead field="date" label="Datum" sort={sort} onChange={next => setFilters({ ...filters, ...next })} />
                  <SortableLedgerHead field="description" label="Beschreibung" sort={sort} onChange={next => setFilters({ ...filters, ...next })} />
                  <TableHead className="font-medium">Kunde</TableHead>
                  <TableHead className="text-center font-medium">Steuerrelevant</TableHead>
                  <TableHead className="text-center font-medium">Ursprungsbeleg</TableHead>
                  <SortableLedgerHead field="amount" label="Betrag" sort={sort} onChange={next => setFilters({ ...filters, ...next })} numeric />
                  <TableHead className="text-right font-medium">Aktionen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {incomes.length > 0 ? (
                  incomes.map((income) => (
                    <TableRow key={income.id} className="hover:bg-muted/50 transition-colors">
                      <TableCell className="text-muted-foreground">{formatBusinessDateDisplay(income.date)}</TableCell>
                      <TableCell className="font-medium">{income.description}<IncomeInvoiceAttribution income={income} /></TableCell>
                      <TableCell className="text-muted-foreground">
                        {income.customerName ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-foreground">
                            {income.customerName}
                          </span>
                        ) : "-"}
                      </TableCell>
                      <TableCell className="text-center">
                        {income.taxRelevant ? (
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
                      <TableCell className="text-center">
                        {income.invoiceStatus ? (
                          <div className="space-y-1"><p className="text-xs text-muted-foreground">Original-Rechnung</p>
                          <StatusBadge
                            status={income.invoiceStatus}
                            availableStatuses={[]}
                            onStatusChange={(newStatus) => onInvoiceStatusChange(income.invoiceId, newStatus)}
                          /></div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium text-positive">{formatCurrency(income.amount)}</TableCell>
                      <TableCell className="text-right">
                        <IncomeRowActions income={income} onEdit={onEdit} onDuplicate={onDuplicate} onDelete={onDelete} isDeleting={isDeleting} onManualRecord={onManualRecord} compact />
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
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
          {/* Pagination */}
          <div className={styles.pagination}>
            <div className="text-sm text-muted-foreground">
              Seite {page} von {totalPages} · {total} Einträge
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="incomes-page-size" className="text-sm">Pro Seite</Label>
              <select
                id="incomes-page-size"
                value={pageSize}
                onChange={async (e) => {
                  const size = parseInt(e.target.value);
                  onPageSizeChange(size);
                  onPageChange(1);
                  await loadIncomes(1, size);
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
                  await loadIncomes(p, pageSize);
                }}
              >Zurück</Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={async () => {
                  const p = Math.min(totalPages, page + 1);
                  onPageChange(p);
                  await loadIncomes(p, pageSize);
                }}
              >Weiter</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
