import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';

import { MONEY_CURRENCY, MONEY_POLICY_VERSION, MONEY_ROUNDING, inspectMoneyEUR, sumDecimalEUR } from './money.ts';

type ReadRow = { id: number; value: unknown };

type MoneyColumn = {
  model: string;
  field: string;
  read: (client: Prisma.TransactionClient, take: number) => Promise<ReadRow[]>;
};

/** The complete set of current Prisma Float fields that store EUR amounts. */
export const PRISMA_MONEY_COLUMNS: readonly MoneyColumn[] = [
  {
    model: 'Expense',
    field: 'amount',
    read: async (client, take) => (await client.expense.findMany({ select: { id: true, amount: true }, take }))
      .map(row => ({ id: row.id, value: row.amount })),
  },
  {
    model: 'Income',
    field: 'amount',
    read: async (client, take) => (await client.income.findMany({ select: { id: true, amount: true }, take }))
      .map(row => ({ id: row.id, value: row.amount })),
  },
  {
    model: 'Invoice',
    field: 'totalAmount',
    read: async (client, take) => (await client.invoice.findMany({ select: { id: true, totalAmount: true }, take }))
      .map(row => ({ id: row.id, value: row.totalAmount })),
  },
  {
    model: 'RecurringExpense',
    field: 'amount',
    read: async (client, take) => (await client.recurringExpense.findMany({ select: { id: true, amount: true }, take }))
      .map(row => ({ id: row.id, value: row.amount })),
  },
  {
    model: 'Reminder',
    field: 'fee',
    read: async (client, take) => (await client.reminder.findMany({ select: { id: true, fee: true }, take }))
      .map(row => ({ id: row.id, value: row.fee })),
  },
  {
    model: 'CashBook',
    field: 'initialBalance',
    read: async (client, take) => (await client.cashBook.findMany({ select: { id: true, initialBalance: true }, take }))
      .map(row => ({ id: row.id, value: row.initialBalance })),
  },
  {
    model: 'CashTransaction',
    field: 'amount',
    read: async (client, take) => (await client.cashTransaction.findMany({ select: { id: true, amount: true }, take }))
      .map(row => ({ id: row.id, value: row.amount })),
  },
  {
    model: 'CashTransaction',
    field: 'runningBalance',
    read: async (client, take) => (await client.cashTransaction.findMany({ select: { id: true, runningBalance: true }, take }))
      .map(row => ({ id: row.id, value: row.runningBalance })),
  },
];

/** Float fields intentionally excluded from the EUR money inventory. */
export const PRISMA_MONEY_FLOAT_EXCLUSIONS = [
  { model: 'Expense', field: 'taxDeductiblePercentage', reason: 'percentage, not a currency amount' },
  { model: 'RecurringExpense', field: 'taxDeductiblePercentage', reason: 'percentage, not a currency amount' },
] as const;
/** JSON can contain historical document amounts, but has no typed money field. */
export const PRISMA_MONEY_JSON_EXCLUSIONS = [
  { model: 'Invoice', field: 'parsedData', reason: 'embedded amounts require the BV-013 snapshot contract' },
] as const;
export const MAX_MONEY_REPORT_ROWS = 100_000;

export type MoneyMigrationRow = {
  model: string;
  field: string;
  id: number;
  sourceValue: string | null;
  normalizedCents: string | null;
  differenceCents: string | null;
  error: string | null;
};

export type MoneyMigrationColumnSummary = {
  model: string;
  field: string;
  rows: number;
  nullValues: number;
  errors: number;
  sourceTotalEUR: string;
  normalizedTotalCents: string;
  differenceTotalCents: string;
};

export type MoneyMigrationReport = {
  snapshotTime: string;
  readOnlyVerification?: {
    before: { sha256: string; mtimeMs: number; size: number };
    after: { sha256: string; mtimeMs: number; size: number };
    unchanged: boolean;
  };
  status: 'READY' | 'BLOCKED';
  migrationBlocked: boolean;
  policy: {
    version: string;
    currency: string;
    rounding: string;
    mode: 'read-only';
    excludedFloatFields: readonly { model: string; field: string; reason: string }[];
    excludedJsonFields: readonly { model: string; field: string; reason: string }[];
  };
  columns: MoneyMigrationColumnSummary[];
  rows: MoneyMigrationRow[];
  totals: {
    scope: 'technical-control-sum-across-columns';
    rows: number;
    nullValues: number;
    errors: number;
    normalizedTotalCents: string;
    differenceTotalCents: string;
  };
};

function sumCents(values: readonly bigint[]): bigint {
  return values.reduce((sum, value) => sum + value, BigInt(0));
}

