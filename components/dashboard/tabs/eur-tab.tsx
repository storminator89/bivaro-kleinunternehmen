"use client";

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { subMonths } from 'date-fns';
import { Expense, TimeRange, DepreciationDetail } from "@/types/dashboard";
import { formatCurrency } from "@/lib/dashboard-utils";

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#8dd1e1'];

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
  expensesAll: Expense[];
  depreciationDetails: DepreciationDetail[];
  selectedTimeRange: TimeRange;
  onExport: () => void;
};

export function EURTab({
  totalIncome,
  totalExpense,
  profit,
  monthlyChartData,
  categoryChartData,
  expensesAll,
  depreciationDetails,
  selectedTimeRange,
  onExport,
}: EURTabProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Einnahmen-Überschuss-Rechnung</h2>
          <p className="text-muted-foreground">Finanzielle Übersicht und steuerliche Auswertung.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onExport}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4-4m0 0l-4 4m4-4V4" />
            </svg>
            Exportieren
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Gesamteinnahmen</CardTitle>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{formatCurrency(totalIncome)}</div>
            <p className="text-xs text-muted-foreground">im gewählten Zeitraum</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Gesamtausgaben</CardTitle>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{formatCurrency(totalExpense)}</div>
            <p className="text-xs text-muted-foreground">im gewählten Zeitraum</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Gewinn / Verlust</CardTitle>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(profit)}</div>
            <p className="text-xs text-muted-foreground">Vorläufiges Ergebnis</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Einnahmen vs. Ausgaben</CardTitle>
            <CardDescription>Monatliche Übersicht (Cash-Flow)</CardDescription>
          </CardHeader>
          <CardContent className="pl-2">
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyChartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}€`} />
                  <RechartsTooltip 
                    formatter={(value: number) => formatCurrency(value)}
                    labelFormatter={(label) => {
                      const item = monthlyChartData.find(d => d.name === label);
                      return item ? item.fullName : label;
                    }}
                  />
                  <Legend />
                  <Bar dataKey="Einnahmen" fill="#16a34a" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Ausgaben" fill="#dc2626" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Ausgaben nach Kategorie</CardTitle>
            <CardDescription>Verteilung der Kosten</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {categoryChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip formatter={(value: number) => formatCurrency(value)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tables */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Income Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-green-700 flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Betriebseinnahmen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kategorie</TableHead>
                  <TableHead className="text-right">Betrag</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>Einnahmen (steuerpflichtig)</TableCell>
                  <TableCell className="text-right font-medium text-green-600">{formatCurrency(totalIncome)}</TableCell>
                </TableRow>
                <TableRow className="font-bold bg-muted/50">
                  <TableCell>Summe</TableCell>
                  <TableCell className="text-right text-green-600">{formatCurrency(totalIncome)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Expense Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-red-700 flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Betriebsausgaben
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kategorie</TableHead>
                  <TableHead className="text-right">Betrag</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from(
                  expensesAll.reduce((acc, expense) => {
                    if (!expense.taxRelevant) return acc;
                    
                    const expenseDate = new Date(expense.date);
                    const today = new Date();
                    let deductibleAmount = 0;
                    
                    if (selectedTimeRange === 'thisYear' || selectedTimeRange === 'lastYear') {
                      let targetYear = today.getFullYear();
                      if (selectedTimeRange === 'lastYear') targetYear = today.getFullYear() - 1;
                      
                      if (expense.depreciationYears && expense.depreciationYears > 0) {
                        const expenseYear = expenseDate.getFullYear();
                        const endYear = expenseYear + expense.depreciationYears;
                        if (targetYear >= expenseYear && targetYear < endYear) {
                          const yearlyDepreciation = expense.amount / expense.depreciationYears;
                          if (targetYear === expenseYear) {
                            const monthsLeft = 12 - expenseDate.getMonth();
                            deductibleAmount = (yearlyDepreciation / 12) * monthsLeft;
                          } else {
                            deductibleAmount = yearlyDepreciation;
                          }
                        }
                      } else {
                        if (expenseDate.getFullYear() === targetYear) deductibleAmount = expense.amount;
                      }
                    } else {
                      let include = false;
                      if (selectedTimeRange === 'all') include = true;
                      else if (selectedTimeRange === 'last3Months') include = expenseDate >= subMonths(today, 3);
                      else if (selectedTimeRange === 'last6Months') include = expenseDate >= subMonths(today, 6);
                      
                      if (include) deductibleAmount = expense.amount;
                    }

                    if (deductibleAmount > 0) {
                      const category = expense.category || 'Sonstiges';
                      const finalAmount = deductibleAmount * (expense.taxDeductiblePercentage || 100) / 100;
                      acc.set(category, (acc.get(category) || 0) + finalAmount);
                    }
                    return acc;
                  }, new Map<string, number>())
                ).map(([category, amount]) => (
                  <TableRow key={category}>
                    <TableCell>{category}</TableCell>
                    <TableCell className="text-right font-medium text-red-600">{formatCurrency(amount)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-bold bg-muted/50">
                  <TableCell>Summe</TableCell>
                  <TableCell className="text-right text-red-600">{formatCurrency(totalExpense)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* AfA Details */}
      {depreciationDetails.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Details zu Abschreibungen (AfA)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Anschaffung</TableHead>
                  <TableHead>Datum</TableHead>
                  <TableHead className="text-right">Kosten</TableHead>
                  <TableHead className="text-center">Dauer</TableHead>
                  <TableHead className="text-right">Rechenweg</TableHead>
                  <TableHead className="text-right">Abzug {selectedTimeRange === 'lastYear' ? 'Vorjahr' : 'aktuell'}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {depreciationDetails.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.description}</TableCell>
                    <TableCell className="text-muted-foreground">{new Date(item.date).toLocaleDateString('de-DE')}</TableCell>
                    <TableCell className="text-right">{formatCurrency(item.totalAmount)}</TableCell>
                    <TableCell className="text-center">{item.years} Jahre</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground font-mono">{item.calculationExplanation}</TableCell>
                    <TableCell className="text-right font-bold text-red-600">{formatCurrency(item.currentYearAmount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground mt-4">
              Hinweis: Im Anschaffungsjahr erfolgt die Abschreibung zeitanteilig (pro rata temporis).
            </p>
          </CardContent>
        </Card>
      )}
      
      {/* AfA Info Box if not yearly view */}
      {(selectedTimeRange !== 'thisYear' && selectedTimeRange !== 'lastYear') && (
        <div className="bg-muted/50 rounded-lg p-4 border text-sm text-muted-foreground flex items-start gap-3">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="font-medium text-foreground">AfA-Berechnung nicht verfügbar</p>
            <p className="mt-1 opacity-90">
              Detaillierte Abschreibungen werden nur in der Jahresansicht ("Aktuelles Jahr" oder "Vorjahr") berechnet und angezeigt. 
              In anderen Zeiträumen werden Ausgaben nach dem Abflussprinzip (voller Betrag) dargestellt.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
