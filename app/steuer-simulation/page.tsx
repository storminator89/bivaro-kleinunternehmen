"use client";

import { PageHeader } from "@/components/page-header";
import { useEffect, useMemo, useState, useCallback, useRef, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import styles from "@/components/public-accounting/accounting-workspaces.module.css";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { LucideIcon } from "lucide-react";
import {
  CircleHelp,
  Factory,
  AlertTriangle,
  Lightbulb,
  Loader2,
  RefreshCw,
  ShieldCheck,
  ThumbsUp,
  Briefcase,
  ChevronDown,
  ArrowUpRight,
} from "lucide-react";
type TimeRange = "all" | "last3Months" | "last6Months" | "thisYear" | "lastYear";

import {
  calculateIncomeTax,
  calculateSolidaritySurcharge,
  calculateTradeTaxDetails,
  calculateTradeTaxCredit,
  calculateChurchTax,
  getTaxRulePack,
} from "@/lib/tax-calculator";
import type { TaxSummary } from "@/lib/tax-summary";
import { connectPaymentRefreshBridge, PAYMENT_DASHBOARD_REFRESH_EVENT } from '@/lib/payment-dashboard-refresh';
import { simulationInputErrors, simulationNumberError, simulationNumberRules, type SimulationNumberField } from "./validation";

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
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
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

type SimulationNumberInputProps = Omit<ComponentProps<typeof Input>, "id" | "value"> & {
  id: SimulationNumberField;
  value: number;
};

function SimulationNumberInput({ id, value, disabled, ...props }: SimulationNumberInputProps) {
  const error = disabled ? null : simulationNumberError(id, value);
  const rules = simulationNumberRules[id];
  return (
    <>
      <Input
        {...props}
        id={id}
        value={Number.isFinite(value) ? value : ""}
        min={rules.min}
        max={"max" in rules ? rules.max : undefined}
        step={rules.step}
        required
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && <p id={`${id}-error`} className="mt-2 text-sm text-destructive" role="alert">{error}</p>}
    </>
  );
}

