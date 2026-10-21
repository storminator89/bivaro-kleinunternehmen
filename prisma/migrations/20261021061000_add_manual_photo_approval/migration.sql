ALTER TABLE "PurchaseDocument" ADD COLUMN "reviewedSourceSnapshot" JSONB;
-- Approved manual evidence is append-only. Restore inserts into an empty target or merges equivalent components.
CREATE TRIGGER "PurchaseDocument_manual_review_immutable_update" BEFORE UPDATE ON "PurchaseDocument"
WHEN OLD."reviewedSourceSnapshot" IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Approved manual source evidence is immutable'); END;
CREATE TRIGGER "PurchaseDocument_manual_review_immutable_delete" BEFORE DELETE ON "PurchaseDocument"
WHEN OLD."reviewedSourceSnapshot" IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Approved manual source evidence is immutable; restore into an empty target'); END;
CREATE TRIGGER "PurchaseDocument_manual_review_owned_insert" BEFORE INSERT ON "PurchaseDocument"
WHEN NEW."reviewedSourceSnapshot" IS NOT NULL AND (
  NEW."reviewStatus" <> 'BOOKED' OR NEW."expenseId" IS NULL OR NEW."mediaType" NOT IN ('image/jpeg','image/png')
  OR json_extract(NEW."reviewedSourceSnapshot", '$.ownerId') IS NOT NEW."userId"
  OR json_extract(NEW."reviewedSourceSnapshot", '$.sourceUploadRequestId') IS NOT NEW."uploadRequestId"
  OR json_extract(NEW."reviewedSourceSnapshot", '$.originalSha256') IS NOT NEW."originalSha256"
  OR json_extract(NEW."reviewedSourceSnapshot", '$.originalByteCount') IS NOT NEW."originalByteCount"
  OR json_extract(NEW."reviewedSourceSnapshot", '$.mediaType') IS NOT NEW."mediaType"
  OR json_extract(NEW."reviewedSourceSnapshot", '$.reviewedDocumentRevision') IS NOT (NEW."revision" - 1)
  OR NOT EXISTS (SELECT 1 FROM "Expense" WHERE "id" = NEW."expenseId" AND "userId" = NEW."userId" AND "storedReceiptFileName" = NEW."storedFileName")
)
BEGIN SELECT RAISE(ABORT, 'Manual source evidence tenant or original mismatch'); END;
CREATE TRIGGER "PurchaseDocument_manual_review_owned_update" BEFORE UPDATE ON "PurchaseDocument"
WHEN NEW."reviewedSourceSnapshot" IS NOT NULL AND (
  NEW."reviewStatus" <> 'BOOKED' OR NEW."expenseId" IS NULL OR NEW."mediaType" NOT IN ('image/jpeg','image/png')
  OR json_extract(NEW."reviewedSourceSnapshot", '$.ownerId') IS NOT NEW."userId"
  OR json_extract(NEW."reviewedSourceSnapshot", '$.sourceUploadRequestId') IS NOT NEW."uploadRequestId"
  OR json_extract(NEW."reviewedSourceSnapshot", '$.originalSha256') IS NOT NEW."originalSha256"
  OR json_extract(NEW."reviewedSourceSnapshot", '$.originalByteCount') IS NOT NEW."originalByteCount"
  OR json_extract(NEW."reviewedSourceSnapshot", '$.mediaType') IS NOT NEW."mediaType"
  OR json_extract(NEW."reviewedSourceSnapshot", '$.reviewedDocumentRevision') IS NOT (NEW."revision" - 1)
  OR NOT EXISTS (SELECT 1 FROM "Expense" WHERE "id" = NEW."expenseId" AND "userId" = NEW."userId" AND "storedReceiptFileName" = NEW."storedFileName")
)
BEGIN SELECT RAISE(ABORT, 'Manual source evidence tenant or original mismatch'); END;
