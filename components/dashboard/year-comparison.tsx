"use client";

import type { DashboardMonthlyData as MonthlyData, YearComparisonData } from "@/types/dashboard";
import { QueryFeedback } from "./query-feedback";
import { Label } from "@/components/ui/label";
import { TrendIndicator } from "./trend-indicator";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DashboardIcon } from "@/components/brand/dashboard-icon";
import { ChevronDown, ChevronUp, CalendarDays } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface YearComparisonProps {
  data: YearComparisonData;
  selectedYear: number;
  maxYear: number;
  onYearChange: (year: number) => void;
  isLoading: boolean;
  error: boolean;
  onRetry: () => void;
}

export function YearComparison({ data, selectedYear, maxYear, onYearChange, isLoading, error, onRetry }: YearComparisonProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [activeView, setActiveView] = useState('overview');

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount);
  };

  const profitThisYear = data.revenueThisYearToDate - data.expensesThisYearToDate;
  const profitLastYear = data.revenueLastYearToDate - data.expensesLastYearToDate;
  const currentMonth = data.comparisonThroughMonth ?? (data.currentYear < maxYear ? 11 : new Date().getMonth());

  return (
    <Card className="year-analysis overflow-hidden rounded-xl border-border/80 bg-card">
      <div className="year-analysis-heading">
      <button
        type="button"
        className="flex min-h-14 w-full items-center justify-between gap-3 border-b border-transparent text-left transition-colors hover:bg-secondary/40"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        aria-controls="year-comparison-content"
      >
        <div className="flex items-center gap-2">
          <DashboardIcon name="tile-year-comparison" size={36} />
          <div>
            <h2 className="text-lg font-semibold">Jahresvergleich</h2>
            <p className="text-sm text-muted-foreground">
              {selectedYear} und {selectedYear - 1} · {selectedYear === maxYear ? 'Vergleich bis zum heutigen Datum' : 'Vollständige Kalenderjahre'}
            </p>
          </div>
        </div>
        {isExpanded ? <ChevronUp className="h-5 w-5 shrink-0" aria-hidden="true" /> : <ChevronDown className="h-5 w-5 shrink-0" aria-hidden="true" />}
      </button>
      <div className="year-selector">
        <Label htmlFor="comparison-year" className="sr-only">Vergleichsjahr</Label>
        <CalendarDays aria-hidden="true" />
        <select id="comparison-year" value={selectedYear} onChange={event => onYearChange(Number(event.target.value))}>
          {Array.from({ length: maxYear - 1900 + 1 }, (_, index) => maxYear - index).map(year => <option key={year} value={year}>{year}</option>)}
        </select>
      </div>
      </div>
      {isExpanded && (isLoading || error) && <div id="year-comparison-content" aria-busy={isLoading}><QueryFeedback noun="Vergleichsdaten" isError={error && !isLoading} onRetry={onRetry} /></div>}
      {isExpanded && !isLoading && !error && (
        <CardContent id="year-comparison-content" className="pt-0">
          <Tabs value={activeView} onValueChange={setActiveView} className="space-y-4">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="overview">Übersicht</TabsTrigger>
              <TabsTrigger value="revenue">Einnahmen</TabsTrigger>
              <TabsTrigger value="expenses">Ausgaben</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              {/* KPI Karten */}
              <div className="year-summary-grid grid grid-cols-1 gap-4 sm:grid-cols-3">
                <ComparisonCard
                  title="Einnahmen"
                  currentValue={data.revenueThisYearToDate}
                  previousValue={data.revenueLastYearToDate}

                  currentYear={data.currentYear}
                  lastYear={data.lastYear}
                  formatCurrency={formatCurrency}
                  positiveIsGood={true}
                />
                <ComparisonCard
                  title="Ausgaben"
                  currentValue={data.expensesThisYearToDate}
                  previousValue={data.expensesLastYearToDate}

                  currentYear={data.currentYear}
                  lastYear={data.lastYear}
                  formatCurrency={formatCurrency}
                  positiveIsGood={false}
                />
                <ComparisonCard
                  title="Gewinn"
                  currentValue={profitThisYear}
                  previousValue={profitLastYear}

                  currentYear={data.currentYear}
                  lastYear={data.lastYear}
                  formatCurrency={formatCurrency}
                  positiveIsGood={true}
                />
              </div>

              {/* Mini-Chart Übersicht */}
              <div className="mt-6">
                <h4 className="text-sm font-medium text-muted-foreground mb-3">Monatlicher Verlauf</h4>
                <div className="annual-chart" role="img" aria-label={`Monatliche Einnahmen ${data.currentYear} und ${data.lastYear}. Alle Werte finden Sie auch im Reiter Einnahmen.`}>
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <BarChart data={data.monthlyDataThisYear.map((month, index) => ({
                      month: month.monthName.replace('.', ''),
                      current: month.revenue,
                      previous: data.monthlyDataLastYear[index]?.revenue ?? 0,
                    }))} margin={{ top: 12, right: 0, left: 0, bottom: 0 }} accessibilityLayer>
                      <CartesianGrid vertical={false} stroke="var(--color-rule)" />
                      <XAxis dataKey="month" axisLine={false} tickLine={false} tickMargin={10} minTickGap={8} />
                      <YAxis width={54} axisLine={false} tickLine={false} tickFormatter={value => `${new Intl.NumberFormat('de-DE', { notation: 'compact' }).format(Number(value))} €`} />
                      <Tooltip formatter={value => formatCurrency(Number(value))} cursor={{ fill: 'var(--color-paper-2)' }} />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ paddingTop: 'var(--space-md)', fontSize: 'var(--text-xs)' }} />
                      <Bar dataKey="previous" name={String(data.lastYear)} fill="var(--color-chart-previous)" radius={[3,3,0,0]} maxBarSize={20} isAnimationActive={false} />
                      <Bar dataKey="current" name={String(data.currentYear)} fill="var(--primary)" radius={[3,3,0,0]} maxBarSize={20} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="revenue" className="space-y-4">
              <MonthlyComparisonTable
                title="Einnahmen"
                monthlyDataThisYear={data.monthlyDataThisYear}
                monthlyDataLastYear={data.monthlyDataLastYear}
                currentYear={data.currentYear}
                lastYear={data.lastYear}
                dataKey="revenue"
                formatCurrency={formatCurrency}
                currentMonth={currentMonth}
                fullYear={data.period === 'fullYear'}
              />
            </TabsContent>

            <TabsContent value="expenses" className="space-y-4">
              <MonthlyComparisonTable
                title="Ausgaben"
                monthlyDataThisYear={data.monthlyDataThisYear}
                monthlyDataLastYear={data.monthlyDataLastYear}
                currentYear={data.currentYear}
                lastYear={data.lastYear}
                dataKey="expenses"
                formatCurrency={formatCurrency}
                currentMonth={currentMonth}
                fullYear={data.period === 'fullYear'}
                positiveIsGood={false}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      )}
    </Card>
  );
}

