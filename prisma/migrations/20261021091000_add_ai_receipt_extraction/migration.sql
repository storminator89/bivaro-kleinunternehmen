-- Optional extraction evidence only. No queue starts and no financial rows change.
ALTER TABLE "PurchaseDocument" ADD COLUMN "aiExtraction" JSONB;
ALTER TABLE "PurchaseDocument" ADD COLUMN "aiDraftProvenance" JSONB;
ALTER TABLE "PurchaseDocument" ADD COLUMN "aiApprovedSnapshot" JSONB;
