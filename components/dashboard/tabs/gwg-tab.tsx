"use client";

import React from 'react';
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Expense, TimeRange } from "@/types/dashboard";
import { formatCurrency } from "@/lib/dashboard-utils";

type GWGTabProps = {
  expensesAll: Expense[];
  selectedTimeRange: TimeRange;
  onExport: () => void;
};

export function GWGTab({
  expensesAll,
  selectedTimeRange,
  onExport,
}: GWGTabProps) {
  const gwgExpenses = expensesAll.filter(expense => {
    if (!expense.taxRelevant) return false;
    if (expense.amount <= 250 || expense.amount > 1000) return false;
    
    const expenseDate = new Date(expense.date);
    const today = new Date();
    if (selectedTimeRange === 'thisYear') {
      return expenseDate.getFullYear() === today.getFullYear();
    } else if (selectedTimeRange === 'lastYear') {
      return expenseDate.getFullYear() === today.getFullYear() - 1;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-xl shadow-sm border overflow-hidden transition-all duration-300 hover:shadow-md">
        <div className="px-6 pt-6 pb-4 border-b bg-gradient-to-r from-amber-50/50 to-amber-50/30 dark:from-amber-900/10 dark:to-amber-900/5">
          <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
            <div>
              <h2 className="text-xl font-semibold mb-1 flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                GWG-Verzeichnis
              </h2>
              <p className="text-sm text-muted-foreground">
                Verzeichnis für Geringwertige Wirtschaftsgüter (GWG) über 250 € bis 1.000 € Netto.
              </p>
            </div>
            <Button
              onClick={onExport}
              className="self-start bg-amber-600 hover:bg-amber-700 text-white"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4-4m0 0l-4 4m4-4V4" />
              </svg>
              GWG-Verzeichnis exportieren
            </Button>
          </div>
        </div>
        <div className="p-6">
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Anzeige für: <span className="font-medium text-foreground">
                  {selectedTimeRange === 'thisYear' ? 'Aktuelles Jahr' : selectedTimeRange === 'lastYear' ? 'Vorjahr' : 'Alle Jahre'}
                </span>
              </div>
            </div>
            
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="font-medium">Datum</TableHead>
                    <TableHead className="font-medium">Beschreibung</TableHead>
                    <TableHead className="font-medium">Kategorie</TableHead>
                    <TableHead className="text-right font-medium">Betrag (Netto)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {gwgExpenses.length > 0 ? (
                    gwgExpenses.map((expense) => (
                      <TableRow key={expense.id}>
                        <TableCell>{new Date(expense.date).toLocaleDateString('de-DE')}</TableCell>
                        <TableCell>{expense.description}</TableCell>
                        <TableCell>{expense.category}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(expense.amount)}</TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                        Keine GWG-Anschaffungen im gewählten Zeitraum gefunden.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              Hinweis: Dieses Verzeichnis listet automatisch alle steuerrelevanten Ausgaben zwischen 250 € und 1.000 € auf.
              Es dient als Nachweis gemäß § 6 Abs. 2 EStG.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
