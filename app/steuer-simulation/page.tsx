"use client";

import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Suspense, useEffect, useMemo, useState, useCallback, useRef, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import styles from "@/components/public-accounting/accounting-workspaces.module.css";
import { SimulationResultDisclosure } from "@/components/public-accounting/simulation-result-disclosure";
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
  Briefcase,
  ChevronDown,
  ArrowUpRight,
} from "lucide-react";

import {
  calculateIncomeTax,
  calculateSolidaritySurcharge,
  calculateTradeTaxDetails,
  calculateTradeTaxCredit,
  calculateChurchTax,
  getTaxRulePack,
} from "@/lib/tax-calculator";
import { readSimulationView, simulationPeriodLabel, simulationSummaryMatches, simulationDataChecks, SIMULATION_SOURCE_SCOPE, type SimulationView, type SimulationDataCheck } from "@/lib/simulation-disclosure";
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

function SteuerSimulationContent() {
  const searchParams = useSearchParams();
  const { year: taxYear, timeRange: selectedTimeRange, error: selectionError } = readSimulationView(searchParams, new Date().getFullYear());
  const [summary, setSummary] = useState<TaxSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  const changeView = (next: Partial<SimulationView>) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("year", String(next.year ?? taxYear));
    params.set("timeRange", next.timeRange ?? selectedTimeRange);
    // Invalidate pending responses before the Router observes the new URL.
    requestVersion.current += 1;
    setSummary(null);
    setError(null);
    setLoading(true);
    window.history.pushState(null, "", `?${params.toString()}`);
  };

  const fetchData = useCallback(async () => {
    const version = ++requestVersion.current;
    if (selectionError) {
      setSummary(null);
      setLoading(false);
      setError(selectionError);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      setSummary(null);
      const response = await fetch(`/api/tax-summary?year=${taxYear}&timeRange=${selectedTimeRange}`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Daten konnten nicht geladen werden.");
      if (version !== requestVersion.current) return;
      if (!simulationSummaryMatches(result as TaxSummary, { year: taxYear, timeRange: selectedTimeRange })) {
        throw new Error("Die Serverdaten stimmen nicht mit dem gewählten Steuerjahr und Zeitraum überein. Bitte laden Sie die Finanzdaten erneut.");
      }
      setSummary(result as TaxSummary);
    } catch (err) {
      if (version !== requestVersion.current) return;
      console.error("Fehler beim Laden der Finanzdaten:", err);
      setSummary(null);
      setError(err instanceof Error ? err.message : "Die Finanzdaten konnten nicht geladen werden. Bitte versuchen Sie es erneut.");
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [selectedTimeRange, taxYear, selectionError]);

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
  const profit = summary?.profit ?? 0;
  const profitFloor = Math.max(0, profit);

  const inputErrors = simulationInputErrors({
    healthInsurance, pensionInsurance, careInsurance, otherDeductions,
    tradeTaxHebesatz, churchTaxRate, grossSalary, employeeExpenses,
  }, { sideBusiness: employmentType === "side-business", includeChurchTax });
  const simulationInputsValid = inputErrors.length === 0;
  const sourceAvailable = !loading && !error && !selectionError && simulationSummaryMatches(summary, { year: taxYear, timeRange: selectedTimeRange });
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

  const recommendationToneStyles: Record<SimulationDataCheck["tone"], string> = {
    info: "border-primary/30 bg-primary/5",
    warning: "border-amber-300/60 bg-amber-100/40 dark:bg-amber-500/10",
  };
  const recommendationIconMap: Record<SimulationDataCheck["tone"], LucideIcon> = {
    info: Lightbulb,
    warning: AlertTriangle,
  };
  const recommendationIconColor: Record<SimulationDataCheck["tone"], string> = {
    info: "text-primary",
    warning: "text-amber-600 dark:text-amber-400",
  };
  const recommendations = useMemo(() => sourceAvailable && summary
    ? simulationDataChecks(summary, formatCurrency) : [], [sourceAvailable, summary, formatCurrency]);
  const periodLabel = simulationPeriodLabel({ year: taxYear, timeRange: selectedTimeRange });

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
        <PageHeader title="Steuer-Simulation" actions={<>
<div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-64 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-2 sm:min-w-32">
              <Label htmlFor="taxYear" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Steuerjahr
              </Label>
              <select
                id="taxYear"
                value={taxYear}
                onChange={(event) => changeView({ year: Number(event.target.value) })}
                className="block h-11 w-full rounded-[var(--radius-input)] border border-input bg-background px-3 text-sm shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
              >
                {!getTaxRulePack(taxYear) && <option value={taxYear}>{Number.isFinite(taxYear) ? taxYear : "Ungültiges Jahr"} · nicht unterstützt</option>}
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
                onChange={(event) => changeView({ timeRange: event.target.value as SimulationView["timeRange"] })}
                className="block h-11 w-full rounded-[var(--radius-input)] border border-input bg-background px-3 text-sm shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
              >
                {selectedTimeRange === "lastYear" && <option value="lastYear">Gewähltes Steuerjahr · Jahresansicht</option>}
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
        {(error || selectionError) && (
          <div role="alert" className="rounded-[var(--radius-input)] border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error || selectionError}
            <p>Keine bestätigte Datenbasis; keine Modellsteuern berechnet.</p>
          </div>
        )}
        {!taxDataSupported && summary && (
          <div role="alert" className="rounded-[var(--radius-input)] border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Keine Berechnung für diesen Zeitraum oder Verlustfall. Details unter „Datenbasis und Grenzen“.
          </div>
        )}

        <section className="tax-source-context" aria-labelledby="overview-heading">
          <div className="tax-source-profit"><span className="tax-source-label">Datenbasis · In-App-EÜR · Regeljahr {taxYear}</span><h2 id="overview-heading">Gewinn laut EÜR</h2><strong>{loading ? '—' : sourceAvailable ? formatCurrency(profit) : 'Nicht verfügbar / fachlich zu prüfen'}</strong><p>{sourceAvailable ? `Vor Steuern · steuerrelevante Buchungen · ${periodLabel}` : 'Keine bestätigte steuerliche Datenbasis'}</p></div>
          <dl><div><dt>Betriebseinnahmen</dt><dd>{loading ? '—' : sourceAvailable ? formatCurrency(totalIncome) : 'Nicht verfügbar'}</dd></div><div><dt>Betriebsausgaben</dt><dd>{loading ? '—' : sourceAvailable ? formatCurrency(totalExpenses) : 'Nicht verfügbar'}</dd></div><div><dt>Buchungen</dt><dd>{loading ? '—' : sourceAvailable ? summary.sourceCount : 'Nicht verfügbar'}</dd></div></dl>
          <details className="tax-source-period"><summary className="w-fit cursor-pointer py-2">Datenbasis und Grenzen</summary>
          <p>Nur In-App-Buchungen; externe Beträge fehlen. Jahreskontext wird nicht addiert. Kleinunternehmerstatus ungeprüft.</p>
          <p>{SIMULATION_SOURCE_SCOPE}</p>
          {!loading && summary && <p className="tax-source-period">Geladene Daten für Regeljahr {summary.year} · Stand {new Date(summary.dataAsOf).toLocaleString("de-DE")} · Regelpaket {summary.ruleVersion}. </p>}
          <p className="tax-source-period">Zeitraum: {summary?.annualBasis ? `Steuerjahr ${taxYear}` : periodLabel}</p>
          {summary?.warnings.map(warning => <p key={warning}>{warning}</p>)}
          </details>
        </section>
        <div className="tax-mobile-result"><span>Modellrest aus Betriebsgewinn<strong>{loading ? '—' : formatSimulationValue(netProfitAfterTax)}</strong></span><a href="#simulation-result">Zum Ergebnis<ArrowUpRight aria-hidden="true" /></a></div>
        <div className="tax-workspace">
        <section aria-labelledby="parameters-heading" className="tax-parameters rounded-[var(--radius-card)] border border-border bg-card">
          <div className="flex flex-col gap-4 border-b border-border p-6 sm:flex-row sm:items-start sm:justify-between sm:p-8">
            <div className="space-y-2">
              <h2 id="parameters-heading" tabIndex={-1} className="scroll-mt-40 text-2xl font-semibold tracking-tight">Annahmen</h2>
            </div>
            <Button variant="ghost" onClick={resetDefaults} className="self-start text-muted-foreground">
              Standardwerte
            </Button>
          </div>
            {!simulationInputsValid && (
              <div role="alert" className="m-6 rounded-[var(--radius-input)] border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                Bitte korrigieren Sie die markierten Eingaben. Bis dahin werden keine Simulationsergebnisse berechnet.
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
            </div>
            <div className="tax-parameter-group">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <Label className="text-base font-semibold">Beschäftigungsverhältnis</Label>
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
                      Sozialabgaben aus Bruttogehalt schätzen
                    </Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" aria-label="Sozialversicherungs-Näherung - Hilfe" className="inline-flex min-h-11 min-w-11 items-center justify-center text-muted-foreground"><CircleHelp className="h-4 w-4" aria-hidden="true" /></button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        Näherung mit den Beitragsbemessungsgrenzen des Steuerjahres und vereinfachten Arbeitnehmeranteilen. Zusatzbeiträge, Sachsenregel und persönliche Besonderheiten werden nicht geprüft. Zum manuellen Bearbeiten die Näherung ausschalten.
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
            <h2 id="result-heading">Ergebnis</h2>
            <p className="tax-result-amount" aria-live="polite">{loading ? '—' : formatSimulationValue(netProfitAfterTax)}</p>
            <p>Modellrest aus Betriebsgewinn · nach Modellsteuern</p>
          </div>
          <div className={styles.taxActiveAssumptions} aria-label="Aktive Simulationsannahmen"><span>{businessType === "gewerblich" ? "Gewerbebetrieb" : "Freiberufliche Tätigkeit"}</span><span>{employmentType === "side-business" ? "Nebenberuflich" : "Hauptberuflich"}</span><span>Abzüge {simulationInputsValid ? formatCurrency(totalDeductions) : "nicht berechnet"}</span></div>
          <div className="space-y-6 p-6 sm:p-8">
            <SimulationResultDisclosure
              view={{ year: taxYear, timeRange: selectedTimeRange }}
              summary={sourceAvailable ? summary : null}
              taxableIncome={taxableIncome}
              calculationSupported={taxCalculationSupported}
              assumptions={{ healthInsurance, pensionInsurance, careInsurance, otherDeductions, businessType,
                employmentType, grossSalary, employeeExpenses, autoCalcSocial, numberOfChildren,
                tradeTaxHebesatz, includeSolidarity, includeChurchTax, churchTaxRate }}
            />
            <dl className="tax-result-metrics"><div><dt>{employmentType === 'side-business' ? 'Modell-Mehrsteuer durch Betrieb' : 'Modellsteuern'}</dt><dd>{loading ? '—' : formatSimulationValue(marginalTax)}</dd></div><div><dt>Modellbelastung / Betriebsgewinn</dt><dd>{loading ? '—' : taxCalculationSupported && profit > 0 ? `${effectiveTaxRate.toFixed(1)} %` : 'nicht berechnet'}</dd></div></dl>
            <details className="tax-calculation"><summary>Berechnungsweg anzeigen<ChevronDown aria-hidden="true" /></summary><div className="tax-calculation-body">
            <div className="grid gap-6">
              <div>
                <div className="flex items-center justify-between gap-4 border-b border-border pb-3">
                  <h3 className="font-semibold">Einkommen</h3>
                  <span className="text-xs text-muted-foreground">Berechnungsgrundlage</span>
                </div>
                <dl className="divide-y divide-border">
                  <div className="flex items-center justify-between gap-4 py-3">
                  <span className="text-sm text-muted-foreground">Betriebsgewinn laut In-App-EÜR</span>
                  <span className="text-sm font-medium tabular-nums">{sourceAvailable ? formatCurrency(profit) : "nicht verfügbar"}</span>
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
                  <span className="text-sm text-muted-foreground">Vereinfachter Modelleingang für den Tarif</span>
                  <span className="text-sm font-semibold tabular-nums">{formatSimulationValue(taxableIncome)}</span>
                </div>
                </dl>
              </div>
              <div>
                <div className="flex items-center justify-between gap-4 border-b border-border pb-3">
                  <h3 className="font-semibold">Modellsteuern</h3>
                  <span className="text-xs text-muted-foreground">Effektiv</span>
                </div>
                <dl className="divide-y divide-border">
                <div className="flex items-center justify-between gap-4 py-3">
                  <span className="text-sm text-muted-foreground">
                    {employmentType === "side-business" ? "Modell-Mehrsteuer durch Betrieb" : "Summe der Modellsteuern"}
                  </span>
                  <span className="text-sm font-semibold tabular-nums">{formatSimulationValue(marginalTax)}</span>
                </div>
                {employmentType === "side-business" && (
                  <div className="flex items-center justify-between gap-4 py-3 text-sm">
                    <span className="text-muted-foreground">Modellsteuern inkl. Gehaltsannahme</span>
                    <span className="font-medium tabular-nums">{formatSimulationValue(totalTax)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-4 py-3">
                  <span className="text-sm text-muted-foreground">
                    Modellbelastung / Betriebsgewinn
                  </span>
                  <span className="text-sm font-medium tabular-nums">
                    {taxCalculationSupported && profit > 0 ? `${effectiveTaxRate.toFixed(1)} %` : "nicht berechnet"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4 py-3">
                  <span className="text-sm text-muted-foreground">Modellrest aus Betriebsgewinn</span>
                  <span className="text-sm font-semibold tabular-nums">{formatSimulationValue(netProfitAfterTax)}</span>
                </div>
                {employmentType === "side-business" && <div className="flex items-center justify-between gap-4 border-t border-border py-3"><span className="text-sm font-medium">Rest inkl. Gehaltsannahme im Modell</span><span className="text-sm font-bold tabular-nums text-primary">{formatSimulationValue(totalNetIncome)}</span></div>}
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
                Verlustfall: keine Steuerberechnung.
              </div>
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">
              Begrenzte Modellschätzung · keine Steuerberatung oder vollständige persönliche Steuerlast.
            </p>
          </div>
        </section>

        <details aria-labelledby="recommendations-heading" className="tax-recommendations rounded-[var(--radius-card)] border border-border bg-card">
          <summary className="cursor-pointer p-4">
            <h2 id="recommendations-heading" className="inline text-base font-semibold">Prüfhinweise</h2>
          </summary>
          <div className="p-6 sm:p-8">
            {!sourceAvailable && <p className="text-sm text-muted-foreground">Prüfhinweise benötigen eine bestätigte serverseitige Datenbasis.</p>}
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
        </details>
        </aside></div>
      </div>
    </TooltipProvider>
  );
}

// URL state is read inside Suspense as required by Next.js prerendering.
export default function SteuerSimulationPage() {
  return <Suspense fallback={<p role="status">Steuerjahr und Datenansicht werden geladen …</p>}><SteuerSimulationContent /></Suspense>;
}
