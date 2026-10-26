"use client";

import { PageHeader } from "@/components/page-header";
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import styles from "@/components/public-accounting/accounting-workspaces.module.css";
import {
    Plus,
    ArrowUpCircle,
    ArrowDownCircle,
    Download,
    Edit,
    Trash2,
    Calculator,
    Calendar,
    RefreshCw as _RefreshCw,
    AlertTriangle,
    CheckCircle,
    Loader2,
    BookOpen,
} from "lucide-react";
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

// Types
interface CashBook {
    id: number;
    name: string;
    description?: string | null;
    initialBalance: number;
    currency: string;
    isActive: boolean;
    currentBalance: number;
    transactionCount: number;
}

interface CashTransaction {
    id: number;
    date: string;
    type: 'EINNAHME' | 'AUSGABE';
    description: string;
    amount: number;
    runningBalance: number;
    category?: string;
    receiptNumber?: string;
    taxRelevant: boolean;
    notes?: string;
    cashBookId: number;
}

// A successful HTTP response is not yet a usable list. Reject malformed
// summaries before they can become an empty state, selector or balance.
function isCashBookList(value: unknown): value is CashBook[] {
    if (!Array.isArray(value)) return false;
    const ids = new Set<number>();
    return value.every(book => {
        if (!book || typeof book !== 'object'
            || !Number.isSafeInteger(book.id) || book.id <= 0 || ids.has(book.id)
            || typeof book.name !== 'string' || !book.name.trim()
            || (book.description != null && typeof book.description !== 'string')
            || typeof book.initialBalance !== 'number' || !Number.isFinite(book.initialBalance)
            || typeof book.currentBalance !== 'number' || !Number.isFinite(book.currentBalance)
            || !Number.isSafeInteger(book.transactionCount) || book.transactionCount < 0
            || typeof book.currency !== 'string' || typeof book.isActive !== 'boolean') return false;
        ids.add(book.id);
        return true;
    });
}

interface DailyBalance {
    date: string;
    openingBalance: number;
    totalIncome: number;
    totalExpense: number;
    closingBalance: number;
    transactionCount: number;
    transactions: CashTransaction[];
    currentSystemBalance: number;
}

interface CashCountResult {
    status: 'OK' | 'ÜBERSCHUSS' | 'FEHLBETRAG' | string;
    difference: number;
    systemBalance: number;
    countedAmount: number;
    adjustmentTransaction?: {
        suggestedDescription: string;
        amount: number;
    };
}

// Categories for cash transactions
const CASH_CATEGORIES = [
    'Barverkauf',
    'Bareinlage',
    'Barentnahme',
    'Materialkosten',
    'Büromaterial',
    'Porto',
    'Trinkgeld',
    'Bewirtung',
    'Fahrtkosten',
    'Sonstige Einnahmen',
    'Sonstige Ausgaben'
];

