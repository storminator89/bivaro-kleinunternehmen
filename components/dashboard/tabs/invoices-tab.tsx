"use client";

import React from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, Eye, FileCode2, FileText, FileX, Mail, MoreHorizontal, Trash2, Upload, ChevronDown, Search, X, Loader2, CheckCheck, Clock3 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { EmailPreviewDialog } from "@/components/dashboard/email-preview-dialog";
import { Invoice, FilterState } from "@/types/dashboard";
import { LedgerListHeading } from "@/components/dashboard/ledger-list-heading";
import { formatCurrency } from "@/lib/dashboard-utils";

function canDeleteDraft(invoice: Invoice): boolean {
  return invoice.type !== 'CREDIT_NOTE' && invoice.type !== 'QUOTE'
    && invoice.status === 'DRAFT' && invoice.issuanceState === 'UNISSUED'
    && !invoice.income && !invoice.paidAt;
}

function availableInvoiceStatuses(invoice: Invoice): string[] {
  if (invoice.type === 'CREDIT_NOTE' || invoice.type === 'QUOTE'
    || invoice.income || invoice.paidAt) return [];
  if (invoice.status === 'DRAFT') return ['SENT', 'PAID'];
  if (invoice.status === 'SENT') return ['PAID'];
  return [];
}

type InvoicesTabProps = {
  // Upload state
  selectedFile: File | null;
  isUploading: boolean;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onFileUpload: () => void;
  onOpenCreateModal: () => void;

  // Filter state
  filters: FilterState['invoices'];
  setFilters: (filters: FilterState['invoices']) => void;

  // Data
  invoices: Invoice[];

  isLoading?: boolean;
  isError?: boolean;

  // Pagination
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  loadInvoices: (page: number, pageSize: number) => Promise<void>;

  // Actions
  onViewReceipt: (url: string) => void;
  onOpenDetails: (invoice: Invoice) => void;
  onStatusChange: (invoiceId: number, newStatus: string) => void;
  onCancel: (invoice: Invoice) => void;
  onDelete: (id: number) => void;
  isDeleting: boolean;
};

