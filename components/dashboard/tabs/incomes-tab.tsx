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
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Income, Customer, FilterState } from "@/types/dashboard";
import { formatCurrency } from "@/lib/dashboard-utils";

type NewIncome = {
  description: string;
  amount: string;
  customerId?: number;
  taxRelevant: boolean;
};

type IncomesTabProps = {
  // Form state
  newIncome: NewIncome;
  setNewIncome: React.Dispatch<React.SetStateAction<NewIncome>>;
  onSubmit: (e: React.FormEvent) => void;
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
  onEdit: (income: Income) => void;
  onDuplicate: (income: Income) => void;
  onDelete: (id: number) => void;
  onInvoiceStatusChange: (invoiceId: number | undefined, newStatus: string) => void;
  isDeleting: boolean;
};

export function IncomesTab({
  newIncome,
  setNewIncome,
  onSubmit,
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
  onEdit,
  onDuplicate,
  onDelete,
  onInvoiceStatusChange,
  isDeleting,
}: IncomesTabProps) {
  return (
    <div className="space-y-6">
      {/* New Income Form */}
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="border-b bg-muted/20 px-6 pb-4 pt-6">
          <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
            <div>
              <h2 className="text-xl font-semibold mb-1 flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="mr-2 h-5 w-5 text-positive" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Neue Einnahme erfassen
              </h2>
              <p className="text-sm text-muted-foreground">
                Erfassen Sie hier Ihre geschäftlichen Einnahmen
              </p>
            </div>
          </div>
        </div>
        <div className="p-6">
          <form onSubmit={onSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
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
              <div className="flex items-center space-x-2 h-full pt-6">
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
              <Button type="submit">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                Einnahme speichern
              </Button>
            </div>
          </form>
        </div>
      </div>

      {/* Incomes List */}
      <div className="bg-card rounded-xl shadow-sm border overflow-hidden">
        <div className="px-6 pt-6 pb-4 border-b">
          <h2 className="text-xl font-semibold mb-2">Ihre Einnahmen</h2>
          <p className="text-sm text-muted-foreground mb-4">Filtern Sie Ihre Einnahmen nach verschiedenen Kriterien.</p>
          <div className="bg-muted/40 rounded-xl p-4 border">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Customer Filter */}
              <div>
                <Label htmlFor="income-customer-filter" className="text-xs font-medium uppercase tracking-wide block mb-1.5 text-muted-foreground">Kunde</Label>
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
                <Label htmlFor="income-date-filter" className="text-xs font-medium uppercase tracking-wide block mb-1.5 text-muted-foreground">Zeitraum</Label>
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
                <Label htmlFor="income-tax-filter" className="text-xs font-medium uppercase tracking-wide block mb-1.5 text-muted-foreground">Steuerlich relevant</Label>
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

              {/* Search */}
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
            </div>

            {/* Filter Actions */}
            <div className="flex flex-col gap-3 mt-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{incomes.length}</span> Einnahmen gefunden
                </div>
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
          <div className="divide-y lg:hidden" aria-label="Einnahmenliste">
            {incomes.length > 0 ? incomes.map((income) => (
              <article key={income.id} className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold">{income.description}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {new Date(income.date).toLocaleDateString('de-DE')}{income.customerName ? ` · ${income.customerName}` : ''}
                    </p>
                  </div>
                  <p className="shrink-0 font-semibold tabular-nums text-positive">{formatCurrency(income.amount)}</p>
                </div>
                <p className="text-xs text-muted-foreground">{income.taxRelevant ? 'Steuerrelevant' : 'Nicht steuerrelevant'}</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="min-h-11" onClick={() => onEdit(income)}>Bearbeiten</Button>
                  <Button variant="outline" size="sm" className="min-h-11" onClick={() => onDuplicate(income)}>Duplizieren</Button>
                  <Button variant="ghost" size="sm" className="min-h-11 text-destructive" disabled={isDeleting} onClick={() => onDelete(income.id)}>Löschen</Button>
                </div>
              </article>
            )) : (
              <p className="p-6 text-center text-sm text-muted-foreground">Keine Einnahmen vorhanden. Erfassen Sie oben Ihre erste Einnahme.</p>
            )}
          </div>
          <div className="hidden overflow-x-auto p-6 lg:block">
            <Table>
              <TableCaption>Alle erfassten Geschäftseinnahmen</TableCaption>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="font-medium">Datum</TableHead>
                  <TableHead className="font-medium">Beschreibung</TableHead>
                  <TableHead className="font-medium">Kunde</TableHead>
                  <TableHead className="text-center font-medium">Steuerrelevant</TableHead>
                  <TableHead className="text-center font-medium">Rechnungsstatus</TableHead>
                  <TableHead className="text-right font-medium">Betrag</TableHead>
                  <TableHead className="text-right font-medium">Aktionen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {incomes.length > 0 ? (
                  incomes.map((income) => (
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
                          <StatusBadge
                            status={income.invoiceStatus}
                            onStatusChange={(newStatus) => onInvoiceStatusChange(income.invoiceId, newStatus)}
                          />
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium text-positive">{formatCurrency(income.amount)}</TableCell>
                      <TableCell className="text-right">
                        <TooltipProvider>
                          <div className="flex justify-end space-x-2">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="icon"
                                  aria-label={`${income.description} duplizieren`}
                                  onClick={() => onDuplicate(income)}
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
                                  aria-label={`${income.description} bearbeiten`}
                                  onClick={() => onEdit(income)}
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
                                  aria-label={`${income.description} löschen`}
                                  className="border-critical/30 text-critical hover:bg-critical-surface"
                                  onClick={() => onDelete(income.id)}
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

          {/* Pagination */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-6 pb-6">
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
