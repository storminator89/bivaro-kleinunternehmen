"use client";

import React, { useState } from 'react';
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
import { Eye, Download, Trash2, ArrowRightCircle, Loader2, FileText, Mail } from "lucide-react";
import { EmailPreviewDialog } from "@/components/dashboard/email-preview-dialog";
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
    page: number;
    pageSize: number;
    totalPages: number;
    statusFilter: string;
    searchTerm: string;
    isLoading?: boolean;
    onPageChange: (page: number) => void;
    onPageSizeChange: (size: number) => void;
    onStatusFilterChange: (status: string) => void;
    onSearchChange: (term: string) => void;
    onOpenCreateModal: () => void;
    onStatusChange: (quoteId: number, newStatus: string) => Promise<void>;
    onConvertToInvoice: (quote: Quote) => void | Promise<void>;
    onDelete: (quoteId: number) => Promise<void>;
    loadQuotes: (page: number, pageSize: number) => Promise<void>;
};

const STATUS_OPTIONS = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'];

const STATUS_LABELS: Record<string, string> = {
    DRAFT: 'Entwurf',
    SENT: 'Versendet',
    ACCEPTED: 'Angenommen',
    REJECTED: 'Abgelehnt',
    EXPIRED: 'Abgelaufen',
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
            <SelectTrigger className={`h-auto w-auto px-2.5 py-0.5 rounded-full text-xs font-medium border-0 focus:ring-1 focus:ring-primary/40 gap-1 ${STATUS_COLORS[status] || 'bg-muted text-muted-foreground'}`}>
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
    page,
    pageSize,
    totalPages,
    statusFilter,
    searchTerm,
    isLoading,
    onPageChange,
    onPageSizeChange,
    onStatusFilterChange,
    onSearchChange,
    onOpenCreateModal,
    onStatusChange,
    onConvertToInvoice,
    onDelete,
    loadQuotes,
}: QuotesTabProps) {
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
        <div className="space-y-6">
            {/* Header card */}
            <div className="overflow-hidden rounded-xl border bg-card">
                <div className="border-b bg-muted/20 px-6 pb-4 pt-6">
                    <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
                        <div>
                            <h2 className="text-xl font-semibold mb-1 flex items-center">
                                <FileText className="mr-2 h-5 w-5 text-positive" />
                                Angebote
                            </h2>
                            <p className="text-sm text-muted-foreground">
                                Erstellen und verwalten Sie Angebote – wandeln Sie diese mit einem Klick in Rechnungen um.
                            </p>
                        </div>
                        <Button onClick={onOpenCreateModal} className="gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                            </svg>
                            Angebot erstellen
                        </Button>
                    </div>
                </div>

                {/* Filters */}
                <div className="px-6 py-4 border-b">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="quote-status-filter" className="text-sm">Status</Label>
                            <select
                                id="quote-status-filter"
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                value={statusFilter}
                                onChange={(e) => onStatusFilterChange(e.target.value)}
                            >
                                <option value="all">Alle Status</option>
                                {STATUS_OPTIONS.map(s => (
                                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="quote-search" className="text-sm">Suche</Label>
                            <div className="relative">
                                <Input
                                    id="quote-search"
                                    type="text"
                                    placeholder="Angebotsnummer suchen..."
                                    value={searchTerm}
                                    onChange={(e) => onSearchChange(e.target.value)}
                                />
                                {searchTerm && (
                                    <button
                                        type="button"
                                        aria-label="Suche leeren"
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
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

                <div className="divide-y lg:hidden" aria-label="Angebotsliste">
                    {quotes.length > 0 ? quotes.map((quote) => (
                        <article key={quote.id} className="space-y-3 p-4">
                            <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                    <h3 className="truncate font-semibold">{quote.invoiceNumber || 'Angebot ohne Nummer'}</h3>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        {quote.customer?.name || 'Kein Kunde'} · {quote.invoiceDate ? new Date(quote.invoiceDate).toLocaleDateString('de-DE') : new Date(quote.uploadedAt).toLocaleDateString('de-DE')}
                                    </p>
                                </div>
                                <p className="shrink-0 font-semibold tabular-nums">{quote.totalAmount ? formatCurrency(quote.totalAmount) : '–'}</p>
                            </div>
                            <QuoteStatusBadge status={quote.status} onStatusChange={(newStatus) => onStatusChange(quote.id, newStatus)} />
                            <div className="flex flex-wrap gap-2">
                                <Button variant="outline" size="sm" className="min-h-11" onClick={() => window.open(`/api/quotes/download?id=${quote.id}`, '_blank')}><Eye className="h-4 w-4" />Ansehen</Button>
                                {quote.status !== 'ACCEPTED' && quote.status !== 'REJECTED' && quote.status !== 'EXPIRED' && (
                                    <Button variant="outline" size="sm" className="min-h-11" disabled={convertingId === quote.id} onClick={() => setConfirmConvert(quote)}>In Rechnung</Button>
                                )}
                                <Button variant="ghost" size="sm" className="min-h-11 text-destructive" disabled={deletingId === quote.id} onClick={() => setConfirmDelete(quote)}>Löschen</Button>
                            </div>
                        </article>
                    )) : (
                        <p className="p-6 text-center text-sm text-muted-foreground">Keine Angebote vorhanden. Erstellen Sie Ihr erstes Angebot.</p>
                    )}
                </div>

                {/* Table */}
                <div className="hidden overflow-x-auto p-6 lg:block">
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
                            {quotes.length > 0 ? (
                                quotes.map((quote) => (
                                    <TableRow key={quote.id} className="hover:bg-muted/50 transition-colors">
                                        <TableCell className="text-muted-foreground">
                                            {quote.invoiceDate
                                                ? new Date(quote.invoiceDate).toLocaleDateString('de-DE')
                                                : new Date(quote.uploadedAt).toLocaleDateString('de-DE')}
                                        </TableCell>
                                        <TableCell className="font-medium">
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
                                            {quote.totalAmount
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
                                                    {quote.status !== 'ACCEPTED' && quote.status !== 'REJECTED' && quote.status !== 'EXPIRED' && (
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
                                            <FileText className="h-12 w-12 opacity-20 mb-3" />
                                            <span>Keine Angebote vorhanden. Erstellen Sie Ihr erstes Angebot.</span>
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
                            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
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

            {/* Confirm: Convert to Invoice */}
            <Dialog open={!!confirmConvert} onOpenChange={() => setConfirmConvert(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Angebot in Rechnung umwandeln?</DialogTitle>
                        <DialogDescription>
                            Das Angebot <strong>{confirmConvert?.invoiceNumber}</strong> wird in eine Rechnung umgewandelt.
                            Es wird automatisch eine neue Rechnungsnummer vergeben und ein Einnahme-Eintrag erstellt.
                            Das Angebot wird als &quot;Angenommen&quot; markiert.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmConvert(null)}>Abbrechen</Button>
                        <Button onClick={handleConvert} className="gap-2">
                            <ArrowRightCircle className="h-4 w-4" />
                            In Rechnung umwandeln
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
