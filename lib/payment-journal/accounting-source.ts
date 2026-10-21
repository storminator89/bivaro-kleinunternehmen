import { Prisma } from '@prisma/client';
/** Single operational signed-cent SQL source; Income is the root's projection, never an extra receipt.
 * Fiscal classification is intentionally not supplied by this contract.
 */
export function operationalIncomeEntriesSql(userId: string): Prisma.Sql {
  const epoch = (value: Prisma.Sql) => Prisma.sql`CASE WHEN typeof(${value}) IN ('integer','real') THEN ${value} ELSE round((julianday(${value})-2440587.5)*86400000.0) END`;
  const date = epoch(Prisma.sql`CASE WHEN payment."dateCertainty"='ACTUAL' AND payment."paidAt" IS NOT NULL THEN payment."paidAt"
    WHEN invoice."status" IN ('PAID','CANCELLED') AND invoice."paidAt" IS NOT NULL THEN invoice."paidAt" ELSE entry."date" END`);
  const effective = epoch(Prisma.sql`adjustment."accountingEffectiveOn"`);
  return Prisma.sql`
    SELECT entry.id, entry.description, CASE WHEN payment."dateCertainty"='ACTUAL' THEN CAST(payment."amountCents" AS INTEGER) ELSE CAST(round(entry.amount*100) AS INTEGER) END AS amountCents,
      ${date} AS bookingDate, 'RECEIPT' AS movementKind, entry."invoiceId" AS invoiceId
    FROM "Income" entry LEFT JOIN "Invoice" invoice ON invoice.id=entry."invoiceId"
    LEFT JOIN "PaymentJournalEvent" payment ON payment."incomeId"=entry.id AND payment."userId"=entry."userId" AND payment."invoiceId"=entry."invoiceId"
    WHERE entry."userId"=${userId} AND entry."taxRelevant"=1 AND (entry."invoiceId" IS NULL OR invoice.id IS NULL
      OR (payment."dateCertainty"='ACTUAL' AND payment."paidAt" IS NOT NULL) OR invoice.status='PAID' OR (invoice.status='CANCELLED' AND invoice."paidAt" IS NOT NULL))
    UNION ALL
    SELECT -adjustment.id, CASE WHEN adjustment.kind='CUSTOMER_REFUND' THEN 'Tatsächliche Rückzahlung: ' ELSE 'Nie eingegangene Zahlung berichtigt: ' END || adjustment.reference,
      -CAST(adjustment."amountCents" AS INTEGER), ${effective}, adjustment.kind, adjustment."invoiceId"
    FROM "PaymentAdjustment" adjustment JOIN "PaymentJournalEvent" payment ON payment.id=adjustment."originalPaymentId" AND payment."userId"=adjustment."userId"
    JOIN "Income" entry ON entry.id=payment."incomeId" AND entry."userId"=adjustment."userId"
    WHERE adjustment."userId"=${userId} AND entry."taxRelevant"=1
  `;
}
