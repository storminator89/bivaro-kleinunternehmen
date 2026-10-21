"use client";

import Link from 'next/link';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
    Download,
    FileSpreadsheet,
    AlertTriangle,
    TrendingUp,
    TrendingDown,
    Scale,
    Loader2,
    Info,
    Calendar,
    Building2
} from "lucide-react";
import { EURExportData, UnmappedCategory } from '@/types/eur-export';
import { getEURYearContract, getSupportedEURYears } from '@/lib/eur-line-mapping';

interface EURElsterExportDialogProps {
    isOpen: boolean;
    onClose: () => void;
}

export function EURElsterExportDialog({ isOpen, onClose }: EURElsterExportDialogProps) {
    const supportedYears = getSupportedEURYears();
    const [selectedYear, setSelectedYear] = useState<string>(String(supportedYears[supportedYears.length - 1]));
    const [isLoading, setIsLoading] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [previewData, setPreviewData] = useState<{
        data: EURExportData;
        unmappedCategories: UnmappedCategory[];
        warnings: string[];
    } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const previewRequestRef = useRef(0);
    const previewAbortRef = useRef<AbortController | null>(null);

    // Only years with a checked official mapping can be selected. New form
    // years are added after their BMF/ELSTER source has been reviewed.
    const availableYears = supportedYears.map(String);

    // Format currency
    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('de-DE', {
            style: 'currency',
            currency: 'EUR'
        }).format(amount);
    };

    // Load preview data
    const loadPreview = useCallback(async () => {
        const requestId = ++previewRequestRef.current;
        previewAbortRef.current?.abort();
        const controller = new AbortController();
        previewAbortRef.current = controller;
        setIsLoading(true);
        setError(null);
        setPreviewData(null);
        try {
            const res = await fetch(`/api/eur-export?year=${selectedYear}&format=json`, { signal: controller.signal });
            if (requestId !== previewRequestRef.current) return;
            if (res.ok) {
                const data = await res.json();
                if (requestId !== previewRequestRef.current) return;
                setPreviewData(data);
            } else {
                const errorData = await res.json();
                if (requestId !== previewRequestRef.current) return;
                setError(errorData.error || 'Fehler beim Laden der Vorschau');
            }
        } catch (err) {
            if (controller.signal.aborted || requestId !== previewRequestRef.current) return;
            console.error('Error loading preview:', err);
            setError('Fehler beim Laden der Vorschau');
        } finally {
            if (requestId === previewRequestRef.current) setIsLoading(false);
        }
    }, [selectedYear]);

    useEffect(() => () => previewAbortRef.current?.abort(), []);

    // Load preview when year changes
    useEffect(() => {
        if (isOpen) {
            loadPreview();
        } else {
            previewAbortRef.current?.abort();
        }
    }, [isOpen, selectedYear, loadPreview]);

    // Export as CSV
    const handleExport = async () => {
        setIsExporting(true);
        try {
            const res = await fetch(`/api/eur-export?year=${selectedYear}&format=csv`);
            if (res.ok) {
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `Anlage-EUER-Uebertragungshilfe-${selectedYear}.csv`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url);
            } else {
                const errorData = await res.json();
                alert(errorData.error || 'Fehler beim Export');
            }
        } catch (err) {
            console.error('Error exporting:', err);
            alert('Fehler beim Export');
        } finally {
            setIsExporting(false);
        }
    };

    const previewContract = previewData ? getEURYearContract(previewData.data.year) : null;

    // Group lines by type
    const groupedLines = {
        income: previewData?.data.lines.filter(l => l.type === 'income') || [],
        expense: previewData?.data.lines.filter(l => l.type === 'expense') || [],
        result: previewData?.data.lines.filter(l => l.type === 'result') || [],
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="!max-w-[1200px] !w-[95vw] max-h-[90dvh] min-h-0 min-w-0 overflow-hidden flex flex-col p-4 sm:p-6">
                {/* Header */}
                <DialogHeader className="shrink-0 border-b pb-4 text-left">
                    <div className="flex min-w-0 items-center gap-3 pr-6">
                        <div className="shrink-0 rounded-lg bg-primary p-2 text-primary-foreground">
                            <FileSpreadsheet className="h-6 w-6" />
                        </div>
                        <div className="min-w-0">
                            <DialogTitle className="text-lg font-bold leading-snug sm:text-xl">
                                Anlage EÜR – Übertragungshilfe
                            </DialogTitle>
                            <DialogDescription className="text-sm">
                                CSV-Arbeitsunterlage mit geprüfter Jahreszuordnung; keine ELSTER-Einreichung
                            </DialogDescription>
                        </div>
                    </div>

                    {previewData && (
                        <div className="min-w-0 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground sm:text-sm">
                            <p className="break-words"><span className="font-medium text-foreground">Mappingversion:</span> {previewData.data.mappingVersion}</p>
                            <p className="mt-1">Kontrollsummen: {previewData.data.controlTotals.incomeCount} Einnahmen, {previewData.data.controlTotals.expenseCount} Ausgaben</p>
                        </div>
                    )}
                </DialogHeader>

                {/* Scrollable Content */}
                <div role="region" aria-label="EÜR-Vorschau" className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain py-4 space-y-5 [overflow-wrap:anywhere]">
                    {/* Year Selection & Company Info */}
                    <div className="flex min-w-0 flex-col md:flex-row justify-between items-start md:items-center gap-3">
                        <div className="flex min-w-0 flex-wrap items-center gap-3 bg-muted/50 p-3 rounded-lg">
                            <Calendar className="h-5 w-5 shrink-0 text-muted-foreground" />
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <Label htmlFor="year-select" className="font-medium">Veranlagungsjahr:</Label>
                                <Select value={selectedYear} onValueChange={setSelectedYear}>
                                    <SelectTrigger id="year-select" className="w-28 bg-background">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {availableYears.map(year => (
                                            <SelectItem key={year} value={year}>{year}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {previewData?.data.companyName && (
                            <div className="flex min-w-0 flex-wrap items-center gap-2 text-muted-foreground">
                                <Building2 className="h-4 w-4" />
                                <span className="min-w-0 break-words text-sm">{previewData.data.companyName}</span>
                                {previewData.data.taxNumber && (
                                    <Badge variant="outline" className="ml-2">
                                        StNr: {previewData.data.taxNumber}
                                    </Badge>
                                )}
                            </div>
                        )}
                    </div>

                    {previewData && (
                        <details className="min-w-0 rounded-lg border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                            <summary className="cursor-pointer font-medium text-foreground">Quelle und Prüfumfang</summary>
                            <p className="mt-2 break-words"><span className="font-medium text-foreground">Quellenversion:</span> {previewData.data.sourceVersion}</p>
                            {previewData.data.sourceSha256 && <p className="mt-2 break-all font-mono text-xs">Quellen-SHA256: {previewData.data.sourceSha256}</p>}
                            <p className="mt-2">{previewData.data.checkedScope}</p>
                        </details>
                    )}

                    <p className="text-sm text-muted-foreground">
                        Kein passendes Formularjahr? Das <Link className="underline" href={`/handoff?year=${selectedYear}`}>
                            begrenzte Rohdaten-/Kanzleipaket
                        </Link> erlaubt auch andere Kalenderjahre, ohne amtliche EÜR-Zeilenzuordnung. Zeitraum und Warnungen dort vor dem Download prüfen.
                    </p>

                    {/* Loading State */}
                    {isLoading && (
                        <div className="flex flex-col items-center justify-center py-16 gap-4">
                            <div className="p-4 rounded-full bg-primary/10">
                                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                            </div>
                            <p className="text-muted-foreground">Daten werden geladen...</p>
                        </div>
                    )}

                    {/* Error State */}
                    {error && (
                        <div className="bg-destructive/10 text-destructive p-6 rounded-xl flex items-center gap-4 border border-destructive/20">
                            <div className="p-3 rounded-full bg-destructive/20">
                                <AlertTriangle className="h-6 w-6" />
                            </div>
                            <div>
                                <p className="font-semibold">Fehler beim Laden</p>
                                <p className="text-sm opacity-90">{error}</p>
                            </div>
                        </div>
                    )}

                    {/* Preview Data */}
                    {!isLoading && !error && previewData && (
                        <>
                            {/* Summary Cards - Main KPIs */}
                            <div className="grid min-w-0 gap-4 md:grid-cols-3">
                                <Card className="relative overflow-hidden border-positive/40 bg-positive-surface">
                                    <div className="absolute top-0 right-0 w-24 h-24 transform translate-x-8 -translate-y-8">
                                        <div className="w-full h-full rounded-full bg-emerald-200/30 dark:bg-emerald-800/20" />
                                    </div>
                                    <CardContent className="pt-6 relative">
                                        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 mb-2">
                                            <TrendingUp className="h-5 w-5" />
                                            <span className="text-sm font-medium">Betriebseinnahmen</span>
                                        </div>
                                        <div className="text-3xl font-bold text-emerald-700 dark:text-emerald-300">
                                            {formatCurrency(previewData.data.totalIncome)}
                                        </div>
                                        <p className="text-xs text-emerald-600/70 mt-1">
                                            {groupedLines.income.length} Zeile{groupedLines.income.length !== 1 ? 'n' : ''}
                                        </p>
                                    </CardContent>
                                </Card>

                                <Card className="relative overflow-hidden border-critical/40 bg-critical-surface">
                                    <div className="absolute top-0 right-0 w-24 h-24 transform translate-x-8 -translate-y-8">
                                        <div className="w-full h-full rounded-full bg-rose-200/30 dark:bg-rose-800/20" />
                                    </div>
                                    <CardContent className="pt-6 relative">
                                        <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 mb-2">
                                            <TrendingDown className="h-5 w-5" />
                                            <span className="text-sm font-medium">Betriebsausgaben</span>
                                        </div>
                                        <div className="text-3xl font-bold text-rose-700 dark:text-rose-300">
                                            {formatCurrency(previewData.data.totalExpense)}
                                        </div>
                                        <p className="text-xs text-rose-600/70 mt-1">
                                            {groupedLines.expense.length} Zeile{groupedLines.expense.length !== 1 ? 'n' : ''}
                                        </p>
                                    </CardContent>
                                </Card>

                                <Card className={`relative overflow-hidden ${previewData.data.profit >= 0
                                    ? 'border-notice/40 bg-notice-surface'
                                    : 'border-caution/40 bg-caution-surface'
                                    }`}>
                                    <div className="absolute top-0 right-0 w-24 h-24 transform translate-x-8 -translate-y-8">
                                        <div className={`w-full h-full rounded-full ${previewData.data.profit >= 0 ? 'bg-blue-200/30 dark:bg-blue-800/20' : 'bg-amber-200/30 dark:bg-amber-800/20'
                                            }`} />
                                    </div>
                                    <CardContent className="pt-6 relative">
                                        <div className={`flex items-center gap-2 mb-2 ${previewData.data.profit >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-amber-600 dark:text-amber-400'
                                            }`}>
                                            <Scale className="h-5 w-5" />
                                            <span className="text-sm font-medium">Berechneter Überschuss</span>
                                        </div>
                                        <div className={`text-3xl font-bold ${previewData.data.profit >= 0 ? 'text-blue-700 dark:text-blue-300' : 'text-amber-700 dark:text-amber-300'
                                            }`}>
                                            {formatCurrency(previewData.data.profit)}
                                        </div>
                                        <p className={`text-xs mt-1 ${previewData.data.profit >= 0 ? 'text-blue-600/70' : 'text-amber-600/70'
                                            }`}>
                                            Zeile {previewContract?.roles.intermediateResult} der Anlage EÜR
                                        </p>
                                    </CardContent>
                                </Card>
                            </div>

                            {/* Warnings */}
                            {previewData.warnings.length > 0 && (
                                <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-4 rounded-xl">
                                    <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 mb-2">
                                        <AlertTriangle className="h-5 w-5" />
                                        <span className="font-semibold">Hinweise</span>
                                    </div>
                                    <ul className="text-sm text-amber-600 dark:text-amber-500 list-disc list-inside space-y-1">
                                        {previewData.warnings.map((warning, i) => (
                                            <li key={i}>{warning}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {/* Unmapped Categories */}
                            {previewData.unmappedCategories.length > 0 && (
                                <div className="bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 p-4 rounded-xl">
                                    <div className="flex items-center gap-2 text-orange-700 dark:text-orange-400 mb-3">
                                        <Info className="h-5 w-5" />
                                        <span className="font-semibold">Nicht zugeordnete Kategorien</span>
                                    </div>
                                    <p className="text-sm text-orange-600 dark:text-orange-500 mb-3">
                                        Diese Kategorien sind noch nicht belastbar zugeordnet. Sie werden vorläufig zu Zeile {previewContract?.roles.fallbackExpense} (übrige unbeschränkt abziehbare Betriebsausgaben) gerechnet und müssen geprüft werden:
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                        {previewData.unmappedCategories.map((cat, i) => (
                                            <Badge key={i} variant="outline" className="max-w-full min-w-0 flex-wrap whitespace-normal break-words bg-white dark:bg-background py-1.5 px-3">
                                                <span className="font-medium">{cat.category}</span>
                                                <span className="mx-1.5 text-muted-foreground">·</span>
                                                <span className="text-orange-600">{formatCurrency(cat.amount)}</span>
                                                <span className="ml-1 text-muted-foreground">({cat.count}×)</span>
                                            </Badge>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {previewData.data.corrections.length > 0 && (
                                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/20">
                                    <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 mb-3">
                                        <AlertTriangle className="h-5 w-5" />
                                        <span className="font-semibold">Negative Korrekturen / Erstattungen</span>
                                    </div>
                                    <p className="text-sm text-amber-700/80 dark:text-amber-500 mb-3">
                                        Das gespeicherte Vorzeichen wurde übernommen. Bitte Ursprungsbeleg und Erstattungsgrund fachlich prüfen.
                                    </p>
                                    <div className="space-y-1 text-sm">
                                        {previewData.data.corrections.map((correction, index) => (
                                            <div key={`${correction.expenseId ?? 'correction'}-${index}`} className="flex flex-wrap gap-x-3 gap-y-1">
                                                <span className="font-mono">{correction.date}</span>
                                                <span>{correction.description || correction.category}</span>
                                                <span className="font-medium">{formatCurrency(correction.amount)}</span>
                                                <span className="text-muted-foreground">Zeile {correction.lineNumber ?? 'offen'}</span>
                                                <span className="text-muted-foreground">{correction.originalExpenseId ? `Ursprung #${correction.originalExpenseId}` : 'Ursprung nicht verknüpft'}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="border-t my-2" />

                            {/* EÜR Lines Tables */}
                            <div className="grid min-w-0 gap-6 lg:grid-cols-2 [&_[data-slot=table-container]]:overflow-visible">
                                {/* Income Lines */}
                                <div className="min-w-0 space-y-3">
                                    <div className="flex items-center gap-2">
                                        <div className="p-1.5 rounded-md bg-emerald-100 dark:bg-emerald-900/50">
                                            <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                                        </div>
                                        <h4 className="font-semibold text-emerald-700 dark:text-emerald-400">
                                            Betriebseinnahmen
                                        </h4>
                                        <Badge variant="secondary" className="ml-auto">
                                            {groupedLines.income.length} Zeilen
                                        </Badge>
                                    </div>
                                    <div className="min-w-0 rounded-xl border bg-card">
                                        <Table aria-label="Einnahmen nach EÜR-Zeile" className="table-fixed">
                                            <colgroup><col className="w-11 sm:w-14" /><col /><col className="w-28 sm:w-32" /></colgroup>
                                            <TableHeader>
                                                <TableRow className="bg-muted/50">
                                                    <TableHead className="font-semibold">Zeile</TableHead>
                                                    <TableHead className="font-semibold">Bezeichnung</TableHead>
                                                    <TableHead className="text-right font-semibold">Betrag</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {groupedLines.income.length === 0 ? (
                                                    <TableRow>
                                                        <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                                                            Keine Einnahmen im gewählten Jahr
                                                        </TableCell>
                                                    </TableRow>
                                                ) : (
                                                    groupedLines.income.map((line) => (
                                                        <TableRow key={line.lineNumber} className="hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20">
                                                            <TableCell className="align-top font-mono text-sm font-medium">{line.lineNumber}</TableCell>
                                                            <TableCell className="whitespace-normal break-words align-top text-sm [overflow-wrap:anywhere]">{line.name}</TableCell>
                                                            <TableCell className="whitespace-nowrap text-right align-top font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                                                                {formatCurrency(line.amount)}
                                                            </TableCell>
                                                        </TableRow>
                                                    ))
                                                )}
                                                {groupedLines.income.length > 0 && (
                                                    <TableRow className="bg-emerald-50 dark:bg-emerald-950/30 font-bold">
                                                        <TableCell colSpan={2} className="whitespace-normal break-words">Summe Einnahmen</TableCell>
                                                        <TableCell className="whitespace-nowrap text-right tabular-nums text-emerald-700 dark:text-emerald-300">
                                                            {formatCurrency(previewData.data.totalIncome)}
                                                        </TableCell>
                                                    </TableRow>
                                                )}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </div>

                                {/* Expense Lines */}
                                <div className="min-w-0 space-y-3">
                                    <div className="flex items-center gap-2">
                                        <div className="p-1.5 rounded-md bg-rose-100 dark:bg-rose-900/50">
                                            <TrendingDown className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                                        </div>
                                        <h4 className="font-semibold text-rose-700 dark:text-rose-400">
                                            Betriebsausgaben
                                        </h4>
                                        <Badge variant="secondary" className="ml-auto">
                                            {groupedLines.expense.length} Zeilen
                                        </Badge>
                                    </div>
                                    <div className="min-w-0 rounded-xl border bg-card">
                                        <Table aria-label="Ausgaben nach EÜR-Zeile" className="table-fixed">
                                            <colgroup><col className="w-11 sm:w-14" /><col /><col className="w-28 sm:w-32" /></colgroup>
                                            <TableHeader>
                                                <TableRow className="bg-muted/50">
                                                    <TableHead className="font-semibold">Zeile</TableHead>
                                                    <TableHead className="font-semibold">Bezeichnung</TableHead>
                                                    <TableHead className="text-right font-semibold">Betrag</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {groupedLines.expense.length === 0 ? (
                                                    <TableRow>
                                                        <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                                                            Keine Ausgaben im gewählten Jahr
                                                        </TableCell>
                                                    </TableRow>
                                                ) : (
                                                    groupedLines.expense.map((line) => (
                                                        <TableRow key={line.lineNumber} className="hover:bg-rose-50/50 dark:hover:bg-rose-950/20">
                                                            <TableCell className="align-top font-mono text-sm font-medium">{line.lineNumber}</TableCell>
                                                            <TableCell className="whitespace-normal break-words align-top text-sm [overflow-wrap:anywhere]">{line.name}</TableCell>
                                                            <TableCell className="whitespace-nowrap text-right align-top font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                                                                {formatCurrency(line.amount)}
                                                            </TableCell>
                                                        </TableRow>
                                                    ))
                                                )}
                                                {groupedLines.expense.length > 0 && (
                                                    <TableRow className="bg-rose-50 dark:bg-rose-950/30 font-bold">
                                                        <TableCell colSpan={2} className="whitespace-normal break-words">Summe Ausgaben</TableCell>
                                                        <TableCell className="whitespace-nowrap text-right tabular-nums text-rose-700 dark:text-rose-300">
                                                            {formatCurrency(previewData.data.totalExpense)}
                                                        </TableCell>
                                                    </TableRow>
                                                )}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </div>
                            </div>

                            {/* Result Line - Prominent Display */}
                            <div className={`p-6 rounded-xl ${previewData.data.profit >= 0
                                ? 'border border-notice/40 bg-notice-surface'
                                : 'border border-caution/40 bg-caution-surface'
                                }`}>
                                <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                                    <div className="flex items-center gap-3">
                                        <div className={`p-2 rounded-lg ${previewData.data.profit >= 0 ? 'bg-blue-200 dark:bg-blue-900' : 'bg-amber-200 dark:bg-amber-900'
                                            }`}>
                                            <Scale className={`h-5 w-5 ${previewData.data.profit >= 0 ? 'text-blue-700 dark:text-blue-300' : 'text-amber-700 dark:text-amber-300'
                                                }`} />
                                        </div>
                                        <div>
                                            <span className="font-mono text-sm text-muted-foreground">Zeile {previewContract?.roles.intermediateResult}</span>
                                            <p className="font-semibold text-lg">Vereinfachter Überschuss für Zeile {previewContract?.roles.intermediateResult}</p>
                                        </div>
                                    </div>
                                    <div className={`text-4xl font-bold ${previewData.data.profit >= 0 ? 'text-blue-700 dark:text-blue-300' : 'text-amber-700 dark:text-amber-300'
                                        }`}>
                                        {formatCurrency(previewData.data.profit)}
                                    </div>
                                </div>
                            </div>

                            {/* Info Box */}
                            <div className="bg-slate-50 dark:bg-slate-950/20 border border-slate-200 dark:border-slate-800 p-4 rounded-xl text-sm">
                                <div className="flex items-start gap-3">
                                    <div className="p-2 rounded-lg bg-slate-200 dark:bg-slate-800">
                                        <Info className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                                    </div>
                                    <div className="text-slate-700 dark:text-slate-300">
                                        <p className="font-semibold mb-1">Hinweis zum Export-Format</p>
                                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                                            Die CSV-Datei verwendet das deutsche Format (Semikolon als Trennzeichen, Komma als Dezimaltrennzeichen)
                                            und kann in Excel geöffnet und von einer fachkundigen Person übertragen werden. Die späteren amtlichen Ergebniszeilen {previewContract?.laterResultRowsLabel} werden hier nicht vollständig ermittelt. Eine ELSTER-Einreichung findet hier nicht statt.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {/* Footer */}
                <DialogFooter className="shrink-0 border-t pt-4 gap-2">
                    <Button variant="outline" onClick={onClose}>
                        Schließen
                    </Button>
                    <Button
                        onClick={handleExport}
                                disabled={isLoading || isExporting || !previewData}
                        className="min-w-[180px]"
                        size="lg"
                    >
                        {isExporting ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Wird exportiert...
                            </>
                        ) : (
                            <>
                                <Download className="h-4 w-4 mr-2" />
                                CSV herunterladen
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