export default function SteuerSimulationPage() {
  const [summary, setSummary] = useState<TaxSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTimeRange, setSelectedTimeRange] = useState<TimeRange>("thisYear");
  const [taxYear, setTaxYear] = useState<number>(new Date().getFullYear());
  const requestVersion = useRef(0);

  const [healthInsurance, setHealthInsurance] = useState<number>(defaultSettings.healthInsurance);
  const [pensionInsurance, setPensionInsurance] = useState<number>(defaultSettings.pensionInsurance);
  const [careInsurance, setCareInsurance] = useState<number>(defaultSettings.careInsurance);
  const [otherDeductions, setOtherDeductions] = useState<number>(defaultSettings.otherDeductions);
  const [tradeTaxHebesatz, setTradeTaxHebesatz] = useState<number>(defaultSettings.tradeTaxHebesatz);
  const [churchTaxRate, setChurchTaxRate] = useState<number>(defaultSettings.churchTaxRate);
  const [includeSolidarity, setIncludeSolidarity] = useState<boolean>(defaultSettings.includeSolidarity);
  const [includeChurchTax, setIncludeChurchTax] = useState<boolean>(defaultSettings.includeChurchTax);

  // Neue States für Angestelltenverhältnis
  const [businessType, setBusinessType] = useState<"gewerblich" | "freiberuflich">("gewerblich");
  const [employmentType, setEmploymentType] = useState<"self-employed" | "side-business">("self-employed");
  const [grossSalary, setGrossSalary] = useState<number>(50000);
  const [employeeExpenses, setEmployeeExpenses] = useState<number>(1230); // Werbungskostenpauschale 2024
  // Social contributions are user assumptions by default. The optional
  // helper uses only rough employee rates and is not a full SV calculator.
  const [autoCalcSocial, setAutoCalcSocial] = useState<boolean>(false);
  const [numberOfChildren, setNumberOfChildren] = useState<number>(0);

  useEffect(() => {
    if (employmentType === "side-business" && autoCalcSocial && !simulationNumberError("grossSalary", grossSalary)) {
      // Versionierte Beitragsbemessungsgrenzen aus dem ausgewählten Jahr.
      const socialRules = getTaxRulePack(taxYear)?.socialSecurity;
      if (!socialRules) return;
      const bbG_KV = socialRules.healthContributionAssessmentCeiling;
      const bbG_RV = socialRules.pensionContributionAssessmentCeiling;

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
  }, [grossSalary, employmentType, autoCalcSocial, numberOfChildren, taxYear]);

  const fetchData = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      setLoading(true);
      setError(null);
      setSummary(null);
      const response = await fetch(`/api/tax-summary?year=${taxYear}&timeRange=${selectedTimeRange}`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Daten konnten nicht geladen werden.");
      if (version !== requestVersion.current) return;
      setSummary(result as TaxSummary);
    } catch (err) {
      if (version !== requestVersion.current) return;
      console.error("Fehler beim Laden der Finanzdaten:", err);
      setSummary(null);
      setError(err instanceof Error ? err.message : "Die Finanzdaten konnten nicht geladen werden. Bitte versuchen Sie es erneut.");
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [selectedTimeRange, taxYear]);

  useEffect(() => {
    fetchData();
    const disconnect = connectPaymentRefreshBridge();
    const refreshPayments = () => { void fetchData(); };
    const recheckVisibleFiscalData = () => { if (document.visibilityState === 'visible') void fetchData(); };
    const restoreFiscalData = (event: PageTransitionEvent) => { if (event.persisted) recheckVisibleFiscalData(); };
    window.addEventListener(PAYMENT_DASHBOARD_REFRESH_EVENT, refreshPayments);
    window.addEventListener('focus', recheckVisibleFiscalData);
    document.addEventListener('visibilitychange', recheckVisibleFiscalData);
    window.addEventListener('pageshow', restoreFiscalData);
    return () => { disconnect(); window.removeEventListener(PAYMENT_DASHBOARD_REFRESH_EVENT, refreshPayments); window.removeEventListener('focus', recheckVisibleFiscalData); document.removeEventListener('visibilitychange', recheckVisibleFiscalData); window.removeEventListener('pageshow', restoreFiscalData); requestVersion.current += 1; };
  }, [fetchData]);

  const totalIncome = summary?.totalIncome ?? 0;
  const totalExpenses = summary?.totalExpenses ?? 0;
  const expenseCoverage = totalIncome > 0 ? totalExpenses / totalIncome : 0;
  const partialDeductionShortfall = summary?.partialDeductionShortfall ?? 0;
  const nonTaxRelevantExpenseCount = summary?.nonTaxRelevantExpenseCount ?? 0;
  const nonTaxRelevantExpenseAmount = summary?.nonTaxRelevantExpenseAmount ?? 0;
  const nonTaxRelevantIncomeCount = summary?.nonTaxRelevantIncomeCount ?? 0;
  const nonTaxRelevantIncomeAmount = summary?.nonTaxRelevantIncomeAmount ?? 0;
  const profit = summary?.profit ?? 0;
  const profitFloor = Math.max(0, profit);

  const inputErrors = simulationInputErrors({
    healthInsurance, pensionInsurance, careInsurance, otherDeductions,
    tradeTaxHebesatz, churchTaxRate, grossSalary, employeeExpenses,
  }, { sideBusiness: employmentType === "side-business", includeChurchTax });
  const simulationInputsValid = inputErrors.length === 0;
  const sourceAvailable = !loading && !error && summary !== null;
  const taxDataSupported = Boolean(sourceAvailable && summary?.annualBasis && profit >= 0);
  const taxCalculationSupported = taxDataSupported && simulationInputsValid;


  // 1. Gewerbesteuer
  const tradeTaxDetails = taxCalculationSupported
    ? calculateTradeTaxDetails(profitFloor, tradeTaxHebesatz)
    : { tradeTax: 0, tradeTaxBaseAmount: 0 };
  const tradeTax = taxCalculationSupported && businessType === "gewerblich" ? tradeTaxDetails.tradeTax : 0;

  // 2. Zu versteuerndes Einkommen (zvE)
  const totalDeductions = simulationInputsValid ? healthInsurance + pensionInsurance + careInsurance + otherDeductions : 0;

  let incomeFromEmployment = 0;
  if (employmentType === "side-business" && simulationInputsValid) {
    incomeFromEmployment = Math.max(0, grossSalary - employeeExpenses);
  }

  const taxableIncome = taxCalculationSupported ? Math.max(0, profit + incomeFromEmployment - totalDeductions) : 0;

  // 3. Tarifliche Einkommensteuer
  const baseIncomeTax = taxCalculationSupported ? calculateIncomeTax(taxableIncome, taxYear) : 0;

  // 4. Gewerbesteueranrechnung nach §35 EStG (vierfacher Messbetrag plus
  // tatsächlich gezahlte Gewerbesteuer und anteilige Höchstgrenze).
  const tradeTaxCredit = taxCalculationSupported && businessType === "gewerblich" ? calculateTradeTaxCredit({
    incomeTax: baseIncomeTax,
    businessProfit: profit,
    totalPositiveIncome: Math.max(0, profit) + Math.max(0, incomeFromEmployment),
    tradeTaxBaseAmount: tradeTaxDetails.tradeTaxBaseAmount,
    actuallyPayableTradeTax: tradeTax,
  }) : 0;

  const finalIncomeTax = taxCalculationSupported
    ? Math.max(0, baseIncomeTax - tradeTaxCredit)
    : 0;

  // 5. Zuschläge
  const solidaritySurcharge = taxCalculationSupported && includeSolidarity
    ? calculateSolidaritySurcharge(finalIncomeTax, taxYear)
    : 0;
  // §51a EStG bases the simple church-tax estimate on the tariff income tax;
  // §35 is not applied to this surcharge base. State-specific rules and
  // personal allowances remain outside this limited simulation.
  const churchTax = taxCalculationSupported && includeChurchTax ? calculateChurchTax(baseIncomeTax, churchTaxRate) : 0;

  const totalTax = taxCalculationSupported
    ? finalIncomeTax + solidaritySurcharge + churchTax + tradeTax
    : 0;

  // Berechnung der Grenzsteuerbelastung für Nebengewerbe
  let marginalTax = totalTax;
  let taxWithoutBusiness = 0;

  if (employmentType === "side-business" && taxCalculationSupported) {
    // Steuerlast ohne Gewerbe berechnen (nur Job)
    const taxableIncomeBase = Math.max(0, incomeFromEmployment - totalDeductions);
    const baseIncomeTaxOnly = calculateIncomeTax(taxableIncomeBase, taxYear);
    const baseSoli = includeSolidarity ? calculateSolidaritySurcharge(baseIncomeTaxOnly, taxYear) : 0;
    const baseChurch = includeChurchTax ? calculateChurchTax(baseIncomeTaxOnly, churchTaxRate) : 0;

    taxWithoutBusiness = baseIncomeTaxOnly + baseSoli + baseChurch;
    marginalTax = totalTax - taxWithoutBusiness;
  }

  const netProfitAfterTax = taxCalculationSupported
    ? (employmentType === "side-business" ? profit - marginalTax : profit - totalTax)
    : 0;

  const effectiveTaxRate = taxCalculationSupported && profit > 0
    ? (marginalTax / profit) * 100
    : 0;

  const svBeitraege = healthInsurance + pensionInsurance + careInsurance;
  const totalNetIncome = taxCalculationSupported
    ? (employmentType === "side-business"
      ? grossSalary - svBeitraege + profit - totalTax
      : profit - totalTax)
    : 0;

  // Für UI-Anzeige
  const deductionsApplied = totalDeductions;

  const formatCurrency = useCallback((value: number) =>
    new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value), []);
  const formatSimulationValue = useCallback((value: number) =>
    taxCalculationSupported ? formatCurrency(value) : "nicht berechnet", [formatCurrency, taxCalculationSupported]);

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
    if (!simulationInputsValid) return recs;

    if (profit < 0) {
      recs.push({
        tone: "warning",
        title: "Verluste strategisch nutzen",
        description: `Sie verzeichnen aktuell einen Verlust von ${formatCurrency(Math.abs(profit))}. Prüfen Sie Verlustvor- bzw. -rücktrag und passen Sie Vorauszahlungen an.`,
      });

      if (nonTaxRelevantExpenseCount > 0) {
        recs.push({
          tone: "info",
          title: "Nicht berücksichtigte Ausgaben analysieren",
          description: `${nonTaxRelevantExpenseCount} Ausgaben (${formatCurrency(nonTaxRelevantExpenseAmount)}) sind als nicht steuerrelevant markiert. Überprüfen Sie, ob sich Belege doch steuerlich ansetzen lassen.`,
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

    if (nonTaxRelevantExpenseCount > 0) {
      recs.push({
        tone: "info",
        title: "Nicht steuerrelevante Kosten bewerten",
        description: `${nonTaxRelevantExpenseCount} Ausgaben (${formatCurrency(nonTaxRelevantExpenseAmount)}) werden steuerlich nicht berücksichtigt. Stellen Sie sicher, dass die Zuordnung korrekt ist oder dokumentieren Sie private Anteile sauber.`,
      });
    }

    if (nonTaxRelevantIncomeCount > 0 && nonTaxRelevantIncomeAmount > 0) {
      recs.push({
        tone: "warning",
        title: "Steuerfreie Einnahmen plausibilisieren",
        description: `${nonTaxRelevantIncomeCount} Einnahmen in Höhe von ${formatCurrency(nonTaxRelevantIncomeAmount)} sind als steuerfrei klassifiziert. Prüfen Sie, ob alle Voraussetzungen (z. B. echte Privatverkäufe) erfüllt sind.`,
      });
    }

    if (businessType === "gewerblich" && tradeTaxHebesatz < 200 && profit > 24500) {
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
    simulationInputsValid,
    effectiveTaxRate,
    expenseCoverage,
    formatCurrency,
    nonTaxRelevantExpenseAmount,
    nonTaxRelevantExpenseCount,
    nonTaxRelevantIncomeAmount,
    nonTaxRelevantIncomeCount,
    partialDeductionShortfall,
    profit,
    taxableIncome,
    totalDeductions,
    totalIncome,
    tradeTaxHebesatz,
    businessType,

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
    setBusinessType("gewerblich");
    setEmploymentType("self-employed");
    setGrossSalary(50000);
    setEmployeeExpenses(1230);
    setAutoCalcSocial(false);
    setNumberOfChildren(0);
  };

  return (
    <TooltipProvider delayDuration={800}>
      <div className={`${styles.taxWorkspace} tax-studio space-y-6`}>
        <PageHeader title="Steuer-Simulation" description="Spielen Sie Szenarien mit Ihren steuerrelevanten EÜR-Daten durch und sehen Sie direkt, wie sich Ihre Steuerlast verändert." section="Auswertungen" actions={<>
<div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-64 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-2 sm:min-w-32">
              <Label htmlFor="taxYear" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Steuerjahr
              </Label>
              <select
                id="taxYear"
                value={taxYear}
                onChange={(event) => setTaxYear(Number(event.target.value))}
                className="block h-11 w-full rounded-[var(--radius-input)] border border-input bg-background px-3 text-sm shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value={2026}>2026</option>
                <option value={2025}>2025</option>
              </select>
            </div>
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
                <option value="thisYear">Gewähltes Steuerjahr</option>
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
</>} />
        <nav className={styles.taxRouteLinks} aria-label="Simulation und Datenbasis">
          <a href="#overview-heading">Datenbasis</a><a href="#parameters-heading">Annahmen anpassen</a><a href="#simulation-result">Ergebnis prüfen</a><Link href="/dashboard?tab=eur">Zur EÜR<ArrowUpRight className="h-4 w-4" aria-hidden="true" /></Link>
        </nav>
        {error && (
          <div role="alert" className="rounded-[var(--radius-input)] border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}
        {Boolean(summary?.warnings.length) && <details className="tax-method-notes" open={!taxCalculationSupported}>
          <summary>Datenbasis und Grenzen<ChevronDown aria-hidden="true" /></summary>
          <div>{summary?.warnings.map(warning => <p key={warning}>{warning}</p>)}</div>
        </details>}
        {!taxDataSupported && summary && (
          <div role="alert" className="rounded-[var(--radius-input)] border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Für diesen Datenstand wird keine endgültige Steuerlast angezeigt. Die Simulation unterstützt nur Jahresansichten ohne Verlust, Verlustvortrag oder Verlustrücktrag; die Vollständigkeit außerhalb Bivaro wird nicht geprüft.
          </div>
        )}

        <section className="tax-source-context" aria-labelledby="overview-heading">
          <div className="tax-source-profit"><span className="tax-source-label">Datenbasis · In-App-EÜR · {taxYear}</span><h2 id="overview-heading">Gewinn laut EÜR</h2><strong>{loading ? '—' : sourceAvailable ? formatCurrency(profit) : 'Nicht verfügbar / fachlich zu prüfen'}</strong><p>{sourceAvailable ? 'Vor Steuern · steuerrelevante Buchungen' : 'Keine bestätigte steuerliche Datenbasis'}</p></div>
          <dl><div><dt>Betriebseinnahmen</dt><dd>{loading ? '—' : sourceAvailable ? formatCurrency(totalIncome) : 'Nicht verfügbar'}</dd></div><div><dt>Betriebsausgaben</dt><dd>{loading ? '—' : sourceAvailable ? formatCurrency(totalExpenses) : 'Nicht verfügbar'}</dd></div><div><dt>Buchungen</dt><dd>{loading ? '—' : sourceAvailable ? summary.sourceCount : 'Nicht verfügbar'}</dd></div></dl>
          <p className="tax-source-period">Nur In-App-Buchungen; externe Einnahmen und Ausgaben nicht enthalten. Eigene Jahreskontextangaben werden nicht addiert. Keine Aussage zum Kleinunternehmerstatus.</p>
          {!loading && summary && <p className="tax-source-period">Geladene Daten für Regeljahr {summary.year} · Stand {new Date(summary.dataAsOf).toLocaleString("de-DE")} · Regelpaket {summary.ruleVersion}. Ihre veränderbaren Annahmen stehen im Parameterbereich.</p>}
          <p className="tax-source-period">Zeitraum: {selectedTimeRange === "thisYear" ? `Steuerjahr ${taxYear}` : selectedTimeRange === "lastYear" ? `Steuerjahr ${taxYear - 1}` : selectedTimeRange === "last3Months" ? "Letzte 3 Monate" : selectedTimeRange === "last6Months" ? "Letzte 6 Monate" : "Gesamter Zeitraum"}</p>
        </section>
        <div className="tax-mobile-result"><span>Netto {employmentType === "side-business" ? "aus Gewerbe" : "nach Steuern"}<strong>{loading ? '—' : formatSimulationValue(netProfitAfterTax)}</strong></span><a href="#simulation-result">Zum Ergebnis<ArrowUpRight aria-hidden="true" /></a></div>
        <div className="tax-workspace">
        <section aria-labelledby="parameters-heading" className="tax-parameters rounded-[var(--radius-card)] border border-border bg-card">
          <div className="flex flex-col gap-4 border-b border-border p-6 sm:flex-row sm:items-start sm:justify-between sm:p-8">
            <div className="space-y-2">
              <h2 id="parameters-heading" className="text-2xl font-semibold tracking-tight">Parameter für die Simulation</h2>
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">Passen Sie Vorsorge, Beschäftigungsverhältnis und Steuersätze an. Das Ergebnis aktualisiert sich sofort.</p>
            </div>
            <Button variant="ghost" onClick={resetDefaults} className="self-start text-muted-foreground">
              Standardwerte
            </Button>
          </div>
            {!simulationInputsValid && (
              <div role="alert" className="m-6 rounded-[var(--radius-input)] border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                Bitte korrigieren Sie die markierten Eingaben. Bis dahin werden keine Simulationsergebnisse oder Empfehlungen berechnet.
              </div>
            )}
            <div className="tax-parameter-body space-y-8 p-6 sm:p-8">
            <div className="tax-parameter-group">
              <h3>Tätigkeit und Einordnung</h3>
              <ParameterLabel
                htmlFor="businessType"
                label="Tätigkeitsart"
                tooltip="Die vereinfachte Simulation unterstützt Einzelunternehmen als Gewerbebetrieb oder freiberufliche Tätigkeit. Andere Rechtsformen und Sonderfälle sind nicht enthalten."
              />
              <select
                id="businessType"
                value={businessType}
                onChange={(event) => setBusinessType(event.target.value as "gewerblich" | "freiberuflich")}
                className="mt-2 block h-11 w-full max-w-sm rounded-[var(--radius-input)] border border-input bg-background px-3 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="gewerblich">Gewerbebetrieb</option>
                <option value="freiberuflich">Freiberufliche Tätigkeit</option>
              </select>
              <p className="mt-2 text-xs text-muted-foreground">Bei freiberuflicher Tätigkeit wird keine Gewerbesteuer angesetzt. Die Einordnung muss fachlich zutreffen.</p>
            </div>
            <div className="tax-parameter-group">
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
                    <SimulationNumberInput
                      id="grossSalary"
                      type="number"
                      inputMode="decimal"
                      value={grossSalary}
                      onChange={(event) => setGrossSalary(event.target.valueAsNumber)}
                      className="mt-2 bg-background"
                    />
                  </div>
                  <div>
                    <ParameterLabel
                      htmlFor="employeeExpenses"
                      label="Werbungskosten (EUR)"
                      tooltip="Werbungskosten aus nichtselbstständiger Arbeit (Pauschbetrag 2024: 1.230 €)."
                    />
                    <SimulationNumberInput
                      id="employeeExpenses"
                      type="number"
                      inputMode="decimal"
                      value={employeeExpenses}
                      onChange={(event) => setEmployeeExpenses(event.target.valueAsNumber)}
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
                      Sozialversicherungsbeiträge näherungsweise aus Bruttogehalt berechnen
                    </Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" aria-label="Sozialversicherungs-Näherung - Hilfe" className="inline-flex min-h-11 min-w-11 items-center justify-center text-muted-foreground"><CircleHelp className="h-4 w-4" aria-hidden="true" /></button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        Näherung mit den Beitragsbemessungsgrenzen des Steuerjahres und vereinfachten Arbeitnehmeranteilen. Zusatzbeiträge, Sachsenregel und persönliche Besonderheiten bitte prüfen; die Felder bleiben überschreibbar.
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
              <div className="grid gap-5 border-t border-border pt-5 md:grid-cols-2 xl:grid-cols-2">
              <div>
                <ParameterLabel
                  htmlFor="healthInsurance"
                  label="Krankenversicherung (EUR)"
                  tooltip="Jährliche Beiträge zur Krankenversicherung (Basisabsicherung)."
                />
                <SimulationNumberInput
                  id="healthInsurance"
                  type="number"
                  inputMode="decimal"
                  value={healthInsurance}
                  onChange={(event) => setHealthInsurance(event.target.valueAsNumber)}
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
                <SimulationNumberInput
                  id="pensionInsurance"
                  type="number"
                  inputMode="decimal"
                  value={pensionInsurance}
                  onChange={(event) => setPensionInsurance(event.target.valueAsNumber)}
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
                <SimulationNumberInput
                  id="careInsurance"
                  type="number"
                  inputMode="decimal"
                  value={careInsurance}
                  onChange={(event) => setCareInsurance(event.target.valueAsNumber)}
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
                <SimulationNumberInput
                  id="otherDeductions"
                  type="number"
                  inputMode="decimal"
                  value={otherDeductions}
                  onChange={(event) => setOtherDeductions(event.target.valueAsNumber)}
                  className="mt-2"
                />
              </div>
              </div>
              <div className="mt-8 border-t border-border pt-6"><h3 className="mb-5 font-semibold">Steuern und Zuschläge</h3><div className="grid gap-5 md:grid-cols-2">
              <div>
                <ParameterLabel
                  htmlFor="tradeTaxHebesatz"
                  label="Gewerbesteuer-Hebesatz (%)"
                  tooltip="Kommunaler Hebesatz für die Gewerbesteuer (mind. 200%)."
                />
                <SimulationNumberInput
                  id="tradeTaxHebesatz"
                  type="number"
                  inputMode="decimal"
                  value={tradeTaxHebesatz}
                  onChange={(event) => setTradeTaxHebesatz(event.target.valueAsNumber)}
                  className="mt-2"
                />
              </div>
              <div>
                <ParameterLabel
                  htmlFor="churchTaxRate"
                  label="Kirchensteuer (%)"
                  tooltip="Vereinfachte Annahme: Prozentsatz auf die tarifliche Einkommensteuer nach §51a EStG (8% oder 9%). Landesrecht und persönliche Freibeträge werden nicht abgebildet."
                />
                <SimulationNumberInput
                  id="churchTaxRate"
                  type="number"
                  inputMode="decimal"
                  value={churchTaxRate}
                  onChange={(event) => setChurchTaxRate(event.target.valueAsNumber)}
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
            </div>
            <div className={styles.taxAssumptionNote}>
              <p className="text-sm text-muted-foreground">
                Einkommensteuertarif {taxYear} · Grundfreibetrag {taxYear === 2025 ? "12.096" : "12.348"} € berücksichtigt.
              </p>
            </div>
          </div>
        </section>

        <aside className="tax-result-rail">
        <section id="simulation-result" aria-labelledby="result-heading" className="tax-result rounded-[var(--radius-card)] border border-border bg-card">
          <div className="tax-result-hero">
            <span className="tax-result-kicker"><span aria-hidden="true" />Live-Simulation · {taxYear}</span>
            <h2 id="result-heading">Ergebnis der Simulation</h2>
            <p className="tax-result-amount" aria-live="polite">{loading ? '—' : formatSimulationValue(netProfitAfterTax)}</p>
            <p>Netto {employmentType === "side-business" ? "aus Gewerbe" : "nach Steuern"} · auf Basis Ihrer Annahmen</p>
          </div>
          <div className={styles.taxActiveAssumptions} aria-label="Aktive Simulationsannahmen"><span>{businessType === "gewerblich" ? "Gewerbebetrieb" : "Freiberufliche Tätigkeit"}</span><span>{employmentType === "side-business" ? "Nebenberuflich" : "Hauptberuflich"}</span><span>Abzüge {simulationInputsValid ? formatCurrency(totalDeductions) : "nicht berechnet"}</span></div>
          <div className="space-y-6 p-6 sm:p-8">
            <dl className="tax-result-metrics"><div><dt>Steuerlast {employmentType === 'side-business' ? 'auf Gewerbe' : 'gesamt'}</dt><dd>{loading ? '—' : formatSimulationValue(marginalTax)}</dd></div><div><dt>Effektive Belastung</dt><dd>{loading ? '—' : taxCalculationSupported && profit > 0 ? `${effectiveTaxRate.toFixed(1)} %` : 'nicht berechnet'}</dd></div></dl>
            <details className="tax-calculation"><summary>Berechnungsweg anzeigen<ChevronDown aria-hidden="true" /></summary><div className="tax-calculation-body">
            <div className="grid gap-6">
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
                    <span className="text-sm font-medium tabular-nums">+ {formatSimulationValue(incomeFromEmployment)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-4 py-3">
                  <span className="text-sm text-muted-foreground">Sonderausgaben (Vorsorge etc.)</span>
                  <span className="text-sm font-medium tabular-nums">- {formatSimulationValue(deductionsApplied)}</span>
                </div>
                <div className="flex items-center justify-between gap-4 py-3">
                  <span className="text-sm text-muted-foreground">Zu versteuerndes Einkommen</span>
                  <span className="text-sm font-semibold tabular-nums">{formatSimulationValue(taxableIncome)}</span>
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
                  <span className="text-sm font-semibold tabular-nums">{formatSimulationValue(marginalTax)}</span>
                </div>
                {employmentType === "side-business" && (
                  <div className="flex items-center justify-between gap-4 py-3 text-sm">
                    <span className="text-muted-foreground">Gesamtsteuer inkl. Job</span>
                    <span className="font-medium tabular-nums">{formatSimulationValue(totalTax)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-4 py-3">
                  <span className="text-sm text-muted-foreground">
                    {employmentType === "side-business" ? "Belastung Gewerbe" : "Effektiver Steuersatz"}
                  </span>
                  <span className="text-sm font-medium tabular-nums">
                    {taxCalculationSupported && profit > 0 ? `${effectiveTaxRate.toFixed(1)} %` : "nicht berechnet"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4 py-3">
                  <span className="text-sm text-muted-foreground">{employmentType === "side-business" ? "Netto vom Gewerbe" : "Netto nach Steuern"}</span>
                  <span className="text-sm font-semibold tabular-nums">{formatSimulationValue(netProfitAfterTax)}</span>
                </div>
                {employmentType === "side-business" && <div className="flex items-center justify-between gap-4 border-t border-border py-3"><span className="text-sm font-medium">Gesamtes Netto</span><span className="text-sm font-bold tabular-nums text-primary">{formatSimulationValue(totalNetIncome)}</span></div>}
                </dl>
              </div>
            </div>
            <div className="grid gap-px overflow-hidden rounded-[var(--radius-input)] border border-border bg-border sm:grid-cols-2">
              {[['Einkommensteuer', finalIncomeTax], ['Solidaritätszuschlag', solidaritySurcharge], ['Kirchensteuer', churchTax], ['Gewerbesteuer', tradeTax]].map(([label, value]) => (
                <div key={label} className="bg-background px-4 py-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">{formatSimulationValue(value as number)}</p>
                </div>
              ))}
            </div>
            </div></details>
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

        <section aria-labelledby="recommendations-heading" className="tax-recommendations rounded-[var(--radius-card)] border border-border bg-card">
          <div className="border-b border-border p-6 sm:p-8">
            <h2 id="recommendations-heading" className="mt-2 text-2xl font-semibold tracking-tight">Empfehlungen zur Steueroptimierung</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">Konkrete Ansatzpunkte aus Ihren aktuellen EÜR-Daten und Simulationseinstellungen.</p>
          </div>
          <div className="p-6 sm:p-8">
            {!simulationInputsValid && <p className="text-sm text-muted-foreground">Empfehlungen werden erst nach Korrektur der Eingaben angezeigt.</p>}
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
        </aside></div>
      </div>
    </TooltipProvider>
  );
}
