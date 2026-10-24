"use client";

import React, { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Download,
  FileText,
  Info,
} from "lucide-react";

import { DashboardIcon } from "@/components/brand/dashboard-icon";
import { EURElsterExportDialog } from "@/components/dashboard/eur-elster-export-dialog";
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
import { DepreciationDetail, TimeRange } from "@/types/dashboard";
import styles from "./report-workspace.module.css";

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4 · visual verification pending */

type MonthlyChartData = {
  name: string;
  fullName: string;
  Einnahmen: number;
  Ausgaben: number;
};

type CategoryChartData = {
  name: string;
  value: number;
};

type EURTabProps = {
  totalIncome: number;
  totalExpense: number;
  profit: number;
  monthlyChartData: MonthlyChartData[];
  categoryChartData: CategoryChartData[];
  expenseCategories: CategoryChartData[];
  depreciationDetails: DepreciationDetail[];
  selectedTimeRange: TimeRange;
  onExport: () => void;
  privateWithdrawals?: number;
  privateDeposits?: number;
};

export function EURTab({
  totalIncome,
  totalExpense,
  profit,
  monthlyChartData,
  categoryChartData,
  expenseCategories,
  depreciationDetails,
  selectedTimeRange,
  onExport,
  privateWithdrawals = 0,
  privateDeposits = 0,
}: EURTabProps) {
  const [showElsterDialog, setShowElsterDialog] = useState(false);
  const privateBalance = privateDeposits - privateWithdrawals;

  return (
    <div className={`report-workspace ${styles.workspace}`} data-testid="eur-report-workspace">
      <header className={styles.header}>
        <div className="min-w-0">
          <h2>
            Bericht und Export
          </h2>
          <p>
            Nur steuerrelevante In-App-Buchungen.
          </p>
        </div>
        <div className={styles.exportActions}>
          <Button type="button" variant="outline" onClick={onExport}>
            <Download aria-hidden="true" className="mr-2 h-4 w-4" />
            CSV exportieren
          </Button>
          <Button type="button" onClick={() => setShowElsterDialog(true)} aria-label="EÜR-Übertragungshilfe öffnen">
            <FileText aria-hidden="true" className="mr-2 h-4 w-4" />
            Übertragungshilfe
          </Button>
        </div>
      </header>

      <EURElsterExportDialog
        isOpen={showElsterDialog}
        onClose={() => setShowElsterDialog(false)}
      />

      <section className={styles.sheet} aria-label="Ergebnisübersicht">
        <div className={`report-balance ${styles.balance}`}>
          <div className={styles.result}>
            <h3>{profit >= 0 ? "Gewinn" : "Verlust"}</h3>
            <strong>{formatCurrency(profit)}</strong>
            <span>Vorläufiges Ergebnis · vor Steuern</span>
          </div>
          <dl className={styles.totals}>
            <div><dt>Gesamteinnahmen</dt><dd>{formatCurrency(totalIncome)}</dd></div>
            <div><dt>Gesamtausgaben</dt><dd>{formatCurrency(totalExpense)}</dd></div>
          </dl>
        </div>
        <div className={styles.breakdowns}>
          <section className={styles.breakdown} aria-labelledby="income-breakdown-mobile">
            <div className={styles.sectionHeading}>
              <h3 id="income-breakdown-mobile"><DashboardIcon name="tile-incomes" size={32} />Betriebseinnahmen</h3>
            </div>
            <dl className={`${styles.mobileList} ${styles.mobileAmounts}`}>
              <div><dt>Einnahmen (steuerpflichtig)</dt><dd>{formatCurrency(totalIncome)}</dd></div>
              <div><dt>Summe</dt><dd>{formatCurrency(totalIncome)}</dd></div>
            </dl>
            <div className={styles.desktopTable}>
              <Table className={styles.table}>
                <TableHeader><TableRow><TableHead>Kategorie</TableHead><TableHead>Betrag</TableHead></TableRow></TableHeader>
                <TableBody><TableRow><TableCell>Einnahmen (steuerpflichtig)</TableCell><TableCell>{formatCurrency(totalIncome)}</TableCell></TableRow></TableBody>
                <TableFooter><TableRow><TableCell>Summe</TableCell><TableCell>{formatCurrency(totalIncome)}</TableCell></TableRow></TableFooter>
              </Table>
            </div>
          </section>
          <section className={styles.breakdown} aria-labelledby="expense-breakdown-mobile">
            <div className={styles.sectionHeading}>
              <h3 id="expense-breakdown-mobile"><DashboardIcon name="tile-expenses" size={32} />Betriebsausgaben</h3>
            </div>
            <div className={styles.mobileList}>
              {expenseCategories.length > 0 ? (
                <dl className={styles.mobileAmounts}>
                  {expenseCategories.map(({ name, value }) => <div key={name}><dt className="min-w-0 [overflow-wrap:anywhere]">{name}</dt><dd>{formatCurrency(value)}</dd></div>)}
                  <div><dt>Summe</dt><dd>{formatCurrency(totalExpense)}</dd></div>
                </dl>
              ) : <p className={styles.empty}>Keine steuerrelevanten Ausgaben in diesem Zeitraum.</p>}
            </div>
            <div className={styles.desktopTable}>
              <Table className={styles.table}>
                <TableHeader><TableRow><TableHead>Kategorie</TableHead><TableHead>Betrag</TableHead></TableRow></TableHeader>
                <TableBody>{expenseCategories.map(({ name, value }) => <TableRow key={name}><TableCell>{name}</TableCell><TableCell>{formatCurrency(value)}</TableCell></TableRow>)}</TableBody>
                <TableFooter><TableRow><TableCell>Summe</TableCell><TableCell>{formatCurrency(totalExpense)}</TableCell></TableRow></TableFooter>
              </Table>
            </div>
          </section>
        </div>
      </section>

      <div className={styles.analysisGrid}>
        <section className={styles.panel} aria-labelledby="eur-cashflow-heading">
          <div className={styles.panelHeader}>
            <h3 id="eur-cashflow-heading">Einnahmen und Ausgaben</h3>
            <p>Monatlicher Cashflow</p>
          </div>
          <div className={styles.panelBody}>
            <div className={styles.chart}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyChartData} accessibilityLayer>
                  <CartesianGrid stroke="var(--color-rule)" vertical={false} />
                  <XAxis dataKey="name" stroke="var(--bivaro-color-muted)" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis width={96} stroke="var(--bivaro-color-muted)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}€`} />
                  <RechartsTooltip
                    contentStyle={{ background: "var(--color-paper)", borderColor: "var(--color-rule)", color: "var(--color-ink)", borderRadius: "var(--radius-input)" }}
                    formatter={(value: number) => formatCurrency(value)}
                    labelFormatter={(label) => {
                      const item = monthlyChartData.find((entry) => entry.name === label);
                      return item ? item.fullName : label;
                    }}
                  />
                  <Legend />
                  <Bar isAnimationActive={false} dataKey="Einnahmen" fill="var(--color-success)" radius={[2, 2, 0, 0]} />
                  <Bar isAnimationActive={false} dataKey="Ausgaben" fill="var(--color-danger)" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <details className={styles.chartTable}>
            <summary>Monatswerte anzeigen</summary>
            <dl>{monthlyChartData.map((entry) => <div key={entry.fullName}><dt>{entry.fullName}</dt><dd><span>Einnahmen</span><strong>{formatCurrency(entry.Einnahmen)}</strong></dd><dd><span>Ausgaben</span><strong>{formatCurrency(entry.Ausgaben)}</strong></dd></div>)}</dl>
          </details>
        </section>
        <section className={styles.panel} aria-labelledby="eur-categories-heading">
          <div className={styles.panelHeader}><h3 id="eur-categories-heading">Ausgaben nach Kategorie</h3></div>
          <div className={styles.panelBody}>
            {categoryChartData.length ? <ul className={styles.categoryList}>{categoryChartData.map(entry => <li key={entry.name}><div><span>{entry.name}</span><strong>{formatCurrency(entry.value)}</strong></div><div className={styles.categoryTrack} aria-hidden="true"><span style={{ width: `${totalExpense > 0 ? Math.min(100, Math.max(0, entry.value / totalExpense * 100)) : 0}%` }} /></div></li>)}</ul> : <p className={styles.empty}>Noch keine steuerrelevanten Ausgaben.</p>}
          </div>
        </section>
      </div>

      {(privateWithdrawals > 0 || privateDeposits > 0) && (
        <section aria-labelledby="private-flows-heading" className={styles.privateFlows}>
          <div className={styles.panelHeader}>
            <h3 id="private-flows-heading">
              <DashboardIcon name="nav-cashbook" size={32} />
              Privatentnahmen und Privateinlagen
            </h3>

          </div>
          <dl className={styles.mobileAmounts}>
            <div><dt className="text-sm">Privatentnahmen</dt><dd className="shrink-0 font-medium tabular-nums">−{formatCurrency(privateWithdrawals)}</dd></div>
            <div><dt className="text-sm">Privateinlagen</dt><dd className="shrink-0 font-medium tabular-nums">+{formatCurrency(privateDeposits)}</dd></div>
            <div className="font-semibold"><dt>Saldo</dt><dd className="shrink-0 tabular-nums">{privateBalance >= 0 ? "+" : ""}{formatCurrency(privateBalance)}</dd></div>
          </dl>
          <div className={styles.note}>
            <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Nicht in der EÜR enthalten.</p>
          </div>
        </section>
      )}

      {depreciationDetails.length > 0 && (
        <section aria-labelledby="afa-heading" className={styles.sheet}>
          <div className={styles.panelHeader}>
            <h3 id="afa-heading">
              <DashboardIcon name="nav-assets" size={32} />
              Details zu Abschreibungen (AfA)
            </h3>
          </div>

          <div className={styles.depreciationMobile}>
            {depreciationDetails.map((item) => (
              <article key={item.id} className={styles.mobileRow}>
                <div>
                  <div className="min-w-0">
                    <h4 className="font-medium [overflow-wrap:anywhere]">{item.description}</h4>
                    <p>{new Date(item.date).toLocaleDateString("de-DE")}</p>
                  </div>
                  <strong className={styles.mobileValue}>{formatCurrency(item.currentYearAmount)}</strong>
                </div>
                <dl className={styles.rowDetails}>
                  <div><dt className="text-muted-foreground">Kosten</dt><dd className="mt-0.5 tabular-nums">{formatCurrency(item.totalAmount)}</dd></div>
                  <div><dt className="text-muted-foreground">Dauer</dt><dd className="mt-0.5">{item.years} Jahre</dd></div>
                  <div className={styles.calculation}><dt className="text-muted-foreground">Rechenweg</dt><dd className="mt-0.5 font-mono text-xs [overflow-wrap:anywhere]">{item.calculationExplanation}</dd></div>
                </dl>
              </article>
            ))}
          </div>

          <div className={styles.depreciationDesktop}>
            <Table className={`${styles.table} ${styles.depreciationTable}`}>
              <TableHeader>
                <TableRow>
                  <TableHead>Anschaffung</TableHead><TableHead>Datum</TableHead><TableHead className="text-right">Kosten</TableHead><TableHead className="text-center">Dauer</TableHead><TableHead className="text-right">Rechenweg</TableHead><TableHead className="text-right">Abzug {selectedTimeRange === "lastYear" ? "Vorjahr" : "aktuell"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {depreciationDetails.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.description}</TableCell>
                    <TableCell className="text-muted-foreground">{new Date(item.date).toLocaleDateString("de-DE")}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(item.totalAmount)}</TableCell>
                    <TableCell className="text-center">{item.years} Jahre</TableCell>
                    <TableCell className="max-w-[22rem] whitespace-normal text-right font-mono text-xs text-muted-foreground">{item.calculationExplanation}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-critical">{formatCurrency(item.currentYearAmount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className={styles.note}>Im Anschaffungsjahr zeitanteilig.</p>
        </section>
      )}

      {selectedTimeRange !== "thisYear" && selectedTimeRange !== "lastYear" && (
        <div className={styles.fiscalNote}>
          <Info aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium text-foreground">AfA-Berechnung nicht verfügbar</p>
            <p className="mt-1">Detaillierte Abschreibungen werden nur für „Aktuelles Jahr“ oder „Vorjahr“ berechnet. In anderen Zeiträumen gilt das Abflussprinzip mit dem vollen Betrag.</p>
          </div>
        </div>
      )}
    </div>
  );
}
