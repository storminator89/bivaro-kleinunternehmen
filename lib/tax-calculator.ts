/**
 * Versioned, deliberately limited tax rules used by the simulation.
 *
 * This is a calculation aid for a natural person with one business. It is
 * not a tax return: joint assessment, special income, foreign income,
 * loss-carry rules and most individual tax allowances are outside this rule
 * pack and must be handled by a tax professional.
 */

export type SupportedTaxYear = 2025 | 2026;

export type TaxRulePack = {
  year: SupportedTaxYear;
  source: string;
  incomeTax: {
    basicAllowance: number;
    firstZoneEnd: number;
    secondZoneEnd: number;
    topRateStart: number;
    firstCoefficient: number;
    secondCoefficient: number;
    secondConstant: number;
    topRateConstant: number;
    richRateConstant: number;
  };
  socialSecurity: {
    healthContributionAssessmentCeiling: number;
    pensionContributionAssessmentCeiling: number;
  };
  solidarity: {
    singleAssessmentAllowance: number;
    capRate: number;
    fullRate: number;
  };
};

const RULE_PACKS: Record<SupportedTaxYear, TaxRulePack> = {
  2025: {
    year: 2025,
    source: "EStG §32a (Veranlagungszeitraum 2025); Bundesregierung Sozialversicherungs-Rechengrößen 2025",
    incomeTax: {
      basicAllowance: 12_096,
      firstZoneEnd: 17_443,
      secondZoneEnd: 68_480,
      topRateStart: 277_825,
      firstCoefficient: 932.30,
      secondCoefficient: 176.64,
      secondConstant: 1_015.13,
      topRateConstant: 10_911.92,
      richRateConstant: 19_246.67,
    },
    socialSecurity: {
      healthContributionAssessmentCeiling: 66_150,
      pensionContributionAssessmentCeiling: 96_600,
    },
    solidarity: {
      singleAssessmentAllowance: 19_950,
      capRate: 0.119,
      fullRate: 0.055,
    },
  },
  2026: {
    year: 2026,
    source: "EStG §32a (Veranlagungszeitraum 2026); Bundesregierung Sozialversicherungs-Rechengrößen 2026",
    incomeTax: {
      basicAllowance: 12_348,
      firstZoneEnd: 17_799,
      secondZoneEnd: 69_878,
      topRateStart: 277_825,
      firstCoefficient: 914.51,
      secondCoefficient: 173.10,
      secondConstant: 1_034.87,
      topRateConstant: 11_135.63,
      richRateConstant: 19_470.38,
    },
    socialSecurity: {
      healthContributionAssessmentCeiling: 69_750,
      pensionContributionAssessmentCeiling: 101_400,
    },
    solidarity: {
      singleAssessmentAllowance: 20_350,
      capRate: 0.119,
      fullRate: 0.055,
    },
  },
};

export function isSupportedTaxYear(year: number): year is SupportedTaxYear {
  return year === 2025 || year === 2026;
}

export function getTaxRulePack(year: number): TaxRulePack | null {
  return isSupportedTaxYear(year) ? RULE_PACKS[year] : null;
}

function floorCents(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError("Steuerbetrag muss endlich sein");
  // A small decimal guard avoids turning exact legal cent values such as
  // 50 * 11.9% into 5.94 because of binary floating-point representation.
  return Math.floor((value + 1e-9) * 100) / 100;
}

/**
 * German tariff calculation for the supported assessment year.
 * The input and the final tariff amount are rounded down as required by
 * §32a EStG. A numeric year is accepted so callers cannot silently reuse a
 * current-year rule for historical data.
 */
export function calculateIncomeTaxForYear(
  taxableIncome: number,
  year: number,
): number {
  if (!Number.isFinite(taxableIncome)) throw new RangeError("Zu versteuerndes Einkommen muss endlich sein");
  const rules = getTaxRulePack(year);
  if (!rules) throw new Error(`Nicht unterstütztes Veranlagungsjahr: ${year}`);

  const zvE = Math.max(0, Math.floor(taxableIncome));
  const tariff = rules.incomeTax;

  let result: number;
  if (zvE <= tariff.basicAllowance) {
    result = 0;
  } else if (zvE <= tariff.firstZoneEnd) {
    const y = (zvE - tariff.basicAllowance) / 10_000;
    result = (tariff.firstCoefficient * y + 1_400) * y;
  } else if (zvE <= tariff.secondZoneEnd) {
    const z = (zvE - tariff.firstZoneEnd) / 10_000;
    result = (tariff.secondCoefficient * z + 2_397) * z + tariff.secondConstant;
  } else if (zvE <= tariff.topRateStart) {
    result = 0.42 * zvE - tariff.topRateConstant;
  } else {
    result = 0.45 * zvE - tariff.richRateConstant;
  }

  return Math.max(0, Math.floor(result));
}

