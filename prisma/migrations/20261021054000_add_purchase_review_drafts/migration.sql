ALTER TABLE "PurchaseDocument" ADD COLUMN "reviewDraft" JSONB;
ALTER TABLE "PurchaseDocument" ADD COLUMN "reviewDraftSavedAt" DATETIME;
ALTER TABLE "PurchaseDocument" ADD COLUMN "reviewDraftSearch" TEXT;
