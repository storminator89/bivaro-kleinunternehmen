
/**
 * Berechnet die Einkommensteuer nach dem deutschen Einkommensteuertarif 2024.
 * Formeln basieren auf § 32a EStG.
 */
export function calculateIncomeTax(taxableIncome: number): number {
  // Abrunden auf vollen Euro
  const zvE = Math.floor(taxableIncome);

  if (zvE <= 11604) {
    return 0;
  } else if (zvE <= 17005) {
    const y = (zvE - 11604) / 10000;
    return (922.98 * y + 1400) * y;
  } else if (zvE <= 66760) {
    const z = (zvE - 17005) / 10000;
    return (181.19 * z + 2397) * z + 1025.38;
  } else if (zvE <= 277825) {
    return 0.42 * zvE - 9960.28;
  } else {
    return 0.45 * zvE - 18295.03;
  }
}

/**
 * Berechnet den Solidaritätszuschlag 2024.
 * Freigrenze: 18.130 € Einkommensteuer (Einzelveranlagung).
 */
export function calculateSolidaritySurcharge(incomeTax: number): number {
  if (incomeTax <= 18130) {
    return 0;
  } else if (incomeTax <= 33912) {
    // Milderungszone: Differenz zur Freigrenze * 11,9%
    return (incomeTax - 18130) * 0.119;
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
