ALTER TABLE "Reminder" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "Reminder" ADD COLUMN "balanceSnapshot" JSONB;
CREATE UNIQUE INDEX "Reminder_userId_idempotencyKey_key" ON "Reminder"("userId", "idempotencyKey");
-- Explicitly confirmed evidence is retained, including its once-only command key.
CREATE TRIGGER "Reminder_confirmed_immutable_update" BEFORE UPDATE ON "Reminder"
WHEN OLD."balanceSnapshot" IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'confirmed reminder evidence is immutable'); END;
CREATE TRIGGER "Reminder_confirmed_immutable_delete" BEFORE DELETE ON "Reminder"
WHEN OLD."balanceSnapshot" IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'confirmed reminder evidence is immutable'); END;
CREATE TRIGGER "Reminder_confirmed_owned_insert" BEFORE INSERT ON "Reminder"
WHEN NEW."balanceSnapshot" IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM "Invoice" WHERE "id" = NEW."invoiceId" AND "userId" = NEW."userId"
)
BEGIN SELECT RAISE(ABORT, 'confirmed reminder invoice owner mismatch'); END;
