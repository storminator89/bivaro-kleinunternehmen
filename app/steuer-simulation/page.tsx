"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRightLeft,
  Calculator,
  CircleHelp,
  Factory,
  Loader2,
  PiggyBank,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { subMonths } from "date-fns";

type Expense = {
  id: number;
  description: string;
  amount: number;
  date: string;
  category?: string | null;
  taxRelevant: boolean;
  taxDeductiblePercentage?: number | null;
};

type Income = {
  id: number;
  description: string;
  amount: number;
  date: string;
  customerId?: number;
  customerName?: string | null;
  taxRelevant: boolean;
};

type TimeRange = "all" | "last3Months" | "last6Months" | "thisYear" | "lastYear";

const defaultSettings = {
  allowance: 10908, // Grundfreibetrag 2023/24
  additionalDeductions: 0,
  incomeTaxRate: 30,
  solidarityRate: 5.5,
  churchTaxRate: 8,
  tradeTaxRate: 0,
  includeSolidarity: true,
  includeChurchTax: false,
};

type ParameterLabelProps = {
  htmlFor: string;
  label: string;
  tooltip: string;
};

function ParameterLabel({ htmlFor, label, tooltip }: ParameterLabelProps) {
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="text-muted-foreground/80 hover:text-foreground transition-colors"
            aria-label={`${label} - Hilfe`}
          >
            <CircleHelp className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" align="start" className="max-w-xs text-sm">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

export default function SteuerSimulationPage() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTimeRange, setSelectedTimeRange] = useState<TimeRange>("thisYear");

  const [allowance, setAllowance] = useState<number>(defaultSettings.allowance);
  const [additionalDeductions, setAdditionalDeductions] = useState<number>(defaultSettings.additionalDeductions);
  const [incomeTaxRate, setIncomeTaxRate] = useState<number>(defaultSettings.incomeTaxRate);
  const [solidarityRate, setSolidarityRate] = useState<number>(defaultSettings.solidarityRate);
  const [churchTaxRate, setChurchTaxRate] = useState<number>(defaultSettings.churchTaxRate);
  const [tradeTaxRate, setTradeTaxRate] = useState<number>(defaultSettings.tradeTaxRate);
  const [includeSolidarity, setIncludeSolidarity] = useState<boolean>(defaultSettings.includeSolidarity);
  const [includeChurchTax, setIncludeChurchTax] = useState<boolean>(defaultSettings.includeChurchTax);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [expensesRes, incomesRes] = await Promise.all([
        fetch("/api/expenses?page=1&pageSize=10000"),
        fetch("/api/incomes?page=1&pageSize=10000"),
      ]);

      if (!expensesRes.ok || !incomesRes.ok) {
        throw new Error("Daten konnten nicht geladen werden.");
      }

      const [expensesJson, incomesJson] = await Promise.all([expensesRes.json(), incomesRes.json()]);
      setExpenses(expensesJson.items ?? []);
      setIncomes(incomesJson.items ?? []);
    } catch (err) {
      console.error("Fehler beim Laden der Finanzdaten:", err);
      setError("Die Finanzdaten konnten nicht geladen werden. Bitte versuchen Sie es erneut.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const shouldInclude = (isoDate: string) => {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) {
      return false;
    }
    if (selectedTimeRange === "all") {
      return true;
    }
    const today = new Date();
    if (selectedTimeRange === "last3Months") {
      const threshold = subMonths(today, 3);
      return date >= threshold;
    }
    if (selectedTimeRange === "last6Months") {
      const threshold = subMonths(today, 6);
      return date >= threshold;
    }
    if (selectedTimeRange === "thisYear") {
      return date.getFullYear() === today.getFullYear();
    }
    if (selectedTimeRange === "lastYear") {
      return date.getFullYear() === today.getFullYear() - 1;
    }
    return true;
  };

  const filteredIncomes = useMemo(
    () => incomes.filter((income) => income.taxRelevant && shouldInclude(income.date)),
    [incomes, selectedTimeRange]
  );

  const filteredExpenses = useMemo(
    () =>
      expenses.filter((expense) => expense.taxRelevant && shouldInclude(expense.date)),
    [expenses, selectedTimeRange]
  );

  const totalIncome = useMemo(
    () => filteredIncomes.reduce((sum, income) => sum + income.amount, 0),
    [filteredIncomes]
  );

  const totalExpenses = useMemo(
    () =>
      filteredExpenses.reduce((sum, expense) => {
        const percentage = expense.taxDeductiblePercentage ?? 100;
        return sum + expense.amount * (percentage / 100);
      }, 0),
    [filteredExpenses]
  );

  const profit = totalIncome - totalExpenses;
  const profitFloor = Math.max(0, profit);
  const totalDeductions = Math.max(0, allowance) + Math.max(0, additionalDeductions);
  const taxableProfit = Math.max(0, profitFloor - totalDeductions);
  const incomeTax = taxableProfit * (Math.max(0, incomeTaxRate) / 100);
  const solidaritySurcharge = includeSolidarity ? incomeTax * (Math.max(0, solidarityRate) / 100) : 0;
  const churchTax = includeChurchTax ? incomeTax * (Math.max(0, churchTaxRate) / 100) : 0;
  const tradeTax = taxableProfit * (Math.max(0, tradeTaxRate) / 100);
  const totalTax = incomeTax + solidaritySurcharge + churchTax + tradeTax;
  const netProfitAfterTax = profit - totalTax;
  const effectiveTaxRate = profit > 0 ? (totalTax / profit) * 100 : 0;
  const deductionsApplied = Math.min(profitFloor, totalDeductions);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value);

  const resetDefaults = () => {
    setAllowance(defaultSettings.allowance);
    setAdditionalDeductions(defaultSettings.additionalDeductions);
    setIncomeTaxRate(defaultSettings.incomeTaxRate);
    setSolidarityRate(defaultSettings.solidarityRate);
    setChurchTaxRate(defaultSettings.churchTaxRate);
    setTradeTaxRate(defaultSettings.tradeTaxRate);
    setIncludeSolidarity(defaultSettings.includeSolidarity);
    setIncludeChurchTax(defaultSettings.includeChurchTax);
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-8">
        <div className="grid gap-6 lg:grid-cols-[1.7fr_minmax(0,1fr)]">
          <Card className="relative overflow-hidden border-muted shadow-sm">
            <div className="absolute inset-y-0 right-0 w-1/2 bg-gradient-to-l from-primary/10 via-primary/5 to-transparent dark:from-primary/20" />
            <CardHeader className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="gap-1 border-primary/40 text-primary">
                  <Calculator className="h-3.5 w-3.5" />
                  Simulation
                </Badge>
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  EÜR basiert
                </span>
              </div>
              <CardTitle className="text-3xl font-semibold tracking-tight">Steuer-Simulation</CardTitle>
              <CardDescription className="text-base leading-relaxed text-muted-foreground">
                Loten Sie unterschiedliche Steuer-Szenarien aus, indem Sie Freibeträge, Zuschläge und Hebesätze variieren.
                Alle Werte basieren auf den steuerrelevanten Einnahmen und Ausgaben Ihrer EÜR.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-4 lg:gap-6">
              <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/60 px-4 py-3 text-sm text-muted-foreground">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <div>
                  <p className="font-medium text-foreground">Planungssicherheit</p>
                  <p>Finden Sie den Break-even für Ihre Steuerlast.</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/60 px-4 py-3 text-sm text-muted-foreground">
                <TrendingUp className="h-5 w-5 text-primary" />
                <div>
                  <p className="font-medium text-foreground">Datengestützt</p>
                  <p>Berechnungen greifen direkt auf Ihre Buchungen zu.</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-primary/30 bg-primary/5 shadow-sm backdrop-blur">
            <CardHeader className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-xl font-semibold">
                <ArrowRightLeft className="h-5 w-5 text-primary" />
                Zeitraum wählen
              </CardTitle>
              <CardDescription>
                Steuern Sie die Analyse nach Zeitraum und halten Sie Ihre Daten aktuell.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="timeRange" className="text-sm font-medium text-muted-foreground">
                  Zeitraum
                </Label>
                <select
                  id="timeRange"
                  value={selectedTimeRange}
                  onChange={(event) => setSelectedTimeRange(event.target.value as TimeRange)}
                  className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="thisYear">Aktuelles Jahr</option>
                  <option value="lastYear">Vorjahr</option>
                  <option value="last3Months">Letzte 3 Monate</option>
                  <option value="last6Months">Letzte 6 Monate</option>
                  <option value="all">Gesamter Zeitraum</option>
                </select>
              </div>
              <Button
                variant="outline"
                onClick={fetchData}
                disabled={loading}
                className="flex w-full items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Aktualisiere
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    Neu laden
                  </>
                )}
              </Button>
              <p className="text-xs text-muted-foreground">
                Tipp: Vergleichen Sie mehrere Zeiträume, um saisonale Schwankungen zu erkennen.
              </p>
            </CardContent>
          </Card>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <Card className="border border-primary/10 bg-gradient-to-br from-primary/10 via-background to-background shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                <PiggyBank className="h-5 w-5 text-primary" />
                Betriebseinnahmen
              </CardTitle>
              <CardDescription>Steuerpflichtige Einnahmen im gewählten Zeitraum</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold">{formatCurrency(totalIncome)}</p>
              <p className="text-sm text-muted-foreground mt-2">
                {filteredIncomes.length} Buchungen berücksichtigt
              </p>
            </CardContent>
          </Card>
          <Card className="border border-primary/10 bg-gradient-to-br from-primary/10 via-background to-background shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                <Factory className="h-5 w-5 text-primary" />
                Betriebsausgaben
              </CardTitle>
              <CardDescription>Für die Steuer ansetzbare Ausgaben</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold">{formatCurrency(totalExpenses)}</p>
              <p className="text-sm text-muted-foreground mt-2">
                {filteredExpenses.length} Buchungen berücksichtigt
              </p>
            </CardContent>
          </Card>
          <Card className="border border-primary/10 bg-gradient-to-br from-primary/10 via-background to-background shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                <TrendingUp className="h-5 w-5 text-primary" />
                Gewinn laut EÜR
              </CardTitle>
              <CardDescription>Vor Steuern</CardDescription>
            </CardHeader>
            <CardContent>
              <p className={`text-3xl font-semibold ${profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                {formatCurrency(profit)}
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                Enthält nur steuerrelevante Einnahmen und Ausgaben
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Parameter für die Simulation</CardTitle>
            <CardDescription>Legen Sie Freibeträge, Steuersätze und Zuschläge fest.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <div>
                <ParameterLabel
                  htmlFor="allowance"
                  label="Grundfreibetrag (EUR)"
                  tooltip="Jährlicher steuerfreier Betrag, der vom Gewinn abgezogen wird, bevor die Einkommensteuer berechnet wird."
                />
                <Input
                  id="allowance"
                  type="number"
                  inputMode="decimal"
                  value={allowance}
                  onChange={(event) => setAllowance(Number(event.target.value) || 0)}
                  min={0}
                  step={100}
                  className="mt-1"
                />
              </div>
              <div>
                <ParameterLabel
                  htmlFor="additionalDeductions"
                  label="Weitere abzugsfähige Beträge (EUR)"
                  tooltip="Zusätzliche Sonderausgaben oder Freibeträge (z. B. Krankenversicherung), die Sie vom Gewinn abziehen möchten."
                />
                <Input
                  id="additionalDeductions"
                  type="number"
                  inputMode="decimal"
                  value={additionalDeductions}
                  onChange={(event) => setAdditionalDeductions(Number(event.target.value) || 0)}
                  min={0}
                  step={100}
                  className="mt-1"
                />
              </div>
              <div>
                <ParameterLabel
                  htmlFor="incomeTaxRate"
                  label="Einkommensteuersatz (%)"
                  tooltip="Pauschaler Steuersatz für die Einkommensteuer. Für progressive Tarife können Sie einen Durchschnittswert eintragen."
                />
                <Input
                  id="incomeTaxRate"
                  type="number"
                  inputMode="decimal"
                  value={incomeTaxRate}
                  onChange={(event) => setIncomeTaxRate(Number(event.target.value) || 0)}
                  min={0}
                  max={99}
                  step={0.1}
                  className="mt-1"
                />
              </div>
              <div>
                <ParameterLabel
                  htmlFor="solidarityRate"
                  label="Solidaritätszuschlag (%)"
                  tooltip="Prozentsatz des Solidaritätszuschlags auf die festgesetzte Einkommensteuer. Kann deaktiviert werden, falls Sie unter der Freigrenze liegen."
                />
                <Input
                  id="solidarityRate"
                  type="number"
                  inputMode="decimal"
                  value={solidarityRate}
                  onChange={(event) => setSolidarityRate(Number(event.target.value) || 0)}
                  min={0}
                  max={20}
                  step={0.1}
                  className="mt-1"
                  disabled={!includeSolidarity}
                />
                <div className="mt-2 flex items-center gap-2">
                  <input
                    id="includeSolidarity"
                    type="checkbox"
                    className="h-4 w-4 rounded border border-input"
                    checked={includeSolidarity}
                    onChange={(event) => setIncludeSolidarity(event.target.checked)}
                  />
                  <Label htmlFor="includeSolidarity" className="text-sm text-muted-foreground">
                    Zuschlag berücksichtigen
                  </Label>
                </div>
              </div>
              <div>
                <ParameterLabel
                  htmlFor="churchTaxRate"
                  label="Kirchensteuer (%)"
                  tooltip="Prozentsatz der Kirchensteuer auf die Einkommensteuer, typischerweise 8% oder 9% abhängig vom Bundesland."
                />
                <Input
                  id="churchTaxRate"
                  type="number"
                  inputMode="decimal"
                  value={churchTaxRate}
                  onChange={(event) => setChurchTaxRate(Number(event.target.value) || 0)}
                  min={0}
                  max={15}
                  step={0.5}
                  className="mt-1"
                  disabled={!includeChurchTax}
                />
                <div className="mt-2 flex items-center gap-2">
                  <input
                    id="includeChurchTax"
                    type="checkbox"
                    className="h-4 w-4 rounded border border-input"
                    checked={includeChurchTax}
                    onChange={(event) => setIncludeChurchTax(event.target.checked)}
                  />
                  <Label htmlFor="includeChurchTax" className="text-sm text-muted-foreground">
                    Kirchensteuer berechnen
                  </Label>
                </div>
              </div>
              <div>
                <ParameterLabel
                  htmlFor="tradeTaxRate"
                  label="Gewerbesteuersatz (%)"
                  tooltip="Kommunaler Hebesatz für die Gewerbesteuer. Für Freiberufler oder nicht gewerbesteuerpflichtige Betriebe auf 0 setzen."
                />
                <Input
                  id="tradeTaxRate"
                  type="number"
                  inputMode="decimal"
                  value={tradeTaxRate}
                  onChange={(event) => setTradeTaxRate(Number(event.target.value) || 0)}
                  min={0}
                  max={20}
                  step={0.1}
                  className="mt-1"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-primary/30 bg-primary/5 px-4 py-3">
              <Button variant="secondary" onClick={resetDefaults}>
                Standardwerte wiederherstellen
              </Button>
              <p className="text-sm text-muted-foreground">
                Passen Sie die Werte an individuelle Situationen wie Krankenversicherung, Sonderausgaben oder kommunale Hebesätze an.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ergebnis der Simulation</CardTitle>
            <CardDescription>Vergleichen Sie vor- und nachsteuerliche Ergebnisse.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-border bg-muted/40 p-4 backdrop-blur-sm">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">EÜR-Gewinn</span>
                  <span className="text-base font-medium">{formatCurrency(profit)}</span>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Abzugsfähige Beträge</span>
                  <span className="text-base font-medium">- {formatCurrency(deductionsApplied)}</span>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Steuerpflichtiger Gewinn</span>
                  <span className="text-base font-semibold">{formatCurrency(taxableProfit)}</span>
                </div>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 p-4 backdrop-blur-sm">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Gesamte Steuerlast</span>
                  <span className="text-base font-semibold">{formatCurrency(totalTax)}</span>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Effektiver Steuersatz</span>
                  <span className="text-base font-medium">
                    {profit > 0 ? `${effectiveTaxRate.toFixed(1)} %` : "-"}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Netto nach Steuern</span>
                  <span className="text-base font-semibold">{formatCurrency(netProfitAfterTax)}</span>
                </div>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-md border border-border bg-background/80 px-3 py-4 shadow-sm">
                <p className="text-xs uppercase text-muted-foreground">Einkommensteuer</p>
                <p className="mt-1 text-lg font-semibold">{formatCurrency(incomeTax)}</p>
              </div>
              <div className="rounded-md border border-border bg-background/80 px-3 py-4 shadow-sm">
                <p className="text-xs uppercase text-muted-foreground">Solidaritätszuschlag</p>
                <p className="mt-1 text-lg font-semibold">{formatCurrency(solidaritySurcharge)}</p>
              </div>
              <div className="rounded-md border border-border bg-background/80 px-3 py-4 shadow-sm">
                <p className="text-xs uppercase text-muted-foreground">Kirchensteuer</p>
                <p className="mt-1 text-lg font-semibold">{formatCurrency(churchTax)}</p>
              </div>
              <div className="rounded-md border border-border bg-background/80 px-3 py-4 shadow-sm">
                <p className="text-xs uppercase text-muted-foreground">Gewerbesteuer</p>
                <p className="mt-1 text-lg font-semibold">{formatCurrency(tradeTax)}</p>
              </div>
            </div>
            {profit < 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-100">
                Sie weisen aktuell einen Verlust aus. Nutzen Sie die Simulation, um zu prüfen, ab welchem Gewinn eine Steuerlast entsteht.
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              Hinweis: Die Simulation ersetzt keine steuerliche Beratung. Für verbindliche Aussagen wenden Sie sich bitte an Ihre Steuerberatung.
            </p>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
