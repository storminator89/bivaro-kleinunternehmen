"use client";

import React, { useState, useEffect, useCallback } from 'react';
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

interface EURElsterExportDialogProps {
    isOpen: boolean;
    onClose: () => void;
}

export function EURElsterExportDialog({ isOpen, onClose }: EURElsterExportDialogProps) {
    const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString());
    const [isLoading, setIsLoading] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [previewData, setPreviewData] = useState<{
        data: EURExportData;
        unmappedCategories: UnmappedCategory[];
        warnings: string[];
    } | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Available years (current year and 5 years back)
    const availableYears = Array.from({ length: 6 }, (_, i) =>
        (new Date().getFullYear() - i).toString()
    );

    // Format currency
    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('de-DE', {
            style: 'currency',
            currency: 'EUR'
        }).format(amount);
    };

    // Load preview data
    const loadPreview = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/eur-export?year=${selectedYear}&format=json`);
            if (res.ok) {
                const data = await res.json();
                setPreviewData(data);
            } else {
                const errorData = await res.json();
                setError(errorData.error || 'Fehler beim Laden der Vorschau');
            }
        } catch (err) {
            console.error('Error loading preview:', err);
            setError('Fehler beim Laden der Vorschau');
        } finally {
            setIsLoading(false);
        }
    }, [selectedYear]);

    // Load preview when year changes
    useEffect(() => {
        if (isOpen) {
            loadPreview();
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
                a.download = `Anlage-EUER-${selectedYear}.csv`;
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

    // Group lines by type
    const groupedLines = {
        income: previewData?.data.lines.filter(l => l.type === 'income') || [],
        expense: previewData?.data.lines.filter(l => l.type === 'expense') || [],
        result: previewData?.data.lines.filter(l => l.type === 'result') || [],
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="!max-w-[1200px] !w-[95vw] max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <DialogHeader className="pb-4 border-b">
                    <div className="flex items-center gap-3">
                        <div className="rounded-lg bg-primary p-2 text-primary-foreground">
                            <FileSpreadsheet className="h-6 w-6" />
                        </div>
                        <div>
                            <DialogTitle className="text-xl font-bold">
                                Anlage EÜR für Elster
                            </DialogTitle>
                            <DialogDescription className="text-sm">
                                Export der Einnahmen-Überschuss-Rechnung im Elster-kompatiblen CSV-Format
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto py-6 space-y-6">
                    {/* Year Selection & Company Info */}
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 px-1">
                        <div className="flex items-center gap-4 bg-muted/50 p-3 rounded-lg">
                            <Calendar className="h-5 w-5 text-muted-foreground" />
                            <div className="flex items-center gap-2">
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
                            <div className="flex items-center gap-2 text-muted-foreground">
                                <Building2 className="h-4 w-4" />
                                <span className="text-sm">{previewData.data.companyName}</span>
                                {previewData.data.taxNumber && (
                                    <Badge variant="outline" className="ml-2">
                                        StNr: {previewData.data.taxNumber}
                                    </Badge>
                                )}
                            </div>
                        )}
                    </div>

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
                            <div className="grid gap-4 md:grid-cols-3">
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
                                            <span className="text-sm font-medium">Gewinn / Verlust</span>
                                        </div>
                                        <div className={`text-3xl font-bold ${previewData.data.profit >= 0 ? 'text-blue-700 dark:text-blue-300' : 'text-amber-700 dark:text-amber-300'
                                            }`}>
                                            {formatCurrency(previewData.data.profit)}
                                        </div>
                                        <p className={`text-xs mt-1 ${previewData.data.profit >= 0 ? 'text-blue-600/70' : 'text-amber-600/70'
                                            }`}>
                                            Zeile 87 der Anlage EÜR
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
                                        Diese Kategorien wurden automatisch zu Zeile 72 (Sonstige Betriebsausgaben) hinzugefügt:
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                        {previewData.unmappedCategories.map((cat, i) => (
                                            <Badge key={i} variant="outline" className="bg-white dark:bg-background py-1.5 px-3">
                                                <span className="font-medium">{cat.category}</span>
                                                <span className="mx-1.5 text-muted-foreground">·</span>
                                                <span className="text-orange-600">{formatCurrency(cat.amount)}</span>
                                                <span className="ml-1 text-muted-foreground">({cat.count}×)</span>
                                            </Badge>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="border-t my-2" />

                            {/* EÜR Lines Tables */}
                            <div className="grid gap-6 lg:grid-cols-2">
                                {/* Income Lines */}
                                <div className="space-y-3">
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
                                    <div className="rounded-xl border bg-card overflow-hidden">
                                        <Table>
                                            <TableHeader>
                                                <TableRow className="bg-muted/50">
                                                    <TableHead className="w-20 font-semibold">Zeile</TableHead>
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
                                                            <TableCell className="font-mono text-sm font-medium">{line.lineNumber}</TableCell>
                                                            <TableCell className="text-sm">{line.name}</TableCell>
                                                            <TableCell className="text-right font-semibold text-emerald-600 dark:text-emerald-400">
                                                                {formatCurrency(line.amount)}
                                                            </TableCell>
                                                        </TableRow>
                                                    ))
                                                )}
                                                {groupedLines.income.length > 0 && (
                                                    <TableRow className="bg-emerald-50 dark:bg-emerald-950/30 font-bold">
                                                        <TableCell></TableCell>
                                                        <TableCell>Summe Einnahmen</TableCell>
                                                        <TableCell className="text-right text-emerald-700 dark:text-emerald-300">
                                                            {formatCurrency(previewData.data.totalIncome)}
                                                        </TableCell>
                                                    </TableRow>
                                                )}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </div>

                                {/* Expense Lines */}
                                <div className="space-y-3">
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
                                    <div className="rounded-xl border bg-card overflow-hidden max-h-[400px] overflow-y-auto">
                                        <Table>
                                            <TableHeader className="sticky top-0 bg-card z-10">
                                                <TableRow className="bg-muted/50">
                                                    <TableHead className="w-20 font-semibold">Zeile</TableHead>
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
                                                            <TableCell className="font-mono text-sm font-medium">{line.lineNumber}</TableCell>
                                                            <TableCell className="text-sm">{line.name}</TableCell>
                                                            <TableCell className="text-right font-semibold text-rose-600 dark:text-rose-400">
                                                                {formatCurrency(line.amount)}
                                                            </TableCell>
                                                        </TableRow>
                                                    ))
                                                )}
                                                {groupedLines.expense.length > 0 && (
                                                    <TableRow className="bg-rose-50 dark:bg-rose-950/30 font-bold sticky bottom-0">
                                                        <TableCell></TableCell>
                                                        <TableCell>Summe Ausgaben</TableCell>
                                                        <TableCell className="text-right text-rose-700 dark:text-rose-300">
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
                                            <span className="font-mono text-sm text-muted-foreground">Zeile 87</span>
                                            <p className="font-semibold text-lg">Gewinn / Verlust aus der EÜR</p>
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
                                            und kann direkt in Excel geöffnet oder als Vorlage für die manuelle Elster-Eingabe verwendet werden.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {/* Footer */}
                <DialogFooter className="pt-4 border-t gap-2">
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
