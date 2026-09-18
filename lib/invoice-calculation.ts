/**
 * Monetary calculation for invoice lines.
 *
 * JavaScript numbers are used at the public boundary because that is what the
 * invoice form and Prisma model expose.  Internally every value is converted
 * to a decimal BigInt representation before it is multiplied or rounded.  A
 * line net amounts are rounded independently to cents. Tax bases are then
 * grouped by category and rate and each group's tax is rounded once.
 */

export type InvoiceCalculationItem = {
  quantity: number;
  unitPrice: number;
  taxRate?: number;
  taxCategory?: 'S' | 'E' | 'Z';
};

export type CalculatedInvoiceLine = {
  netAmount: number;
  taxAmount: number;
};

export type CalculatedInvoiceAmounts = {
  lines: CalculatedInvoiceLine[];
  netAmount: number;
  taxAmount: number;
  grossAmount: number;
};

export type CalculatedInvoiceTaxGroup = {
  category: 'S' | 'E' | 'Z';
  rate: number;
  basisAmount: number;
  taxAmount: number;
};

type Decimal = {
  coefficient: bigint;
  scale: number;
};

const MAX_DECIMAL_SCALE = 12;
const BIGINT_ZERO = BigInt(0);
const BIGINT_ONE = BigInt(1);
const BIGINT_NEGATIVE_ONE = BigInt(-1);
const BIGINT_TEN = BigInt(10);

function decimalFromNumber(value: number, field: string): Decimal {
  if (!Number.isFinite(value)) {
    throw new Error(`${field} muss eine endliche Zahl sein.`);
  }

  // String(value) is intentional: it prevents binary floating point
  // operations from affecting the arithmetic below.  Exponential notation is
  // expanded so that all operations remain integer operations.
  const source = String(value).trim();
  const match = source.match(/^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match) {
    throw new Error(`${field} hat kein unterstütztes Zahlenformat.`);
  }

  const sign = match[1] === '-' ? BIGINT_NEGATIVE_ONE : BIGINT_ONE;
  const whole = match[2];
  const fraction = match[3] || '';
  const exponent = Number(match[4] || 0);
  const digits = BigInt(`${whole}${fraction}` || '0');
  const scale = fraction.length - exponent;

  if (Math.abs(scale) > MAX_DECIMAL_SCALE || Math.abs(exponent) > MAX_DECIMAL_SCALE) {
    throw new Error(`${field} hat zu viele Dezimalstellen.`);
  }

  if (scale >= 0) {
    return { coefficient: sign * digits, scale };
  }

  return {
    coefficient: sign * digits * BIGINT_TEN ** BigInt(-scale),
    scale: 0,
  };
}

function multiply(left: Decimal, right: Decimal): Decimal {
  return {
    coefficient: left.coefficient * right.coefficient,
    scale: left.scale + right.scale,
  };
}

function roundToCents(value: Decimal): bigint {
  if (value.scale <= 2) {
    return value.coefficient * BIGINT_TEN ** BigInt(2 - value.scale);
  }

  const divisor = BIGINT_TEN ** BigInt(value.scale - 2);
  const sign = value.coefficient < BIGINT_ZERO ? BIGINT_NEGATIVE_ONE : BIGINT_ONE;
  const absolute = value.coefficient < BIGINT_ZERO ? -value.coefficient : value.coefficient;
  const quotient = absolute / divisor;
  const remainder = absolute % divisor;
  const rounded = remainder * BigInt(2) >= divisor ? quotient + BIGINT_ONE : quotient;
  return sign * rounded;
}

function centsToNumber(cents: bigint): number {
  const value = Number(cents);
  if (!Number.isSafeInteger(value)) {
    throw new Error('Betrag überschreitet den unterstützten Zahlenbereich.');
  }
  return value / 100;
}

function assertNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} darf nicht negativ sein und muss endlich sein.`);
  }
}

/**
 * Calculate invoice amounts using rounded line values.
 *
 * `taxRate` is interpreted as a percentage (19 means 19%).  The function
 * deliberately does not use an input `total` field: the transmitted quantity
 * and unit price are the source of the line amount, which keeps XML values and
 * header totals consistent.
 */
type InternalLine = {
  netCents: bigint;
  lineTaxCents: bigint;
  rate: number;
  category: 'S' | 'E' | 'Z';
};

type InternalGroup = {
  basisCents: bigint;
  rate: Decimal;
  category: 'S' | 'E' | 'Z';
};

function calculateLineCalculations(items: InvoiceCalculationItem[]): InternalLine[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Mindestens eine Rechnungsposition ist erforderlich.');
  }

  return items.map((item, index) => {
    const prefix = `Position ${index + 1}`;
    assertNonNegative(item.quantity, `${prefix}: Menge`);
    if (item.quantity <= 0) {
      throw new Error(`${prefix}: Menge muss größer als 0 sein.`);
    }
    assertNonNegative(item.unitPrice, `${prefix}: Einzelpreis`);

    const rate = item.taxRate ?? 0;
    assertNonNegative(rate, `${prefix}: Steuersatz`);

    const netCents = roundToCents(multiply(
      decimalFromNumber(item.quantity, `${prefix}: Menge`),
      decimalFromNumber(item.unitPrice, `${prefix}: Einzelpreis`),
    ));
    // The percentage denominator is 100.  Dividing after multiplication keeps
    // the full precision of rates before the mandatory cent rounding.
    const decimalRate = decimalFromNumber(rate, `${prefix}: Steuersatz`);
    const lineTaxCents = roundToCents({
      coefficient: netCents * decimalRate.coefficient,
      scale: 2 + decimalRate.scale + 2,
    });

    return {
      netCents,
      lineTaxCents,
      rate,
      category: item.taxCategory || (rate === 0 ? 'E' : 'S'),
    };
  });
}

function groupLineCalculations(lineCalculations: InternalLine[]): InternalGroup[] {
  const groups = new Map<string, InternalGroup>();
  lineCalculations.forEach(line => {
    const rate = decimalFromNumber(line.rate, 'Steuersatz');
    const key = `${line.category}:${rate.coefficient.toString()}:${rate.scale}`;
    const group = groups.get(key);
    if (group) group.basisCents += line.netCents;
    else groups.set(key, { basisCents: line.netCents, rate, category: line.category });
  });
  return [...groups.values()];
}

export function calculateInvoiceAmounts(items: InvoiceCalculationItem[]): CalculatedInvoiceAmounts {
  const lineCalculations = calculateLineCalculations(items);
  const groups = groupLineCalculations(lineCalculations);
  const netCents = lineCalculations.reduce((sum, line) => sum + line.netCents, BIGINT_ZERO);
  const taxCents = groups.reduce((sum, group) => sum + roundToCents({
    coefficient: group.basisCents * group.rate.coefficient,
    scale: 2 + group.rate.scale + 2,
  }), BIGINT_ZERO);

  return {
    lines: lineCalculations.map(line => ({
      netAmount: centsToNumber(line.netCents),
      taxAmount: centsToNumber(line.lineTaxCents),
    })),
    netAmount: centsToNumber(netCents),
    taxAmount: centsToNumber(taxCents),
    grossAmount: centsToNumber(netCents + taxCents),
  };
}

/**
 * Return the exact rounded tax groups used by `calculateInvoiceAmounts`.
 * Keeping this alongside the amount calculation prevents XML header tax
 * groups from reintroducing binary floating point summation.
 */
export function calculateInvoiceTaxGroups(items: InvoiceCalculationItem[]): CalculatedInvoiceTaxGroup[] {
  return groupLineCalculations(calculateLineCalculations(items)).map(group => ({
    category: group.category,
    rate: Number(group.rate.coefficient) / 10 ** group.rate.scale,
    basisAmount: centsToNumber(group.basisCents),
    taxAmount: centsToNumber(roundToCents({
      coefficient: group.basisCents * group.rate.coefficient,
      scale: 2 + group.rate.scale + 2,
    })),
  }));
}

/** Internal helper used by the XML generator after line amounts are rounded. */
export function roundInvoiceAmount(value: number): number {
  return centsToNumber(roundToCents(decimalFromNumber(value, 'Betrag')));
}