interface ComparisonCardProps {
  title: string;
  currentValue: number;
  previousValue: number;
  currentYear: number;
  lastYear: number;
  formatCurrency: (amount: number) => string;
  positiveIsGood?: boolean;
}

function ComparisonCard({ title, currentValue, previousValue, currentYear: _currentYear, lastYear, formatCurrency, positiveIsGood = true }: ComparisonCardProps) {

  return (
    <div className="year-comparison-stat">
      <div className="text-sm font-medium text-muted-foreground">{title}</div>
      <div className="mt-2 flex flex-wrap items-baseline gap-2">
        <span className="text-lg font-semibold tabular-nums">{formatCurrency(currentValue)}</span>
        <TrendIndicator current={currentValue} previous={previousValue} positiveIsGood={positiveIsGood} />
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {lastYear}: {formatCurrency(previousValue)}
      </div>
    </div>
  );
}

interface MonthlyComparisonTableProps {
  title: string;
  monthlyDataThisYear: MonthlyData[];
  monthlyDataLastYear: MonthlyData[];
  currentYear: number;
  lastYear: number;
  dataKey: 'revenue' | 'expenses' | 'profit';
  formatCurrency: (amount: number) => string;
  currentMonth: number;
  fullYear: boolean;
  positiveIsGood?: boolean;
}

function MonthlyComparisonTable({
  title,
  monthlyDataThisYear,
  monthlyDataLastYear,
  currentYear,
  lastYear,
  dataKey,
  formatCurrency,
  currentMonth,
  fullYear,
  positiveIsGood = true
}: MonthlyComparisonTableProps) {
  return (
    <div className="relative overflow-x-auto" role="region" aria-label={`Monatsvergleich ${title}: ${currentYear} und ${lastYear}`} tabIndex={0}>
      <table className="year-comparison-table w-full text-sm">
        <caption className="sr-only">Monatswerte und Veränderung für {title}</caption>
        <thead>
          <tr className="border-b">
            <th className="text-left py-2 font-medium">Monat</th>
            <th className="text-right py-2 font-medium">{lastYear}</th>
            <th className="text-right py-2 font-medium">{currentYear}</th>
            <th className="text-right py-2 font-medium">Veränderung</th>
          </tr>
        </thead>
        <tbody>
          {monthlyDataThisYear.map((month, idx) => {
            const lastYearMonth = monthlyDataLastYear[idx];
            const currentValue = month[dataKey];
            const previousValue = lastYearMonth[dataKey];
            const isFuture = idx > currentMonth;

            return (
              <tr key={idx} className={`border-b ${isFuture ? 'text-muted-foreground' : ''}`}>
                <td className="py-2">{month.monthName}</td>
                <td className="text-right py-2 tabular-nums">{formatCurrency(previousValue)}</td>
                <td className="text-right py-2 font-medium tabular-nums">{formatCurrency(currentValue)}</td>
                <td className="py-2 text-right">
                  {!isFuture ? <TrendIndicator current={currentValue} previous={previousValue} positiveIsGood={positiveIsGood} /> : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="font-bold border-t-2">
            <td className="py-2">{fullYear ? 'Gesamtjahr' : `Bis ${monthlyDataThisYear[currentMonth]?.monthName}`}</td>
            <td className="text-right py-2">
              {formatCurrency(monthlyDataLastYear.slice(0, currentMonth + 1).reduce((sum, m) => sum + m[dataKey], 0))}
            </td>
            <td className="text-right py-2">
              {formatCurrency(monthlyDataThisYear.slice(0, currentMonth + 1).reduce((sum, m) => sum + m[dataKey], 0))}
            </td>
            <td className="text-right py-2">
              {(() => {
                const totalThis = monthlyDataThisYear.slice(0, currentMonth + 1).reduce((sum, m) => sum + m[dataKey], 0);
                const totalLast = monthlyDataLastYear.slice(0, currentMonth + 1).reduce((sum, m) => sum + m[dataKey], 0);
                return <TrendIndicator current={totalThis} previous={totalLast} positiveIsGood={positiveIsGood} />;
              })()}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
