"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, BarChart3 } from "lucide-react";

interface MonthlyData {
  month: number;
  monthName: string;
  revenue: number;
  expenses: number;
  profit: number;
}

interface YearComparisonData {
  currentYear: number;
  lastYear: number;
  revenueThisYearTotal: number;
  revenueLastYearTotal: number;
  expensesThisYearTotal: number;
  expensesLastYearTotal: number;
  revenueThisYearToDate: number;
  revenueLastYearToDate: number;
  expensesThisYearToDate: number;
  expensesLastYearToDate: number;
  monthlyDataThisYear: MonthlyData[];
  monthlyDataLastYear: MonthlyData[];
}

interface YearComparisonProps {
  data: YearComparisonData;
}

interface ChartBarProps {
  month: MonthlyData;
  lastYearMonth: MonthlyData;
  thisYearHeight: number;
  lastYearHeight: number;
  isFuture: boolean;
  currentYear: number;
  lastYear: number;
  formatCurrency: (amount: number) => string;
}

function ChartBar({ month, lastYearMonth, thisYearHeight, lastYearHeight, isFuture, currentYear, lastYear, formatCurrency }: ChartBarProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const change = lastYearMonth.revenue > 0 
    ? ((month.revenue - lastYearMonth.revenue) / lastYearMonth.revenue * 100)
    : (month.revenue > 0 ? 100 : 0);
  const isPositive = change >= 0;

  return (
    <div 
      className="flex-1 flex flex-col items-center gap-1 relative"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-50 bg-popover border rounded-lg shadow-lg p-3 min-w-[180px] text-sm">
          <div className="font-semibold mb-2 text-center border-b pb-1">{month.monthName}</div>
          <div className="space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{lastYear}:</span>
              <span>{formatCurrency(lastYearMonth.revenue)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{currentYear}:</span>
              <span className="font-medium">{formatCurrency(month.revenue)}</span>
            </div>
            {!isFuture && (month.revenue > 0 || lastYearMonth.revenue > 0) && (
              <div className="flex justify-between pt-1 border-t mt-1">
                <span className="text-muted-foreground">Veränderung:</span>
                <span className={isPositive ? 'text-green-600' : 'text-red-600'}>
                  {isPositive ? '+' : ''}{change.toFixed(1)}%
                </span>
              </div>
            )}
          </div>
          {/* Tooltip Arrow */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-popover" />
        </div>
      )}
      <div className="flex gap-0.5 items-end h-24 w-full cursor-pointer">
        {/* Vorjahr */}
        <div
          className="flex-1 bg-muted rounded-t transition-all hover:bg-muted/80"
          style={{ height: `${lastYearHeight}%`, minHeight: lastYearMonth.revenue > 0 ? '4px' : '0' }}
        />
        {/* Aktuelles Jahr */}
        <div
          className={`flex-1 rounded-t transition-all ${isFuture ? 'bg-primary/20 hover:bg-primary/30' : 'bg-primary hover:bg-primary/80'}`}
          style={{ height: `${thisYearHeight}%`, minHeight: month.revenue > 0 ? '4px' : '0' }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground">{month.monthName}</span>
    </div>
  );
}

export function YearComparison({ data }: YearComparisonProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount);
  };

  const calculateChange = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  };

  const revenueChangeToDate = calculateChange(data.revenueThisYearToDate, data.revenueLastYearToDate);
  const expensesChangeToDate = calculateChange(data.expensesThisYearToDate, data.expensesLastYearToDate);
  const profitThisYear = data.revenueThisYearToDate - data.expensesThisYearToDate;
  const profitLastYear = data.revenueLastYearToDate - data.expensesLastYearToDate;
  const profitChange = calculateChange(profitThisYear, profitLastYear);

  // Max-Wert für die Bar-Skalierung
  const maxRevenue = Math.max(
    ...data.monthlyDataThisYear.map(m => m.revenue),
    ...data.monthlyDataLastYear.map(m => m.revenue),
    1
  );

  const currentMonth = new Date().getMonth();

  return (
    <Card className="bg-card border rounded-xl shadow-sm overflow-hidden">
      <div 
        className="flex items-center justify-between cursor-pointer p-4"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-lg font-semibold">Jahresvergleich</h2>
            <p className="text-sm text-muted-foreground">
              {data.currentYear} vs. {data.lastYear} • Einnahmen: {formatCurrency(data.revenueThisYearToDate)} ({revenueChangeToDate >= 0 ? '+' : ''}{revenueChangeToDate.toFixed(1)}%)
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon">
          {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </Button>
      </div>
      
      {isExpanded && (
      <CardContent className="pt-0">
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="overview">Übersicht</TabsTrigger>
            <TabsTrigger value="revenue">Einnahmen</TabsTrigger>
            <TabsTrigger value="expenses">Ausgaben</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            {/* KPI Karten */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <ComparisonCard
                title="Einnahmen"
                currentValue={data.revenueThisYearToDate}
                previousValue={data.revenueLastYearToDate}
                change={revenueChangeToDate}
                currentYear={data.currentYear}
                lastYear={data.lastYear}
                formatCurrency={formatCurrency}
                positiveIsGood={true}
              />
              <ComparisonCard
                title="Ausgaben"
                currentValue={data.expensesThisYearToDate}
                previousValue={data.expensesLastYearToDate}
                change={expensesChangeToDate}
                currentYear={data.currentYear}
                lastYear={data.lastYear}
                formatCurrency={formatCurrency}
                positiveIsGood={false}
              />
              <ComparisonCard
                title="Gewinn"
                currentValue={profitThisYear}
                previousValue={profitLastYear}
                change={profitChange}
                currentYear={data.currentYear}
                lastYear={data.lastYear}
                formatCurrency={formatCurrency}
                positiveIsGood={true}
              />
            </div>

            {/* Mini-Chart Übersicht */}
            <div className="mt-6">
              <h4 className="text-sm font-medium text-muted-foreground mb-3">Monatlicher Verlauf</h4>
              <div className="flex items-end gap-1 h-32">
                {data.monthlyDataThisYear.map((month, idx) => {
                  const lastYearMonth = data.monthlyDataLastYear[idx];
                  const thisYearHeight = (month.revenue / maxRevenue) * 100;
                  const lastYearHeight = (lastYearMonth.revenue / maxRevenue) * 100;
                  const isFuture = idx > currentMonth;

                  return (
                    <ChartBar
                      key={idx}
                      month={month}
                      lastYearMonth={lastYearMonth}
                      thisYearHeight={thisYearHeight}
                      lastYearHeight={lastYearHeight}
                      isFuture={isFuture}
                      currentYear={data.currentYear}
                      lastYear={data.lastYear}
                      formatCurrency={formatCurrency}
                    />
                  );
                })}
              </div>
              <div className="flex justify-center gap-6 mt-3 text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-muted rounded" />
                  <span>{data.lastYear}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-primary rounded" />
                  <span>{data.currentYear}</span>
                </div>
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
  change: number;
  currentYear: number;
  lastYear: number;
  formatCurrency: (amount: number) => string;
  positiveIsGood?: boolean;
}

function ComparisonCard({ title, currentValue, previousValue, change, currentYear, lastYear, formatCurrency, positiveIsGood = true }: ComparisonCardProps) {
  const isPositive = change >= 0;
  const isGood = positiveIsGood ? isPositive : !isPositive;

  return (
    <div className="p-4 rounded-lg border bg-card">
      <div className="text-sm font-medium text-muted-foreground">{title}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-bold">{formatCurrency(currentValue)}</span>
        <span className={`text-sm font-medium flex items-center gap-1 ${isGood ? 'text-green-600' : 'text-red-600'}`}>
          {isPositive ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          )}
          {Math.abs(change).toFixed(1)}%
        </span>
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
  positiveIsGood?: boolean;
}

function MonthlyComparisonTable({ 
  monthlyDataThisYear, 
  monthlyDataLastYear, 
  currentYear, 
  lastYear, 
  dataKey, 
  formatCurrency, 
  currentMonth,
  positiveIsGood = true 
}: MonthlyComparisonTableProps) {
  const calculateChange = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
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
            const change = calculateChange(currentValue, previousValue);
            const isPositive = change >= 0;
            const isGood = positiveIsGood ? isPositive : !isPositive;
            const isFuture = idx > currentMonth;

            return (
              <tr key={idx} className={`border-b ${isFuture ? 'text-muted-foreground/50' : ''}`}>
                <td className="py-2">{month.monthName}</td>
                <td className="text-right py-2">{formatCurrency(previousValue)}</td>
                <td className="text-right py-2 font-medium">{formatCurrency(currentValue)}</td>
                <td className={`text-right py-2 ${!isFuture && currentValue > 0 ? (isGood ? 'text-green-600' : 'text-red-600') : ''}`}>
                  {!isFuture && (currentValue > 0 || previousValue > 0) ? (
                    <span className="flex items-center justify-end gap-1">
                      {isPositive ? '+' : ''}{change.toFixed(1)}%
                    </span>
                  ) : (
                    '-'
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="font-bold border-t-2">
            <td className="py-2">Gesamt</td>
            <td className="text-right py-2">
              {formatCurrency(monthlyDataLastYear.reduce((sum, m) => sum + m[dataKey], 0))}
            </td>
            <td className="text-right py-2">
              {formatCurrency(monthlyDataThisYear.slice(0, currentMonth + 1).reduce((sum, m) => sum + m[dataKey], 0))}
            </td>
            <td className="text-right py-2">
              {(() => {
                const totalThis = monthlyDataThisYear.slice(0, currentMonth + 1).reduce((sum, m) => sum + m[dataKey], 0);
                const totalLast = monthlyDataLastYear.slice(0, currentMonth + 1).reduce((sum, m) => sum + m[dataKey], 0);
                const totalChange = calculateChange(totalThis, totalLast);
                const isPositive = totalChange >= 0;
                const isGood = positiveIsGood ? isPositive : !isPositive;
                return (
                  <span className={isGood ? 'text-green-600' : 'text-red-600'}>
                    {isPositive ? '+' : ''}{totalChange.toFixed(1)}%
                  </span>
                );
              })()}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
