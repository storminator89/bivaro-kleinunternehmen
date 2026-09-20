import { describe, expect, it } from 'vitest';

import {
  MONEY_MAX_CENTS,
  formatMoneyEUR,
  inspectMoneyEUR,
  parseMoneyEUR,
  sumDecimalEUR,
} from '../money';

describe('MoneyEUR policy', () => {
  it('uses signed half away from zero and rejects sub-cent values in strict mode', () => {
    expect(parseMoneyEUR('0.10')).toBe(BigInt(10));
    expect(parseMoneyEUR('0.20')).toBe(BigInt(20));
    expect(parseMoneyEUR('1.005', { mode: 'normalize' })).toBe(BigInt(101));
    expect(parseMoneyEUR('-1.005', { mode: 'normalize' })).toBe(BigInt(-101));
    expect(() => parseMoneyEUR('1.005')).toThrow(/strict mode/);
  });

  it('accepts exact decimal strings and rejects non-finite, unsafe and overflow input', () => {
    expect(parseMoneyEUR('92233720368547758.07')).toBe(MONEY_MAX_CENTS);
    expect(parseMoneyEUR('-92233720368547758.07')).toBe(-MONEY_MAX_CENTS);
    expect(() => parseMoneyEUR('92233720368547758.08')).toThrow(/Cent-Bereich/);
    expect(() => parseMoneyEUR(Number.MAX_SAFE_INTEGER + 1)).toThrow(/Unsicherer Number/);
    expect(() => parseMoneyEUR(90071992547409.92)).toThrow(/Unsicherer Number/);
    expect(() => parseMoneyEUR(Number.NaN)).toThrow(/endlich/);
    expect(formatMoneyEUR(BigInt(-101))).toBe('-1.01');
  });

  it('keeps migration differences explicit and sums source decimals exactly', () => {
    expect(inspectMoneyEUR(1.005)).toEqual({
      sourceValue: '1.005',
      normalizedCents: BigInt(101),
      differenceCents: '0.5',
      error: null,
    });
    expect(inspectMoneyEUR('1e1000').error).toMatch(/Eingabebereich/);
    expect(sumDecimalEUR(['0.1', '0.2', '-0.3'])).toBe('0');
  });
});
