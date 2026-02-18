
/**
 * Berechnet die Einkommensteuer nach dem deutschen Einkommensteuertarif 2026.
 * Formeln basieren auf § 32a EStG (Steuerfortentwicklungsgesetz).
 */
export function calculateIncomeTax(taxableIncome: number): number {
  // Abrunden auf vollen Euro
  const zvE = Math.floor(taxableIncome);

  if (zvE <= 12348) {
    return 0;
  } else if (zvE <= 17799) {
    const y = (zvE - 12348) / 10000;
    return (914.51 * y + 1400) * y;
  } else if (zvE <= 69878) {
    const z = (zvE - 17799) / 10000;
    return (173.10 * z + 2397) * z + 1034.87;
  } else if (zvE <= 277825) {
    return 0.42 * zvE - 11135.63;
  } else {
    return 0.45 * zvE - 19470.38;
  }
}

/**
 * Berechnet den Solidaritätszuschlag 2026.
 * Freigrenze: 20.350 € Einkommensteuer (Einzelveranlagung).
 */
export function calculateSolidaritySurcharge(incomeTax: number): number {
  if (incomeTax <= 20350) {
    return 0;
  } else if (incomeTax <= 37843) {
    // Milderungszone: Differenz zur Freigrenze * 11,9%
    return (incomeTax - 20350) * 0.119;
  } else {
    return incomeTax * 0.055;
  }
}

/**
 * Berechnet die Gewerbesteuer.
 * Freibetrag für Einzelunternehmen: 24.500 €.
 * Steuermesszahl: 3,5%.
 */
export function calculateTradeTax(profit: number, hebesatz: number): number {
  const taxableTradeProfit = Math.max(0, profit - 24500);
  const tradeTaxBase = taxableTradeProfit * 0.035;
  return tradeTaxBase * (hebesatz / 100);
}

/**
 * Berechnet die Kirchensteuer (pauschal 8% oder 9% der Einkommensteuer).
 * Wirkt sich als Sonderausgabe mindernd aus (in manchen Fällen, hier vereinfacht nicht berücksichtigt in der Basis, 
 * da Sonderausgabenabzug für KiSt komplex ist und oft gedeckelt).
 */
export function calculateChurchTax(incomeTax: number, rate: number): number {
  return incomeTax * (rate / 100);
}
