"use client";

import React from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileX } from "lucide-react";
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
import { Invoice, FilterState } from "@/types/dashboard";
import { formatCurrency } from "@/lib/dashboard-utils";

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
  return (
    <div className="space-y-6">
      {/* Upload Form */}
      <div className="bg-card rounded-xl shadow-sm border overflow-hidden transition-all duration-300 hover:shadow-md">
        <div className="px-6 pt-6 pb-4 border-b bg-gradient-to-r from-blue-50/50 to-blue-50/30 dark:from-blue-900/10 dark:to-blue-900/5">
          <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
            <div>
              <h2 className="text-xl font-semibold mb-1 flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0121 9.414V19a2 2 0 01-2 2z" />
                </svg>
                ZUGFeRD-Rechnung hochladen
              </h2>
              <p className="text-sm text-muted-foreground">
                Laden Sie Ihre ZUGFeRD-kompatiblen PDF-Rechnungen hoch.
                Die Daten werden automatisch extrahiert und verarbeitet.
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={onOpenCreateModal}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                Rechnung erstellen
              </Button>
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
                    onChange={onFileChange}
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
                  onClick={onFileUpload}
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

      {/* Invoices List */}
      <div className="bg-card rounded-xl shadow-sm border overflow-hidden">
        <div className="px-6 pt-6 pb-4 border-b">
          <h2 className="text-xl font-semibold">Ihre Rechnungen</h2>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Status Filter */}
            <div className="space-y-2">
              <Label htmlFor="invoice-status-filter" className="text-sm">Zahlungsstatus</Label>
              <select
                id="invoice-status-filter"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={filters.paidStatus}
                onChange={(e) => setFilters({ ...filters, paidStatus: e.target.value as FilterState['invoices']['paidStatus'] })}
              >
                <option value="all">Alle</option>
                <option value="paid">Bezahlt</option>
                <option value="unpaid">Offen</option>
              </select>
            </div>

            {/* Date Range Filter */}
            <div className="space-y-2">
              <Label htmlFor="invoice-date-filter" className="text-sm">Zeitraum</Label>
              <select
                id="invoice-date-filter"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
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
              <Label htmlFor="invoice-search" className="text-sm">Suche</Label>
              <div className="relative">
                <Input
                  id="invoice-search"
                  type="text"
                  placeholder="Rechnungsnummer oder Dateiname suchen..."
                  value={filters.searchTerm}
                  onChange={(e) => setFilters({ ...filters, searchTerm: e.target.value })}
                />
                {filters.searchTerm && (
                  <button
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
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

        {/* Invoices Table */}
        <div className="overflow-hidden">
          <div className="overflow-x-auto p-6">
            <Table>
              <TableCaption>Alle hochgeladenen Rechnungen</TableCaption>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead
                    className="font-medium cursor-pointer hover:bg-muted select-none"
                    onClick={() => {
                      const newOrder = filters.sortBy === 'date' && filters.sortOrder === 'desc' ? 'asc' : 'desc';
                      setFilters({ ...filters, sortBy: 'date', sortOrder: newOrder });
                    }}
                  >
                    <span className="flex items-center gap-1">
                      Datum
                      {filters.sortBy === 'date' && (
                        <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${filters.sortOrder === 'asc' ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      )}
                    </span>
                  </TableHead>
                  <TableHead
                    className="font-medium cursor-pointer hover:bg-muted select-none"
                    onClick={() => {
                      const newOrder = filters.sortBy === 'invoiceNumber' && filters.sortOrder === 'desc' ? 'asc' : 'desc';
                      setFilters({ ...filters, sortBy: 'invoiceNumber', sortOrder: newOrder });
                    }}
                  >
                    <span className="flex items-center gap-1">
                      Rechnungsnummer
                      {filters.sortBy === 'invoiceNumber' && (
                        <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${filters.sortOrder === 'asc' ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      )}
                    </span>
                  </TableHead>
                  <TableHead className="font-medium">Dateiname</TableHead>
                  <TableHead
                    className="text-right font-medium cursor-pointer hover:bg-muted select-none"
                    onClick={() => {
                      const newOrder = filters.sortBy === 'amount' && filters.sortOrder === 'desc' ? 'asc' : 'desc';
                      setFilters({ ...filters, sortBy: 'amount', sortOrder: newOrder });
                    }}
                  >
                    <span className="flex items-center justify-end gap-1">
                      Betrag
                      {filters.sortBy === 'amount' && (
                        <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${filters.sortOrder === 'asc' ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      )}
                    </span>
                  </TableHead>
                  <TableHead className="text-center font-medium">Status</TableHead>
                  <TableHead className="text-right font-medium">Aktionen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.length > 0 ? (
                  invoices.map((invoice) => (
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
                          onStatusChange={(newStatus) => onStatusChange(invoice.id, newStatus)}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <TooltipProvider>
                          <div className="flex justify-end space-x-2">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="icon"
                                  onClick={() => onViewReceipt(`/api/invoices/download?id=${invoice.id}`)}
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                  </svg>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Rechnung anzeigen</p>
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="icon"
                                  onClick={() => {
                                    window.open(`/api/invoices/download?id=${invoice.id}&download=true`, 'Rechnung Download', 'width=800,height=600,scrollbars=yes,resizable=yes');
                                  }}
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4-4m0 0l-4 4m4-4V4" />
                                  </svg>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Rechnung herunterladen</p>
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="icon"
                                  onClick={() => onOpenDetails(invoice)}
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                  </svg>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Rechnungsdetails anzeigen</p>
                              </TooltipContent>
                            </Tooltip>
                            {invoice.status !== 'CANCELLED' && invoice.type !== 'CREDIT_NOTE' && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    className="text-orange-600 border-orange-200 hover:bg-orange-50 dark:text-orange-400 dark:border-orange-900/50 dark:hover:bg-orange-900/20"
                                    onClick={() => onCancel(invoice)}
                                  >
                                    <FileX className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Rechnung stornieren</p>
                                </TooltipContent>
                              </Tooltip>
                            )}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="icon"
                                  className="text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-900/50 dark:hover:bg-red-900/20"
                                  onClick={() => onDelete(invoice.id)}
                                  disabled={isDeleting}
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Rechnung löschen</p>
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

          {/* Pagination */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-6 pb-6">
            <div className="text-sm text-muted-foreground">
              Seite {page} von {totalPages} · {total} Einträge
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="invoices-page-size" className="text-sm">Pro Seite</Label>
              <select
                id="invoices-page-size"
                value={pageSize}
                onChange={async (e) => {
                  const size = parseInt(e.target.value);
                  onPageSizeChange(size);
                  onPageChange(1);
                  await loadInvoices(1, size);
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
    </div>
  );
}
