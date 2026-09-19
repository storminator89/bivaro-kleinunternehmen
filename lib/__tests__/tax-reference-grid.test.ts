import { describe, expect, it } from 'vitest';
import { calculateIncomeTaxForYear, calculateSolidaritySurchargeForYear } from '@/lib/tax-calculator';

// Independent integer/rational reference, deliberately not importing rule packs.
// 2025: https://esth.bundesfinanzministerium.de/esth/2025/A-Einkommensteuergesetz/IV-Tarif-31-34b/Paragraf-32a/inhalt.html
// 2026: https://www.gesetze-im-internet.de/estg/__32a.html
// Soli: https://lsth.bundesfinanzministerium.de/lsth/2025/B-Anhaenge/Anhang-27/I/inhalt.html
//       https://www.gesetze-im-internet.de/solzg_1995/BJNR097500993.html
const b = BigInt;
function referenceTariff(income: number, year: number): number {
  const n = b(income);
  const [allowance, firstEnd, secondEnd, firstCoefficient, secondCoefficient, constant, topConstant, richConstant] = year === 2025
    ? [12096, 17443, 68480, 93230, 17664, 101513, 1091192, 1924667]
    : [12348, 17799, 69878, 91451, 17310, 103487, 1113563, 1947038];
  if (income <= allowance) return 0;
  if (income <= firstEnd) {
    const d = n - b(allowance);
    return Number((b(firstCoefficient) * d * d + b(1400000000) * d) / b(10000000000));
  }
  if (income <= secondEnd) {
    const d = n - b(firstEnd);
    return Number((b(secondCoefficient) * d * d + b(2397000000) * d + b(constant) * b(100000000)) / b(10000000000));
  }
  return Number((income <= 277825 ? b(42) * n - b(topConstant) : b(45) * n - b(richConstant)) / b(100));
}

describe('independent tax arithmetic review', () => {
  it.each([2025, 2026])('matches the exact tariff at every whole euro through 400,000 for %i', year => {
    const differences: number[] = [];
    for (let income = 0; income <= 400000; income++) {
      if (calculateIncomeTaxForYear(income, year) !== referenceTariff(income, year)) differences.push(income);
    }
    expect(differences).toEqual([]);
  });

  it.each([2025, 2026])('matches exact Soli cent truncation through 100,000 income tax for %i', year => {
    const allowance = year === 2025 ? 19950 : 20350;
    const differences: number[] = [];
    for (let tax = 0; tax <= 100000; tax++) {
      const full = b(55) * b(tax);
      const cap = b(119) * b(Math.max(0, tax - allowance));
      const expected = Number((full < cap ? full : cap) / b(10)) / 100;
      if (Math.abs(calculateSolidaritySurchargeForYear(tax, year) - expected) > 0.000001) differences.push(tax);
    }
    expect(differences).toEqual([]);
  });
});
