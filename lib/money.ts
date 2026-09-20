/**
 * Versioned EUR money policy used by migration tooling and future write paths.
 *
 * Amounts are represented as integer cents. Decimal input is parsed without
 * JavaScript floating point arithmetic and, when normalisation is requested,
 * rounded with signed half away from zero (the same rule as invoice-calculation).
 */

export const MONEY_POLICY_VERSION = 'money-eur-v1';
export const MONEY_CURRENCY = 'EUR';
export const MONEY_ROUNDING = 'SIGNED_HALF_AWAY_FROM_ZERO';
export const MONEY_MAX_CENTS = BigInt('9223372036854775807');

type Decimal = { coefficient: bigint; scale: number };

export type MoneyInput = string | number;
export type MoneyParseMode = 'strict' | 'normalize';

export class MoneyParseError extends Error {
  readonly code: 'INVALID' | 'FRACTION' | 'OVERFLOW';

  constructor(code: MoneyParseError['code'], message: string) {
    super(message);
    this.name = 'MoneyParseError';
    this.code = code;
  }
}

export type MoneyInspection = {
  sourceValue: string;
  normalizedCents: bigint | null;
  differenceCents: string | null;
  error: string | null;
};

const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i;
const MAX_INPUT_DIGITS = 128;

function decimalFromInput(value: unknown): Decimal {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new MoneyParseError('INVALID', 'EUR-Betrag muss eine Zahl oder Dezimalzeichenfolge sein.');
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new MoneyParseError('INVALID', 'EUR-Betrag muss endlich sein.');
  }
  // A Number this large cannot retain cent precision. Require an exact
  // decimal string at that boundary instead of pretending String(number) is
  // the original amount.
  if (typeof value === 'number' && Math.abs(value) > Number.MAX_SAFE_INTEGER / 100) {
    throw new MoneyParseError('OVERFLOW', 'Unsicherer Number-EUR-Betrag; bitte als Dezimalzeichenfolge übergeben.');
  }

  const source = String(value).trim();
  const match = source.match(DECIMAL_PATTERN);
  if (!match) {
    throw new MoneyParseError('INVALID', 'EUR-Betrag hat kein unterstütztes Dezimalformat.');
  }

  const whole = match[2];
  const fraction = match[3] ?? '';
  const exponentText = match[4] ?? '0';
  const exponent = Number(exponentText);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_INPUT_DIGITS) {
    throw new MoneyParseError('OVERFLOW', 'EUR-Betrag überschreitet den unterstützten Eingabebereich.');
  }
  if (whole.length + fraction.length > MAX_INPUT_DIGITS) {
    throw new MoneyParseError('OVERFLOW', 'EUR-Betrag überschreitet den unterstützten Eingabebereich.');
  }

  const digits = BigInt(`${whole}${fraction}` || '0');
  const coefficient = match[1] === '-' ? -digits : digits;
  const scale = fraction.length - exponent;
  if (scale < 0) {
    return { coefficient: coefficient * BigInt(10) ** BigInt(-scale), scale: 0 };
  }
  return { coefficient, scale };
}

function roundedCents(decimal: Decimal): { cents: bigint; remainder: bigint; divisor: bigint } {
  if (decimal.scale <= 2) {
    return { cents: decimal.coefficient * BigInt(10) ** BigInt(2 - decimal.scale), remainder: BigInt(0), divisor: BigInt(1) };
  }

  const divisor = BigInt(10) ** BigInt(decimal.scale - 2);
  const absolute = decimal.coefficient < BigInt(0) ? -decimal.coefficient : decimal.coefficient;
  const quotient = absolute / divisor;
  const remainder = absolute % divisor;
  const rounded = remainder * BigInt(2) >= divisor ? quotient + BigInt(1) : quotient;
  return { cents: decimal.coefficient < BigInt(0) ? -rounded : rounded, remainder, divisor };
}

function assertRange(cents: bigint): void {
  if (cents > MONEY_MAX_CENTS || cents < -MONEY_MAX_CENTS) {
    throw new MoneyParseError('OVERFLOW', 'EUR-Betrag überschreitet den unterstützten Cent-Bereich.');
  }
}

/** Parse EUR input into cents. Strict mode rejects any non-zero fraction below one cent. */
export function parseMoneyEUR(value: MoneyInput, options: { mode?: MoneyParseMode } = {}): bigint {
  const decimal = decimalFromInput(value);
  const rounded = roundedCents(decimal);
  if ((options.mode ?? 'strict') === 'strict' && rounded.remainder !== BigInt(0)) {
    throw new MoneyParseError('FRACTION', 'EUR-Betrag ist nicht centgenau; strict mode rundet nicht still.');
  }
  assertRange(rounded.cents);
  return rounded.cents;
}

function formatSignedDecimal(numerator: bigint, scale: number): string {
  if (numerator === BigInt(0)) return '0';
  const negative = numerator < BigInt(0);
  const absolute = negative ? -numerator : numerator;
  const raw = absolute.toString().padStart(scale + 1, '0');
  const split = scale === 0 ? raw : `${raw.slice(0, -scale)}.${raw.slice(-scale)}`;
  const trimmed = split.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return negative ? `-${trimmed}` : trimmed;
}

function differenceCents(decimal: Decimal, cents: bigint): string {
  if (decimal.scale <= 2) {
    return formatSignedDecimal(cents - decimal.coefficient * BigInt(10) ** BigInt(2 - decimal.scale), 0);
  }
  const divisor = BigInt(10) ** BigInt(decimal.scale - 2);
  return formatSignedDecimal(cents * divisor - decimal.coefficient, decimal.scale - 2);
}

/** Convert a legacy value for a report without hiding rounding or parse errors. */
export function inspectMoneyEUR(value: unknown): MoneyInspection {
  const sourceValue = String(value);
  try {
    const decimal = decimalFromInput(value);
    const rounded = roundedCents(decimal);
    assertRange(rounded.cents);
    return {
      sourceValue,
      normalizedCents: rounded.cents,
      differenceCents: differenceCents(decimal, rounded.cents),
      error: null,
    };
  } catch (error) {
    return {
      sourceValue,
      normalizedCents: null,
      differenceCents: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Add decimal source values exactly for report totals. Invalid values are rejected. */
export function sumDecimalEUR(values: readonly MoneyInput[]): string {
  let coefficient = BigInt(0);
  let scale = 0;
  for (const value of values) {
    const decimal = decimalFromInput(value);
    if (decimal.scale > scale) {
      coefficient *= BigInt(10) ** BigInt(decimal.scale - scale);
      scale = decimal.scale;
    }
    coefficient += decimal.coefficient * BigInt(10) ** BigInt(scale - decimal.scale);
  }
  return formatSignedDecimal(coefficient, scale);
}

export function formatMoneyEUR(cents: bigint): string {
  assertRange(cents);
  return formatSignedDecimal(cents, 2);
}
