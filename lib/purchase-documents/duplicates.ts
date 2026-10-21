import { Prisma } from '@prisma/client';

/** Conservative source-name/number hints only; owner predicate and 51-row ceiling are mandatory. */
export async function findPurchaseDuplicateHints(tx: Pick<Prisma.TransactionClient, '$queryRaw'>, userId: string, id: number, supplier: string | null, number: string | null) {
  if (!supplier?.trim() || !number?.trim()) return [];
  return tx.$queryRaw<Array<{ id: number; supplierName: string | null; invoiceNumber: string | null; invoiceDate: Date | null; currency: string | null; grossAmount: unknown; reviewStatus: string; revision: number; expenseId: number | null }>>(Prisma.sql`
    SELECT "id", "supplierName", "invoiceNumber", "invoiceDate", "currency", "reviewStatus", "revision", "expenseId",
      CASE WHEN "parseStatus" = 'PARSED' AND json_type("parsedData", '$.grossAmount') = 'text' THEN substr(json_extract("parsedData", '$.grossAmount'), 1, 101)
        WHEN json_type("reviewedSourceSnapshot", '$.grossAmount') = 'text' THEN json_extract("reviewedSourceSnapshot", '$.grossAmount') ELSE NULL END AS "grossAmount"
    FROM "PurchaseDocument" WHERE "userId" = ${userId} AND "id" <> ${id}
      AND lower(trim(COALESCE("supplierName", json_extract("reviewedSourceSnapshot", '$.supplierName'), json_extract("reviewDraft", '$.supplierName')))) = lower(trim(${supplier}))
      AND lower(trim(COALESCE("invoiceNumber", json_extract("reviewedSourceSnapshot", '$.invoiceNumber'), json_extract("reviewDraft", '$.invoiceNumber')))) = lower(trim(${number}))
    ORDER BY "id" ASC LIMIT 51
  `);
}
