import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { RECORD_SEARCH_LIMIT, RECORD_SEARCH_MIN_LENGTH, recordSearchPages, recordSearchQuery, type RecordSearchGroup, type RecordSearchItem, type RecordSearchPages, type RecordSearchResult, type RecordSearchType } from './contract';

type Row = { id: number; label: string };
const LABEL_LIMIT = 240;
function group(type: RecordSearchType, page: number, rows: Row[], href: (id: number) => string): RecordSearchGroup {
  return { type, page, hasMore: rows.length > RECORD_SEARCH_LIMIT, items: rows.slice(0, RECORD_SEARCH_LIMIT).map(row => ({ type, id: row.id, label: row.label, href: href(row.id) } satisfies RecordSearchItem)) };
}

/** Literal substring search of owned scalar fields only; no related/private content is loaded. */
export async function searchOwnedRecords(userId: string, value: string, requestedPages?: RecordSearchPages): Promise<RecordSearchResult> {
  const query = recordSearchQuery(value);
  const pages = recordSearchPages(requestedPages);
  if (query.length < RECORD_SEARCH_MIN_LENGTH) return { groups: [] };
  const take = RECORD_SEARCH_LIMIT + 1;
  // Offsets are capped at 95. Each response is current data, not a snapshot
  // across pages: concurrent writes can shift rows; never infer a total count.
  // instr treats %, _ and backslashes literally. SQLite lower folds ASCII;
  // non-ASCII characters match literally (no transliteration/fuzzy matching).
  const [customers, outbound, inbound] = await prisma.$transaction([
    prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT "id", substr("name", 1, ${LABEL_LIMIT}) AS "label" FROM "Customer"
      WHERE "userId" = ${userId} AND instr(lower("name"), lower(${query})) > 0
      ORDER BY "name" ASC, "id" ASC LIMIT ${take} OFFSET ${pages.customer * RECORD_SEARCH_LIMIT}
    `),
    prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT "id", substr("invoiceNumber", 1, ${LABEL_LIMIT}) AS "label" FROM "Invoice"
      WHERE "userId" = ${userId} AND "type" IN ('INVOICE', 'CREDIT_NOTE')
        AND instr(lower("invoiceNumber"), lower(${query})) > 0
      ORDER BY "uploadedAt" DESC, "id" DESC LIMIT ${take} OFFSET ${pages.outbound * RECORD_SEARCH_LIMIT}
    `),
    prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT "id", substr(coalesce(nullif("invoiceNumber", ''), "originalFileName"), 1, ${LABEL_LIMIT}) AS "label"
      FROM "PurchaseDocument" WHERE "userId" = ${userId}
        AND (instr(lower("invoiceNumber"), lower(${query})) > 0 OR instr(lower("originalFileName"), lower(${query})) > 0)
      ORDER BY "uploadedAt" DESC, "id" DESC LIMIT ${take} OFFSET ${pages.inbound * RECORD_SEARCH_LIMIT}
    `),
  ]);
  return { groups: [
    group('customer', pages.customer, customers, id => `/customers?customer=${id}`),
    group('outbound', pages.outbound, outbound, id => `/dashboard?tab=invoices&document=${id}`),
    group('inbound', pages.inbound, inbound, id => `/purchases?document=${id}`),
  ] };
}
