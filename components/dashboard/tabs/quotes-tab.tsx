"use client";

import { QuoteWorkflowDialog } from '@/components/dashboard/quote-workflow-dialog';
import { QuoteReleaseVersionsDialog } from '@/components/dashboard/quote-release-versions-dialog';
import { quoteConversionBlockReason, quoteNextAction, type QuoteWorkflowCounts } from '@/lib/quote-workflow';
import { formatBusinessDateDisplay } from '@/lib/business-date';
import Link from "next/link";
import { DashboardIcon } from "@/components/brand/dashboard-icon";
import { QueryFeedback } from '@/components/dashboard/query-feedback';
import React, { useState } from 'react';
import styles from "./quote-workspace.module.css";
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
import { Eye, Download, Trash2, ArrowRightCircle, Loader2, Mail, Search, X, FilePenLine, Send, CircleCheck, CircleX, Clock3, Ban } from "lucide-react";
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
    ownerCaptureEnabled?: boolean;
    ownerCaptureSessionKey?: string;
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

const STATUS_ICONS: Record<string, typeof FilePenLine> = {
    DRAFT: FilePenLine,
    SENT: Send,
    ACCEPTED: CircleCheck,
    REJECTED: CircleX,
    EXPIRED: Clock3,
    CANCELLED: Ban,
};

