"use client";

import { QuoteWorkflowDialog } from '@/components/dashboard/quote-workflow-dialog';
import { quoteConversionBlockReason, quoteNextAction, type QuoteWorkflowCounts } from '@/lib/quote-workflow';
import { formatBusinessDateDisplay } from '@/lib/business-date';
import Link from "next/link";
import { DashboardIcon } from "@/components/brand/dashboard-icon";
import { QueryFeedback } from '@/components/dashboard/query-feedback';
import React, { useState } from 'react';
import styles from "@/components/dashboard/sales-workspace.module.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import {
    Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Eye, Download, Trash2, ArrowRightCircle, Loader2, Mail, Search, X } from "lucide-react";
import { EmailPreviewDialog } from "@/components/dashboard/email-preview-dialog";
import { LedgerListHeading } from "@/components/dashboard/ledger-list-heading";
import { formatCurrency } from "@/lib/dashboard-utils";

export type Quote = {
    id: number;
    invoiceNumber?: string;
    fileName: string;
    uploadedAt: string;
    invoiceDate?: string;
    validUntil?: string;
    totalAmount?: number;
    status: string;
    quoteFollowUpOn?: string | null;
    quoteResponseNote?: string | null;
    convertedInvoice?: { id: number } | null;
    customer?: { id: number; name: string } | null;
    parsedData?: {
        items?: Array<{ description: string; quantity: number; unitPrice: number; unit: string; taxRate: number }>;
        notes?: string;
        customerAddress?: string;
        [key: string]: unknown;
    } | null;
};

type QuotesTabProps = {
    quotes: Quote[];
    total: number;
    workflowCounts?: QuoteWorkflowCounts;
    workflowDate?: string;
    page: number;
    pageSize: number;
    totalPages: number;
    statusFilter: string;
    searchTerm: string;
    isLoading?: boolean;
    isError?: boolean;
    onPageChange: (page: number) => void;
    onPageSizeChange: (size: number) => void;
    onStatusFilterChange: (status: string) => void;
    onSearchChange: (term: string) => void;
    onResetFilters?: () => void;
    onOpenCreateModal: () => void;
    onStatusChange: (quoteId: number, newStatus: string) => Promise<void>;
    onConvertToInvoice: (quote: Quote) => void | Promise<void>;
    onDelete: (quoteId: number) => Promise<void>;
    loadQuotes: (page: number, pageSize: number) => Promise<void>;
};

const STATUS_OPTIONS = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED'];

const STATUS_LABELS: Record<string, string> = {
    DRAFT: 'Entwurf',
    SENT: 'Versendet',
    ACCEPTED: 'Angenommen',
    REJECTED: 'Abgelehnt',
    EXPIRED: 'Abgelaufen',
    CANCELLED: 'Zurückgezogen',
};

const STATUS_COLORS: Record<string, string> = {
    DRAFT: 'bg-muted text-muted-foreground',
    SENT: 'bg-notice-surface text-notice-foreground',
    ACCEPTED: 'bg-positive-surface text-positive-foreground',
    REJECTED: 'bg-critical-surface text-critical-foreground',
    EXPIRED: 'bg-secondary text-muted-foreground',
};

