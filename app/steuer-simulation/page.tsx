"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRightLeft,
  Calculator,
  CircleHelp,
  Factory,
  AlertTriangle,
  Lightbulb,
  Loader2,
  PiggyBank,
  RefreshCw,
  ShieldCheck,
  ThumbsUp,
  TrendingUp,
  Briefcase,
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

import {
  calculateIncomeTax,
  calculateSolidaritySurcharge,
  calculateTradeTax,
  calculateChurchTax,
} from "@/lib/tax-calculator";

const defaultSettings = {
  healthInsurance: 4000,
  pensionInsurance: 0,
  careInsurance: 1000,
  otherDeductions: 0,
  tradeTaxHebesatz: 400,
  churchTaxRate: 8,
  includeSolidarity: true,
  includeChurchTax: false,
};

type ParameterLabelProps = {
  htmlFor: string;
  label: string;
  tooltip: string;
};

type Recommendation = {
  tone: "info" | "warning" | "positive";
  title: string;
  description: string;
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

  const [healthInsurance, setHealthInsurance] = useState<number>(defaultSettings.healthInsurance);
  const [pensionInsurance, setPensionInsurance] = useState<number>(defaultSettings.pensionInsurance);
  const [careInsurance, setCareInsurance] = useState<number>(defaultSettings.careInsurance);
  const [otherDeductions, setOtherDeductions] = useState<number>(defaultSettings.otherDeductions);
  const [tradeTaxHebesatz, setTradeTaxHebesatz] = useState<number>(defaultSettings.tradeTaxHebesatz);
  const [churchTaxRate, setChurchTaxRate] = useState<number>(defaultSettings.churchTaxRate);
  const [includeSolidarity, setIncludeSolidarity] = useState<boolean>(defaultSettings.includeSolidarity);
  const [includeChurchTax, setIncludeChurchTax] = useState<boolean>(defaultSettings.includeChurchTax);

  // Neue States für Angestelltenverhältnis
  const [employmentType, setEmploymentType] = useState<"self-employed" | "side-business">("self-employed");
  const [grossSalary, setGrossSalary] = useState<number>(50000);
  const [employeeExpenses, setEmployeeExpenses] = useState<number>(1230); // Werbungskostenpauschale 2024
  const [autoCalcSocial, setAutoCalcSocial] = useState<boolean>(true);

  useEffect(() => {
    if (employmentType === "side-business" && autoCalcSocial) {
      // Beitragsbemessungsgrenzen 2024 (West)
      const bbG_KV = 62100;
      const bbG_RV = 90600;

      const salaryForKV = Math.min(grossSalary, bbG_KV);
      const salaryForRV = Math.min(grossSalary, bbG_RV);

      // Arbeitnehmeranteile (ca. Werte 2024)
      // KV: 7.3% + 0.85% (halber Zusatzbeitrag 1.7%) = 8.15%
      // RV: 9.3%
      // PV: 2.3% (inkl. Kinderlosenzuschlag Anteil)

      setHealthInsurance(Math.round(salaryForKV * 0.0815));
      setPensionInsurance(Math.round(salaryForRV * 0.093));
      setCareInsurance(Math.round(salaryForKV * 0.023));
    }
  }, [grossSalary, employmentType, autoCalcSocial]);

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

  const shouldInclude = useCallback((isoDate: string) => {
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
  }, [selectedTimeRange]);

  const filteredIncomes = useMemo(
    () => incomes.filter((income) => income.taxRelevant && shouldInclude(income.date)),
    [incomes, shouldInclude]
  );

  const filteredExpenses = useMemo(
    () =>
      expenses.filter((expense) => expense.taxRelevant && shouldInclude(expense.date)),
    [expenses, shouldInclude]
  );

  const filteredIncomesAll = useMemo(
    () => incomes.filter((income) => shouldInclude(income.date)),
    [incomes, shouldInclude]
  );

  const filteredExpensesAll = useMemo(
    () => expenses.filter((expense) => shouldInclude(expense.date)),
    [expenses, shouldInclude]
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

  const partialDeductionShortfall = useMemo(
    () =>
      filteredExpensesAll.reduce((sum, expense) => {
        if (!expense.taxRelevant) {
          return sum;
        }
        const percentage = expense.taxDeductiblePercentage ?? 100;
        if (percentage >= 100) {
          return sum;
        }
        return sum + expense.amount * (1 - percentage / 100);
      }, 0),
    [filteredExpensesAll]
  );

  const nonTaxRelevantExpenses = useMemo(
    () => filteredExpensesAll.filter((expense) => !expense.taxRelevant),
    [filteredExpensesAll]
  );

  const nonTaxRelevantExpenseAmount = useMemo(
    () => nonTaxRelevantExpenses.reduce((sum, expense) => sum + expense.amount, 0),
    [nonTaxRelevantExpenses]
  );

  const nonTaxRelevantIncomes = useMemo(
    () => filteredIncomesAll.filter((income) => !income.taxRelevant),
    [filteredIncomesAll]
  );

  const nonTaxRelevantIncomeAmount = useMemo(
    () => nonTaxRelevantIncomes.reduce((sum, income) => sum + income.amount, 0),
    [nonTaxRelevantIncomes]
  );

  const profit = totalIncome - totalExpenses;
  const profitFloor = Math.max(0, profit);

  // 1. Gewerbesteuer
  const tradeTax = calculateTradeTax(profitFloor, tradeTaxHebesatz);

  // 2. Zu versteuerndes Einkommen (zvE)
  const totalDeductions = healthInsurance + pensionInsurance + careInsurance + otherDeductions;

  let incomeFromEmployment = 0;
  if (employmentType === "side-business") {
    incomeFromEmployment = Math.max(0, grossSalary - employeeExpenses);
  }

  const taxableIncome = Math.max(0, profitFloor + incomeFromEmployment - totalDeductions);

  // 3. Tarifliche Einkommensteuer
  const baseIncomeTax = calculateIncomeTax(taxableIncome);

  // 4. Gewerbesteueranrechnung (3,8-facher Messbetrag, max. die tatsächliche GewSt)
  // Messbetrag = (Gewinn - 24500) * 3.5%
  const tradeTaxBaseAmount = Math.max(0, profitFloor - 24500) * 0.035;
  const tradeTaxCredit = Math.min(tradeTax, tradeTaxBaseAmount * 3.8);

  const finalIncomeTax = Math.max(0, baseIncomeTax - tradeTaxCredit);

  // 5. Zuschläge
  const solidaritySurcharge = includeSolidarity ? calculateSolidaritySurcharge(finalIncomeTax) : 0;
  const churchTax = includeChurchTax ? calculateChurchTax(finalIncomeTax, churchTaxRate) : 0;

  const totalTax = finalIncomeTax + solidaritySurcharge + churchTax + tradeTax;

  // Berechnung der Grenzsteuerbelastung für Nebengewerbe
  let marginalTax = totalTax;
  let taxWithoutBusiness = 0;

  if (employmentType === "side-business") {
    // Steuerlast ohne Gewerbe berechnen (nur Job)
    const taxableIncomeBase = Math.max(0, incomeFromEmployment - totalDeductions);
    const baseIncomeTaxOnly = calculateIncomeTax(taxableIncomeBase);
    const baseSoli = includeSolidarity ? calculateSolidaritySurcharge(baseIncomeTaxOnly) : 0;
    const baseChurch = includeChurchTax ? calculateChurchTax(baseIncomeTaxOnly, churchTaxRate) : 0;

    taxWithoutBusiness = baseIncomeTaxOnly + baseSoli + baseChurch;
    marginalTax = totalTax - taxWithoutBusiness;
  }

  const netProfitAfterTax = employmentType === "side-business"
    ? profit - marginalTax
    : profit - totalTax;

  const effectiveTaxRate = profit > 0
    ? (marginalTax / profit) * 100
    : 0;

  const totalNetIncome = (profit + incomeFromEmployment) - totalTax;

  // Für UI-Anzeige
  const deductionsApplied = totalDeductions;
  const expenseCoverage = totalIncome > 0 ? totalExpenses / totalIncome : 0;
  const unusedAllowance = 0; // Nicht mehr relevant in neuer Logik

  const formatCurrency = useCallback((value: number) =>
    new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value), []);

  const recommendationToneStyles: Record<Recommendation["tone"], string> = {
    info: "border-primary/30 bg-primary/5",
    warning: "border-amber-300/60 bg-amber-100/40 dark:bg-amber-500/10",
    positive: "border-emerald-300/60 bg-emerald-100/30 dark:bg-emerald-500/10",
  };

  const recommendationIconMap: Record<Recommendation["tone"], LucideIcon> = {
    info: Lightbulb,
    warning: AlertTriangle,
    positive: ThumbsUp,
  };

  const recommendationIconColor: Record<Recommendation["tone"], string> = {
    info: "text-primary",
    warning: "text-amber-600 dark:text-amber-400",
    positive: "text-emerald-600 dark:text-emerald-400",
  };

  const recommendations = useMemo<Recommendation[]>(() => {
    const recs: Recommendation[] = [];

    if (profit < 0) {
      recs.push({
        tone: "warning",
        title: "Verluste strategisch nutzen",
        description: `Sie verzeichnen aktuell einen Verlust von ${formatCurrency(Math.abs(profit))}. Prüfen Sie Verlustvor- bzw. -rücktrag und passen Sie Vorauszahlungen an.`,
      });

      if (nonTaxRelevantExpenses.length > 0) {
        recs.push({
          tone: "info",
          title: "Nicht berücksichtigte Ausgaben analysieren",
          description: `${nonTaxRelevantExpenses.length} Ausgaben (${formatCurrency(nonTaxRelevantExpenseAmount)}) sind als nicht steuerrelevant markiert. Überprüfen Sie, ob sich Belege doch steuerlich ansetzen lassen.`,
        });
      }

      return recs;
    }

    if (profit === 0 && unusedAllowance > 0) {
      recs.push({
        tone: "info",
        title: "Freibeträge vollständig nutzen",
        description: `Ihr Gewinn wird aktuell vollständig durch Freibeträge gedeckt (${formatCurrency(unusedAllowance)} bleiben unverbraucht). Planen Sie Einnahmeverschiebungen oder Investitionen gezielt, um Steuervorteile optimal zu nutzen.`,
      });
    }

    if (taxableIncome > 11604 * 1.1) {
      recs.push({
        tone: "info",
        title: "Zusätzliche Abzugsmöglichkeiten prüfen",
        description: `Das zu versteuernde Einkommen liegt bei ${formatCurrency(taxableIncome)}. Investitionsabzugsbetrag, Sonderabschreibungen oder Vorsorgeaufwendungen können die Steuerlast weiter verkleinern.`,
      });
    }

    if (totalDeductions < 5000 && profit > 20000) {
      recs.push({
        tone: "info",
        title: "Vorsorgeaufwendungen prüfen",
        description: "Ihre angesetzten Vorsorgeaufwendungen erscheinen niedrig. Prüfen Sie, ob Kranken-, Pflege- und Rentenversicherungsbeiträge vollständig erfasst sind.",
      });
    }

    if (totalIncome > 0 && expenseCoverage < 0.35) {
      recs.push({
        tone: "positive",
        title: "Zukunftsinvestitionen vorziehen",
        description: `Nur ${(expenseCoverage * 100).toFixed(0)} % der Einnahmen sind aktuell als abzugsfähige Ausgaben verbucht. Moderne Betriebsinvestitionen oder Wartungsausgaben könnten den Gewinn steuerlich abfedern.`,
      });
    }

    if (partialDeductionShortfall > 250) {
      recs.push({
        tone: "warning",
        title: "Teilabzugsfähige Ausgaben optimieren",
        description: `Bei Ausgaben bleiben ${formatCurrency(partialDeductionShortfall)} ungenutzt, weil nur ein Teil steuerlich ansetzbar ist. Prüfen Sie alternative Gestaltung (z. B. separates Arbeitszimmer, betriebliches Fahrzeug).`,
      });
    }

    if (nonTaxRelevantExpenses.length > 0) {
      recs.push({
        tone: "info",
        title: "Nicht steuerrelevante Kosten bewerten",
        description: `${nonTaxRelevantExpenses.length} Ausgaben (${formatCurrency(nonTaxRelevantExpenseAmount)}) werden steuerlich nicht berücksichtigt. Stellen Sie sicher, dass die Zuordnung korrekt ist oder dokumentieren Sie private Anteile sauber.`,
      });
    }

    if (nonTaxRelevantIncomes.length > 0 && nonTaxRelevantIncomeAmount > 0) {
      recs.push({
        tone: "warning",
        title: "Steuerfreie Einnahmen plausibilisieren",
        description: `${nonTaxRelevantIncomes.length} Einnahmen in Höhe von ${formatCurrency(nonTaxRelevantIncomeAmount)} sind als steuerfrei klassifiziert. Prüfen Sie, ob alle Voraussetzungen (z. B. echte Privatverkäufe) erfüllt sind.`,
      });
    }

    if (tradeTaxHebesatz < 200 && profit > 24500) {
      recs.push({
        tone: "warning",
        title: "Gewerbesteuer-Hebesatz prüfen",
        description: `Der eingestellte Hebesatz von ${tradeTaxHebesatz}% erscheint niedrig. Der Mindesthebesatz liegt in der Regel bei 200%. Prüfen Sie den Hebesatz Ihrer Gemeinde.`,
      });
    }

    if (profit > 0 && effectiveTaxRate > 45) {
      recs.push({
        tone: "info",
        title: "Hohe Grenzsteuerbelastung",
        description: `Die effektive Belastung von ${effectiveTaxRate.toFixed(1)} % resultiert aus der Progression. Da Ihr Hauptgehalt den Grundfreibetrag bereits ausschöpft, unterliegt der Gewerbegewinn direkt dem Spitzensteuersatz (zzgl. evtl. Soli/Kirchensteuer).`,
      });
    }

    if (employmentType === "side-business" && taxableIncome > 66760) {
      recs.push({
        tone: "warning",
        title: "Progressionseffekt beachten",
        description: `Durch Ihr Gehalt und den Gewinn rutschen Sie in einen höheren Steuersatz. Jeder zusätzliche Euro Gewinn wird mit dem Grenzsteuersatz (ca. 42%) belastet.`,
      });
    }

    if (recs.length === 0) {
      recs.push({
        tone: "positive",
        title: "Aktuelle Struktur wirkt effizient",
        description: "Es wurden keine offensichtlichen Optimierungspotenziale erkannt. Dokumentieren Sie die Annahmen für die Steuerberatung und prüfen Sie regelmäßig neue Investitions- oder Vorsorgechancen.",
      });
    }

    return recs;
  }, [
    effectiveTaxRate,
    expenseCoverage,
    formatCurrency,
    nonTaxRelevantExpenseAmount,
    nonTaxRelevantExpenses,
    nonTaxRelevantIncomeAmount,
    nonTaxRelevantIncomes,
    partialDeductionShortfall,
    profit,
    taxableIncome,
    totalDeductions,
    totalIncome,
    tradeTaxHebesatz,
    unusedAllowance,
    employmentType,
  ]);

  const resetDefaults = () => {
    setHealthInsurance(defaultSettings.healthInsurance);
    setPensionInsurance(defaultSettings.pensionInsurance);
    setCareInsurance(defaultSettings.careInsurance);
    setOtherDeductions(defaultSettings.otherDeductions);
    setTradeTaxHebesatz(defaultSettings.tradeTaxHebesatz);
    setChurchTaxRate(defaultSettings.churchTaxRate);
    setIncludeSolidarity(defaultSettings.includeSolidarity);
    setIncludeChurchTax(defaultSettings.includeChurchTax);
    setEmploymentType("self-employed");
    setGrossSalary(50000);
    setEmployeeExpenses(1230);
    setAutoCalcSocial(true);
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
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <Label className="text-base font-semibold">Beschäftigungsverhältnis</Label>
                  <p className="text-sm text-muted-foreground">
                    Führen Sie das Gewerbe haupt- oder nebenberuflich?
                  </p>
                </div>
                <div className="flex items-center gap-2 rounded-lg border bg-background p-1">
                  <Button
                    variant={employmentType === "self-employed" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setEmploymentType("self-employed")}
                    className="gap-2"
                  >
                    <Factory className="h-4 w-4" />
                    Hauptberuflich
                  </Button>
                  <Button
                    variant={employmentType === "side-business" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setEmploymentType("side-business")}
                    className="gap-2"
                  >
                    <Briefcase className="h-4 w-4" />
                    Nebenberuflich
                  </Button>
                </div>
              </div>

              {employmentType === "side-business" && (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <ParameterLabel
                      htmlFor="grossSalary"
                      label="Bruttojahresgehalt (EUR)"
                      tooltip="Ihr Bruttoarbeitslohn aus der nichtselbstständigen Hauptbeschäftigung."
                    />
                    <Input
                      id="grossSalary"
                      type="number"
                      inputMode="decimal"
                      value={grossSalary}
                      onChange={(event) => setGrossSalary(Number(event.target.value) || 0)}
                      min={0}
                      step={1000}
                      className="mt-1 bg-background"
                    />
                  </div>
                  <div>
                    <ParameterLabel
                      htmlFor="employeeExpenses"
                      label="Werbungskosten (EUR)"
                      tooltip="Werbungskosten aus nichtselbstständiger Arbeit (Pauschbetrag 2024: 1.230 €)."
                    />
                    <Input
                      id="employeeExpenses"
                      type="number"
                      inputMode="decimal"
                      value={employeeExpenses}
                      onChange={(event) => setEmployeeExpenses(Number(event.target.value) || 0)}
                      min={0}
                      step={10}
                      className="mt-1 bg-background"
                    />
                  </div>
                </div>
              )}

              {employmentType === "side-business" && (
                <div className="mt-4 flex items-center gap-2 rounded-md bg-muted/50 p-3 text-sm">
                  <input
                    id="autoCalcSocial"
                    type="checkbox"
                    className="h-4 w-4 rounded border border-input"
                    checked={autoCalcSocial}
                    onChange={(event) => setAutoCalcSocial(event.target.checked)}
                  />
                  <Label htmlFor="autoCalcSocial" className="font-normal">
                    Sozialversicherungsbeiträge automatisch aus Bruttogehalt berechnen
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <CircleHelp className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      Berechnet die abzugsfähigen Vorsorgeaufwendungen (KV, RV, PV) basierend auf Ihrem Bruttogehalt automatisch. Diese mindern Ihre Steuerlast.
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <div>
                <ParameterLabel
                  htmlFor="healthInsurance"
                  label="Krankenversicherung (EUR)"
                  tooltip="Jährliche Beiträge zur Krankenversicherung (Basisabsicherung)."
                />
                <Input
                  id="healthInsurance"
                  type="number"
                  inputMode="decimal"
                  value={healthInsurance}
                  onChange={(event) => setHealthInsurance(Number(event.target.value) || 0)}
                  min={0}
                  step={100}
                  className="mt-1"
                  disabled={employmentType === "side-business" && autoCalcSocial}
                />
              </div>
              <div>
                <ParameterLabel
                  htmlFor="pensionInsurance"
                  label="Rentenversicherung (EUR)"
                  tooltip="Jährliche Beiträge zur gesetzlichen oder privaten Rentenversicherung (Rürup)."
                />
                <Input
                  id="pensionInsurance"
                  type="number"
                  inputMode="decimal"
                  value={pensionInsurance}
                  onChange={(event) => setPensionInsurance(Number(event.target.value) || 0)}
                  min={0}
                  step={100}
                  className="mt-1"
                  disabled={employmentType === "side-business" && autoCalcSocial}
                />
              </div>
              <div>
                <ParameterLabel
                  htmlFor="careInsurance"
                  label="Pflegeversicherung (EUR)"
                  tooltip="Jährliche Beiträge zur Pflegeversicherung."
                />
                <Input
                  id="careInsurance"
                  type="number"
                  inputMode="decimal"
                  value={careInsurance}
                  onChange={(event) => setCareInsurance(Number(event.target.value) || 0)}
                  min={0}
                  step={50}
                  className="mt-1"
                  disabled={employmentType === "side-business" && autoCalcSocial}
                />
              </div>
              <div>
                <ParameterLabel
                  htmlFor="otherDeductions"
                  label="Sonstige Sonderausgaben (EUR)"
                  tooltip="Weitere abzugsfähige Beträge (z. B. Spenden, Kirchensteuer-Vorauszahlung)."
                />
                <Input
                  id="otherDeductions"
                  type="number"
                  inputMode="decimal"
                  value={otherDeductions}
                  onChange={(event) => setOtherDeductions(Number(event.target.value) || 0)}
                  min={0}
                  step={100}
                  className="mt-1"
                />
              </div>
              <div>
                <ParameterLabel
                  htmlFor="tradeTaxHebesatz"
                  label="Gewerbesteuer-Hebesatz (%)"
                  tooltip="Kommunaler Hebesatz für die Gewerbesteuer (mind. 200%)."
                />
                <Input
                  id="tradeTaxHebesatz"
                  type="number"
                  inputMode="decimal"
                  value={tradeTaxHebesatz}
                  onChange={(event) => setTradeTaxHebesatz(Number(event.target.value) || 0)}
                  min={0}
                  max={1000}
                  step={10}
                  className="mt-1"
                />
              </div>
              <div>
                <ParameterLabel
                  htmlFor="churchTaxRate"
                  label="Kirchensteuer (%)"
                  tooltip="Prozentsatz der Kirchensteuer auf die Einkommensteuer (8% oder 9%)."
                />
                <Input
                  id="churchTaxRate"
                  type="number"
                  inputMode="decimal"
                  value={churchTaxRate}
                  onChange={(event) => setChurchTaxRate(Number(event.target.value) || 0)}
                  min={0}
                  max={9}
                  step={1}
                  className="mt-1"
                  disabled={!includeChurchTax}
                />
                <div className="mt-2 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
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
                  <div className="flex items-center gap-2">
                    <input
                      id="includeSolidarity"
                      type="checkbox"
                      className="h-4 w-4 rounded border border-input"
                      checked={includeSolidarity}
                      onChange={(event) => setIncludeSolidarity(event.target.checked)}
                    />
                    <Label htmlFor="includeSolidarity" className="text-sm text-muted-foreground">
                      Soli berechnen
                    </Label>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-primary/30 bg-primary/5 px-4 py-3">
              <Button variant="secondary" onClick={resetDefaults}>
                Standardwerte wiederherstellen
              </Button>
              <p className="text-sm text-muted-foreground">
                Die Berechnung basiert auf dem Einkommensteuertarif 2024 (Grundfreibetrag 11.604 € berücksichtigt).
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
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Einkünfte aus Gewerbe</span>
                  <span className="text-base font-medium">{formatCurrency(profit)}</span>
                </div>
                {employmentType === "side-business" && (
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Einkünfte aus Anstellung</span>
                    <span className="text-base font-medium">+ {formatCurrency(incomeFromEmployment)}</span>
                  </div>
                )}
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Sonderausgaben (Vorsorge etc.)</span>
                  <span className="text-base font-medium">- {formatCurrency(deductionsApplied)}</span>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Zu versteuerndes Einkommen</span>
                  <span className="text-base font-semibold">{formatCurrency(taxableIncome)}</span>
                </div>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 p-4 backdrop-blur-sm">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {employmentType === "side-business" ? "Steuer auf Gewerbe" : "Gesamte Steuerlast"}
                  </span>
                  <span className="text-base font-semibold">{formatCurrency(marginalTax)}</span>
                </div>
                {employmentType === "side-business" && (
                  <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span>(Gesamtsteuer inkl. Job: {formatCurrency(totalTax)})</span>
                  </div>
                )}
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {employmentType === "side-business" ? "Belastung Gewerbe" : "Effektiver Steuersatz"}
                  </span>
                  <span className="text-base font-medium">
                    {profit > 0 ? `${effectiveTaxRate.toFixed(1)} %` : "-"}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {employmentType === "side-business" ? "Netto vom Gewerbe" : "Netto nach Steuern"}
                  </span>
                  <span className="text-base font-semibold">{formatCurrency(netProfitAfterTax)}</span>
                </div>
                {employmentType === "side-business" && (
                  <div className="mt-3 border-t pt-2 flex items-center justify-between">
                    <span className="text-sm font-medium">Gesamtes Netto</span>
                    <span className="text-base font-bold text-primary">{formatCurrency(totalNetIncome)}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-md border border-border bg-background/80 px-3 py-4 shadow-sm">
                <p className="text-xs uppercase text-muted-foreground">Einkommensteuer</p>
                <p className="mt-1 text-lg font-semibold">{formatCurrency(finalIncomeTax)}</p>
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

        <Card className="border-primary/20 shadow-sm">
          <CardHeader className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-1 border-primary/40 text-primary">
                Optimierung
              </Badge>
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Handlungsempfehlungen
              </span>
            </div>
            <CardTitle>Empfehlungen zur Steueroptimierung</CardTitle>
            <CardDescription>
              Konkrete Ansatzpunkte basierend auf Ihren aktuellen EÜR-Daten und Simulationseinstellungen.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {recommendations.map((rec, index) => {
                const Icon = recommendationIconMap[rec.tone];
                return (
                  <li
                    key={`${rec.title}-${index}`}
                    className={`flex items-start gap-3 rounded-lg border px-4 py-3 backdrop-blur-sm ${recommendationToneStyles[rec.tone]}`}
                  >
                    <Icon className={`mt-0.5 h-5 w-5 ${recommendationIconColor[rec.tone]}`} />
                    <div className="space-y-1">
                      <p className="font-medium text-foreground">{rec.title}</p>
                      <p className="text-sm text-muted-foreground leading-relaxed">{rec.description}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
