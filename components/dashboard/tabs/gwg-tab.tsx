"use client";

import React from "react";
import { DashboardIcon } from "@/components/brand/dashboard-icon";
import { Download, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/dashboard-utils";
import { Expense, TimeRange } from "@/types/dashboard";
import styles from "./report-workspace.module.css";

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4 · visual verification pending */

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
    <div className={`report-workspace ${styles.workspace}`} data-testid="gwg-report-workspace">
      <header className={styles.header}>
        <div className="min-w-0">
          <h2>Anschaffungen</h2>
          <p>
            Steuerrelevante Wirtschaftsgüter über 250 € bis einschließlich 1.000 € netto.
          </p>
        </div>
        <div className={styles.exportActions}><Button type="button" onClick={onExport}>
          <Download aria-hidden="true" className="mr-2 h-4 w-4" />
          GWG exportieren
        </Button></div>
      </header>

      <section aria-labelledby="gwg-summary" className={styles.sheet}>
        <div className={styles.assetSummary}>
          <h3 id="gwg-summary">Anschaffungen im Überblick</h3>
          <dl className={styles.assetMetrics}>
            <div><dt>Zeitraum</dt><dd>{getPeriodLabel(selectedTimeRange)}</dd></div>
            <div><dt>Einträge</dt><dd>{gwgExpenses.length}</dd></div>
            <div><dt>Nettosumme</dt><dd>{formatCurrency(totalAmount)}</dd></div>
          </dl>
        </div>
        <div className={styles.sectionHeading}>
          <h3 id="gwg-list-heading"><DashboardIcon name="nav-cashbook" size={32} />Erfasste Wirtschaftsgüter</h3>
        </div>

        {gwgExpenses.length > 0 ? (
          <>
            <div className={styles.mobileList}>
              {gwgExpenses.map((expense) => (
                <article key={expense.id} className={styles.mobileRow}>
                  <div>
                    <div className="min-w-0">
                      <h4 className="font-medium [overflow-wrap:anywhere]">{expense.description}</h4>
                      <p>{new Date(expense.date).toLocaleDateString("de-DE")}</p>
                    </div>
                    <strong className={styles.mobileValue}>{formatCurrency(expense.amount)}</strong>
                  </div>
                  <dl className={styles.rowDetails}>
                    <div>
                      <dt className="text-muted-foreground">Kategorie</dt>
                      <dd className="min-w-0 [overflow-wrap:anywhere]">{expense.category || "Ohne Kategorie"}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>

            <div className={styles.desktopTable}>
              <Table className={`${styles.table} ${styles.assetTable}`}>
                <TableHeader>
                  <TableRow>
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
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={3}>Summe</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(totalAmount)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          </>
        ) : (
          <p className={styles.empty}>Keine GWG-Anschaffungen gefunden</p>
        )}

        <div className={styles.note}>
          <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Automatisch aus passenden Ausgaben · § 6 Abs. 2 EStG.</p>
        </div>
      </section>
    </div>
  );
}