function QuoteStatusBadge({ status, onStatusChange }: { status: string; onStatusChange: (s: string) => void }) {
    return (
        <Select value={status} onValueChange={onStatusChange}>
            <SelectTrigger aria-label={`Angebotsstatus: ${STATUS_LABELS[status] || status}`} className={`min-h-11 w-auto rounded-md border-0 px-2.5 text-xs font-medium gap-1 ${STATUS_COLORS[status] || 'bg-muted text-muted-foreground'}`}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent align="center">
                {STATUS_OPTIONS.map(s => (
                    <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}


export function QuotesTab({
    quotes,
    total,
    workflowCounts,
    workflowDate,
    page,
    pageSize,
    totalPages,
    statusFilter,
    searchTerm,
    isLoading = false,
    isError = false,
    onPageChange,
    onPageSizeChange,
    onStatusFilterChange,
    onSearchChange,
    onResetFilters,
    onOpenCreateModal,
    onStatusChange,
    onConvertToInvoice,
    onDelete,
    loadQuotes,
}: QuotesTabProps) {
    const [workflowQuote, setWorkflowQuote] = useState<Quote | null>(null);
    const [convertingId, setConvertingId] = useState<number | null>(null);
    const [deletingId, setDeletingId] = useState<number | null>(null);
    const [confirmConvert, setConfirmConvert] = useState<Quote | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<Quote | null>(null);
    const [emailQuote, setEmailQuote] = useState<Quote | null>(null);

    const handleConvert = async () => {
        if (!confirmConvert) return;
        setConvertingId(confirmConvert.id);
        setConfirmConvert(null);
        try {
            await onConvertToInvoice(confirmConvert);
        } finally {
            setConvertingId(null);
        }
    };

    const handleDelete = async () => {
        if (!confirmDelete) return;
        setDeletingId(confirmDelete.id);
        setConfirmDelete(null);
        try {
            await onDelete(confirmDelete.id);
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <div className={`space-y-6 ${styles.records}`}>
            <section aria-labelledby="quote-next-heading">
                <h2 id="quote-next-heading" className="sr-only">Nächste Schritte</h2>

                <div className="flex flex-wrap gap-2">
                    {([
                        ['FOLLOW_UP', '1 · Nachfassen', 'Heute oder früher vorgemerkt'],
                        ['NEEDS_RESPONSE', '2 · Rückmeldung klären', 'Versendet, Gültigkeit vorbei'],
                        ['READY_TO_INVOICE', '3 · Rechnung vorbereiten', 'Von Ihnen als angenommen erfasst'],
                    ] as const).map(([key, title, detail]) => <button key={key} type="button" title={detail} aria-pressed={statusFilter === key} disabled={isLoading || isError} onClick={() => onStatusFilterChange(statusFilter === key ? 'all' : key)} className={`min-h-11 rounded-lg border bg-card px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${statusFilter === key ? 'border-primary bg-positive-surface' : 'border-border'}`}>
                        <span className="flex items-center justify-between gap-3 font-medium"><span>{title}</span><span className="tabular-nums">{isLoading || isError || !workflowCounts ? '–' : workflowCounts[key]}</span></span>
                    </button>)}
                </div>

            </section>
            {/* Header card */}
            <div className="ledger-list overflow-hidden rounded-xl border bg-card">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4 sm:p-6">
                    <LedgerListHeading icon="nav-quotes" title="Ihre Angebote" isLoading={isLoading} isError={isError} total={total} amounts={isLoading || isError ? [] : quotes.map(quote => quote.totalAmount ?? 0)} />
                    {(searchTerm || statusFilter !== 'all') && <Button variant="ghost" size="sm" onClick={() => { if (onResetFilters) onResetFilters(); else { onSearchChange(''); onStatusFilterChange('all'); } }}><X className="mr-1.5 h-4 w-4" aria-hidden="true" />Filter zurücksetzen</Button>}
                </div>

                {/* Filters */}
                <div className={styles.recordToolbar}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="quote-status-filter" className="text-sm">Status</Label>
                            <select
                                id="quote-status-filter"
                                className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                value={statusFilter}
                                onChange={(e) => onStatusFilterChange(e.target.value)}
                            >
                                <option value="all">Alle Status</option>
                                <optgroup label="Nächster Schritt"><option value="FOLLOW_UP">Nachfassen – heute &amp; überfällig</option><option value="NEEDS_RESPONSE">Gültigkeit vorbei – Rückmeldung klären</option><option value="READY_TO_INVOICE">Angenommen – Rechnung vorbereiten</option></optgroup>
                                {STATUS_OPTIONS.map(s => (
                                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="quote-search" className="text-sm">Suche</Label>
                            <div className="relative">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                                <Input
                                    id="quote-search"
                                    type="text"
                                    className="pl-9 pr-11"
                                    placeholder="Angebotsnummer oder Kunde suchen…"
                                    value={searchTerm}
                                    onChange={(e) => onSearchChange(e.target.value)}
                                />
                                {searchTerm && (
                                    <button
                                        type="button"
                                        aria-label="Suche leeren"
                                        className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-muted-foreground hover:text-foreground"
                                        onClick={() => onSearchChange('')}
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

                {isError && <QueryFeedback noun="Angebote" isError onRetry={() => loadQuotes(page, pageSize)} />}
                <div hidden={isError}>
                <div className="divide-y xl:hidden" aria-label="Angebotsliste">
                    {isLoading ? <div role="status" className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Angebote werden geladen…</div> : quotes.length > 0 ? quotes.map((quote) => (
                        <article key={quote.id} className={`space-y-3 ${styles.mobileRecord}`}>
                            <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                    <h3 className="truncate font-semibold">{quote.invoiceNumber || 'Angebot ohne Nummer'}</h3>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        {quote.customer?.name || 'Kein Kunde'} · {quote.invoiceDate ? new Date(quote.invoiceDate).toLocaleDateString('de-DE') : new Date(quote.uploadedAt).toLocaleDateString('de-DE')}
                                    </p>
                                </div>
                                <p className="shrink-0 font-semibold tabular-nums">{quote.totalAmount != null ? formatCurrency(quote.totalAmount) : '–'}</p>
                            </div>
                            {quote.validUntil && <p className="text-xs text-muted-foreground">Gültig bis {new Date(quote.validUntil).toLocaleDateString('de-DE')}</p>}
                            {quoteNextAction(quote, workflowDate) && <p className="text-sm font-medium text-primary">{quoteNextAction(quote, workflowDate)?.label}</p>}
                            {!quote.convertedInvoice && quoteConversionBlockReason(quote, workflowDate) && <p className="text-sm text-muted-foreground">Rückmeldung klären.</p>}
                            {quote.quoteFollowUpOn && <p className="text-sm text-muted-foreground">Wiedervorlage: {formatBusinessDateDisplay(quote.quoteFollowUpOn)}</p>}
                            <QuoteStatusBadge status={quote.status} onStatusChange={(newStatus) => onStatusChange(quote.id, newStatus)} />
                            <div className="flex flex-wrap gap-2">
                                {quote.convertedInvoice && <Button variant="outline" size="sm" asChild><Link href={`/history?invoiceId=${quote.convertedInvoice.id}`}>Verknüpfte Rechnung ansehen</Link></Button>}
                                <Button variant="outline" size="sm" onClick={() => setWorkflowQuote(quote)}>Rückmeldung &amp; Nachfassen</Button>
                                <Button variant="outline" size="sm" className="min-h-11" onClick={() => window.open(`/api/quotes/download?id=${quote.id}`, '_blank')}><Eye className="h-4 w-4" />Ansehen</Button>
                                {!quote.convertedInvoice && !quoteConversionBlockReason(quote, workflowDate) && (
                                    <Button variant="outline" size="sm" className="min-h-11" disabled={convertingId === quote.id} onClick={() => setConfirmConvert(quote)}>In Rechnung</Button>
                                )}
                                <Button variant="outline" size="sm" disabled={quote.status === 'REJECTED' || quote.status === 'EXPIRED'} onClick={() => setEmailQuote(quote)}><Mail className="h-4 w-4" aria-hidden="true" />E-Mail</Button>
                                <Button variant="ghost" size="sm" onClick={() => window.open(`/api/quotes/download?id=${quote.id}&download=true`, '_blank')}><Download className="h-4 w-4" aria-hidden="true" />PDF</Button>
                                <Button variant="ghost" size="sm" className="min-h-11 text-destructive" disabled={deletingId === quote.id} onClick={() => setConfirmDelete(quote)}>Löschen</Button>
                            </div>
                        </article>
                    )) : (
                        <div className="ledger-empty"><DashboardIcon name="nav-quotes" size={48} /><h3>{searchTerm || statusFilter !== 'all' ? 'Keine passenden Angebote' : 'Noch keine Angebote'}</h3>{(searchTerm || statusFilter !== 'all') && <p>Suche oder Filter ändern.</p>}{!searchTerm && statusFilter === 'all' && <Button variant="outline" onClick={onOpenCreateModal}>Erstes Angebot erstellen</Button>}</div>
                    )}
                </div>

                {/* Table */}
                <div className="hidden overflow-x-auto p-6 xl:block">
                    <Table>
                        <TableCaption>
                            {isLoading ? 'Lade Angebote...' : `${total} Angebot${total !== 1 ? 'e' : ''}`}
                        </TableCaption>
                        <TableHeader>
                            <TableRow className="bg-muted/50">
                                <TableHead className="font-medium">Datum</TableHead>
                                <TableHead className="font-medium">Angebots-Nr.</TableHead>
                                <TableHead className="font-medium">Kunde</TableHead>
                                <TableHead className="font-medium">Gültig bis</TableHead>
                                <TableHead className="text-right font-medium">Betrag</TableHead>
                                <TableHead className="text-center font-medium">Status</TableHead>
                                <TableHead className="text-right font-medium">Aktionen</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? <TableRow><TableCell colSpan={7}><div role="status" className="flex items-center justify-center gap-2 py-12 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Angebote werden geladen…</div></TableCell></TableRow> : quotes.length > 0 ? (
                                quotes.map((quote) => (
                                    <TableRow key={quote.id} className="hover:bg-muted/50 transition-colors">
                                        <TableCell className="text-muted-foreground">
                                            {quote.invoiceDate
                                                ? new Date(quote.invoiceDate).toLocaleDateString('de-DE')
                                                : new Date(quote.uploadedAt).toLocaleDateString('de-DE')}
                                        </TableCell>
                                        <TableCell className="font-medium">
                                            {quoteNextAction(quote, workflowDate) && <p className="mb-1 text-xs font-medium text-primary">{quoteNextAction(quote, workflowDate)?.label}</p>}
                                            {quote.invoiceNumber || <span className="text-muted-foreground italic text-xs">Nicht verfügbar</span>}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground">
                                            {quote.customer?.name || <span className="italic text-xs">Kein Kunde</span>}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground">
                                            {quote.validUntil
                                                ? new Date(quote.validUntil).toLocaleDateString('de-DE')
                                                : <span className="italic text-xs">–</span>}
                                        </TableCell>
                                        <TableCell className="text-right font-medium">
                                            {quote.totalAmount != null
                                                ? formatCurrency(quote.totalAmount)
                                                : <span className="text-muted-foreground italic text-xs">–</span>}
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <div className="flex justify-center">
                                                <QuoteStatusBadge
                                                    status={quote.status}
                                                    onStatusChange={(newStatus) => onStatusChange(quote.id, newStatus)}
                                                />
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {!quote.convertedInvoice && quoteConversionBlockReason(quote, workflowDate) && <p className="mb-2 max-w-64 text-left text-sm text-muted-foreground">Rückmeldung klären.</p>}
                                            {quote.convertedInvoice && <Button variant="outline" size="sm" className="mb-2 mr-2" asChild><Link href={`/history?invoiceId=${quote.convertedInvoice.id}`}>Verknüpfte Rechnung ansehen</Link></Button>}
                                            <Button variant="outline" size="sm" className="mb-2" onClick={() => setWorkflowQuote(quote)}>Rückmeldung &amp; Nachfassen</Button>
                                            {quote.quoteFollowUpOn && <p className="mb-2 text-sm text-muted-foreground">Wiedervorlage: {formatBusinessDateDisplay(quote.quoteFollowUpOn)}</p>}
                                            <TooltipProvider>
                                                <div className="flex justify-end space-x-2">
                                                    {/* View */}
                                                     <Tooltip>
                                                         <TooltipTrigger asChild>
                                                             <Button variant="outline" size="icon"
                                                                 aria-label={`Angebot ${quote.invoiceNumber || quote.id} anzeigen`}
                                                                 onClick={() => window.open(`/api/quotes/download?id=${quote.id}`, '_blank')}>
                                                                 <Eye className="h-4 w-4" />
                                                            </Button>
                                                         </TooltipTrigger>
                                                         <TooltipContent><p>Angebot anzeigen</p></TooltipContent>
                                                     </Tooltip>

                                                     {/* Send by email */}
                                                     <Tooltip>
                                                         <TooltipTrigger asChild>
                                                             <Button
                                                                 variant="outline"
                                                                 size="icon"
                                                                 aria-label={`Angebot ${quote.invoiceNumber || quote.id} per E-Mail senden`}
                                                                 className="border-notice/30 text-notice hover:bg-notice-surface"
                                                                 onClick={() => setEmailQuote(quote)}
                                                                 disabled={quote.status === 'REJECTED' || quote.status === 'EXPIRED'}
                                                             >
                                                                 <Mail className="h-4 w-4" />
                                                             </Button>
                                                         </TooltipTrigger>
                                                         <TooltipContent><p>Angebot per E-Mail senden</p></TooltipContent>
                                                     </Tooltip>

                                                     {/* Download */}
                                                     <Tooltip>
                                                         <TooltipTrigger asChild>
                                                             <Button variant="outline" size="icon"
                                                                aria-label={`Angebot ${quote.invoiceNumber || quote.id} herunterladen`}
                                                                onClick={() => window.open(`/api/quotes/download?id=${quote.id}&download=true`, '_blank')}>
                                                                <Download className="h-4 w-4" />
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent><p>Herunterladen</p></TooltipContent>
                                                    </Tooltip>

                                                    {/* Convert to Invoice */}
                                                    {!quote.convertedInvoice && !quoteConversionBlockReason(quote, workflowDate) && (
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <Button
                                                                    variant="outline"
                                                                    size="icon"
                                                                    aria-label={`Angebot ${quote.invoiceNumber || quote.id} in Rechnung umwandeln`}
                                                                    className="border-positive/30 text-positive hover:bg-positive-surface"
                                                                    onClick={() => setConfirmConvert(quote)}
                                                                    disabled={convertingId === quote.id}
                                                                >
                                                                    {convertingId === quote.id
                                                                        ? <Loader2 className="h-4 w-4 animate-spin" />
                                                                        : <ArrowRightCircle className="h-4 w-4" />}
                                                                </Button>
                                                            </TooltipTrigger>
                                                            <TooltipContent><p>In Rechnung umwandeln</p></TooltipContent>
                                                        </Tooltip>
                                                    )}

                                                    {/* Delete */}
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Button
                                                                variant="outline"
                                                                size="icon"
                                                                aria-label={`Angebot ${quote.invoiceNumber || quote.id} löschen`}
                                                                className="border-critical/30 text-critical hover:bg-critical-surface"
                                                                onClick={() => setConfirmDelete(quote)}
                                                                disabled={deletingId === quote.id}
                                                            >
                                                                {deletingId === quote.id
                                                                    ? <Loader2 className="h-4 w-4 animate-spin" />
                                                                    : <Trash2 className="h-4 w-4" />}
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent><p>Löschen</p></TooltipContent>
                                                    </Tooltip>
                                                </div>
                                            </TooltipProvider>
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                                        <div className="flex flex-col items-center">
                                            <DashboardIcon name="nav-quotes" size={48} className="mb-3" />
                                            <span>Keine passenden Angebote vorhanden.</span><Button variant="outline" className="mt-4" onClick={onOpenCreateModal}>Angebot anlegen</Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
                </div>
                {/* Pagination */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-6 pb-6">
                    <div className="text-sm text-muted-foreground">
                        {total === 0 ? 'Keine Einträge' : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} von ${total} Angeboten · Seite ${page} von ${Math.max(1, totalPages)}`}
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                        <Label htmlFor="quotes-page-size" className="text-sm">Pro Seite</Label>
                        <select
                            id="quotes-page-size"
                            value={pageSize}
                            onChange={async (e) => {
                                const size = parseInt(e.target.value);
                                onPageSizeChange(size);
                                onPageChange(1);
                                await loadQuotes(1, size);
                            }}
                            className="min-h-11 rounded-md border border-input bg-background px-2 text-sm"
                        >
                            <option value={10}>10</option>
                            <option value={20}>20</option>
                            <option value={50}>50</option>
                        </select>
                        <Button variant="outline" size="sm" disabled={page <= 1}
                            onClick={async () => { const p = Math.max(1, page - 1); onPageChange(p); await loadQuotes(p, pageSize); }}>
                            Zurück
                        </Button>
                        <Button variant="outline" size="sm" disabled={page >= totalPages}
                            onClick={async () => { const p = Math.min(totalPages, page + 1); onPageChange(p); await loadQuotes(p, pageSize); }}>
                            Weiter
                        </Button>
                    </div>
                </div>
            </div>

            {workflowQuote && <QuoteWorkflowDialog key={workflowQuote.id} quote={workflowQuote} onClose={() => setWorkflowQuote(null)} onSaved={() => loadQuotes(page, pageSize)} />}
            {/* Confirm: Convert to Invoice */}
            <Dialog open={!!confirmConvert} onOpenChange={() => setConfirmConvert(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Rechnungsentwurf prüfen?</DialogTitle>
                        <DialogDescription>
                            Kunde und Positionen aus <strong>{confirmConvert?.invoiceNumber}</strong> werden in den Rechnungseditor übernommen. Prüfen Sie dort Datum, Leistung und Steuerentscheidung.
                            Erst wenn Sie im Editor speichern, wird ein verknüpfter Rechnungsentwurf angelegt. Es wird nichts versendet und keine Zahlung oder Einnahme gebucht. Abbrechen schließt ohne neue Rechnung.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmConvert(null)}>Abbrechen</Button>
                        <Button onClick={handleConvert} className="gap-2">
                            <ArrowRightCircle className="h-4 w-4" />
                            Entwurf prüfen
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Confirm: Delete */}
            <Dialog open={!!confirmDelete} onOpenChange={() => setConfirmDelete(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Angebot löschen?</DialogTitle>
                        <DialogDescription>
                            Möchten Sie das Angebot <strong>{confirmDelete?.invoiceNumber || confirmDelete?.fileName}</strong> wirklich löschen?
                            Diese Aktion kann nicht rückgängig gemacht werden.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmDelete(null)}>Abbrechen</Button>
                        <Button variant="destructive" onClick={handleDelete}>Löschen</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <EmailPreviewDialog
                open={!!emailQuote}
                onOpenChange={(open) => !open && setEmailQuote(null)}
                documentType="quote"
                documentId={emailQuote?.id ?? null}
                onSent={() => loadQuotes(page, pageSize)}
            />
        </div>
    );
}
