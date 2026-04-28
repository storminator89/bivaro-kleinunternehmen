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
import { Eye, Download, Trash2, ArrowRightCircle, Loader2, FileText } from "lucide-react";
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
    DRAFT: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    SENT: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
    ACCEPTED: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
    REJECTED: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    EXPIRED: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
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
            <div className="bg-card rounded-xl shadow-sm border overflow-hidden transition-all duration-300 hover:shadow-md">
                <div className="px-6 pt-6 pb-4 border-b bg-gradient-to-r from-green-50/50 to-green-50/30 dark:from-green-900/10 dark:to-green-900/5">
                    <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
                        <div>
                            <h2 className="text-xl font-semibold mb-1 flex items-center">
                                <FileText className="h-5 w-5 mr-2 text-green-500" />
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

                {/* Table */}
                <div className="overflow-x-auto p-6">
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
                                                                onClick={() => window.open(`/api/quotes/download?id=${quote.id}`, '_blank')}>
                                                                <Eye className="h-4 w-4" />
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent><p>Angebot anzeigen</p></TooltipContent>
                                                    </Tooltip>

                                                    {/* Download */}
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Button variant="outline" size="icon"
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
                                                                    className="text-green-600 border-green-200 hover:bg-green-50 dark:text-green-400 dark:border-green-900/50 dark:hover:bg-green-900/20"
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
                                                                className="text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-900/50 dark:hover:bg-red-900/20"
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
                        <Button onClick={handleConvert} className="bg-green-600 hover:bg-green-700 text-white gap-2">
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
        </div>
    );
}
