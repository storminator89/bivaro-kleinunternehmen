-- Additive technical evidence only: no amount, date, tax or category changes.
ALTER TABLE "Income" ADD COLUMN "manualRecordId" TEXT;
ALTER TABLE "Income" ADD COLUMN "manualRecordState" TEXT NOT NULL DEFAULT 'LEGACY_UNREVIEWED';
ALTER TABLE "Income" ADD COLUMN "manualRecordOrigin" TEXT NOT NULL DEFAULT 'LEGACY_UNKNOWN';
ALTER TABLE "Income" ADD COLUMN "manualRecordRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Expense" ADD COLUMN "manualRecordId" TEXT;
ALTER TABLE "Expense" ADD COLUMN "manualRecordState" TEXT NOT NULL DEFAULT 'LEGACY_UNREVIEWED';
ALTER TABLE "Expense" ADD COLUMN "manualRecordOrigin" TEXT NOT NULL DEFAULT 'LEGACY_UNKNOWN';
ALTER TABLE "Expense" ADD COLUMN "manualRecordRevision" INTEGER NOT NULL DEFAULT 0;
-- Allocate portable v4-shaped identities without inventing provenance.
UPDATE "Income" SET "manualRecordId" = lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)));
UPDATE "Expense" SET "manualRecordId" = lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)));
UPDATE "Income" SET "manualRecordOrigin" = 'PAYMENT_JOURNAL' WHERE EXISTS (SELECT 1 FROM "PaymentJournalEvent" p WHERE p."incomeId" = "Income"."id");
UPDATE "Income" SET "manualRecordOrigin" = 'INVOICE' WHERE "invoiceId" IS NOT NULL AND "manualRecordOrigin" = 'LEGACY_UNKNOWN';
UPDATE "Income" SET "manualRecordOrigin" = 'CASHBOOK' WHERE EXISTS (SELECT 1 FROM "CashTransaction" c WHERE c."incomeId" = "Income"."id") AND "manualRecordOrigin" = 'LEGACY_UNKNOWN';
UPDATE "Expense" SET "manualRecordOrigin" = 'PURCHASE_DOCUMENT' WHERE EXISTS (SELECT 1 FROM "PurchaseDocument" p WHERE p."expenseId" = "Expense"."id");
UPDATE "Expense" SET "manualRecordOrigin" = 'RECURRING' WHERE ("recurringExpenseId" IS NOT NULL OR "scheduledDate" IS NOT NULL) AND "manualRecordOrigin" = 'LEGACY_UNKNOWN';
UPDATE "Expense" SET "manualRecordOrigin" = 'CASHBOOK' WHERE EXISTS (SELECT 1 FROM "CashTransaction" c WHERE c."expenseId" = "Expense"."id") AND "manualRecordOrigin" = 'LEGACY_UNKNOWN';
CREATE UNIQUE INDEX "Income_manualRecordId_key" ON "Income"("manualRecordId");
CREATE UNIQUE INDEX "Expense_manualRecordId_key" ON "Expense"("manualRecordId");
CREATE TABLE "ManualFinancialRecordEvent" (
 "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "recordId" TEXT NOT NULL,
 "kind" TEXT NOT NULL CHECK ("kind" IN ('income','expense')),
 "incomeId" INTEGER, "expenseId" INTEGER, "sequence" INTEGER NOT NULL CHECK ("sequence" > 0),
 "operation" TEXT NOT NULL CHECK ("operation" IN ('FINALIZE','CORRECT_AMOUNT')),
 "mutationId" TEXT NOT NULL, "semanticHash" TEXT NOT NULL, "previousHash" TEXT,
 "snapshot" JSONB NOT NULL, "hash" TEXT NOT NULL, "reason" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK (("kind"='income' AND "incomeId" IS NOT NULL AND "expenseId" IS NULL) OR ("kind"='expense' AND "expenseId" IS NOT NULL AND "incomeId" IS NULL)),
 FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY ("incomeId") REFERENCES "Income"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ManualFinancialRecordEvent_userId_mutationId_key" ON "ManualFinancialRecordEvent"("userId","mutationId");
CREATE UNIQUE INDEX "ManualFinancialRecordEvent_recordId_sequence_key" ON "ManualFinancialRecordEvent"("recordId","sequence");
CREATE INDEX "ManualFinancialRecordEvent_userId_recordId_idx" ON "ManualFinancialRecordEvent"("userId","recordId");
CREATE TRIGGER "manual_record_event_no_update" BEFORE UPDATE ON "ManualFinancialRecordEvent" BEGIN SELECT RAISE(ABORT,'Manual financial history is append-only'); END;
CREATE TRIGGER "manual_record_event_no_delete" BEFORE DELETE ON "ManualFinancialRecordEvent" BEGIN SELECT RAISE(ABORT,'Manual financial history is append-only'); END;
CREATE TRIGGER "manual_record_event_owner" BEFORE INSERT ON "ManualFinancialRecordEvent" BEGIN
 SELECT CASE WHEN NEW."kind"='income' AND NOT EXISTS (SELECT 1 FROM "Income" WHERE "id"=NEW."incomeId" AND "userId"=NEW."userId" AND "manualRecordId"=NEW."recordId") THEN RAISE(ABORT,'Manual financial history owner mismatch') END;
 SELECT CASE WHEN NEW."kind"='expense' AND NOT EXISTS (SELECT 1 FROM "Expense" WHERE "id"=NEW."expenseId" AND "userId"=NEW."userId" AND "manualRecordId"=NEW."recordId") THEN RAISE(ABORT,'Manual financial history owner mismatch') END;
 SELECT CASE WHEN NEW."sequence"=1 AND (NEW."operation"<>'FINALIZE' OR NEW."previousHash" IS NOT NULL) THEN RAISE(ABORT,'Invalid manual financial history root') END;
 SELECT CASE WHEN NEW."sequence">1 AND (NEW."operation"<>'CORRECT_AMOUNT' OR NOT EXISTS (SELECT 1 FROM "ManualFinancialRecordEvent" WHERE "recordId"=NEW."recordId" AND "sequence"=NEW."sequence"-1 AND "hash"=NEW."previousHash" AND "userId"=NEW."userId")) THEN RAISE(ABORT,'Invalid manual financial history chain') END;
END;
CREATE TRIGGER "manual_record_income_identity" BEFORE UPDATE ON "Income" WHEN OLD."manualRecordId" IS NOT NEW."manualRecordId" OR (OLD."manualRecordOrigin"<>NEW."manualRecordOrigin" AND NOT (OLD."manualRecordState"<>'FINALIZED' AND OLD."manualRecordOrigin" IN ('MANUAL','LEGACY_UNKNOWN') AND NEW."manualRecordOrigin"='CASHBOOK' AND EXISTS (SELECT 1 FROM "CashTransaction" WHERE "incomeId"=OLD."id"))) BEGIN SELECT RAISE(ABORT,'Manual financial identity and origin are immutable'); END;
CREATE TRIGGER "manual_record_expense_identity" BEFORE UPDATE ON "Expense" WHEN OLD."manualRecordId" IS NOT NEW."manualRecordId" OR (OLD."manualRecordOrigin"<>NEW."manualRecordOrigin" AND NOT (OLD."manualRecordState"<>'FINALIZED' AND OLD."manualRecordOrigin" IN ('MANUAL','LEGACY_UNKNOWN') AND NEW."manualRecordOrigin"='CASHBOOK' AND EXISTS (SELECT 1 FROM "CashTransaction" WHERE "expenseId"=OLD."id"))) BEGIN SELECT RAISE(ABORT,'Manual financial identity and origin are immutable'); END;
CREATE TRIGGER "manual_record_income_frozen" BEFORE UPDATE ON "Income" WHEN OLD."manualRecordState"='FINALIZED' AND (NEW."manualRecordState"<>'FINALIZED' OR NEW."userId"<>OLD."userId" OR NEW."description"<>OLD."description" OR NEW."date"<>OLD."date" OR NEW."customerId" IS NOT OLD."customerId" OR NEW."invoiceId" IS NOT OLD."invoiceId" OR NEW."taxRelevant"<>OLD."taxRelevant") BEGIN SELECT RAISE(ABORT,'Finalized manual financial context is immutable'); END;
CREATE TRIGGER "manual_record_expense_frozen" BEFORE UPDATE ON "Expense" WHEN OLD."manualRecordState"='FINALIZED' AND (NEW."manualRecordState"<>'FINALIZED' OR NEW."userId"<>OLD."userId" OR NEW."description"<>OLD."description" OR NEW."date"<>OLD."date" OR NEW."category" IS NOT OLD."category" OR NEW."receiptUrl" IS NOT OLD."receiptUrl" OR NEW."taxRelevant"<>OLD."taxRelevant" OR NEW."taxDeductiblePercentage" IS NOT OLD."taxDeductiblePercentage" OR NEW."receiptFileName" IS NOT OLD."receiptFileName" OR NEW."storedReceiptFileName" IS NOT OLD."storedReceiptFileName" OR NEW."depreciationYears" IS NOT OLD."depreciationYears" OR NEW."recurringExpenseId" IS NOT OLD."recurringExpenseId" OR NEW."scheduledDate" IS NOT OLD."scheduledDate") BEGIN SELECT RAISE(ABORT,'Finalized manual financial context is immutable'); END;
CREATE TRIGGER "manual_record_income_no_delete" BEFORE DELETE ON "Income" WHEN OLD."manualRecordState"='FINALIZED' BEGIN SELECT RAISE(ABORT,'Finalized manual financial record cannot be deleted'); END;
CREATE TRIGGER "manual_record_expense_no_delete" BEFORE DELETE ON "Expense" WHEN OLD."manualRecordState"='FINALIZED' BEGIN SELECT RAISE(ABORT,'Finalized manual financial record cannot be deleted'); END;
CREATE TRIGGER "manual_record_customer_retained" BEFORE DELETE ON "Customer" WHEN EXISTS (SELECT 1 FROM "Income" WHERE "customerId"=OLD."id" AND "manualRecordState"='FINALIZED') BEGIN SELECT RAISE(ABORT,'Customer must be retained for finalized manual financial evidence'); END;
CREATE TRIGGER "manual_record_cash_no_attach" BEFORE INSERT ON "CashTransaction" WHEN EXISTS (SELECT 1 FROM "Income" WHERE "id"=NEW."incomeId" AND "manualRecordState"='FINALIZED') OR EXISTS (SELECT 1 FROM "Expense" WHERE "id"=NEW."expenseId" AND "manualRecordState"='FINALIZED') BEGIN SELECT RAISE(ABORT,'Finalized manual financial record cannot be cash-linked'); END;
CREATE TRIGGER "manual_record_cash_no_relink" BEFORE UPDATE OF "incomeId","expenseId" ON "CashTransaction" WHEN EXISTS (SELECT 1 FROM "Income" WHERE "id"=NEW."incomeId" AND "manualRecordState"='FINALIZED') OR EXISTS (SELECT 1 FROM "Expense" WHERE "id"=NEW."expenseId" AND "manualRecordState"='FINALIZED') BEGIN SELECT RAISE(ABORT,'Finalized manual financial record cannot be cash-linked'); END;
CREATE TRIGGER "manual_record_purchase_no_attach" BEFORE UPDATE OF "expenseId" ON "PurchaseDocument" WHEN EXISTS (SELECT 1 FROM "Expense" WHERE "id"=NEW."expenseId" AND "manualRecordState"='FINALIZED') BEGIN SELECT RAISE(ABORT,'Finalized manual financial record cannot be source-linked'); END;
CREATE TRIGGER "manual_record_journal_no_attach" BEFORE INSERT ON "PaymentJournalEvent" WHEN EXISTS (SELECT 1 FROM "Income" WHERE "id"=NEW."incomeId" AND "manualRecordState"='FINALIZED') BEGIN SELECT RAISE(ABORT,'Finalized manual financial record cannot be source-linked'); END;

CREATE TRIGGER "manual_record_purchase_no_insert_attach" BEFORE INSERT ON "PurchaseDocument" WHEN EXISTS (SELECT 1 FROM "Expense" WHERE "id"=NEW."expenseId" AND "manualRecordState"='FINALIZED') BEGIN SELECT RAISE(ABORT,'Finalized manual financial record cannot be source-linked'); END;
CREATE TRIGGER "manual_record_journal_no_relink" BEFORE UPDATE OF "incomeId" ON "PaymentJournalEvent" WHEN EXISTS (SELECT 1 FROM "Income" WHERE "id"=NEW."incomeId" AND "manualRecordState"='FINALIZED') BEGIN SELECT RAISE(ABORT,'Finalized manual financial record cannot be source-linked'); END;

-- A changed finalized amount must already have its next immutable evidence in
-- this transaction; the application adds mandatory financial audit before commit.
CREATE TRIGGER "manual_record_income_amount_evidence" BEFORE UPDATE OF "amount" ON "Income" WHEN OLD."manualRecordState"='FINALIZED' AND NEW."amount" IS NOT OLD."amount" BEGIN
 SELECT CASE WHEN NEW."manualRecordRevision"<>OLD."manualRecordRevision"+1 OR NOT EXISTS (SELECT 1 FROM "ManualFinancialRecordEvent" e WHERE e."recordId"=OLD."manualRecordId" AND e."operation"='CORRECT_AMOUNT' AND e."sequence"=(SELECT MAX("sequence") FROM "ManualFinancialRecordEvent" WHERE "recordId"=OLD."manualRecordId") AND CAST(json_extract(e."snapshot",'$.amount') AS REAL)=NEW."amount") THEN RAISE(ABORT,'Finalized amount requires immutable correction evidence') END;
END;
CREATE TRIGGER "manual_record_expense_amount_evidence" BEFORE UPDATE OF "amount" ON "Expense" WHEN OLD."manualRecordState"='FINALIZED' AND NEW."amount" IS NOT OLD."amount" BEGIN
 SELECT CASE WHEN NEW."manualRecordRevision"<>OLD."manualRecordRevision"+1 OR NOT EXISTS (SELECT 1 FROM "ManualFinancialRecordEvent" e WHERE e."recordId"=OLD."manualRecordId" AND e."operation"='CORRECT_AMOUNT' AND e."sequence"=(SELECT MAX("sequence") FROM "ManualFinancialRecordEvent" WHERE "recordId"=OLD."manualRecordId") AND CAST(json_extract(e."snapshot",'$.amount') AS REAL)=NEW."amount") THEN RAISE(ABORT,'Finalized amount requires immutable correction evidence') END;
END;
