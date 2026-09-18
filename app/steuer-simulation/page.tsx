"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRightLeft,
  Calculator,
  CircleHelp,
  Factory,
  AlertTriangle,
  Lightbulb,
  Loader2,
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
  const [numberOfChildren, setNumberOfChildren] = useState<number>(0);

  useEffect(() => {
    if (employmentType === "side-business" && autoCalcSocial) {
      // Beitragsbemessungsgrenzen 2025 (West)
      const bbG_KV = 66150;
      const bbG_RV = 96600;

      const salaryForKV = Math.min(grossSalary, bbG_KV);
      const salaryForRV = Math.min(grossSalary, bbG_RV);

      // Arbeitnehmeranteile (ca. Werte 2025)
      // KV: 7.3% + 0.85% (halber Zusatzbeitrag 1.7%) = 8.15%
      // RV: 9.3%
      // PV AN-Anteil 2025: kinderlos 2.40%, 1 Kind 1.80%, 2+ Kinder 1.55%
      const pvRate = numberOfChildren === 0 ? 0.024
        : numberOfChildren === 1 ? 0.018
          : 0.0155;

      setHealthInsurance(Math.round(salaryForKV * 0.0815));
      setPensionInsurance(Math.round(salaryForRV * 0.093));
      setCareInsurance(Math.round(salaryForKV * pvRate));
    }
  }, [grossSalary, employmentType, autoCalcSocial, numberOfChildren]);

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
  const tradeTaxCredit = Math.min(tradeTax, tradeTaxBaseAmount * 3.8, baseIncomeTax);

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

  const svBeitraege = healthInsurance + pensionInsurance + careInsurance;
  const totalNetIncome = employmentType === "side-business"
    ? grossSalary - svBeitraege + profit - totalTax
    : profit - totalTax;

  // Für UI-Anzeige
  const deductionsApplied = totalDeductions;
  const expenseCoverage = totalIncome > 0 ? totalExpenses / totalIncome : 0;

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



    if (taxableIncome > 12348 * 1.1) {
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
    setNumberOfChildren(0);
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-10">
        <header className="flex flex-col gap-6 border-b border-border pb-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-primary">
              <Calculator className="h-4 w-4" />
              <span>Auswertung / Steuer-Simulation</span>
            </div>
            <div className="max-w-2xl space-y-2">
              <h1 className="text-4xl font-semibold tracking-tight text-foreground">Steuer-Simulation</h1>
              <p className="max-w-xl text-base leading-relaxed text-muted-foreground">
                Spielen Sie Szenarien mit Ihren steuerrelevanten EÜR-Daten durch und sehen Sie direkt, wie sich Ihre Steuerlast verändert.
              </p>
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-64 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-2 sm:min-w-52">
              <Label htmlFor="timeRange" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Analysezeitraum
              </Label>
              <select
                id="timeRange"
                value={selectedTimeRange}
                onChange={(event) => setSelectedTimeRange(event.target.value as TimeRange)}
                className="block h-11 w-full rounded-[var(--radius-input)] border border-input bg-background px-3 text-sm shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
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
              aria-label="Finanzdaten neu laden"
              className="h-11 sm:aspect-square sm:w-11 sm:px-0"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span className="sm:sr-only">{loading ? "Aktualisiere" : "Neu laden"}</span>
            </Button>
          </div>
        </header>
        {error && (
          <div role="alert" className="rounded-[var(--radius-input)] border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <section aria-labelledby="overview-heading" className="grid gap-0 overflow-hidden rounded-[var(--radius-card)] border border-border bg-card lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.8fr)]">
          <div className="space-y-8 border-b border-border p-6 sm:p-8 lg:border-b-0 lg:border-r">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Überblick</p>
                <h2 id="overview-heading" className="mt-2 text-xl font-semibold">Gewinn laut EÜR</h2>
              </div>
              <TrendingUp className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            <div className="flex flex-wrap items-end justify-between gap-5">
              <p className={`text-5xl font-semibold tracking-tight tabular-nums ${profit >= 0 ? "text-primary" : "text-destructive"}`}>
                {formatCurrency(profit)}
              </p>
              <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
                Vor Steuern · nur steuerrelevante Einnahmen und Ausgaben
              </p>
            </div>
            <div className="space-y-2" aria-label="Verhältnis von Einnahmen und Ausgaben">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Einnahmen zu Ausgaben</span>
                <span className="tabular-nums">{totalIncome > 0 ? `${(expenseCoverage * 100).toFixed(0)} % Ausgabenanteil` : "Keine Einnahmen"}</span>
              </div>
              <div className="flex h-2 overflow-hidden rounded-full bg-secondary">
                <div className="bg-primary transition-[width] duration-300" style={{ width: `${Math.min(100, Math.max(0, expenseCoverage * 100))}%` }} />
              </div>
            </div>
          </div>
          <div className="space-y-6 bg-muted/25 p-6 sm:p-8">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <ArrowRightLeft className="h-4 w-4 text-primary" aria-hidden="true" />
              Datenbasis
            </div>
            <dl className="divide-y divide-border">
              <div className="flex items-center justify-between gap-4 py-3 first:pt-0">
                <dt className="text-sm text-muted-foreground">Betriebseinnahmen</dt>
                <dd className="text-right text-sm font-medium tabular-nums">{formatCurrency(totalIncome)}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3">
                <dt className="text-sm text-muted-foreground">Betriebsausgaben</dt>
                <dd className="text-right text-sm font-medium tabular-nums">{formatCurrency(totalExpenses)}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3 last:pb-0">
                <dt className="text-sm text-muted-foreground">Buchungen</dt>
                <dd className="text-right text-sm font-medium tabular-nums">{filteredIncomes.length + filteredExpenses.length}</dd>
              </div>
            </dl>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Zeitraum: {selectedTimeRange === "thisYear" ? "Aktuelles Jahr" : selectedTimeRange === "lastYear" ? "Vorjahr" : selectedTimeRange === "last3Months" ? "Letzte 3 Monate" : selectedTimeRange === "last6Months" ? "Letzte 6 Monate" : "Gesamter Zeitraum"}
            </p>
          </div>
        </section>

        <section aria-labelledby="parameters-heading" className="rounded-[var(--radius-card)] border border-border bg-card">
          <div className="flex flex-col gap-4 border-b border-border p-6 sm:flex-row sm:items-start sm:justify-between sm:p-8">
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Annahmen</p>
              <h2 id="parameters-heading" className="text-2xl font-semibold tracking-tight">Parameter für die Simulation</h2>
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">Passen Sie Vorsorge, Beschäftigungsverhältnis und Steuersätze an. Das Ergebnis aktualisiert sich sofort.</p>
            </div>
            <Button variant="ghost" onClick={resetDefaults} className="self-start text-muted-foreground">
              Standardwerte
            </Button>
          </div>
          <div className="space-y-8 p-6 sm:p-8">
            <div className="rounded-[var(--radius-input)] border border-border bg-muted/25 p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <Label className="text-base font-semibold">Beschäftigungsverhältnis</Label>
                  <p className="text-sm text-muted-foreground">
                    Führen Sie das Gewerbe haupt- oder nebenberuflich?
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-1 rounded-[var(--radius-input)] border border-border bg-background p-1">
                  <Button
                    variant={employmentType === "self-employed" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setEmploymentType("self-employed")}
                    aria-pressed={employmentType === "self-employed"}
                    className="gap-2"
                  >
                    <Factory className="h-4 w-4" />
                    Hauptberuflich
                  </Button>
                  <Button
                    variant={employmentType === "side-business" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setEmploymentType("side-business")}
                    aria-pressed={employmentType === "side-business"}
                    className="gap-2"
                  >
                    <Briefcase className="h-4 w-4" />
                    Nebenberuflich
                  </Button>
                </div>
              </div>

              {employmentType === "side-business" && (
                <div className="mt-6 grid gap-4 border-t border-border pt-6 md:grid-cols-2">
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
                      className="mt-2 bg-background"
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
                      className="mt-2 bg-background"
                    />
                  </div>
                </div>
              )}

              {employmentType === "side-business" && (
                <div className="mt-5 space-y-3">
                  <div className="flex items-start gap-2 rounded-[var(--radius-input)] border border-border bg-background p-3 text-sm">
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
                  {autoCalcSocial && (
                    <div className="rounded-[var(--radius-input)] border border-border bg-background p-4">
                      <ParameterLabel
                        htmlFor="numberOfChildren"
                        label="Anzahl Kinder (für PV-Beitrag)"
                        tooltip="Beeinflusst den Pflegeversicherungsbeitrag: Kinderlose zahlen 2,40%, mit 1 Kind 1,80%, ab 2 Kindern (unter 25) 1,55% Arbeitnehmeranteil."
                      />
                      <select
                        id="numberOfChildren"
                        value={numberOfChildren}
                        onChange={(event) => setNumberOfChildren(Number(event.target.value))}
                        className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value={0}>Keine Kinder (Zuschlag 0,6%)</option>
                        <option value={1}>1 Kind</option>
                        <option value={2}>2 oder mehr Kinder (unter 25)</option>
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
                <h3 className="font-semibold">Vorsorge und Abzüge</h3>
              </div>
              <div className="grid gap-5 border-t border-border pt-5 md:grid-cols-2 lg:grid-cols-3">
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
                  className="mt-2"
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
                  className="mt-2"
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
                  className="mt-2"
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
                  className="mt-2"
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
                  className="mt-2"
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
                  className="mt-2"
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
            </div>
            <div className="flex flex-col gap-3 rounded-[var(--radius-input)] border border-dashed border-border px-4 py-3 sm:flex-row sm:items-center">
              <p className="text-sm text-muted-foreground">
                Einkommensteuertarif 2026 · Grundfreibetrag 12.348 € berücksichtigt.
              </p>
            </div>
          </div>
        </section>

        <section aria-labelledby="result-heading" className="rounded-[var(--radius-card)] border border-border bg-card">
          <div className="border-b border-border p-6 sm:p-8">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Prognose</p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 id="result-heading" className="text-2xl font-semibold tracking-tight">Ergebnis der Simulation</h2>
                <p className="mt-1 text-sm text-muted-foreground">Vor- und nachsteuerliche Werte auf Basis Ihrer aktuellen Annahmen.</p>
              </div>
              <div className="text-left sm:text-right">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Netto {employmentType === "side-business" ? "aus Gewerbe" : "nach Steuern"}</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums text-primary">{formatCurrency(netProfitAfterTax)}</p>
              </div>
            </div>
          </div>
          <div className="space-y-6 p-6 sm:p-8">
            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <div className="flex items-center justify-between gap-4 border-b border-border pb-3">
                  <h3 className="font-semibold">Einkommen</h3>
                  <span className="text-xs text-muted-foreground">Berechnungsgrundlage</span>
                </div>
                <dl className="divide-y divide-border">
                  <div className="flex items-center justify-between gap-4 py-3">
                  <span className="text-sm text-muted-foreground">Einkünfte aus Gewerbe</span>
                  <span className="text-sm font-medium tabular-nums">{formatCurrency(profit)}</span>
                  </div>
                {employmentType === "side-business" && (
                  <div className="flex items-center justify-between gap-4 py-3">
                    <span className="text-sm text-muted-foreground">Einkünfte aus Anstellung</span>
                    <span className="text-sm font-medium tabular-nums">+ {formatCurrency(incomeFromEmployment)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-4 py-3">
                  <span className="text-sm text-muted-foreground">Sonderausgaben (Vorsorge etc.)</span>
                  <span className="text-sm font-medium tabular-nums">- {formatCurrency(deductionsApplied)}</span>
                </div>
                <div className="flex items-center justify-between gap-4 py-3">
                  <span className="text-sm text-muted-foreground">Zu versteuerndes Einkommen</span>
                  <span className="text-sm font-semibold tabular-nums">{formatCurrency(taxableIncome)}</span>
                </div>
                </dl>
              </div>
              <div>
                <div className="flex items-center justify-between gap-4 border-b border-border pb-3">
                  <h3 className="font-semibold">Steuerlast</h3>
                  <span className="text-xs text-muted-foreground">Effektiv</span>
                </div>
                <dl className="divide-y divide-border">
                <div className="flex items-center justify-between gap-4 py-3">
                  <span className="text-sm text-muted-foreground">
                    {employmentType === "side-business" ? "Steuer auf Gewerbe" : "Gesamte Steuerlast"}
                  </span>
                  <span className="text-sm font-semibold tabular-nums">{formatCurrency(marginalTax)}</span>
                </div>
                {employmentType === "side-business" && (
                  <div className="flex items-center justify-between gap-4 py-3 text-sm">
                    <span className="text-muted-foreground">Gesamtsteuer inkl. Job</span>
                    <span className="font-medium tabular-nums">{formatCurrency(totalTax)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-4 py-3">
                  <span className="text-sm text-muted-foreground">
                    {employmentType === "side-business" ? "Belastung Gewerbe" : "Effektiver Steuersatz"}
                  </span>
                  <span className="text-sm font-medium tabular-nums">
                    {profit > 0 ? `${effectiveTaxRate.toFixed(1)} %` : "-"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4 py-3">
                  <span className="text-sm text-muted-foreground">{employmentType === "side-business" ? "Netto vom Gewerbe" : "Netto nach Steuern"}</span>
                  <span className="text-sm font-semibold tabular-nums">{formatCurrency(netProfitAfterTax)}</span>
                </div>
                {employmentType === "side-business" && <div className="flex items-center justify-between gap-4 border-t border-border py-3"><span className="text-sm font-medium">Gesamtes Netto</span><span className="text-sm font-bold tabular-nums text-primary">{formatCurrency(totalNetIncome)}</span></div>}
                </dl>
              </div>
            </div>
            <div className="grid gap-px overflow-hidden rounded-[var(--radius-input)] border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
              {[['Einkommensteuer', finalIncomeTax], ['Solidaritätszuschlag', solidaritySurcharge], ['Kirchensteuer', churchTax], ['Gewerbesteuer', tradeTax]].map(([label, value]) => (
                <div key={label} className="bg-background px-4 py-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">{formatCurrency(value as number)}</p>
                </div>
              ))}
            </div>
            {profit < 0 && (
              <div className="rounded-[var(--radius-input)] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-100">
                Sie weisen aktuell einen Verlust aus. Nutzen Sie die Simulation, um zu prüfen, ab welchem Gewinn eine Steuerlast entsteht.
              </div>
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">
              Hinweis: Die Simulation ersetzt keine steuerliche Beratung. Für verbindliche Aussagen wenden Sie sich bitte an Ihre Steuerberatung.
            </p>
          </div>
        </section>

        <section aria-labelledby="recommendations-heading" className="rounded-[var(--radius-card)] border border-border bg-card">
          <div className="border-b border-border p-6 sm:p-8">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Nächste Schritte</p>
            <h2 id="recommendations-heading" className="mt-2 text-2xl font-semibold tracking-tight">Empfehlungen zur Steueroptimierung</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">Konkrete Ansatzpunkte aus Ihren aktuellen EÜR-Daten und Simulationseinstellungen.</p>
          </div>
          <div className="p-6 sm:p-8">
            <ul className="divide-y divide-border">
              {recommendations.map((rec, index) => {
                const Icon = recommendationIconMap[rec.tone];
                return (
                  <li
                    key={`${rec.title}-${index}`}
                    className="flex items-start gap-4 py-4 first:pt-0 last:pb-0"
                  >
                    <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${recommendationToneStyles[rec.tone]}`}>
                      <Icon className={`h-4 w-4 ${recommendationIconColor[rec.tone]}`} />
                    </span>
                    <div className="space-y-1">
                      <p className="font-medium text-foreground">{rec.title}</p>
                      <p className="text-sm text-muted-foreground leading-relaxed">{rec.description}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      </div>
    </TooltipProvider>
  );
}