function QuoteStatusBadge({ status, onStatusChange }: { status: string; onStatusChange: (s: string) => void }) {
    const StatusIcon = STATUS_ICONS[status] || FilePenLine;
    return (
        <Select value={status} onValueChange={onStatusChange}>
            <SelectTrigger aria-label={`Angebotsstatus: ${STATUS_LABELS[status] || status}`} className={`${styles.status} ${STATUS_COLORS[status] || 'bg-muted text-muted-foreground'}`}>
                <StatusIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
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
    ownerCaptureEnabled = false,
    ownerCaptureSessionKey = '',
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
    const [versionSelection, setVersionSelection] = useState<{ quote: Quote; sessionKey: string } | null>(null);
    const [convertingId, setConvertingId] = useState<number | null>(null);
    const [deletingId, setDeletingId] = useState<number | null>(null);
    const [confirmConvert, setConfirmConvert] = useState<Quote | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<Quote | null>(null);
    const [emailQuote, setEmailQuote] = useState<Quote | null>(null);
    const emailReturnFocusRef = React.useRef<HTMLButtonElement | null>(null);

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
        <div className={styles.workspace}>
            <div className={`ledger-list ${styles.panel}`}>
                <div className={styles.listHeading}>
                    <LedgerListHeading icon="nav-quotes" title="Ihre Angebote" isLoading={isLoading} isError={isError} total={total} amounts={isLoading || isError ? [] : quotes.map(quote => quote.totalAmount ?? 0)} />
                    {(searchTerm || statusFilter !== 'all') && <Button variant="ghost" size="sm" onClick={() => { if (onResetFilters) onResetFilters(); else { onSearchChange(''); onStatusFilterChange('all'); } }}><X className="mr-1.5 h-4 w-4" aria-hidden="true" />Filter zurücksetzen</Button>}
                </div>

                <section aria-labelledby="quote-next-heading" className={styles.pipeline}>
                    <h2 id="quote-next-heading" className="sr-only">Nächste Schritte</h2>
                    {([
                        ['FOLLOW_UP', '1 · Nachfassen', 'Heute oder früher vorgemerkt'],
                        ['NEEDS_RESPONSE', '2 · Rückmeldung klären', 'Versendet, Gültigkeit vorbei'],
                        ['READY_TO_INVOICE', '3 · Rechnung vorbereiten', 'Von Ihnen als angenommen erfasst'],
                    ] as const).map(([key, title, detail]) => <button key={key} type="button" title={detail} aria-pressed={statusFilter === key} disabled={isLoading || isError} onClick={() => onStatusFilterChange(statusFilter === key ? 'all' : key)} className={styles.pipelineStep}>
                        <span>{title}</span><strong>{isLoading || isError || !workflowCounts ? '–' : workflowCounts[key]}</strong>
                    </button>)}
                </section>

                <div className={styles.toolbar}>
                    <div className={styles.searchField}>
                        <Label htmlFor="quote-search" className={styles.fieldLabel}>Suche</Label>
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
                                    className={styles.clearSearch}
                                    onClick={() => onSearchChange('')}
                                >
                                    <X className="h-4 w-4" aria-hidden="true" />
                                </button>
                            )}
                        </div>
                    </div>
                    <div className={styles.statusField}>
                        <Label htmlFor="quote-status-filter" className={styles.fieldLabel}>Status</Label>
                        <select
                            id="quote-status-filter"
                            className={styles.select}
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
                </div>

                {isError && <QueryFeedback noun="Angebote" isError onRetry={() => loadQuotes(page, pageSize)} />}
                <div hidden={isError}>
                    <div className={styles.mobileList} aria-label="Angebotsliste">
                        {isLoading ? <div role="status" className={styles.loading}><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Angebote werden geladen…</div> : quotes.length > 0 ? quotes.map((quote) => (
                            <article key={quote.id} className={styles.mobileRecord}>
                                <div className={styles.recordIdentity}>
                                    <div>
                                        <h3>{quote.invoiceNumber || 'Angebot ohne Nummer'}</h3>
                                        <p>{quote.customer?.name || 'Kein Kunde'}</p>
                                    </div>
                                    <strong>{quote.totalAmount != null ? formatCurrency(quote.totalAmount) : '–'}</strong>
                                </div>
                                <dl className={styles.recordDates}>
                                    <div><dt>Datum</dt><dd>{quote.invoiceDate ? new Date(quote.invoiceDate).toLocaleDateString('de-DE') : new Date(quote.uploadedAt).toLocaleDateString('de-DE')}</dd></div>
                                    {quote.validUntil && <div><dt>Gültig bis</dt><dd>{new Date(quote.validUntil).toLocaleDateString('de-DE')}</dd></div>}
                                </dl>
                                <QuoteStatusBadge status={quote.status} onStatusChange={(newStatus) => onStatusChange(quote.id, newStatus)} />
                                <div className={styles.recordWorkflow}>
                                    {quoteNextAction(quote, workflowDate) && <p className={styles.nextAction}>{quoteNextAction(quote, workflowDate)?.label}</p>}
                                    {!quote.convertedInvoice && quoteConversionBlockReason(quote, workflowDate) && <p>Rückmeldung klären.</p>}
                                    {quote.quoteFollowUpOn && <p>Wiedervorlage: {formatBusinessDateDisplay(quote.quoteFollowUpOn)}</p>}
                                    {quote.convertedInvoice && <Button variant="outline" size="sm" asChild><Link href={`/history?invoiceId=${quote.convertedInvoice.id}`}>Verknüpfte Rechnung ansehen</Link></Button>}
                                    <Button variant="outline" size="sm" onClick={() => setWorkflowQuote(quote)}>Rückmeldung &amp; Nachfassen</Button>
                                    {ownerCaptureEnabled && <Button variant="outline" size="sm" onClick={() => setVersionSelection({ quote, sessionKey: ownerCaptureSessionKey })}>Interne Versionen</Button>}
                                </div>
                                <div className={styles.mobileActions}>
                                    <Button variant="outline" size="sm" className="min-h-11" onClick={() => window.open(`/api/quotes/download?id=${quote.id}`, '_blank')}><Eye className="h-4 w-4" aria-hidden="true" />Ansehen</Button>
                                    {!quote.convertedInvoice && !quoteConversionBlockReason(quote, workflowDate) && (
                                        <Button variant="outline" size="sm" className="min-h-11" disabled={convertingId === quote.id} onClick={() => setConfirmConvert(quote)}>In Rechnung</Button>
                                    )}
                                    <Button variant="outline" size="sm" disabled={quote.status === 'REJECTED' || quote.status === 'EXPIRED'} data-email-preview-return={`quote:${quote.id}`} onClick={(event) => { emailReturnFocusRef.current = event.currentTarget; setEmailQuote(quote); }}><Mail className="h-4 w-4" aria-hidden="true" />E-Mail</Button>
                                    <Button variant="ghost" size="sm" onClick={() => window.open(`/api/quotes/download?id=${quote.id}&download=true`, '_blank')}><Download className="h-4 w-4" aria-hidden="true" />PDF</Button>
                                    <Button variant="ghost" size="sm" className={`min-h-11 text-destructive ${styles.mobileDelete}`} disabled={deletingId === quote.id} onClick={() => setConfirmDelete(quote)}>Löschen</Button>
                                </div>
                            </article>
                        )) : (
                            <div className="ledger-empty"><DashboardIcon name="nav-quotes" size={48} /><h3>{searchTerm || statusFilter !== 'all' ? 'Keine passenden Angebote' : 'Noch keine Angebote'}</h3>{(searchTerm || statusFilter !== 'all') && <p>Suche oder Filter ändern.</p>}{!searchTerm && statusFilter === 'all' && <Button variant="outline" onClick={onOpenCreateModal}>Erstes Angebot erstellen</Button>}</div>
                        )}
                    </div>

                    <div className={styles.desktopList}>
                        <Table className={styles.table}>
                            <TableCaption className="sr-only">{isLoading ? 'Lade Angebote...' : `${total} Angebot${total !== 1 ? 'e' : ''}`}</TableCaption>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Datum</TableHead>
                                    <TableHead>Angebots-Nr.</TableHead>
                                    <TableHead>Kunde</TableHead>
                                    <TableHead>Gültig bis</TableHead>
                                    <TableHead className="text-right">Betrag</TableHead>
                                    <TableHead>Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? <TableRow><TableCell colSpan={6}><div role="status" className={styles.loading}><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Angebote werden geladen…</div></TableCell></TableRow> : quotes.length > 0 ? (
                                    quotes.map((quote) => (
                                        <React.Fragment key={quote.id}>
                                            <TableRow className={styles.quoteRow}>
                                                <TableCell className={styles.dateCell}>{quote.invoiceDate ? new Date(quote.invoiceDate).toLocaleDateString('de-DE') : new Date(quote.uploadedAt).toLocaleDateString('de-DE')}</TableCell>
                                                <TableCell className={styles.identifierCell}>{quote.invoiceNumber || <span className={styles.unavailable}>Nicht verfügbar</span>}</TableCell>
                                                <TableCell className={styles.customerCell}>{quote.customer?.name || <span className={styles.unavailable}>Kein Kunde</span>}</TableCell>
                                                <TableCell className={styles.dateCell}>{quote.validUntil ? new Date(quote.validUntil).toLocaleDateString('de-DE') : <span className={styles.unavailable}>–</span>}</TableCell>
                                                <TableCell className={styles.amountCell}>{quote.totalAmount != null ? formatCurrency(quote.totalAmount) : <span className={styles.unavailable}>–</span>}</TableCell>
                                                <TableCell><QuoteStatusBadge status={quote.status} onStatusChange={(newStatus) => onStatusChange(quote.id, newStatus)} /></TableCell>
                                            </TableRow>
                                            <TableRow className={styles.workflowRow}>
                                                <TableCell colSpan={6}>
                                                    <div className={styles.workflowBar}>
                                                        <div className={styles.workflowInfo}>
                                                            {quoteNextAction(quote, workflowDate) && <p className={styles.nextAction}>{quoteNextAction(quote, workflowDate)?.label}</p>}
                                                            {!quote.convertedInvoice && quoteConversionBlockReason(quote, workflowDate) && <p>Rückmeldung klären.</p>}
                                                            {quote.quoteFollowUpOn && <p>Wiedervorlage: {formatBusinessDateDisplay(quote.quoteFollowUpOn)}</p>}
                                                        </div>
                                                        <div className={styles.workflowActions}>
                                                            {quote.convertedInvoice && <Button variant="outline" size="sm" asChild><Link href={`/history?invoiceId=${quote.convertedInvoice.id}`}>Verknüpfte Rechnung ansehen</Link></Button>}
                                                            <Button variant="outline" size="sm" onClick={() => setWorkflowQuote(quote)}>Rückmeldung &amp; Nachfassen</Button>
                                                            {ownerCaptureEnabled && <Button variant="outline" size="sm" onClick={() => setVersionSelection({ quote, sessionKey: ownerCaptureSessionKey })}>Interne Versionen</Button>}
                                                        </div>
                                                        <div className={styles.actionGroup}>
                                                            <span className="sr-only">Aktionen</span>
                                                            <TooltipProvider>
                                                                <div className={styles.documentActions}>
                                                                    {/* View */}
                                                                     <Tooltip>
                                                                         <TooltipTrigger asChild>
                                                                             <Button variant="outline" size="icon"
                                                                                 aria-label={`Angebot ${quote.invoiceNumber || quote.id} anzeigen`}
                                                                                 onClick={() => window.open(`/api/quotes/download?id=${quote.id}`, '_blank')}>
                                                                                 <Eye className="h-4 w-4" aria-hidden="true" />
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
                                                                                 data-email-preview-return={`quote:${quote.id}`}
                                                                                 className="border-notice/30 text-notice hover:bg-notice-surface"
                                                                                 onClick={(event) => { emailReturnFocusRef.current = event.currentTarget; setEmailQuote(quote); }}
                                                                                 disabled={quote.status === 'REJECTED' || quote.status === 'EXPIRED'}
                                                                             >
                                                                                 <Mail className="h-4 w-4" aria-hidden="true" />
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
                                                                                <Download className="h-4 w-4" aria-hidden="true" />
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
                                                                                        ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                                                                        : <ArrowRightCircle className="h-4 w-4" aria-hidden="true" />}
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
                                                                                    ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                                                                    : <Trash2 className="h-4 w-4" aria-hidden="true" />}
                                                                            </Button>
                                                                        </TooltipTrigger>
                                                                        <TooltipContent><p>Löschen</p></TooltipContent>
                                                                    </Tooltip>
                                                                </div>
                                                            </TooltipProvider>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        </React.Fragment>
                                    ))
                                ) : (
                                    <TableRow><TableCell colSpan={6}>
                                        <div className="ledger-empty"><DashboardIcon name="nav-quotes" size={48} /><span>Keine passenden Angebote vorhanden.</span><Button variant="outline" onClick={onOpenCreateModal}>Angebot anlegen</Button></div>
                                    </TableCell></TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </div>

                <div className={styles.pagination}>
                    <div className={styles.pageSummary}>
                        {total === 0 ? 'Keine Einträge' : <><span>{`${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} von ${total} Angeboten`}</span><span>{`Seite ${page} von ${Math.max(1, totalPages)}`}</span></>}
                    </div>
                    <div className={styles.pageControls}>
                        <div className={styles.pageSize}>
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
                                className={styles.select}
                            >
                                <option value={10}>10</option>
                                <option value={20}>20</option>
                                <option value={50}>50</option>
                            </select>
                        </div>
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
            {ownerCaptureEnabled && versionSelection?.sessionKey === ownerCaptureSessionKey && <QuoteReleaseVersionsDialog key={`${ownerCaptureSessionKey}:${versionSelection.quote.id}`} quoteId={versionSelection.quote.id} ownerSessionKey={ownerCaptureSessionKey} quoteLabel={versionSelection.quote.invoiceNumber || 'Angebot'} onClose={() => setVersionSelection(null)} />}
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
                            <ArrowRightCircle className="h-4 w-4" aria-hidden="true" />
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
                returnFocusRef={emailReturnFocusRef}
                documentType="quote"
                documentId={emailQuote?.id ?? null}
                onSent={() => loadQuotes(page, pageSize)}
            />
        </div>
    );
}