export function InvoicesTab({
  selectedFile,
  isUploading,
  onFileChange,
  onFileUpload,
  onOpenCreateModal,
  filters,
  setFilters,
  invoices,
  isLoading = false,
  isError = false,
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  onPageSizeChange,
  loadInvoices,
  onViewReceipt,
  onOpenDetails,
  onStatusChange,
  onCancel,
  onDelete,
  isDeleting,
}: InvoicesTabProps) {
  const [emailInvoice, setEmailInvoice] = React.useState<Invoice | null>(null);

  const paidCount = invoices.filter(invoice => invoice.status === 'PAID').length;
  const openCount = invoices.filter(invoice => invoice.status === 'SENT' || invoice.status === 'DRAFT').length;

  return (
    <div className="invoice-workspace space-y-5">
      <section className="invoice-summary" aria-label="Rechnungsübersicht">
        <div className="invoice-summary-intro"><span className="summary-symbol"><FileText aria-hidden="true" /></span><div><p className="text-sm font-medium">Ihr Rechnungsbestand</p><p className="mt-1 text-xs text-muted-foreground">Alle Treffer · Zahlungsstatus der aktuellen Seite</p></div></div>
        <dl className="invoice-summary-values">
          <div><dt>Rechnungen im Ergebnis</dt><dd>{isLoading ? '—' : total}</dd></div>
          <div><dt><CheckCheck aria-hidden="true" />Bezahlt auf dieser Seite</dt><dd className="text-positive">{isLoading ? '—' : paidCount}</dd></div>
          <div><dt><Clock3 aria-hidden="true" />Offen auf dieser Seite</dt><dd>{isLoading ? '—' : openCount}</dd></div>
        </dl>
      </section>
      <details className="invoice-import group rounded-xl border border-dashed bg-card" open={selectedFile ? true : undefined}>
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-notice-surface text-notice"><Upload className="h-5 w-5" aria-hidden="true" /></span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold"><span className="sm:hidden">E-Rechnung</span><span className="hidden sm:inline">E-Rechnung importieren</span></span>
            <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">ZUGFeRD, Factur-X oder XRechnung · PDF / XML</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="grid gap-4 border-t p-4 sm:px-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="min-w-0 space-y-2">
            <Label htmlFor="invoiceFile">Rechnungsdatei auswählen</Label>
            <Input id="invoiceFile" type="file" accept=".pdf,.xml,application/pdf,application/xml,text/xml" onChange={onFileChange} disabled={isUploading} className="h-auto min-h-11 cursor-pointer py-2 file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-foreground" aria-describedby="invoice-upload-help" />
            <p id="invoice-upload-help" className="text-xs leading-5 text-muted-foreground">Die Rechnungsdaten werden automatisch aus der Datei übernommen.</p>
          </div>
          <Button onClick={onFileUpload} disabled={!selectedFile || isUploading} className="md:mb-7" aria-busy={isUploading}>
            {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="mr-2 h-4 w-4" aria-hidden="true" />}
            {isUploading ? 'Wird importiert…' : 'Rechnung hochladen'}
          </Button>
        </div>
      </details>

      {/* Invoices List */}
      <div className="invoice-ledger bg-card rounded-xl border overflow-hidden">
        <div className="px-4 pt-5 pb-4 border-b sm:px-6">
          <div className="invoice-list-title flex flex-wrap items-center justify-between gap-3">
            <LedgerListHeading title="Ihre Rechnungen" isLoading={isLoading} total={total} amounts={isLoading || isError ? [] : invoices.map(invoice => invoice.totalAmount ?? 0)} />
            {(filters.searchTerm || filters.paidStatus !== 'all' || filters.dateRange !== 'all') && (
              <Button variant="ghost" size="sm" onClick={() => setFilters({ ...filters, searchTerm: '', paidStatus: 'all', dateRange: 'all' })}><X className="mr-1.5 h-4 w-4" aria-hidden="true" />Filter zurücksetzen</Button>
            )}
          </div>
          <div className="invoice-filter-bar mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_10rem_minmax(12rem,1fr)]">
            <fieldset className="min-w-0 space-y-2">
              <legend className="text-xs font-medium text-muted-foreground">Zahlungsstatus</legend>
              <div className="filter-switch" aria-label="Zahlungsstatus">
                {([{ value: 'all', label: 'Alle' }, { value: 'unpaid', label: 'Offen' }, { value: 'paid', label: 'Bezahlt' }] as const).map(option => (
                  <button key={option.value} type="button" className="filter-chip" aria-pressed={filters.paidStatus === option.value} onClick={() => setFilters({ ...filters, paidStatus: option.value })}>{option.label}</button>
                ))}
              </div>
            </fieldset>

            {/* Date Range Filter */}
            <div className="space-y-2">
              <Label htmlFor="invoice-date-filter" className="text-xs text-muted-foreground">Zeitraum</Label>
              <select
                id="invoice-date-filter"
                className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={filters.dateRange}
                onChange={(e) => setFilters({ ...filters, dateRange: e.target.value as FilterState['invoices']['dateRange'] })}
              >
                <option value="all">Alle Zeiträume</option>
                <option value="thisMonth">Aktueller Monat</option>
                <option value="lastMonth">Letzter Monat</option>
                <option value="thisYear">Aktuelles Jahr</option>
              </select>
            </div>

            {/* Search */}
            <div className="space-y-2">
              <Label htmlFor="invoice-search" className="text-xs text-muted-foreground">Suche</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="invoice-search"
                  type="text"
                  placeholder="Nummer oder Dateiname…"
                  className="pl-9 pr-11"
                  value={filters.searchTerm}
                  onChange={(e) => setFilters({ ...filters, searchTerm: e.target.value })}
                />
                {filters.searchTerm && (
                  <button
                    type="button"
                    aria-label="Suche leeren"
                    className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-muted-foreground hover:text-foreground"
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
        </div>

        {isError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border-b bg-critical-surface p-4 text-sm text-critical-foreground"><p>Rechnungen konnten nicht geladen werden.</p><Button variant="outline" onClick={() => loadInvoices(page, pageSize)}>Erneut laden</Button></div>}
        {/* Invoices Table */}
        <div className="overflow-hidden">
          <div className="divide-y xl:hidden" aria-label="Rechnungsliste">
            {isLoading ? <div role="status" className="flex items-center gap-3 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Rechnungen werden geladen…</div> : isError ? null : invoices.length > 0 ? invoices.map((invoice) => (
              <article key={invoice.id} className="invoice-record space-y-3 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold">{invoice.invoiceNumber || invoice.fileName}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {invoice.invoiceDate ? new Date(invoice.invoiceDate).toLocaleDateString('de-DE') : new Date(invoice.uploadedAt).toLocaleDateString('de-DE')}
                    </p>
                  </div>
                  <p className="shrink-0 font-semibold tabular-nums">{invoice.totalAmount ? formatCurrency(invoice.totalAmount) : '–'}</p>
                </div>
                <StatusBadge status={invoice.status} availableStatuses={availableInvoiceStatuses(invoice)} onStatusChange={(newStatus) => onStatusChange(invoice.id, newStatus)} />
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="min-h-11" onClick={() => onOpenDetails(invoice)}><Eye className="h-4 w-4" />Details</Button>
                  {invoice.hasPdfFile !== false && (
                    <Button variant="outline" size="sm" className="min-h-11" onClick={() => onViewReceipt(`/api/invoices/download?id=${invoice.id}`)}><FileText className="h-4 w-4" />PDF</Button>
                  )}
                  <Button variant="ghost" size="sm" className="min-h-11 text-destructive" disabled={isDeleting || !canDeleteDraft(invoice)} onClick={() => onDelete(invoice.id)}>Löschen</Button>
                </div>
                {!canDeleteDraft(invoice) && (
                  <p className="text-xs text-muted-foreground">Löschen ist nur für nachweislich unausgestellte Entwürfe ohne Zahlung möglich.</p>
                )}
              </article>
            )) : (
              <p className="p-6 text-center text-sm text-muted-foreground">{filters.searchTerm || filters.paidStatus !== 'all' || filters.dateRange !== 'all' ? 'Keine passenden Rechnungen. Ändern Sie die Suche oder setzen Sie die Filter zurück.' : 'Noch keine Rechnungen. Erstellen Sie Ihre erste Rechnung oder importieren Sie eine E-Rechnung.'}</p>
            )}
          </div>
          <div className="hidden overflow-x-auto p-6 xl:block">
            <Table>
              <TableCaption className="sr-only">Rechnungen passend zu den ausgewählten Filtern</TableCaption>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead
                    className="font-medium"
                    aria-sort={filters.sortBy === 'date' ? (filters.sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    <button type="button" className="flex min-h-11 items-center gap-1 rounded px-1 hover:bg-muted" onClick={() => {
                      const newOrder = filters.sortBy === 'date' && filters.sortOrder === 'desc' ? 'asc' : 'desc';
                      setFilters({ ...filters, sortBy: 'date', sortOrder: newOrder });
                    }}>
                      Datum
                      {filters.sortBy === 'date' && (
                        <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${filters.sortOrder === 'asc' ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      )}
                    </button>
                  </TableHead>
                  <TableHead
                    className="font-medium"
                    aria-sort={filters.sortBy === 'invoiceNumber' ? (filters.sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    <button type="button" className="flex min-h-11 items-center gap-1 rounded px-1 hover:bg-muted" onClick={() => {
                      const newOrder = filters.sortBy === 'invoiceNumber' && filters.sortOrder === 'desc' ? 'asc' : 'desc';
                      setFilters({ ...filters, sortBy: 'invoiceNumber', sortOrder: newOrder });
                    }}>
                      Rechnung
                      {filters.sortBy === 'invoiceNumber' && (
                        <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${filters.sortOrder === 'asc' ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      )}
                    </button>
                  </TableHead>

                  <TableHead
                    className="text-right font-medium"
                    aria-sort={filters.sortBy === 'amount' ? (filters.sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    <button type="button" className="ml-auto flex min-h-11 items-center justify-end gap-1 rounded px-1 hover:bg-muted" onClick={() => {
                      const newOrder = filters.sortBy === 'amount' && filters.sortOrder === 'desc' ? 'asc' : 'desc';
                      setFilters({ ...filters, sortBy: 'amount', sortOrder: newOrder });
                    }}>
                      Betrag
                      {filters.sortBy === 'amount' && (
                        <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${filters.sortOrder === 'asc' ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      )}
                    </button>
                  </TableHead>
                  <TableHead className="text-center font-medium">Status</TableHead>
                  <TableHead className="text-right font-medium">Aktionen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? <TableRow><TableCell colSpan={5}><div role="status" className="flex items-center justify-center gap-3 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Rechnungen werden geladen…</div></TableCell></TableRow> : isError ? null : invoices.length > 0 ? (
                  invoices.map((invoice) => (
                    <TableRow key={invoice.id} className="hover:bg-muted/50 transition-colors">
                      <TableCell className="text-muted-foreground">
                        {invoice.invoiceDate
                          ? new Date(invoice.invoiceDate).toLocaleDateString('de-DE')
                          : new Date(invoice.uploadedAt).toLocaleDateString('de-DE')}
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="invoice-file-symbol"><FileText className="h-4 w-4" aria-hidden="true" /></span>
                          <div className="min-w-0">
                            <button type="button" className="min-h-11 text-left font-semibold hover:text-primary hover:underline" onClick={() => onOpenDetails(invoice)} aria-label={`Details zu Rechnung ${invoice.invoiceNumber || invoice.id}`}>{invoice.invoiceNumber || 'Ohne Rechnungsnummer'}</button>
                            {invoice.customer?.name && <p className="text-xs font-medium text-foreground">{invoice.customer.name}</p>}
                            <p className="max-w-[20rem] truncate text-xs text-muted-foreground" title={invoice.fileName}>{invoice.fileName.replace(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}_/i, '')}</p>
                          </div>
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
                          availableStatuses={availableInvoiceStatuses(invoice)}
                          onStatusChange={(newStatus) => onStatusChange(invoice.id, newStatus)}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-2"
                            onClick={() => onOpenDetails(invoice)}
                          >
                            <Eye className="h-4 w-4" />
                            Details
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-2"
                                aria-label={`Weitere Aktionen fuer Rechnung ${invoice.invoiceNumber || invoice.id}`}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                                <span className="hidden xl:inline">Mehr</span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-64">
                              <DropdownMenuItem
                                disabled={invoice.hasPdfFile === false}
                                onSelect={() => onViewReceipt(`/api/invoices/download?id=${invoice.id}`)}
                              >
                                <FileText className="h-4 w-4" />
                                PDF anzeigen
                              </DropdownMenuItem>
                              {invoice.hasEInvoiceXml && (
                                <DropdownMenuItem onSelect={() => onViewReceipt(`/api/invoices/viewer?id=${invoice.id}`)}>
                                  <FileCode2 className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                                  E-Rechnung ansehen
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                disabled={invoice.status === 'CANCELLED'}
                                onSelect={() => setEmailInvoice(invoice)}
                              >
                                <Mail className="h-4 w-4 text-notice" />
                                Per E-Mail senden
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                disabled={invoice.hasPdfFile === false}
                                onSelect={() => {
                                  window.open(`/api/invoices/download?id=${invoice.id}&download=true`, 'Rechnung Download', 'width=800,height=600,scrollbars=yes,resizable=yes');
                                }}
                              >
                                <Download className="h-4 w-4" />
                                PDF herunterladen
                              </DropdownMenuItem>
                              {invoice.hasEInvoiceXml && (
                                <DropdownMenuItem
                                  onSelect={() => {
                                    window.open(`/api/invoices/download?id=${invoice.id}&format=xml&download=true`, 'E-Rechnung XML Download', 'width=800,height=600,scrollbars=yes,resizable=yes');
                                  }}
                                >
                                  <FileCode2 className="h-4 w-4 text-positive" />
                                  XML herunterladen
                                </DropdownMenuItem>
                              )}
                              {(invoice.status !== 'CANCELLED' && invoice.type !== 'CREDIT_NOTE') && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onSelect={() => onCancel(invoice)}>
                                    <FileX className="h-4 w-4 text-caution" />
                                    Rechnung stornieren
                                  </DropdownMenuItem>
                                </>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                disabled={isDeleting || !canDeleteDraft(invoice)}
                                onSelect={() => onDelete(invoice.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                                Rechnung löschen
                              </DropdownMenuItem>
                              {!canDeleteDraft(invoice) && (
                                <p className="px-2 py-1.5 text-xs text-muted-foreground">Nur nachweislich unausgestellte Entwürfe ohne Zahlung sind löschbar.</p>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      <div className="flex flex-col items-center justify-center">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-muted-foreground/30 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 00-2-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <span className="font-medium text-foreground">{filters.searchTerm || filters.paidStatus !== 'all' || filters.dateRange !== 'all' ? 'Keine passenden Rechnungen' : 'Ihre erste Rechnung beginnt hier'}</span>
                        <span className="mt-1 max-w-sm whitespace-normal text-sm">{filters.searchTerm || filters.paidStatus !== 'all' || filters.dateRange !== 'all' ? 'Ändern Sie Ihre Suche oder setzen Sie die Filter zurück.' : 'Erstellen Sie eine Rechnung oder importieren Sie eine vorhandene E-Rechnung.'}</span>
                        {!filters.searchTerm && filters.paidStatus === 'all' && filters.dateRange === 'all' && <Button variant="outline" className="mt-4" onClick={onOpenCreateModal}>Erste Rechnung erstellen</Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t bg-secondary/30 px-4 py-4 sm:px-6">
            <div className="text-sm text-muted-foreground">
              {total === 0 ? 'Keine Einträge' : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} von ${total} Rechnungen · Seite ${page} von ${Math.max(1, totalPages)}`}
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="invoices-page-size" className="whitespace-nowrap text-sm">Pro Seite</Label>
              <select
                id="invoices-page-size"
                value={pageSize}
                onChange={async (e) => {
                  const size = parseInt(e.target.value);
                  onPageSizeChange(size);
                  onPageChange(1);
                  await loadInvoices(1, size);
                }}
                className="h-11 rounded-md border border-input bg-background px-2 text-sm"
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
                  await loadInvoices(p, pageSize);
                }}
              >Zurück</Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={async () => {
                  const p = Math.min(totalPages, page + 1);
                  onPageChange(p);
                  await loadInvoices(p, pageSize);
                }}
              >Weiter</Button>
            </div>
          </div>
        </div>
      </div>

      <EmailPreviewDialog
        open={!!emailInvoice}
        onOpenChange={(open) => !open && setEmailInvoice(null)}
        documentType="invoice"
        documentId={emailInvoice?.id ?? null}
        onSent={() => loadInvoices(page, pageSize)}
      />
    </div>
  );
}
