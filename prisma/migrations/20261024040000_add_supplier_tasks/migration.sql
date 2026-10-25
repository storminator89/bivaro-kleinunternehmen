-- Additive internal reminders only. No inference from source/AI/review or payment data.
ALTER TABLE "PurchaseDocument" ADD COLUMN "supplierTaskKind" TEXT;
ALTER TABLE "PurchaseDocument" ADD COLUMN "supplierTaskFollowUpDate" TEXT;
ALTER TABLE "PurchaseDocument" ADD COLUMN "supplierTaskConfirmationRequired" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "PurchaseDocument_userId_reviewStatus_supplierTaskConfirmationRequired_supplierTaskKind_supplierTaskFollowUpDate_id_idx" ON "PurchaseDocument"("userId", "reviewStatus", "supplierTaskConfirmationRequired", "supplierTaskKind", "supplierTaskFollowUpDate", "id");
