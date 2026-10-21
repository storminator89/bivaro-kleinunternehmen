-- CreateTable
CREATE TABLE "ServiceProject" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "customerId" INTEGER NOT NULL,
    "name" TEXT NOT NULL CHECK (length(trim("name")) BETWEEN 1 AND 120),
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ServiceProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ServiceProject_customerId_userId_fkey" FOREIGN KEY ("customerId", "userId") REFERENCES "Customer" ("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BillingNote" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "customerId" INTEGER NOT NULL,
    "serviceDate" DATETIME NOT NULL,
    "description" TEXT NOT NULL CHECK (length("description") BETWEEN 1 AND 500),
    "quantity" REAL NOT NULL DEFAULT 1 CHECK ("quantity" > 0 AND "quantity" = "quantity"),
    "unit" TEXT NOT NULL DEFAULT 'Stunde' CHECK (length("unit") BETWEEN 1 AND 100),
    "projectId" INTEGER,
    "durationMinutes" INTEGER CHECK (
      "durationMinutes" IS NULL OR (
        typeof("durationMinutes") = 'integer' AND "durationMinutes" BETWEEN 1 AND 60000
        AND "unit" = 'Stunde' AND "quantity" = round("durationMinutes" / 60.0, 12)
      )
    ),
    "captureKey" TEXT,
    "captureFingerprint" TEXT CHECK (
      ("captureKey" IS NULL AND "captureFingerprint" IS NULL) OR
      ("captureKey" IS NOT NULL AND "captureFingerprint" IS NOT NULL AND length("captureKey") = 36 AND length("captureFingerprint") = 64 AND "captureFingerprint" NOT GLOB '*[^0-9a-f]*')
    ),
    "deletedAt" DATETIME CHECK ("deletedAt" IS NULL OR ("captureKey" IS NOT NULL AND "invoiceId" IS NULL)),
    "invoiceId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BillingNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BillingNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BillingNote_projectId_customerId_userId_fkey" FOREIGN KEY ("projectId", "customerId", "userId") REFERENCES "ServiceProject" ("id", "customerId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BillingNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_BillingNote" ("createdAt", "customerId", "description", "id", "invoiceId", "quantity", "serviceDate", "unit", "updatedAt", "userId") SELECT "createdAt", "customerId", "description", "id", "invoiceId", "quantity", "serviceDate", "unit", "updatedAt", "userId" FROM "BillingNote";
DROP TABLE "BillingNote";
ALTER TABLE "new_BillingNote" RENAME TO "BillingNote";
CREATE INDEX "BillingNote_userId_customerId_invoiceId_idx" ON "BillingNote"("userId", "customerId", "invoiceId");
CREATE UNIQUE INDEX "BillingNote_userId_captureKey_key" ON "BillingNote"("userId", "captureKey");
CREATE INDEX "BillingNote_userId_serviceDate_idx" ON "BillingNote"("userId", "serviceDate");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ServiceProject_userId_customerId_archivedAt_idx" ON "ServiceProject"("userId", "customerId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceProject_id_customerId_userId_key" ON "ServiceProject"("id", "customerId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_id_userId_key" ON "Customer"("id", "userId");


-- Project identities never move across customers or tenants; names/archive are editable.
CREATE TRIGGER "ServiceProject_immutable_owner"
BEFORE UPDATE OF "userId", "customerId" ON "ServiceProject"
WHEN NEW."userId" IS NOT OLD."userId" OR NEW."customerId" IS NOT OLD."customerId"
BEGIN
  SELECT RAISE(ABORT, 'Service project ownership is immutable');
END;

-- A claimed service remains a historical source; only the association can be released.
CREATE TRIGGER "BillingNote_protect_claimed_source"
BEFORE UPDATE OF "userId", "customerId", "projectId", "durationMinutes", "serviceDate", "description", "quantity", "unit" ON "BillingNote"
WHEN OLD."invoiceId" IS NOT NULL AND (
  NEW."userId" IS NOT OLD."userId" OR NEW."customerId" IS NOT OLD."customerId"
  OR NEW."projectId" IS NOT OLD."projectId" OR NEW."durationMinutes" IS NOT OLD."durationMinutes"
  OR NEW."serviceDate" IS NOT OLD."serviceDate" OR NEW."description" IS NOT OLD."description"
  OR NEW."quantity" IS NOT OLD."quantity" OR NEW."unit" IS NOT OLD."unit"
)
BEGIN
  SELECT RAISE(ABORT, 'Claimed service sources are immutable');
END;

-- Receipt identities cannot be swapped independently from their source.
CREATE TRIGGER "BillingNote_immutable_capture_identity"
BEFORE UPDATE OF "captureKey", "captureFingerprint" ON "BillingNote"
WHEN NEW."captureKey" IS NOT OLD."captureKey" OR NEW."captureFingerprint" IS NOT OLD."captureFingerprint"
BEGIN
  SELECT RAISE(ABORT, 'Service capture identity is immutable');
END;

-- A tombstone is permanent and is never a claimable service again.
CREATE TRIGGER "BillingNote_preserve_tombstone"
BEFORE UPDATE OF "deletedAt", "invoiceId" ON "BillingNote"
WHEN OLD."deletedAt" IS NOT NULL AND (
  NEW."deletedAt" IS NOT OLD."deletedAt" OR NEW."invoiceId" IS NOT OLD."invoiceId"
)
BEGIN
  SELECT RAISE(ABORT, 'Removed service capture receipts cannot be resurrected');
END;
