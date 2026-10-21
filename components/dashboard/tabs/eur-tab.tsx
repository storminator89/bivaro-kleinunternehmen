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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/dashboard-utils";
import { DepreciationDetail, TimeRange } from "@/types/dashboard";

/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V4 */

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
    <div className="report-workspace min-w-0 space-y-6">
      <header className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight [overflow-wrap:anywhere]">
            Bericht und Export
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Nur steuerrelevante In-App-Buchungen.
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Button variant="outline" onClick={onExport} className="min-h-11 whitespace-nowrap">
            <Download aria-hidden="true" className="mr-2 h-4 w-4" />
            CSV exportieren
          </Button>
          <Button onClick={() => setShowElsterDialog(true)} aria-label="EÜR-Übertragungshilfe öffnen" className="min-h-11 whitespace-nowrap">
            <FileText aria-hidden="true" className="mr-2 h-4 w-4" />
            Übertragungshilfe
          </Button>
        </div>
      </header>

      <EURElsterExportDialog
        isOpen={showElsterDialog}
        onClose={() => setShowElsterDialog(false)}
      />

      <section className="report-balance" aria-label="Ergebnisübersicht">
        <div className="report-balance-result"><DashboardIcon name="tile-profit" size={48} className="mb-3" /><h3>{profit >= 0 ? 'Gewinn' : 'Verlust'}</h3><strong>{formatCurrency(profit)}</strong><span>Vorläufiges Ergebnis · vor Steuern</span></div>
        <dl><div><dt>Gesamteinnahmen</dt><dd>{formatCurrency(totalIncome)}</dd></div><div><dt>Gesamtausgaben</dt><dd>{formatCurrency(totalExpense)}</dd></div></dl>
      </section>

      <div className="grid min-w-0 gap-4 xl:grid-cols-7">
        <Card className="min-w-0 xl:col-span-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-3"><DashboardIcon name="tile-year-comparison" size={36} />Einnahmen und Ausgaben</CardTitle>
            <CardDescription>Monatlicher Cashflow</CardDescription>
          </CardHeader>
          <CardContent className="pl-2">
            <div className="h-[260px] min-w-0 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyChartData}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}€`} />
                  <RechartsTooltip
                    formatter={(value: number) => formatCurrency(value)}
                    labelFormatter={(label) => {
                      const item = monthlyChartData.find((entry) => entry.name === label);
                      return item ? item.fullName : label;
                    }}
                  />
                  <Legend />
                  <Bar isAnimationActive={false} dataKey="Einnahmen" fill="var(--color-success)" radius={[4, 4, 0, 0]} />
                  <Bar isAnimationActive={false} dataKey="Ausgaben" fill="var(--color-danger)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        <Card className="min-w-0 xl:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-3"><DashboardIcon name="tile-expenses" size={36} />Ausgaben nach Kategorie</CardTitle>
          </CardHeader>
          <CardContent>
            {categoryChartData.length ? <ul className="report-category-list">{categoryChartData.map(entry => <li key={entry.name}><div><span>{entry.name}</span><strong>{formatCurrency(entry.value)}</strong></div><div className="report-category-track" aria-hidden="true"><span style={{width: `${totalExpense > 0 ? Math.min(100, Math.max(0, entry.value / totalExpense * 100)) : 0}%`}} /></div></li>)}</ul> : <p className="report-empty">Noch keine steuerrelevanten Ausgaben.</p>}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4 lg:hidden">
        <section aria-labelledby="income-breakdown-mobile" className="overflow-hidden rounded-lg border">
          <div className="flex flex-col items-start gap-1 border-b bg-positive-surface px-4 py-3 text-positive-foreground sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <h3 id="income-breakdown-mobile" className="flex items-center gap-3 font-semibold"><DashboardIcon name="tile-incomes" size={32} />Betriebseinnahmen</h3>
            <span className="shrink-0 font-semibold tabular-nums">{formatCurrency(totalIncome)}</span>
          </div>
          <dl>
            <div className="flex items-center justify-between gap-4 px-4 py-4 text-sm">
              <dt>Einnahmen (steuerpflichtig)</dt>
              <dd className="shrink-0 font-medium tabular-nums text-positive">{formatCurrency(totalIncome)}</dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="expense-breakdown-mobile" className="overflow-hidden rounded-lg border">
          <div className="flex flex-col items-start gap-1 border-b bg-critical-surface px-4 py-3 text-critical-foreground sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <h3 id="expense-breakdown-mobile" className="flex items-center gap-3 font-semibold"><DashboardIcon name="tile-expenses" size={32} />Betriebsausgaben</h3>
            <span className="shrink-0 font-semibold tabular-nums">{formatCurrency(totalExpense)}</span>
          </div>
          {expenseCategories.length > 0 ? (
            <dl className="divide-y">
              {expenseCategories.map(({ name, value }) => (
                <div key={name} className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
                  <dt className="min-w-0 [overflow-wrap:anywhere]">{name}</dt>
                  <dd className="shrink-0 font-medium tabular-nums text-critical">{formatCurrency(value)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="px-4 py-5 text-sm text-muted-foreground">Keine steuerrelevanten Ausgaben in diesem Zeitraum.</p>
          )}
        </section>
      </div>

      <div className="hidden gap-4 lg:grid lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-positive">
              <DashboardIcon name="tile-incomes" size={32} />
              Betriebseinnahmen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Kategorie</TableHead><TableHead className="text-right">Betrag</TableHead></TableRow></TableHeader>
              <TableBody>
                <TableRow><TableCell>Einnahmen (steuerpflichtig)</TableCell><TableCell className="text-right font-medium tabular-nums text-positive">{formatCurrency(totalIncome)}</TableCell></TableRow>
                <TableRow className="bg-muted/50 font-semibold"><TableCell>Summe</TableCell><TableCell className="text-right tabular-nums text-positive">{formatCurrency(totalIncome)}</TableCell></TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-critical">
              <DashboardIcon name="tile-expenses" size={32} />
              Betriebsausgaben
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Kategorie</TableHead><TableHead className="text-right">Betrag</TableHead></TableRow></TableHeader>
              <TableBody>
                {expenseCategories.map(({ name, value }) => (
                  <TableRow key={name}><TableCell>{name}</TableCell><TableCell className="text-right font-medium tabular-nums text-critical">{formatCurrency(value)}</TableCell></TableRow>
                ))}
                <TableRow className="bg-muted/50 font-semibold"><TableCell>Summe</TableCell><TableCell className="text-right tabular-nums text-critical">{formatCurrency(totalExpense)}</TableCell></TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {(privateWithdrawals > 0 || privateDeposits > 0) && (
        <section aria-labelledby="private-flows-heading" className="overflow-hidden rounded-lg border border-caution/40 bg-caution-surface text-caution-foreground">
          <div className="border-b border-caution/30 px-4 py-4 sm:px-6">
            <h3 id="private-flows-heading" className="flex items-center gap-2 font-semibold">
              <DashboardIcon name="nav-cashbook" size={32} />
              Privatentnahmen und Privateinlagen
            </h3>

          </div>
          <dl className="divide-y divide-caution/25">
            <div className="flex items-center justify-between gap-4 px-4 py-3 sm:px-6"><dt className="text-sm">Privatentnahmen</dt><dd className="shrink-0 font-medium tabular-nums">−{formatCurrency(privateWithdrawals)}</dd></div>
            <div className="flex items-center justify-between gap-4 px-4 py-3 sm:px-6"><dt className="text-sm">Privateinlagen</dt><dd className="shrink-0 font-medium tabular-nums">+{formatCurrency(privateDeposits)}</dd></div>
            <div className="flex items-center justify-between gap-4 px-4 py-4 font-semibold sm:px-6"><dt>Saldo</dt><dd className="shrink-0 tabular-nums">{privateBalance >= 0 ? "+" : ""}{formatCurrency(privateBalance)}</dd></div>
          </dl>
          <div className="flex items-start gap-2 border-t border-caution/30 px-4 py-4 text-xs sm:px-6">
            <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Nicht in der EÜR enthalten.</p>
          </div>
        </section>
      )}

      {depreciationDetails.length > 0 && (
        <section aria-labelledby="afa-heading" className="overflow-hidden rounded-lg border">
          <div className="border-b px-4 py-4 sm:px-6">
            <h3 id="afa-heading" className="flex items-center gap-2 font-semibold">
              <DashboardIcon name="nav-assets" size={32} />
              Details zu Abschreibungen (AfA)
            </h3>
          </div>

          <div className="divide-y lg:hidden">
            {depreciationDetails.map((item) => (
              <article key={item.id} className="min-w-0 px-4 py-4 sm:px-6">
                <div className="flex min-w-0 items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h4 className="font-medium [overflow-wrap:anywhere]">{item.description}</h4>
                    <p className="mt-1 text-sm text-muted-foreground">{new Date(item.date).toLocaleDateString("de-DE")}</p>
                  </div>
                  <p className="shrink-0 font-semibold tabular-nums text-critical">{formatCurrency(item.currentYearAmount)}</p>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div><dt className="text-muted-foreground">Kosten</dt><dd className="mt-0.5 tabular-nums">{formatCurrency(item.totalAmount)}</dd></div>
                  <div><dt className="text-muted-foreground">Dauer</dt><dd className="mt-0.5">{item.years} Jahre</dd></div>
                  <div className="col-span-2 min-w-0"><dt className="text-muted-foreground">Rechenweg</dt><dd className="mt-0.5 font-mono text-xs [overflow-wrap:anywhere]">{item.calculationExplanation}</dd></div>
                </dl>
              </article>
            ))}
          </div>

          <div className="hidden lg:block">
            <Table>
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
          <p className="border-t px-4 py-3 text-xs text-muted-foreground sm:px-6">Im Anschaffungsjahr zeitanteilig.</p>
        </section>
      )}

      {selectedTimeRange !== "thisYear" && selectedTimeRange !== "lastYear" && (
        <div className="flex items-start gap-3 rounded-lg border bg-muted/50 p-4 text-sm text-muted-foreground">
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