function sumDecimalStrings(values: readonly string[]): string {
  return values.length === 0 ? '0' : sumDecimalEUR(values);
}

/**
 * Read every existing Prisma money Float in one transaction and return a
 * PII-free reconciliation report. The caller owns the PrismaClient lifecycle.
 */
export async function createMoneyMigrationReport(
  client: PrismaClient,
  options: { maxRows?: number } = {},
): Promise<MoneyMigrationReport> {
  const maxRows = options.maxRows ?? MAX_MONEY_REPORT_ROWS;
  if (!Number.isSafeInteger(maxRows) || maxRows < 1) {
    throw new Error('maxRows muss eine positive sichere Ganzzahl sein.');
  }
  return client.$transaction(async transaction => {
    // SQLite keeps this transaction read-only even if a future report query
    // accidentally becomes a write. The transaction still gives one snapshot.
    const previousQueryOnly = (await transaction.$queryRawUnsafe<Array<{ query_only: number }>>('PRAGMA query_only'))[0]?.query_only ?? 0;
    await transaction.$executeRawUnsafe('PRAGMA query_only = ON');
    try {
      const snapshotTime = new Date().toISOString();
      const rows: MoneyMigrationRow[] = [];
      const columns: MoneyMigrationColumnSummary[] = [];

    for (const column of PRISMA_MONEY_COLUMNS) {
      const sourceRows = await column.read(transaction, maxRows - rows.length + 1);
      if (rows.length + sourceRows.length > maxRows) {
        throw new Error(`Money-Migrationsbericht überschreitet das Zeilenlimit (${maxRows}).`);
      }
      const reportRows: MoneyMigrationRow[] = [];
      const sourceValues: string[] = [];
      const normalizedCents: bigint[] = [];
      const differences: string[] = [];
      let nullValues = 0;
      let errors = 0;

      for (const sourceRow of sourceRows) {
        if (sourceRow.value === null) {
          nullValues += 1;
          reportRows.push({
            model: column.model,
            field: column.field,
            id: sourceRow.id,
            sourceValue: null,
            normalizedCents: null,
            differenceCents: null,
            error: null,
          });
          continue;
        }

        const inspection = inspectMoneyEUR(sourceRow.value);
        const reportRow: MoneyMigrationRow = {
          model: column.model,
          field: column.field,
          id: sourceRow.id,
          sourceValue: inspection.sourceValue,
          normalizedCents: inspection.normalizedCents?.toString() ?? null,
          differenceCents: inspection.differenceCents,
          error: inspection.error,
        };
        reportRows.push(reportRow);
        if (inspection.error) {
          errors += 1;
          continue;
        }
        sourceValues.push(inspection.sourceValue);
        normalizedCents.push(inspection.normalizedCents as bigint);
        differences.push(inspection.differenceCents as string);
      }

      rows.push(...reportRows);
      columns.push({
        model: column.model,
        field: column.field,
        rows: reportRows.length,
        nullValues,
        errors,
        sourceTotalEUR: sumDecimalStrings(sourceValues),
        normalizedTotalCents: sumCents(normalizedCents).toString(),
        differenceTotalCents: sumDecimalStrings(differences),
      });
    }

    const allNormalized = rows.flatMap(row => row.normalizedCents === null ? [] : [BigInt(row.normalizedCents)]);
    const allDifferences = rows.flatMap(row => row.differenceCents === null ? [] : [row.differenceCents]);
    const errorCount = columns.reduce((sum, column) => sum + column.errors, 0);
      return {
        snapshotTime,
        status: errorCount === 0 ? 'READY' : 'BLOCKED',
        migrationBlocked: errorCount > 0,
        policy: {
          version: MONEY_POLICY_VERSION,
          currency: MONEY_CURRENCY,
          rounding: MONEY_ROUNDING,
          mode: 'read-only',
          excludedFloatFields: PRISMA_MONEY_FLOAT_EXCLUSIONS,
          excludedJsonFields: PRISMA_MONEY_JSON_EXCLUSIONS,
        },
        columns,
        rows,
        totals: {
          scope: 'technical-control-sum-across-columns',
          rows: rows.length,
          nullValues: columns.reduce((sum, column) => sum + column.nullValues, 0),
          errors: errorCount,
          normalizedTotalCents: sumCents(allNormalized).toString(),
          differenceTotalCents: sumDecimalStrings(allDifferences),
        },
      };
    } finally {
      await transaction.$executeRawUnsafe(`PRAGMA query_only = ${previousQueryOnly ? 'ON' : 'OFF'}`);
    }
  });
}
