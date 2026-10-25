import { Prisma } from '@prisma/client';
import type { RecordSearchType } from './contract';

/**
 * One match contract for palette candidates and full-list continuations.
 * Values are always bound parameters; %, _ and backslashes are literal.
 * SQLite lower folds ASCII only, so Unicode remains literal, not fuzzy.
 * Use only against the corresponding single source table (no relation joins).
 */
export function ownedRecordMatch(type: RecordSearchType, userId: string, query: string): Prisma.Sql {
  if (type === 'customer') return Prisma.sql`"userId" = ${userId} AND instr(lower("name"), lower(${query})) > 0`;
  if (type === 'outbound') return Prisma.sql`"userId" = ${userId} AND "type" IN ('INVOICE', 'CREDIT_NOTE') AND instr(lower("invoiceNumber"), lower(${query})) > 0`;
  return Prisma.sql`"userId" = ${userId} AND (instr(lower("invoiceNumber"), lower(${query})) > 0 OR instr(lower("originalFileName"), lower(${query})) > 0)`;
}
