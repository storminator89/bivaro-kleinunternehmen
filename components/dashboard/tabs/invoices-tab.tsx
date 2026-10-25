"use client";

import React from 'react';
import Link from 'next/link';
import styles from "./invoice-workspace.module.css";
import { useRecordListSearch } from '@/components/record-search/record-list-search-provider';
import { RecordListSearchNotice } from '@/components/record-search/record-list-search-notice';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DashboardIcon } from "@/components/brand/dashboard-icon";
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
import { invoicePaymentAmounts } from '@/components/payments/payment-presentation';
import { displayPaymentAmount } from '@/lib/full-payment-form';
import { formatCurrency } from "@/lib/dashboard-utils";

function canDeleteDraft(invoice: Invoice): boolean {
  return invoice.type !== 'CREDIT_NOTE' && invoice.type !== 'QUOTE'
    && invoice.status === 'DRAFT' && invoice.issuanceState === 'UNISSUED'
    && !invoice.incomes?.length && !invoice.paymentSummary?.paidCents?.match(/[1-9]/u) && !invoice.paidAt;
}

function availableInvoiceStatuses(invoice: Invoice): string[] {
  if (invoice.serviceDraftEditable || invoice.type === 'CREDIT_NOTE' || invoice.type === 'QUOTE' || invoice.status === 'CANCELLED') return [];
  const options: string[] = [];
  if (invoice.status === 'DRAFT' && !invoice.incomes?.length && !invoice.paidAt) options.push('SENT');
  if (invoice.canRecordPayment) options.push('PAID');
  return options;
}