export default function CashBookPage() {
    // State
    const [cashBooks, setCashBooks] = useState<CashBook[]>([]);
    const [selectedCashBookId, setSelectedCashBookId] = useState<number | null>(null);
    // Keep the selected summary canonical: refreshed balances/counts must never
    // compete with a second, stale copy of the cash book object.
    const selectedCashBook = cashBooks.find(book => book.id === selectedCashBookId) ?? null;
    const [dataVersion, setDataVersion] = useState(0);
    const cashBookRequest = useRef(0);
    const [transactions, setTransactions] = useState<CashTransaction[]>([]);
    const [dailyBalance, setDailyBalance] = useState<DailyBalance | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [hasLoadedCashBooks, setHasLoadedCashBooks] = useState(false);
    const [cashBookLoadError, setCashBookLoadError] = useState<string | null>(null);
    const cashBookRetryPending = useRef(false);
    const [error, setError] = useState<string | null>(null);

    // Modal States
    const [showNewCashBookModal, setShowNewCashBookModal] = useState(false);
    const [showNewTransactionModal, setShowNewTransactionModal] = useState(false);
    const [_showCashCountModal, _setShowCashCountModal] = useState(false);
    const [showEditTransactionModal, setShowEditTransactionModal] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);

    // Form States
    const [newCashBook, setNewCashBook] = useState({ name: '', description: '', initialBalance: '0' });
    const [newTransaction, setNewTransaction] = useState({
        type: 'EINNAHME' as 'EINNAHME' | 'AUSGABE',
        description: '',
        amount: '',
        category: '',
        receiptNumber: '',
        taxRelevant: true,
        notes: '',
        date: format(new Date(), 'yyyy-MM-dd')
    });
    const [editTransaction, setEditTransaction] = useState<CashTransaction | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<{ type: 'cashbook' | 'transaction', id: number } | null>(null);
    const [cashCount, setCashCount] = useState({ countedAmount: '', notes: '' });
    const [cashCountResult, setCashCountResult] = useState<CashCountResult | null>(null);

    // Pagination
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [pageSize] = useState(20);

    // Filter
    const [dateFilter, setDateFilter] = useState(format(new Date(), 'yyyy-MM-dd'));
    const [activeTab, setActiveTab] = useState('buchungen');

    // Loading states
    const [isSaving, setIsSaving] = useState(false);
    const [isExporting, setIsExporting] = useState(false);

    // Format currency helper
    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('de-DE', {
            style: 'currency',
            currency: 'EUR'
        }).format(amount);
    };

    // Refresh summaries while preserving a valid current selection. Ignore an
    // older response if another refresh was started after it.
    const loadCashBooks = useCallback(async () => {
        const requestId = ++cashBookRequest.current;
        try {
            const res = await fetch('/api/cashbook');
            if (!res.ok) throw new Error('Cash book refresh failed');
            const data: unknown = await res.json();
            if (!isCashBookList(data)) throw new Error('Invalid cash book list');
            if (requestId !== cashBookRequest.current) return;
            setCashBooks(data);
            setSelectedCashBookId(current =>
                data.some(book => book.id === current) ? current : (data[0]?.id ?? null)
            );
            setHasLoadedCashBooks(true);
            setCashBookLoadError(null);
            setError(null);
        } catch (err) {
            if (requestId !== cashBookRequest.current) return;
            console.error('Error loading cash books:', err);
            setCashBookLoadError('Die Kassenbücher konnten nicht geladen werden.');
        } finally {
            if (requestId === cashBookRequest.current) setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        const request = cashBookRequest;
        void loadCashBooks();
        return () => { request.current++; };
    }, [loadCashBooks]);

    // Read recovery must never resubmit a create/edit/delete action. The ref
    // also guards two activations before React renders the pending state.
    const retryLoadCashBooks = async () => {
        if (cashBookRetryPending.current) return;
        cashBookRetryPending.current = true;
        setIsLoading(true);
        setCashBookLoadError(null);
        try {
            await loadCashBooks();
        } finally {
            cashBookRetryPending.current = false;
        }
    };

    // Separate cancellable reads prevent responses for a previous cash book,
    // page or date from overwriting the currently displayed data.
    useEffect(() => {
        setTransactions([]);
        setTotalPages(1);
        if (selectedCashBookId === null) return;
        let cancelled = false;
        const controller = new AbortController();
        const load = async () => {
            try {
                const res = await fetch(
                    `/api/cashbook/transactions?cashBookId=${selectedCashBookId}&page=${page}&pageSize=${pageSize}`,
                    { signal: controller.signal }
                );
                if (!res.ok) throw new Error('Transaction refresh failed');
                const data = await res.json();
                if (cancelled) return;
                const lastPage = Math.max(1, data.totalPages);
                if (page > lastPage) {
                    setPage(lastPage);
                    return;
                }
                setTransactions(data.items);
                setTotalPages(lastPage);
            } catch (err) {
                if (!cancelled) {
                    console.error('Error loading transactions:', err);
                    setError('Fehler beim Laden der Buchungen');
                }
            }
        };
        void load();
        return () => { cancelled = true; controller.abort(); };
    }, [selectedCashBookId, page, pageSize, dataVersion]);

    useEffect(() => {
        setDailyBalance(null);
        if (selectedCashBookId === null) return;
        let cancelled = false;
        const controller = new AbortController();
        const load = async () => {
            try {
                const res = await fetch(
                    `/api/cashbook/daily-balance?cashBookId=${selectedCashBookId}&date=${dateFilter}`,
                    { signal: controller.signal }
                );
                if (!res.ok) throw new Error('Daily balance refresh failed');
                const data = await res.json();
                if (!cancelled) setDailyBalance(data);
            } catch (err) {
                if (!cancelled) {
                    console.error('Error loading daily balance:', err);
                    setError('Fehler beim Laden der Tagesübersicht');
                }
            }
        };
        void load();
        return () => { cancelled = true; controller.abort(); };
    }, [selectedCashBookId, dateFilter, dataVersion]);

    const refreshAfterMutation = async () => {
        // A previous count is historical after a booking changes the balance.
        setCashCountResult(null);
        setDataVersion(version => version + 1);
        await loadCashBooks();
    };

    // Create new cash book
    const handleCreateCashBook = async () => {
        setIsSaving(true);
        try {
            const res = await fetch('/api/cashbook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: newCashBook.name,
                    description: newCashBook.description,
                    initialBalance: parseFloat(newCashBook.initialBalance) || 0
                })
            });

            if (res.ok) {
                const created = await res.json();
                setShowNewCashBookModal(false);
                setNewCashBook({ name: '', description: '', initialBalance: '0' });
                // POST returns the persisted book without computed summary fields.
                setCashBooks(books => [{ ...created, currentBalance: created.initialBalance, transactionCount: 0 }, ...books]);
                setSelectedCashBookId(created.id);
                setPage(1);
                setCashCount({ countedAmount: '', notes: '' });
                await refreshAfterMutation();
            } else {
                const error = await res.json();
                alert(error.error || 'Fehler beim Erstellen');
            }
        } catch (err) {
            console.error('Error creating cash book:', err);
            alert('Fehler beim Erstellen des Kassenbuchs');
        } finally {
            setIsSaving(false);
        }
    };

    // Create new transaction
    const handleCreateTransaction = async () => {
        if (!selectedCashBook) return;

        setIsSaving(true);
        try {
            const res = await fetch('/api/cashbook/transactions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    cashBookId: selectedCashBook.id,
                    ...newTransaction,
                    amount: parseFloat(newTransaction.amount)
                })
            });

            if (res.ok) {
                setShowNewTransactionModal(false);
                setNewTransaction({
                    type: 'EINNAHME',
                    description: '',
                    amount: '',
                    category: '',
                    receiptNumber: '',
                    taxRelevant: true,
                    notes: '',
                    date: format(new Date(), 'yyyy-MM-dd')
                });
                await refreshAfterMutation();
            } else {
                const error = await res.json();
                alert(error.error || 'Fehler beim Erstellen');
            }
        } catch (err) {
            console.error('Error creating transaction:', err);
            alert('Fehler beim Erstellen der Buchung');
        } finally {
            setIsSaving(false);
        }
    };

    // Update transaction
    const handleUpdateTransaction = async () => {
        if (!editTransaction) return;

        setIsSaving(true);
        try {
            const res = await fetch('/api/cashbook/transactions', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editTransaction)
            });

            if (res.ok) {
                setShowEditTransactionModal(false);
                setEditTransaction(null);
                await refreshAfterMutation();
            } else {
                const error = await res.json();
                alert(error.error || 'Fehler beim Aktualisieren');
            }
        } catch (err) {
            console.error('Error updating transaction:', err);
            alert('Fehler beim Aktualisieren der Buchung');
        } finally {
            setIsSaving(false);
        }
    };

    // Delete
    const handleDelete = async () => {
        if (!deleteTarget) return;

        setIsSaving(true);
        try {
            const endpoint = deleteTarget.type === 'cashbook'
                ? `/api/cashbook?id=${deleteTarget.id}`
                : `/api/cashbook/transactions?id=${deleteTarget.id}`;

            const res = await fetch(endpoint, { method: 'DELETE' });

            if (res.ok) {
                setShowDeleteModal(false);
                setDeleteTarget(null);

                if (deleteTarget.type === 'cashbook') {
                    setCashBooks(books => books.filter(book => book.id !== deleteTarget.id));
                    setSelectedCashBookId(current => current === deleteTarget.id ? null : current);
                    setPage(1);
                    setCashCount({ countedAmount: '', notes: '' });
                    await refreshAfterMutation();
                } else {
                    await refreshAfterMutation();
                }
            } else {
                const error = await res.json();
                alert(error.error || 'Fehler beim Löschen');
            }
        } catch (err) {
            console.error('Error deleting:', err);
            alert('Fehler beim Löschen');
        } finally {
            setIsSaving(false);
        }
    };

    // Cash count (Kassensturz)
    const handleCashCount = async () => {
        if (!selectedCashBook) return;

        setIsSaving(true);
        try {
            const res = await fetch('/api/cashbook/daily-balance', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    cashBookId: selectedCashBook.id,
                    countedAmount: parseFloat(cashCount.countedAmount),
                    notes: cashCount.notes
                })
            });

            if (res.ok) {
                const result = await res.json();
                setCashCountResult(result);
            } else {
                const error = await res.json();
                alert(error.error || 'Fehler beim Kassensturz');
            }
        } catch (err) {
            console.error('Error performing cash count:', err);
            alert('Fehler beim Kassensturz');
        } finally {
            setIsSaving(false);
        }
    };

    // Export
    const handleExport = async () => {
        if (!selectedCashBook) return;

        setIsExporting(true);
        try {
            const res = await fetch(
                `/api/cashbook/export?cashBookId=${selectedCashBook.id}`
            );

            if (res.ok) {
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                const disposition = res.headers.get('Content-Disposition') || '';
                const match = disposition.match(/filename="(.+?)"/);
                a.download = match?.[1] || 'kassenbuch-export.csv';
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url);
            }
        } catch (err) {
            console.error('Error exporting:', err);
            alert('Fehler beim Export');
        } finally {
            setIsExporting(false);
        }
    };

    const canShowCashBooks = hasLoadedCashBooks && !isLoading && !cashBookLoadError;

    return (
        <div className={`${styles.cashWorkspace} space-y-6`}>
            {/* Header */}
            <PageHeader title="Kassenbuch" actions={<>
<div className="flex flex-wrap gap-2">
                    <Button
                        onClick={() => setShowNewCashBookModal(true)}
                        variant="outline"
                        disabled={!canShowCashBooks}
                    >
                        <Plus className="h-4 w-4 mr-2" />
                        Neue Kasse
                    </Button>
                    {canShowCashBooks && selectedCashBook && (
                        <>
                            <Button
                                onClick={() => setShowNewTransactionModal(true)}
                            >
                                <Plus className="h-4 w-4 mr-2" />
                                Buchung
                            </Button>
                        </>
                    )}
                </div>
</>} />

            {(isLoading || cashBookLoadError) && (
                <section aria-label="Kassenbuch laden" aria-busy={isLoading}>
                    {isLoading ? (
                        <div role="status" aria-label="Kassenbuch wird geladen" className="flex items-center justify-center gap-3 min-h-[400px]">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
                            <span>Kassenbuch wird geladen…</span>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div role="alert" className={styles.errorNotice}>{cashBookLoadError}</div>
                            <Button variant="outline" onClick={() => void retryLoadCashBooks()}>Erneut versuchen</Button>
                        </div>
                    )}
                </section>
            )}
            {error && !cashBookLoadError && <div role="alert" className={styles.errorNotice}>{error}</div>}
            {/* No cash book message */}
            {canShowCashBooks && cashBooks.length === 0 && (
                <Card className="bg-muted/50">
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <BookOpen className="h-8 w-8 text-muted-foreground mb-4" aria-hidden="true" />
                        <h3 className="text-xl font-semibold mb-2">Kein Kassenbuch vorhanden</h3>
                        <Button onClick={() => setShowNewCashBookModal(true)}>
                            <Plus className="h-4 w-4 mr-2" />
                            Kassenbuch erstellen
                        </Button>
                    </CardContent>
                </Card>
            )}

            {/* Cash Book Selector & Summary */}
            {canShowCashBooks && cashBooks.length > 0 && (
                <section className={styles.cashOverview} aria-label="Kassenübersicht">
                    <div className={`${styles.cashBalance} min-w-0`}>
                        <div className={`${styles.cashSelection} min-w-0`}>
                            <Label htmlFor="cashbook-selector">Aktive Kasse</Label>
                            <Select value={selectedCashBook?.id.toString() || ''} disabled={isSaving} onValueChange={(value) => {
                                setSelectedCashBookId(Number(value));
                                setPage(1);
                                setCashCount({ countedAmount: '', notes: '' });
                                setCashCountResult(null);
                            }}>
                                <SelectTrigger id="cashbook-selector" className="w-full min-w-0"><SelectValue className="min-w-0 overflow-hidden" placeholder="Kasse wählen" /></SelectTrigger>
                                <SelectContent>{cashBooks.map(cb => <SelectItem key={cb.id} value={cb.id.toString()}>{cb.name}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div><h2>Kassenbestand</h2><p>{formatCurrency(selectedCashBook?.currentBalance || 0)}</p></div>
                        <span>{selectedCashBook?.transactionCount ?? 0} Buchungen insgesamt · Anfangsbestand {formatCurrency(selectedCashBook?.initialBalance || 0)}</span>
                    </div>
                    <div className={styles.cashDaySummary}>
                        <div><h2>{dateFilter ? `Bewegungen am ${format(new Date(`${dateFilter}T12:00:00`), 'dd.MM.yyyy', { locale: de })}` : 'Bewegungen im ausgewählten Tageszeitraum'}</h2></div>
                        <dl><div><dt><ArrowUpCircle aria-hidden="true" />Einnahmen</dt><dd>{formatCurrency(dailyBalance?.totalIncome || 0)}</dd></div><div><dt><ArrowDownCircle aria-hidden="true" />Ausgaben</dt><dd>{formatCurrency(dailyBalance?.totalExpense || 0)}</dd></div></dl>
                        <button type="button" onClick={() => setActiveTab('tagesabschluss')}>Tagesübersicht öffnen<span aria-hidden="true">→</span></button>
                    </div>
                </section>
            )}

            {/* Main Content Tabs */}
            {canShowCashBooks && selectedCashBook && (
                <Tabs value={activeTab} onValueChange={setActiveTab} className={styles.cashTabs}>
                    <div className={styles.cashToolbar}>
                        <TabsList className={styles.cashTabList}>
                            <TabsTrigger value="buchungen">Buchungen</TabsTrigger>
                            <TabsTrigger value="tagesabschluss">Tagesübersicht</TabsTrigger>
                            <TabsTrigger value="kassensturz">Kassensturz</TabsTrigger>
                        </TabsList>

                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleExport}
                                disabled={isExporting}
                            >
                                {isExporting ? (
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                ) : (
                                    <Download className="h-4 w-4 mr-2" />
                                )}
                                CSV Export
                            </Button>
                        </div>
                    </div>

                    {/* Buchungen Tab */}
                    <TabsContent value="buchungen" className="space-y-4">
                        <Card className={styles.journalPanel}>
                            <CardHeader>
                                <CardTitle>Kassenbuchungen</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className={styles.desktopJournal}>
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Datum</TableHead>
                                                <TableHead>Belegnr.</TableHead>
                                                <TableHead>Beschreibung</TableHead>
                                                <TableHead>Kategorie</TableHead>
                                                <TableHead className="text-right">Einnahme</TableHead>
                                                <TableHead className="text-right">Ausgabe</TableHead>
                                                <TableHead className="text-right">Saldo</TableHead>
                                                <TableHead className="w-[100px]">Aktionen</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {transactions.length === 0 ? (
                                                <TableRow>
                                                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                                                        Keine Buchungen vorhanden
                                                    </TableCell>
                                                </TableRow>
                                            ) : (
                                                transactions.map((tx) => (
                                                    <TableRow key={tx.id}>
                                                        <TableCell>
                                                            {format(new Date(tx.date), 'dd.MM.yyyy', { locale: de })}
                                                        </TableCell>
                                                        <TableCell>{tx.receiptNumber || '-'}</TableCell>
                                                        <TableCell>
                                                            <div className="flex items-center gap-2">
                                                                {tx.type === 'EINNAHME' ? (
                                                                    <ArrowUpCircle className="h-4 w-4 text-green-500" />
                                                                ) : (
                                                                    <ArrowDownCircle className="h-4 w-4 text-red-500" />
                                                                )}
                                                                {tx.description}
                                                                {tx.taxRelevant && (
                                                                    <Badge variant="outline" className="text-xs">
                                                                        §
                                                                    </Badge>
                                                                )}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell>{tx.category || '-'}</TableCell>
                                                        <TableCell className="text-right text-green-600 font-medium">
                                                            {tx.type === 'EINNAHME' ? formatCurrency(tx.amount) : ''}
                                                        </TableCell>
                                                        <TableCell className="text-right text-red-600 font-medium">
                                                            {tx.type === 'AUSGABE' ? formatCurrency(tx.amount) : ''}
                                                        </TableCell>
                                                        <TableCell className="text-right font-bold">
                                                            {formatCurrency(tx.runningBalance)}
                                                        </TableCell>
                                                        <TableCell>
                                                            <div className="flex gap-1">
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    aria-label={`${tx.description} bearbeiten`}
                                                                    onClick={() => {
                                                                        setEditTransaction(tx);
                                                                        setShowEditTransactionModal(true);
                                                                    }}
                                                                >
                                                                    <Edit className="h-4 w-4" />
                                                                </Button>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    aria-label={`${tx.description} löschen`}
                                                                    onClick={() => {
                                                                        setDeleteTarget({ type: 'transaction', id: tx.id });
                                                                        setShowDeleteModal(true);
                                                                    }}
                                                                >
                                                                    <Trash2 className="h-4 w-4 text-destructive" />
                                                                </Button>
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                ))
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>

                                <div className={styles.mobileJournal}>
                                    {transactions.length === 0 ? <p className={styles.journalEmpty}>Keine Buchungen vorhanden</p> : transactions.map(tx => (
                                        <article key={tx.id} className={styles.mobileTransaction}>
                                            <div className={styles.transactionMeta}><span>{format(new Date(tx.date), 'dd.MM.yyyy', { locale: de })} · {tx.type === 'EINNAHME' ? 'Einnahme' : 'Ausgabe'}</span><span>{tx.receiptNumber || 'Ohne Belegnummer'}</span></div>
                                            <h3>{tx.description}</h3>
                                            <div className={styles.transactionAmount}><strong>{tx.type === 'EINNAHME' ? '+' : '−'} {formatCurrency(tx.amount)}</strong><span>Saldo {formatCurrency(tx.runningBalance)}</span></div>
                                            <div className={styles.transactionFooter}><span>{tx.category || 'Ohne Kategorie'}{tx.taxRelevant ? ' · steuerrelevant' : ''}</span><div>
                                                <Button variant="ghost" size="icon" aria-label={`${tx.description} bearbeiten`} onClick={() => { setEditTransaction(tx); setShowEditTransactionModal(true); }}><Edit className="h-4 w-4" /></Button>
                                                <Button variant="ghost" size="icon" aria-label={`${tx.description} löschen`} onClick={() => { setDeleteTarget({ type: 'transaction', id: tx.id }); setShowDeleteModal(true); }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                                            </div></div>
                                        </article>
                                    ))}
                                </div>

                                {/* Pagination */}
                                {totalPages > 1 && (
                                    <div className="flex justify-center gap-2 mt-4">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={page === 1}
                                            onClick={() => setPage(p => p - 1)}
                                        >
                                            Zurück
                                        </Button>
                                        <span className="flex items-center px-3 text-sm text-muted-foreground">
                                            Seite {page} von {totalPages}
                                        </span>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={page === totalPages}
                                            onClick={() => setPage(p => p + 1)}
                                        >
                                            Weiter
                                        </Button>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* Tagesübersicht Tab */}
                    <TabsContent value="tagesabschluss" className="space-y-4">
                        <Card>
                            <CardHeader>
                                <div className={styles.dailyHeader}>
                                    <div>
                                        <CardTitle>Tagesübersicht</CardTitle>
                                    </div>
                                    <div className="flex gap-2 items-center">
                                        <Label htmlFor="date-filter">Datum:</Label>
                                        <Input
                                            id="date-filter"
                                            type="date"
                                            value={dateFilter}
                                            onChange={(e) => setDateFilter(e.target.value)}
                                            className="w-auto"
                                        />
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            onClick={() => setDateFilter(format(new Date(), 'yyyy-MM-dd'))}
                                            aria-label="Heutiges Datum auswählen"
                                        >
                                            <Calendar className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent>
                                {dailyBalance && (
                                    <div className="space-y-6">
                                        {/* Summary Cards */}
                                        <div className={styles.dailyMetrics}>
                                            <Card className="bg-muted/50">
                                                <CardContent className="pt-6">
                                                    <div className="text-sm text-muted-foreground">Anfangsbestand</div>
                                                    <div className="text-2xl font-bold">
                                                        {formatCurrency(dailyBalance.openingBalance)}
                                                    </div>
                                                </CardContent>
                                            </Card>
                                            <Card className="bg-green-50 dark:bg-green-950/20">
                                                <CardContent className="pt-6">
                                                    <div className="text-sm text-muted-foreground flex items-center gap-1">
                                                        <ArrowUpCircle className="h-4 w-4 text-green-500" />
                                                        Einnahmen
                                                    </div>
                                                    <div className="text-2xl font-bold text-green-600">
                                                        + {formatCurrency(dailyBalance.totalIncome)}
                                                    </div>
                                                </CardContent>
                                            </Card>
                                            <Card className="bg-red-50 dark:bg-red-950/20">
                                                <CardContent className="pt-6">
                                                    <div className="text-sm text-muted-foreground flex items-center gap-1">
                                                        <ArrowDownCircle className="h-4 w-4 text-red-500" />
                                                        Ausgaben
                                                    </div>
                                                    <div className="text-2xl font-bold text-red-600">
                                                        - {formatCurrency(dailyBalance.totalExpense)}
                                                    </div>
                                                </CardContent>
                                            </Card>
                                            <Card className="bg-blue-50 dark:bg-blue-950/20">
                                                <CardContent className="pt-6">
                                                    <div className="text-sm text-muted-foreground">Endbestand</div>
                                                    <div className="text-2xl font-bold text-blue-600">
                                                        {formatCurrency(dailyBalance.closingBalance)}
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        </div>

                                        {/* Day's transactions */}
                                        <div>
                                            <h4 className="font-semibold mb-3">
                                                Buchungen am {format(new Date(dailyBalance.date), 'dd. MMMM yyyy', { locale: de })}
                                                <Badge className="ml-2" variant="secondary">
                                                    {dailyBalance.transactionCount} Buchungen
                                                </Badge>
                                            </h4>
                                            <div className="rounded-md border">
                                                <Table>
                                                    <TableHeader>
                                                        <TableRow>
                                                            <TableHead>Uhrzeit</TableHead>
                                                            <TableHead>Beschreibung</TableHead>
                                                            <TableHead className="text-right">Betrag</TableHead>
                                                            <TableHead className="text-right">Saldo</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {dailyBalance.transactions.length === 0 ? (
                                                            <TableRow>
                                                                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                                                                    Keine Buchungen an diesem Tag
                                                                </TableCell>
                                                            </TableRow>
                                                        ) : (
                                                            dailyBalance.transactions.map((tx) => (
                                                                <TableRow key={tx.id}>
                                                                    <TableCell>
                                                                        {format(new Date(tx.date), 'HH:mm', { locale: de })}
                                                                    </TableCell>
                                                                    <TableCell>
                                                                        <div className="flex items-center gap-2">
                                                                            {tx.type === 'EINNAHME' ? (
                                                                                <ArrowUpCircle className="h-4 w-4 text-green-500" />
                                                                            ) : (
                                                                                <ArrowDownCircle className="h-4 w-4 text-red-500" />
                                                                            )}
                                                                            {tx.description}
                                                                        </div>
                                                                    </TableCell>
                                                                    <TableCell className={`text-right font-medium ${tx.type === 'EINNAHME' ? 'text-green-600' : 'text-red-600'
                                                                        }`}>
                                                                        {tx.type === 'EINNAHME' ? '+' : '-'} {formatCurrency(tx.amount)}
                                                                    </TableCell>
                                                                    <TableCell className="text-right font-bold">
                                                                        {formatCurrency(tx.runningBalance)}
                                                                    </TableCell>
                                                                </TableRow>
                                                            ))
                                                        )}
                                                    </TableBody>
                                                </Table>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* Kassensturz Tab */}
                    <TabsContent value="kassensturz" className={`${styles.cashCount} space-y-4`}>
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Calculator className="h-5 w-5" />
                                    Kassensturz
                                </CardTitle>

                            </CardHeader>
                            <CardContent className={styles.cashCountContent}>
                                <div className="space-y-6">
                                    {/* System balance info */}
                                    <div className="p-4 bg-muted rounded-lg">
                                        <div className="text-sm text-muted-foreground mb-1">
                                            Aktueller Sollbestand laut System
                                        </div>
                                        <div className="text-3xl font-bold">
                                            {formatCurrency(selectedCashBook?.currentBalance || 0)}
                                        </div>
                                        <div className="text-xs text-muted-foreground mt-1">
                                            Stand: {format(new Date(), 'dd.MM.yyyy HH:mm', { locale: de })} Uhr
                                        </div>
                                    </div>

                                    {/* Cash count form */}
                                    <div className="space-y-4">
                                        <div>
                                            <Label htmlFor="counted-amount">Gezählter Bargeldbestand (€)</Label>
                                            <Input
                                                id="counted-amount"
                                                type="number"
                                                step="0.01"
                                                placeholder="0,00"
                                                value={cashCount.countedAmount}
                                                onChange={(e) => setCashCount({ ...cashCount, countedAmount: e.target.value })}
                                                className="text-lg"
                                            />
                                        </div>
                                        <div>
                                            <Label htmlFor="count-notes">Notizen (optional)</Label>
                                            <Textarea
                                                id="count-notes"
                                                placeholder="Bemerkungen zum Kassensturz..."
                                                value={cashCount.notes}
                                                onChange={(e) => setCashCount({ ...cashCount, notes: e.target.value })}
                                            />
                                        </div>
                                        <Button
                                            onClick={handleCashCount}
                                            disabled={!cashCount.countedAmount || isSaving}
                                            className="w-full"
                                        >
                                            {isSaving ? (
                                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                            ) : (
                                                <Calculator className="h-4 w-4 mr-2" />
                                            )}
                                            Kassensturz durchführen
                                        </Button>
                                    </div>

                                    {/* Result */}
                                    {cashCountResult && (
                                        <div role="status" className={`p-6 rounded-lg border-2 ${cashCountResult.status === 'OK'
                                            ? 'bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800'
                                            : 'bg-yellow-50 border-yellow-200 dark:bg-yellow-950/20 dark:border-yellow-800'
                                            }`}>
                                            <div className="flex items-center gap-3 mb-4">
                                                {cashCountResult.status === 'OK' ? (
                                                    <>
                                                        <CheckCircle className="h-8 w-8 text-green-600" />
                                                        <div>
                                                            <h4 className="text-lg font-semibold text-green-700 dark:text-green-400">
                                                                Kasse stimmt
                                                            </h4>
                                                            <p className="text-sm text-green-600">
                                                                Keine Differenz festgestellt
                                                            </p>
                                                        </div>
                                                    </>
                                                ) : (
                                                    <>
                                                        <AlertTriangle className="h-8 w-8 text-yellow-600" />
                                                        <div>
                                                            <h4 className="text-lg font-semibold text-yellow-700 dark:text-yellow-400">
                                                                {cashCountResult.status === 'ÜBERSCHUSS' ? 'Kassenüberschuss' : 'Kassenfehlbetrag'}
                                                            </h4>
                                                            <p className="text-sm text-yellow-600">
                                                                Differenz: {formatCurrency(Math.abs(cashCountResult.difference))}
                                                            </p>
                                                        </div>
                                                    </>
                                                )}
                                            </div>

                                            <div className="grid gap-2 text-sm">
                                                <div className="flex justify-between">
                                                    <span>Sollbestand (System):</span>
                                                    <span className="font-medium">{formatCurrency(cashCountResult.systemBalance)}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span>Istbestand (gezählt):</span>
                                                    <span className="font-medium">{formatCurrency(cashCountResult.countedAmount)}</span>
                                                </div>
                                                <div className="flex justify-between border-t pt-2 mt-2">
                                                    <span className="font-semibold">Differenz:</span>
                                                    <span className={`font-bold ${cashCountResult.difference > 0
                                                        ? 'text-green-600'
                                                        : cashCountResult.difference < 0
                                                            ? 'text-red-600'
                                                            : ''
                                                        }`}>
                                                        {cashCountResult.difference >= 0 ? '+' : ''}{formatCurrency(cashCountResult.difference)}
                                                    </span>
                                                </div>
                                            </div>

                                            {cashCountResult.adjustmentTransaction && (
                                                <div className="mt-4 p-3 bg-white dark:bg-background rounded border">
                                                    <p className="text-sm text-muted-foreground mb-2">
                                                        Vorgeschlagene Korrekturbuchung:
                                                    </p>
                                                    <p className="font-medium">
                                                        {cashCountResult.adjustmentTransaction.suggestedDescription}
                                                    </p>
                                                    <p className="text-sm text-muted-foreground">
                                                        Betrag: {formatCurrency(cashCountResult.adjustmentTransaction.amount)}
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            )}

            {/* New Cash Book Modal */}
            <Dialog open={showNewCashBookModal} onOpenChange={setShowNewCashBookModal}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Neues Kassenbuch erstellen</DialogTitle>
                        <DialogDescription className="sr-only">
                            Name und Anfangsbestand festlegen.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div>
                            <Label htmlFor="cb-name">Name *</Label>
                            <Input
                                id="cb-name"
                                placeholder="z.B. Hauptkasse, Laden, Marktstand"
                                value={newCashBook.name}
                                onChange={(e) => setNewCashBook({ ...newCashBook, name: e.target.value })}
                            />
                        </div>
                        <div>
                            <Label htmlFor="cb-description">Beschreibung</Label>
                            <Textarea
                                id="cb-description"
                                placeholder="Optionale Beschreibung..."
                                value={newCashBook.description}
                                onChange={(e) => setNewCashBook({ ...newCashBook, description: e.target.value })}
                            />
                        </div>
                        <div>
                            <Label htmlFor="cb-balance">Anfangsbestand (€)</Label>
                            <Input
                                id="cb-balance"
                                type="number"
                                step="0.01"
                                placeholder="0,00"
                                value={newCashBook.initialBalance}
                                onChange={(e) => setNewCashBook({ ...newCashBook, initialBalance: e.target.value })}
                            />

                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowNewCashBookModal(false)}>
                            Abbrechen
                        </Button>
                        <Button onClick={handleCreateCashBook} disabled={!newCashBook.name || isSaving}>
                            {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Erstellen
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* New Transaction Modal */}
            <Dialog open={showNewTransactionModal} onOpenChange={setShowNewTransactionModal}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Neue Kassenbuchung</DialogTitle>
                        <DialogDescription className="sr-only">
                            Erfassen Sie eine Bar-Einnahme oder -Ausgabe
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        {/* Type Selection */}
                        <div className="grid grid-cols-2 gap-2">
                            <Button
                                type="button"
                                variant={newTransaction.type === 'EINNAHME' ? 'default' : 'outline'}
                                className={newTransaction.type === 'EINNAHME' ? 'bg-green-600 hover:bg-green-700' : ''}
                                onClick={() => setNewTransaction({ ...newTransaction, type: 'EINNAHME' })}
                            >
                                <ArrowUpCircle className="h-4 w-4 mr-2" />
                                Einnahme
                            </Button>
                            <Button
                                type="button"
                                variant={newTransaction.type === 'AUSGABE' ? 'default' : 'outline'}
                                className={newTransaction.type === 'AUSGABE' ? 'bg-red-600 hover:bg-red-700' : ''}
                                onClick={() => setNewTransaction({ ...newTransaction, type: 'AUSGABE' })}
                            >
                                <ArrowDownCircle className="h-4 w-4 mr-2" />
                                Ausgabe
                            </Button>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label htmlFor="tx-date">Datum *</Label>
                                <Input
                                    id="tx-date"
                                    type="date"
                                    value={newTransaction.date}
                                    onChange={(e) => setNewTransaction({ ...newTransaction, date: e.target.value })}
                                />
                            </div>
                            <div>
                                <Label htmlFor="tx-amount">Betrag (€) *</Label>
                                <Input
                                    id="tx-amount"
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    placeholder="0,00"
                                    value={newTransaction.amount}
                                    onChange={(e) => setNewTransaction({ ...newTransaction, amount: e.target.value })}
                                />
                            </div>
                        </div>

                        <div>
                            <Label htmlFor="tx-description">Beschreibung *</Label>
                            <Input
                                id="tx-description"
                                placeholder="z.B. Barverkauf Produkt X"
                                value={newTransaction.description}
                                onChange={(e) => setNewTransaction({ ...newTransaction, description: e.target.value })}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label htmlFor="tx-category">Kategorie</Label>
                                <Select
                                    value={newTransaction.category}
                                    onValueChange={(value) => setNewTransaction({ ...newTransaction, category: value })}
                                >
                                    <SelectTrigger id="tx-category">
                                        <SelectValue placeholder="Wählen..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {CASH_CATEGORIES.map((cat) => (
                                            <SelectItem key={cat} value={cat}>
                                                {cat}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <Label htmlFor="tx-receipt">Belegnummer</Label>
                                <Input
                                    id="tx-receipt"
                                    placeholder="z.B. K-001"
                                    value={newTransaction.receiptNumber}
                                    onChange={(e) => setNewTransaction({ ...newTransaction, receiptNumber: e.target.value })}
                                />
                            </div>
                        </div>

                        <div className="flex items-center justify-between">
                            <Label htmlFor="tx-tax" className="cursor-pointer">Steuerrelevant</Label>
                            <Switch
                                id="tx-tax"
                                checked={newTransaction.taxRelevant}
                                onCheckedChange={(checked) => setNewTransaction({ ...newTransaction, taxRelevant: checked })}
                            />
                        </div>

                        <div>
                            <Label htmlFor="tx-notes">Notizen</Label>
                            <Textarea
                                id="tx-notes"
                                placeholder="Optionale Hinweise..."
                                value={newTransaction.notes}
                                onChange={(e) => setNewTransaction({ ...newTransaction, notes: e.target.value })}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowNewTransactionModal(false)}>
                            Abbrechen
                        </Button>
                        <Button
                            onClick={handleCreateTransaction}
                            disabled={!newTransaction.description || !newTransaction.amount || isSaving}
                        >
                            {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Buchung erfassen
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Edit Transaction Modal */}
            <Dialog open={showEditTransactionModal} onOpenChange={setShowEditTransactionModal}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Buchung bearbeiten</DialogTitle>
                    </DialogHeader>
                    {editTransaction && (
                        <div className="space-y-4 py-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label htmlFor="edit-tx-date">Datum</Label>
                                    <Input
                                        id="edit-tx-date"
                                        type="date"
                                        value={format(new Date(editTransaction.date), 'yyyy-MM-dd')}
                                        onChange={(e) => setEditTransaction({
                                            ...editTransaction,
                                            date: new Date(e.target.value).toISOString()
                                        })}
                                    />
                                </div>
                                <div>
                                    <Label htmlFor="edit-tx-amount">Betrag (€)</Label>
                                    <Input
                                        id="edit-tx-amount"
                                        type="number"
                                        step="0.01"
                                        value={editTransaction.amount}
                                        onChange={(e) => setEditTransaction({
                                            ...editTransaction,
                                            amount: parseFloat(e.target.value)
                                        })}
                                    />
                                </div>
                            </div>
                            <div>
                                <Label htmlFor="edit-tx-description">Beschreibung</Label>
                                <Input
                                    id="edit-tx-description"
                                    value={editTransaction.description}
                                    onChange={(e) => setEditTransaction({
                                        ...editTransaction,
                                        description: e.target.value
                                    })}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label htmlFor="edit-tx-category">Kategorie</Label>
                                    <Select
                                        value={editTransaction.category || ''}
                                        onValueChange={(value) => setEditTransaction({
                                            ...editTransaction,
                                            category: value
                                        })}
                                    >
                                        <SelectTrigger id="edit-tx-category">
                                            <SelectValue placeholder="Wählen..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {CASH_CATEGORIES.map((cat) => (
                                                <SelectItem key={cat} value={cat}>
                                                    {cat}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div>
                                    <Label htmlFor="edit-tx-receipt">Belegnummer</Label>
                                    <Input
                                        id="edit-tx-receipt"
                                        value={editTransaction.receiptNumber || ''}
                                        onChange={(e) => setEditTransaction({
                                            ...editTransaction,
                                            receiptNumber: e.target.value
                                        })}
                                    />
                                </div>
                            </div>
                            <div className="flex items-center justify-between">
                                <Label htmlFor="edit-tx-tax">Steuerrelevant</Label>
                                <Switch
                                    id="edit-tx-tax"
                                    checked={editTransaction.taxRelevant}
                                    onCheckedChange={(checked) => setEditTransaction({
                                        ...editTransaction,
                                        taxRelevant: checked
                                    })}
                                />
                            </div>
                            <div>
                                <Label htmlFor="edit-tx-notes">Notizen</Label>
                                <Textarea
                                    id="edit-tx-notes"
                                    value={editTransaction.notes || ''}
                                    onChange={(e) => setEditTransaction({
                                        ...editTransaction,
                                        notes: e.target.value
                                    })}
                                />
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowEditTransactionModal(false)}>
                            Abbrechen
                        </Button>
                        <Button onClick={handleUpdateTransaction} disabled={isSaving}>
                            {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Speichern
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation Modal */}
            <Dialog open={showDeleteModal} onOpenChange={setShowDeleteModal}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Löschen bestätigen</DialogTitle>
                        <DialogDescription>
                            {deleteTarget?.type === 'cashbook'
                                ? 'Möchten Sie dieses Kassenbuch wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.'
                                : 'Möchten Sie diese Buchung wirklich löschen? Der Kassenbestand wird neu berechnet.'
                            }
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowDeleteModal(false)}>
                            Abbrechen
                        </Button>
                        <Button variant="destructive" onClick={handleDelete} disabled={isSaving}>
                            {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Löschen
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