/** Backwards-compatible current-year entry point. */
export function calculateIncomeTax(taxableIncome: number, year = 2026): number {
  return calculateIncomeTaxForYear(taxableIncome, year);
}

/**
 * §4 SolzG 1995: min(5.5% of the tax, 11.9% of the amount over the
 * single-assessment allowance), with cent fractions discarded.
 */
export function calculateSolidaritySurchargeForYear(
  incomeTax: number,
  year: number,
): number {
  if (!Number.isFinite(incomeTax)) throw new RangeError("Einkommensteuer muss endlich sein");
  const rules = getTaxRulePack(year);
  if (!rules) throw new Error(`Nicht unterstütztes Veranlagungsjahr: ${year}`);
  const taxCents = Math.max(0, Math.trunc(incomeTax * 100 + 1e-7));
  const allowance = rules.solidarity.singleAssessmentAllowance;
  const allowanceCents = allowance * 100;
  if (taxCents <= allowanceCents) return 0;

  // Work in integer cents. §4 SolzG uses 5.5% and caps the result at
  // 11.9% of the amount above the allowance; fractions of a cent are dropped.
  const fullRateCents = Math.floor((taxCents * 55) / 1000);
  const capCents = Math.floor(((taxCents - allowanceCents) * 119) / 1000);
  return Math.min(fullRateCents, capCents) / 100;
}

/** Backwards-compatible current-year entry point. */
export function calculateSolidaritySurcharge(
  incomeTax: number,
  year = 2026,
): number {
  return calculateSolidaritySurchargeForYear(incomeTax, year);
}

export type TradeTaxCalculation = {
  taxableTradeProfit: number;
  tradeTaxBaseAmount: number;
  tradeTax: number;
};

/**
 * Gewerbesteuer for a sole trader. §11 GewStG requires the Gewerbeertrag to
 * be rounded down to full €100 before the €24,500 allowance and 3.5% rate.
 */
export function calculateTradeTaxDetails(
  profit: number,
  hebesatz: number,
): TradeTaxCalculation {
  if (!Number.isFinite(profit) || !Number.isFinite(hebesatz)) {
    throw new RangeError("Gewinn und Hebesatz müssen endlich sein");
  }
  const roundedProfit = Math.floor(Math.max(0, profit) / 100) * 100;
  const taxableTradeProfit = Math.max(0, roundedProfit - 24_500);
  const tradeTaxBaseAmount = taxableTradeProfit * 0.035;
  return {
    taxableTradeProfit,
    tradeTaxBaseAmount,
    tradeTax: floorCents(tradeTaxBaseAmount * (Math.max(0, hebesatz) / 100)),
  };
}

export function calculateTradeTax(profit: number, hebesatz: number): number {
  return calculateTradeTaxDetails(profit, hebesatz).tradeTax;
}

export type TradeTaxCreditInput = {
  incomeTax: number;
  businessProfit: number;
  totalPositiveIncome: number;
  tradeTaxBaseAmount: number;
  actuallyPayableTradeTax: number;
};

/**
 * §35 EStG credit for a sole trader. The proportional cap is based on the
 * share of positive business income in all positive income. The result is
 * limited by four times the (rounded) trade-tax base, the actually payable
 * trade tax, the proportional §35 cap and the available income tax.
 */
export function calculateTradeTaxCredit(input: TradeTaxCreditInput): number {
  for (const value of Object.values(input)) {
    if (!Number.isFinite(value)) throw new RangeError("§35-Berechnungswerte müssen endlich sein");
  }
  const businessShare = input.totalPositiveIncome > 0
    ? Math.min(1, Math.max(0, input.businessProfit) / input.totalPositiveIncome)
    : 0;
  const proportionalCap = Math.max(0, input.incomeTax) * businessShare;
  const fourfoldMessbetrag = Math.max(0, input.tradeTaxBaseAmount) * 4;
  return floorCents(Math.min(
    Math.max(0, input.incomeTax),
    Math.max(0, input.actuallyPayableTradeTax),
    fourfoldMessbetrag,
    proportionalCap,
  ));
}

export function calculateChurchTax(incomeTax: number, rate: number): number {
  return floorCents(Math.max(0, incomeTax) * (Math.max(0, rate) / 100));
}
