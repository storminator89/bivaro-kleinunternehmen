import { expect, it } from 'vitest';
import { parseMoneyEUR, formatMoneyEUR } from '@/lib/money';
import { roundInvoiceAmount } from '@/lib/invoice-calculation';

it('matches the existing invoice rounding policy across signed half-cent boundaries', () => {
  for (let mills = -20_000; mills <= 20_000; mills++) {
    const value = mills / 1000;
    const expectedAbsoluteCents = Math.floor((Math.abs(mills) + 5) / 10);
    const expectedCents = BigInt(mills < 0 ? -expectedAbsoluteCents : expectedAbsoluteCents);
    const cents = parseMoneyEUR(String(value), { mode: 'normalize' });
    expect(cents).toBe(expectedCents);
    expect(Number(formatMoneyEUR(cents))).toBe(roundInvoiceAmount(value) || 0);
  }
});

it('round-trips exact large decimal cents without conversion through Number', () => {
  const cases = ['0', '0.01', '-0.01', '90071992547409.93', '-90071992547409.93', '92233720368547758.07'];
  for (const value of cases) expect(parseMoneyEUR(formatMoneyEUR(parseMoneyEUR(value)))).toBe(parseMoneyEUR(value));
});
