"use client";

import React from "react";
import { ClipboardList, Download, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/dashboard-utils";
import { Expense, TimeRange } from "@/types/dashboard";

/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V4 */

type GWGTabProps = {
  expensesAll: Expense[];
  selectedTimeRange: TimeRange;
  onExport: () => void;
};

function getPeriodLabel(selectedTimeRange: TimeRange) {
  if (selectedTimeRange === "thisYear") return "Aktuelles Jahr";
  if (selectedTimeRange === "lastYear") return "Vorjahr";
  if (selectedTimeRange === "last3Months") return "Letzte 3 Monate";
  if (selectedTimeRange === "last6Months") return "Letzte 6 Monate";
  return "Alle Jahre";
}

export function GWGTab({ expensesAll, selectedTimeRange, onExport }: GWGTabProps) {
  const gwgExpenses = expensesAll.filter((expense) => {
    if (!expense.taxRelevant) return false;
    if (expense.amount <= 250 || expense.amount > 1000) return false;

    const expenseDate = new Date(expense.date);
    const today = new Date();
    if (selectedTimeRange === "thisYear") {
      return expenseDate.getFullYear() === today.getFullYear();
    }
    if (selectedTimeRange === "lastYear") {
      return expenseDate.getFullYear() === today.getFullYear() - 1;
    }
    return true;
  });
  const totalAmount = gwgExpenses.reduce((sum, expense) => sum + expense.amount, 0);

  return (
    <div className="min-w-0 space-y-6">
      <header className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <ClipboardList aria-hidden="true" className="h-5 w-5 shrink-0 text-caution" />
            <span className="[overflow-wrap:anywhere]">GWG-Verzeichnis</span>
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Steuerrelevante Wirtschaftsgüter über 250 € bis einschließlich 1.000 € netto.
          </p>
        </div>
        <Button onClick={onExport} className="min-h-11 w-full whitespace-nowrap sm:w-auto">
          <Download aria-hidden="true" className="mr-2 h-4 w-4" />
          GWG exportieren
        </Button>
      </header>

      <section aria-labelledby="gwg-summary" className="overflow-hidden rounded-lg border">
        <div className="border-b bg-muted/30 px-4 py-3 sm:px-6">
          <h3 id="gwg-summary" className="font-semibold">Verzeichnisübersicht</h3>
        </div>
        <dl className="grid grid-cols-1 divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="px-4 py-4 sm:px-6">
            <dt className="text-sm text-muted-foreground">Zeitraum</dt>
            <dd className="mt-1 font-medium">{getPeriodLabel(selectedTimeRange)}</dd>
          </div>
          <div className="px-4 py-4 sm:px-6">
            <dt className="text-sm text-muted-foreground">Einträge</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{gwgExpenses.length}</dd>
          </div>
          <div className="px-4 py-4 sm:px-6">
            <dt className="text-sm text-muted-foreground">Nettosumme</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{formatCurrency(totalAmount)}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="gwg-list-heading" className="overflow-hidden rounded-lg border">
        <div className="border-b px-4 py-4 sm:px-6">
          <h3 id="gwg-list-heading" className="font-semibold">Erfasste Wirtschaftsgüter</h3>
        </div>

        {gwgExpenses.length > 0 ? (
          <>
            <div className="divide-y lg:hidden">
              {gwgExpenses.map((expense) => (
                <article key={expense.id} className="min-w-0 px-4 py-4 sm:px-6">
                  <div className="flex min-w-0 items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h4 className="font-medium [overflow-wrap:anywhere]">{expense.description}</h4>
                      <p className="mt-1 text-sm text-muted-foreground">{new Date(expense.date).toLocaleDateString("de-DE")}</p>
                    </div>
                    <p className="shrink-0 font-semibold tabular-nums">{formatCurrency(expense.amount)}</p>
                  </div>
                  <dl className="mt-4 text-sm">
                    <div className="flex items-start justify-between gap-4">
                      <dt className="text-muted-foreground">Kategorie</dt>
                      <dd className="min-w-0 text-right [overflow-wrap:anywhere]">{expense.category || "Ohne Kategorie"}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>

            <div className="hidden lg:block">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Datum</TableHead>
                    <TableHead>Beschreibung</TableHead>
                    <TableHead>Kategorie</TableHead>
                    <TableHead className="text-right">Betrag (Netto)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {gwgExpenses.map((expense) => (
                    <TableRow key={expense.id}>
                      <TableCell>{new Date(expense.date).toLocaleDateString("de-DE")}</TableCell>
                      <TableCell className="font-medium">{expense.description}</TableCell>
                      <TableCell>{expense.category || "Ohne Kategorie"}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatCurrency(expense.amount)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell colSpan={3}>Summe</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(totalAmount)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-start gap-3 px-4 py-8 sm:px-6">
            <ClipboardList aria-hidden="true" className="h-6 w-6 text-muted-foreground" />
            <div>
              <p className="font-medium">Keine GWG-Anschaffungen gefunden</p>
              <p className="mt-1 text-sm text-muted-foreground">Im gewählten Zeitraum gibt es keine steuerrelevanten Ausgaben innerhalb der GWG-Grenzen.</p>
            </div>
          </div>
        )}

        <div className="flex items-start gap-2 border-t bg-muted/20 px-4 py-4 text-xs text-muted-foreground sm:px-6">
          <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Das Verzeichnis dient als Nachweis gemäß § 6 Abs. 2 EStG und listet passende Ausgaben automatisch.</p>
        </div>
      </section>
    </div>
  );
}
