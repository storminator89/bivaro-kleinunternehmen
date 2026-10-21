-- Additive evidence only. Existing positive events and Income rows stay unchanged.
CREATE TABLE "PaymentOperation" (
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "userId" TEXT NOT NULL,
 "idempotencyKey" TEXT NOT NULL CHECK(length("idempotencyKey") BETWEEN 1 AND 128),
 "kind" TEXT NOT NULL CHECK("kind" IN ('PAYMENT_RECEIVED','PAYMENT_CORRECTION','CUSTOMER_REFUND')),
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PaymentOperation_userId_idempotencyKey_key" ON "PaymentOperation"("userId","idempotencyKey");
CREATE TABLE "PaymentAdjustment" (
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "userId" TEXT NOT NULL, "invoiceId" INTEGER NOT NULL,
 "originalPaymentId" INTEGER NOT NULL, "kind" TEXT NOT NULL CHECK("kind" IN ('PAYMENT_CORRECTION','CUSTOMER_REFUND')),
 "amountCents" TEXT NOT NULL CHECK(length("amountCents") BETWEEN 1 AND 16 AND "amountCents" NOT GLOB '*[^0-9]*'
 AND substr("amountCents",1,1) BETWEEN '1' AND '9' AND (length("amountCents")<16 OR "amountCents"<='9007199254740991')),
 "currency" TEXT NOT NULL DEFAULT 'EUR' CHECK("currency"='EUR'),
 "actionDate" DATETIME NOT NULL, "accountingEffectiveOn" DATETIME NOT NULL,
 "reason" TEXT NOT NULL CHECK(length(trim("reason")) BETWEEN 1 AND 1000),
 "reference" TEXT NOT NULL CHECK(length(trim("reference")) BETWEEN 1 AND 255),
 "payoutEvidenceIdentity" TEXT, "cancellationInvoiceId" INTEGER, "basisSnapshot" JSONB,
 "idempotencyKey" TEXT NOT NULL CHECK(length("idempotencyKey") BETWEEN 1 AND 128),
 "semanticFingerprint" TEXT NOT NULL CHECK(length("semanticFingerprint")=64),
 "contractVersion" INTEGER NOT NULL DEFAULT 2 CHECK("contractVersion"=2),
 "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("userId","idempotencyKey") REFERENCES "PaymentOperation"("userId","idempotencyKey") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("originalPaymentId") REFERENCES "PaymentJournalEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("cancellationInvoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CHECK(("kind"='PAYMENT_CORRECTION' AND "cancellationInvoiceId" IS NULL AND "basisSnapshot" IS NULL AND "payoutEvidenceIdentity" IS NULL)
 OR ("kind"='CUSTOMER_REFUND' AND "cancellationInvoiceId" IS NOT NULL AND "basisSnapshot" IS NOT NULL AND "payoutEvidenceIdentity" IS NOT NULL))
);
CREATE UNIQUE INDEX "PaymentAdjustment_userId_idempotencyKey_key" ON "PaymentAdjustment"("userId","idempotencyKey");
CREATE UNIQUE INDEX "PaymentAdjustment_userId_payoutEvidenceIdentity_key" ON "PaymentAdjustment"("userId","payoutEvidenceIdentity");
CREATE INDEX "PaymentAdjustment_userId_invoiceId_id_idx" ON "PaymentAdjustment"("userId","invoiceId","id");
CREATE INDEX "PaymentAdjustment_userId_accountingEffectiveOn_idx" ON "PaymentAdjustment"("userId","accountingEffectiveOn");
CREATE TRIGGER "PaymentAdjustment_owned_insert" BEFORE INSERT ON "PaymentAdjustment"
WHEN NOT EXISTS(SELECT 1 FROM "PaymentJournalEvent" p JOIN "Invoice" i ON i.id=p."invoiceId"
 WHERE p.id=NEW."originalPaymentId" AND p."userId"=NEW."userId" AND p."invoiceId"=NEW."invoiceId"
 AND p."dateCertainty"='ACTUAL' AND i."userId"=NEW."userId" AND i.type='INVOICE' AND i."issuanceState"='ISSUED')
 OR EXISTS(SELECT 1 FROM "Income" i JOIN "CashTransaction" c ON c."incomeId"=i.id WHERE i."invoiceId"=NEW."invoiceId")
 OR NOT EXISTS(SELECT 1 FROM "PaymentOperation" o WHERE o."userId"=NEW."userId" AND o."idempotencyKey"=NEW."idempotencyKey" AND o.kind=NEW.kind)
 OR EXISTS(SELECT 1 FROM "PaymentJournalEvent" p WHERE p."userId"=NEW."userId" AND p."idempotencyKey"=NEW."idempotencyKey")
 OR (NEW.kind='CUSTOMER_REFUND' AND NOT EXISTS(SELECT 1 FROM "Invoice" b JOIN "Invoice" i ON i.id=NEW."invoiceId"
 WHERE b.id=NEW."cancellationInvoiceId" AND b."userId"=NEW."userId" AND b.type='CREDIT_NOTE' AND b."issuanceState"='ISSUED'
 AND b.status='SENT' AND b."originalInvoiceId"=i.id AND i.status='CANCELLED' AND b."totalAmount"=-i."totalAmount"))
BEGIN SELECT RAISE(ABORT,'Payment adjustment ownership, operation or cancellation mismatch'); END;
CREATE TRIGGER "PaymentAdjustment_capacity_insert" BEFORE INSERT ON "PaymentAdjustment"
WHEN CAST(NEW."amountCents" AS INTEGER)+(SELECT COALESCE(SUM(CAST(a."amountCents" AS INTEGER)),0) FROM "PaymentAdjustment" a WHERE a."originalPaymentId"=NEW."originalPaymentId")
 >(SELECT CAST(p."amountCents" AS INTEGER) FROM "PaymentJournalEvent" p WHERE p.id=NEW."originalPaymentId")
BEGIN SELECT RAISE(ABORT,'Payment adjustment exceeds original receipt'); END;
CREATE TRIGGER "PaymentAdjustment_immutable_update" BEFORE UPDATE ON "PaymentAdjustment"
BEGIN SELECT RAISE(ABORT,'Payment adjustments are immutable'); END;
CREATE TRIGGER "PaymentAdjustment_immutable_delete" BEFORE DELETE ON "PaymentAdjustment"
BEGIN SELECT RAISE(ABORT,'Payment adjustments are immutable; restore into an empty target'); END;
CREATE TRIGGER "PaymentOperation_immutable_update" BEFORE UPDATE ON "PaymentOperation"
BEGIN SELECT RAISE(ABORT,'Payment operations are immutable'); END;
CREATE TRIGGER "PaymentOperation_immutable_delete" BEFORE DELETE ON "PaymentOperation"
BEGIN SELECT RAISE(ABORT,'Payment operations are immutable; restore into an empty target'); END;
-- Historical original keys stay untouched; upgraded commands reserve the shared namespace.
CREATE TRIGGER "PaymentJournalEvent_operation_insert" BEFORE INSERT ON "PaymentJournalEvent"
WHEN EXISTS(SELECT 1 FROM "PaymentOperation" o WHERE o."userId"=NEW."userId" AND o."idempotencyKey"=NEW."idempotencyKey" AND o.kind<>'PAYMENT_RECEIVED')
 OR EXISTS(SELECT 1 FROM "PaymentAdjustment" a WHERE a."userId"=NEW."userId" AND a."idempotencyKey"=NEW."idempotencyKey")
BEGIN SELECT RAISE(ABORT,'Payment operation key conflict'); END;

-- Cancellation evidence and the underlying commercial claim cannot drift after adjustment.
CREATE TRIGGER "PaymentAdjustment_basis_immutable" BEFORE UPDATE ON "Invoice"
WHEN (EXISTS(SELECT 1 FROM "PaymentAdjustment" a WHERE a."cancellationInvoiceId"=OLD.id)
 AND (NEW."userId" IS NOT OLD."userId" OR NEW.type IS NOT OLD.type OR NEW.status IS NOT OLD.status OR NEW."issuanceState" IS NOT OLD."issuanceState"
 OR NEW."originalInvoiceId" IS NOT OLD."originalInvoiceId" OR NEW."totalAmount" IS NOT OLD."totalAmount" OR NEW."customerId" IS NOT OLD."customerId"
 OR NEW."invoiceNumber" IS NOT OLD."invoiceNumber" OR NEW."invoiceDate" IS NOT OLD."invoiceDate" OR NEW."cancellationReason" IS NOT OLD."cancellationReason" OR NEW."parsedData" IS NOT OLD."parsedData"))
 OR (EXISTS(SELECT 1 FROM "PaymentAdjustment" a WHERE a."invoiceId"=OLD.id)
 AND (NEW."userId"<>OLD."userId" OR NEW.type<>OLD.type OR NEW."totalAmount" IS NOT OLD."totalAmount"
 OR NEW."customerId" IS NOT OLD."customerId" OR NEW."invoiceNumber" IS NOT OLD."invoiceNumber" OR NEW."parsedData" IS NOT OLD."parsedData"))
BEGIN SELECT RAISE(ABORT,'Adjusted invoice or refund basis is immutable'); END;

-- Cashbook linkage is excluded in both directions, including later raw/restore inserts.
CREATE TRIGGER "CashTransaction_no_adjusted_invoice_insert" BEFORE INSERT ON "CashTransaction"
WHEN NEW."incomeId" IS NOT NULL AND EXISTS(SELECT 1 FROM "Income" i JOIN "PaymentAdjustment" a ON a."invoiceId"=i."invoiceId" WHERE i.id=NEW."incomeId")
BEGIN SELECT RAISE(ABORT,'Adjusted invoice cannot be linked to cashbook'); END;
CREATE TRIGGER "CashTransaction_no_adjusted_invoice_update" BEFORE UPDATE ON "CashTransaction"
WHEN NEW."incomeId" IS NOT NULL AND EXISTS(SELECT 1 FROM "Income" i JOIN "PaymentAdjustment" a ON a."invoiceId"=i."invoiceId" WHERE i.id=NEW."incomeId")
BEGIN SELECT RAISE(ABORT,'Adjusted invoice cannot be linked to cashbook'); END;
