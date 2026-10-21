-- Reports survive document-ID remapping and overwrite restores. No financial effects.
CREATE TABLE "PurchaseValidationReport" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "stableKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "originalSha256" TEXT NOT NULL,
  "sourceDocumentIdAtCheck" INTEGER NOT NULL,
  "requestId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "provenance" TEXT NOT NULL DEFAULT 'LOCAL',
  "report" JSONB NOT NULL,
  "checkedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseValidationReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PurchaseValidationReport_userId_stableKey_key" ON "PurchaseValidationReport"("userId", "stableKey");
CREATE UNIQUE INDEX "PurchaseValidationReport_userId_requestId_key" ON "PurchaseValidationReport"("userId", "requestId");
CREATE INDEX "PurchaseValidationReport_userId_originalSha256_checkedAt_idx" ON "PurchaseValidationReport"("userId", "originalSha256", "checkedAt");

-- Preserve historical proof even when a future caller accidentally tries to mutate it.
CREATE TRIGGER "PurchaseValidationReport_immutable_update" BEFORE UPDATE ON "PurchaseValidationReport" BEGIN SELECT RAISE(ABORT, 'PurchaseValidationReport is append-only'); END;
CREATE TRIGGER "PurchaseValidationReport_immutable_delete" BEFORE DELETE ON "PurchaseValidationReport" BEGIN SELECT RAISE(ABORT, 'PurchaseValidationReport is append-only'); END;
