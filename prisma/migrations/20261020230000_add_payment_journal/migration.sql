-- Additive only: legacy rows are adopted explicitly, never assigned guessed dates.
CREATE TABLE "PaymentJournalEvent" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "userId" TEXT NOT NULL,
  "invoiceId" INTEGER NOT NULL,
  "incomeId" INTEGER,
  "amountCents" TEXT NOT NULL CHECK (
    length("amountCents") BETWEEN 1 AND 16 AND "amountCents" NOT GLOB '*[^0-9]*'
    AND substr("amountCents", 1, 1) BETWEEN '1' AND '9'
    AND (length("amountCents") < 16 OR "amountCents" <= '9007199254740991')
  ),
  "currency" TEXT NOT NULL DEFAULT 'EUR' CHECK ("currency" = 'EUR'),
  "paidAt" DATETIME,
  "dateCertainty" TEXT NOT NULL CHECK ("dateCertainty" IN ('ACTUAL','LEGACY_INCOME','LEGACY_INVOICE','UNKNOWN')),
  "source" TEXT NOT NULL CHECK ("source" IN ('MANUAL','LEGACY_STATUS','LEGACY_IMPORT')),
  "reference" TEXT NOT NULL CHECK (length("reference") BETWEEN 1 AND 255),
  "idempotencyKey" TEXT NOT NULL CHECK (length("idempotencyKey") BETWEEN 1 AND 128),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentJournalEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PaymentJournalEvent_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PaymentJournalEvent_incomeId_fkey" FOREIGN KEY ("incomeId") REFERENCES "Income" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK (("dateCertainty" = 'UNKNOWN' AND "paidAt" IS NULL AND "source" = 'LEGACY_IMPORT' AND "incomeId" IS NULL)
    OR ("dateCertainty" <> 'UNKNOWN' AND "paidAt" IS NOT NULL)),
  CHECK (("source" = 'LEGACY_IMPORT' AND "dateCertainty" <> 'ACTUAL')
    OR ("source" <> 'LEGACY_IMPORT' AND "dateCertainty" = 'ACTUAL' AND "incomeId" IS NOT NULL))
);
CREATE UNIQUE INDEX "PaymentJournalEvent_invoiceId_key" ON "PaymentJournalEvent"("invoiceId");
CREATE UNIQUE INDEX "PaymentJournalEvent_incomeId_key" ON "PaymentJournalEvent"("incomeId");
CREATE UNIQUE INDEX "PaymentJournalEvent_userId_idempotencyKey_key" ON "PaymentJournalEvent"("userId", "idempotencyKey");
CREATE INDEX "PaymentJournalEvent_userId_paidAt_idx" ON "PaymentJournalEvent"("userId", "paidAt");
-- No event editing: corrections will be additive events in a future slice.
CREATE TRIGGER "PaymentJournalEvent_immutable_update" BEFORE UPDATE ON "PaymentJournalEvent"
BEGIN SELECT RAISE(ABORT, 'Payment journal events are immutable'); END;
CREATE TRIGGER "PaymentJournalEvent_owned_insert" BEFORE INSERT ON "PaymentJournalEvent"
WHEN NOT EXISTS (SELECT 1 FROM "Invoice" WHERE "id" = NEW."invoiceId" AND "userId" = NEW."userId")
  OR (NEW."incomeId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Income" WHERE "id" = NEW."incomeId" AND "userId" = NEW."userId" AND "invoiceId" = NEW."invoiceId"))
BEGIN SELECT RAISE(ABORT, 'Payment journal tenant or invoice mismatch'); END;
CREATE TRIGGER "PaymentJournalEvent_immutable_delete" BEFORE DELETE ON "PaymentJournalEvent"
BEGIN SELECT RAISE(ABORT, 'Payment journal events are immutable; restore into an empty target'); END;