export function InvoiceBalance({ invoice }: { invoice: Invoice }) {
  if (invoice.paymentReviewRequired) return <p className="mt-1 text-xs text-caution-foreground">Zahlungsstand prüfen</p>;
  const amounts = invoice.paymentLedger ? invoicePaymentAmounts(invoice.paymentLedger) : null;
  if (invoice.status === 'CANCELLED') return <p className="mt-1 text-xs text-muted-foreground tabular-nums">{invoice.paymentLedger ? <>Tatsächlich erstattet {displayPaymentAmount(amounts!.refunded)} · Noch zu erstatten {displayPaymentAmount(amounts!.refundDue)}</> : 'Erstattungsstand prüfen'}</p>;
  if (amounts && amounts.corrected !== '0') return <p className="mt-1 text-xs text-muted-foreground tabular-nums">{invoice.paymentLedger?.version === 3 ? 'Gültig zugeordnet' : 'Gültig erhalten'} {displayPaymentAmount(amounts!.valid)} · Nie erhalten / korrigiert {displayPaymentAmount(amounts!.corrected)} · Offen {displayPaymentAmount(amounts!.open)}</p>;
  if (!invoice.paymentSummary) return null;
  return <p className="mt-1 text-xs text-muted-foreground tabular-nums">{invoice.paymentLedger?.version === 3 ? 'Zugeordnet' : 'Erhalten'} {displayPaymentAmount(invoice.paymentSummary.paidCents)} · Offen {displayPaymentAmount(invoice.paymentSummary.openCents)}</p>;
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
  const listSearch = useRecordListSearch('outbound');
  const [emailInvoice, setEmailInvoice] = React.useState<Invoice | null>(null);
  const emailReturnFocusRef = React.useRef<HTMLButtonElement | null>(null);

  const paidCount = invoices.filter(invoice => invoice.status !== 'CANCELLED' && (invoice.paymentSummary?.paid || (invoice.status === 'PAID' && !invoice.paymentReviewRequired))).length;
  const openCount = invoices.filter(invoice => invoice.status !== 'CANCELLED' && invoice.paymentSummary && !invoice.paymentSummary.paid).length;

  const renderInvoiceActions = (invoice: Invoice) => (
<DropdownMenu>
                            {/* Radix opens on pointerdown before focusing the button. */}
                            <DropdownMenuTrigger asChild
                              onPointerDown={(event) => { emailReturnFocusRef.current = event.currentTarget; }}
                              onKeyDown={(event) => { emailReturnFocusRef.current = event.currentTarget; }}
                            >
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-2"
                                aria-label={`Weitere Aktionen fuer Rechnung ${invoice.invoiceNumber || invoice.id}`}
                                data-email-preview-return={`invoice:${invoice.id}`}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                                <span>Mehr</span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-64">
                              {invoice.serviceDraftEditable && <><DropdownMenuItem asChild><Link href={`/dashboard/invoices/new?draftId=${invoice.id}`}>Entwurf bearbeiten</Link></DropdownMenuItem><p className="px-2 py-1.5 text-xs text-muted-foreground">Entwurf zuerst prüfen und Rechnungsdatei erstellen.</p><DropdownMenuSeparator /></>}
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
                                disabled={invoice.serviceDraftEditable || invoice.status === 'CANCELLED'}
                                onSelect={() => setEmailInvoice(invoice)}
                              >
                                <Mail className="h-4 w-4 text-notice" />
                                Per E-Mail senden
                              </DropdownMenuItem>
                              <DropdownMenuItem asChild><Link href={`/history?invoiceId=${invoice.id}`}>Rechnungshistorie ansehen</Link></DropdownMenuItem>
                              {invoice.type !== 'CREDIT_NOTE' && <DropdownMenuItem onSelect={() => onStatusChange(invoice.id, 'PAYMENT_HISTORY')}>Zahlungsverlauf ansehen</DropdownMenuItem>}
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
                              {(!invoice.serviceDraftEditable && invoice.status !== 'CANCELLED' && invoice.type !== 'CREDIT_NOTE') && (
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
  );

  const hasActiveFilters = Boolean(listSearch || filters.searchTerm || filters.paidStatus !== 'all' || filters.dateRange !== 'all');

  const renderEmptyState = () => (
    <div className={styles.emptyState}>
      <FileText className="h-6 w-6" aria-hidden="true" />
      <h3>{hasActiveFilters ? 'Keine passenden Rechnungen' : 'Ihre erste Rechnung beginnt hier'}</h3>
      <p>{hasActiveFilters ? 'Ändern Sie Ihre Suche oder setzen Sie die Filter zurück.' : 'Erstellen Sie eine Rechnung oder importieren Sie eine vorhandene E-Rechnung.'}</p>
      {!hasActiveFilters && <Button variant="outline" onClick={onOpenCreateModal}>Erste Rechnung erstellen</Button>}
    </div>
  );

  const renderLoadingState = () => (
    <div className={styles.loadingState}>
      <p role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Rechnungen werden geladen…</p>
      <div className={styles.skeletonRows} aria-hidden="true"><span /><span /><span /></div>
    </div>
  );

  return (
    <div className={`invoice-workspace ${styles.workspace}`}>
      <RecordListSearchNotice type="outbound" searchInputId="invoice-search" onClear={clear => { setFilters({ ...filters, searchTerm: '', paidStatus: 'all', dateRange: 'all' }); clear(); }} />
      {/* Invoices List */}
      <section className={`invoice-ledger ${styles.ledger}`} aria-label="Ihre Rechnungen">
        <div className={styles.ledgerHeader}>
          <div className={`invoice-list-title ${styles.heading}`}>
            <LedgerListHeading icon="nav-invoices" title="Ihre Rechnungen" isLoading={isLoading} isError={isError} total={total} amounts={isLoading || isError ? [] : invoices.map(invoice => invoice.totalAmount ?? 0)} />
            {!listSearch && (filters.searchTerm || filters.paidStatus !== 'all' || filters.dateRange !== 'all') && (
              <Button variant="ghost" size="sm" onClick={() => setFilters({ ...filters, searchTerm: '', paidStatus: 'all', dateRange: 'all' })}><X className="mr-1.5 h-4 w-4" aria-hidden="true" />Filter zurücksetzen</Button>
            )}
          </div>
          <section className={`invoice-summary ${styles.summary}`} aria-label="Rechnungsübersicht">
            <h3 className="sr-only">Ihr Rechnungsbestand</h3>
            <dl className={`invoice-summary-values ${styles.summaryValues}`}>
              <div><dt>Rechnungen im Ergebnis</dt><dd>{isLoading || isError ? '—' : total}</dd></div>
              <div><dt><CheckCheck aria-hidden="true" />Bezahlt auf dieser Seite</dt><dd className="text-positive">{isLoading || isError ? '—' : paidCount}</dd></div>
              <div><dt><Clock3 aria-hidden="true" />Offen auf dieser Seite</dt><dd>{isLoading || isError ? '—' : openCount}</dd></div>
            </dl>
          </section>
          {!listSearch && <div className={`invoice-filter-bar ${styles.filterBar}`}>
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
                    <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
            <fieldset className={`min-w-0 space-y-2 ${styles.statusFilter}`}>
              <legend className="text-xs font-medium text-muted-foreground">Zahlungsstatus</legend>
              <div className={`filter-switch ${styles.statusSwitch}`} aria-label="Zahlungsstatus">
                {([{ value: 'all', label: 'Alle' }, { value: 'unpaid', label: 'Offen' }, { value: 'partial', label: 'Teilbezahlt' }, { value: 'paid', label: 'Bezahlt' }] as const).map(option => (
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
          </div>}
        </div>

        {isError && <div role="alert" className={`flex flex-wrap items-center justify-between gap-3 border-b bg-critical-surface p-4 text-sm text-critical-foreground ${styles.errorState}`}><p>Rechnungen konnten nicht geladen werden.</p><Button variant="outline" onClick={() => loadInvoices(page, pageSize)}>Erneut laden</Button></div>}
        {/* Invoices Table */}
        <div className={styles.listBody}>
          <div className={`divide-y xl:hidden ${styles.mobileList}`} aria-label="Rechnungsliste">
            {isLoading ? renderLoadingState() : isError ? null : invoices.length > 0 ? invoices.map((invoice) => (
              <article key={invoice.id} className={`invoice-record ${styles.mobileRecord}`}>
                <div className={styles.recordHeading}>
                  <div className="min-w-0">
                    <h3 className="font-semibold">{invoice.invoiceNumber || invoice.fileName}</h3>
                    <p className={styles.fileName} title={invoice.fileName}>{invoice.fileName.replace(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}_/i, '')}</p>
                    {invoice.customer?.name && <p className="mt-1 text-sm">{invoice.customer.name}</p>}
                    <p className="mt-1 text-sm text-muted-foreground">
                      {invoice.invoiceDate ? new Date(invoice.invoiceDate).toLocaleDateString('de-DE') : new Date(invoice.uploadedAt).toLocaleDateString('de-DE')}
                    </p>
                  </div>
                  <p className={styles.recordAmount}>{invoice.totalAmount != null ? formatCurrency(invoice.totalAmount) : '–'}</p>
                </div>
                <div className={styles.recordStatus}>
                  <StatusBadge paymentReturnId={invoice.id} status={invoice.status} paymentState={invoice.paymentSummary?.paymentState} availableStatuses={availableInvoiceStatuses(invoice)} onStatusChange={(newStatus) => onStatusChange(invoice.id, newStatus)} />
                  <InvoiceBalance invoice={invoice} />
                </div>
                <div className={styles.recordActions}>
                  <Button variant="outline" size="sm" className="min-h-11" data-invoice-return={invoice.id} onClick={() => onOpenDetails(invoice)}><Eye className="h-4 w-4" />Details</Button>
                  {invoice.hasPdfFile !== false && (
                    <Button variant="outline" size="sm" className="min-h-11" onClick={() => onViewReceipt(`/api/invoices/download?id=${invoice.id}`)}><FileText className="h-4 w-4" />PDF</Button>
                  )}
                  {renderInvoiceActions(invoice)}
                </div>
              </article>
            )) : (
              renderEmptyState()
            )}
          </div>
          <div className={`hidden xl:block ${styles.desktopList}`}>
            <Table>
              <TableCaption className="sr-only">Rechnungen passend zu den ausgewählten Filtern</TableCaption>
              <TableHeader>
                <TableRow className="bg-muted/50">
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
                        <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${filters.sortOrder === 'asc' ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      )}
                    </button>
                  </TableHead>
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
                        <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${filters.sortOrder === 'asc' ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                        <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${filters.sortOrder === 'asc' ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                {isLoading ? <TableRow><TableCell colSpan={5}>{renderLoadingState()}</TableCell></TableRow> : isError ? null : invoices.length > 0 ? (
                  invoices.map((invoice) => (
                    <TableRow key={invoice.id} className={styles.desktopRecord}>
                      <TableCell>
                        <div className="flex min-w-0 items-center gap-3">
                          <span className={`invoice-file-symbol ${styles.documentSymbol}`}><DashboardIcon name="invoice-document" size={36} /></span>
                          <div className="min-w-0">
                            <button type="button" className="min-h-11 text-left font-semibold hover:text-primary hover:underline" data-invoice-return={invoice.id} onClick={() => onOpenDetails(invoice)} aria-label={`Details zu Rechnung ${invoice.invoiceNumber || invoice.id}`}>{invoice.invoiceNumber || 'Ohne Rechnungsnummer'}</button>
                            {invoice.customer?.name && <p className="text-xs font-medium text-foreground">{invoice.customer.name}</p>}
                            <p className={styles.fileName} title={invoice.fileName}>{invoice.fileName.replace(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}_/i, '')}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {invoice.invoiceDate
                          ? new Date(invoice.invoiceDate).toLocaleDateString('de-DE')
                          : new Date(invoice.uploadedAt).toLocaleDateString('de-DE')}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {invoice.totalAmount != null
                          ? formatCurrency(invoice.totalAmount)
                          : <span className="text-muted-foreground italic text-xs">Nicht verfügbar</span>}
                        <InvoiceBalance invoice={invoice} />
                      </TableCell>
                      <TableCell className="text-center">
                        <StatusBadge
                          paymentReturnId={invoice.id}
                          status={invoice.status} paymentState={invoice.paymentSummary?.paymentState}
                          availableStatuses={availableInvoiceStatuses(invoice)}
                          onStatusChange={(newStatus) => onStatusChange(invoice.id, newStatus)}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className={styles.desktopActions}>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-2"
                            data-invoice-return={invoice.id} onClick={() => onOpenDetails(invoice)}
                          >
                            <Eye className="h-4 w-4" />
                            Details
                          </Button>
                          {renderInvoiceActions(invoice)}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5}>
                      {renderEmptyState()}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className={styles.pagination}>
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
      </section>

      <aside className={styles.tools} aria-label="Weitere Rechnungswerkzeuge">
        <details className={`invoice-import group ${styles.importTool}`} open={selectedFile ? true : undefined}>
          <summary className={styles.importSummary}>
            <span className={styles.importSymbol}><DashboardIcon name="invoice-import" size={40} /></span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold"><span className="sm:hidden">E-Rechnung</span><span className="hidden sm:inline">E-Rechnung importieren</span></span>
              <span className={styles.importFormats}>ZUGFeRD, Factur-X oder XRechnung / PDF / XML</span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className={styles.importBody}>
            <div className="min-w-0 space-y-2">
              <Label htmlFor="invoiceFile">Rechnungsdatei auswählen</Label>
              <Input id="invoiceFile" type="file" accept=".pdf,.xml,application/pdf,application/xml,text/xml" onChange={onFileChange} disabled={isUploading} className="h-auto min-h-11 cursor-pointer py-2 file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-foreground" aria-describedby="invoice-upload-help" />
              <span id="invoice-upload-help" className="sr-only">Rechnungsdaten aus Datei übernehmen.</span>
            </div>
            <Button onClick={onFileUpload} disabled={!selectedFile || isUploading} className="w-full" aria-busy={isUploading}>
              {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="mr-2 h-4 w-4" aria-hidden="true" />}
              {isUploading ? 'Wird importiert…' : 'Rechnung hochladen'}
            </Button>
          </div>
        </details>
        <section aria-label="Wiederkehrende Serviceleistungen" className={styles.tool}>
          <div className="min-w-0"><h2 className="text-sm font-semibold">Wiederkehrende Leistungen</h2></div>
          <Button asChild variant="outline"><Link href="/service-billing">Servicepläne öffnen</Link></Button>
        </section>
        <section aria-label="Bankumsätze prüfen" className={styles.tool}>
          <div className="min-w-0"><h2 className="text-sm font-semibold">Zahlungseingänge aus einer Bank-CSV?</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Datei lokal prüfen, passende Rechnungen finden. Keine automatische Buchung.</p></div>
          <Button asChild variant="outline"><Link href="/bank-csv">Bank-CSV prüfen</Link></Button>
        </section>
      </aside>

      <EmailPreviewDialog
        open={!!emailInvoice}
        onOpenChange={(open) => !open && setEmailInvoice(null)}
        returnFocusRef={emailReturnFocusRef}
        documentType="invoice"
        documentId={emailInvoice?.id ?? null}
        onSent={() => loadInvoices(page, pageSize)}
      />
    </div>
  );
}
