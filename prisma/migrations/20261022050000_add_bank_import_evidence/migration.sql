CREATE TABLE "BankImportBatch" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "stableKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "sourceSha256" TEXT NOT NULL,
  "sourceBytes" INTEGER NOT NULL,
  "parserVersion" TEXT NOT NULL,
  "mappingVersion" TEXT NOT NULL,
  "accountAlias" TEXT NOT NULL,
  "delimiter" TEXT NOT NULL,
  "mapping" JSONB NOT NULL,
  "receipt" JSONB NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BankImportBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BankImportBatch_userId_stableKey_key" ON "BankImportBatch"("userId", "stableKey");
CREATE UNIQUE INDEX "BankImportBatch_userId_requestId_key" ON "BankImportBatch"("userId", "requestId");
CREATE UNIQUE INDEX "BankImportBatch_userId_fingerprint_key" ON "BankImportBatch"("userId", "fingerprint");
CREATE INDEX "BankImportBatch_userId_id_idx" ON "BankImportBatch"("userId", "id");
CREATE INDEX "BankImportBatch_userId_sourceSha256_idx" ON "BankImportBatch"("userId", "sourceSha256");
CREATE TABLE "BankImportRow" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "stableKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "batchId" INTEGER NOT NULL,
  "sourceRow" INTEGER NOT NULL,
  "evidence" JSONB NOT NULL,
  "externalKey" TEXT,
  "contentKey" TEXT,
  "dayAmountKey" TEXT,
  CONSTRAINT "BankImportRow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BankImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "BankImportBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BankImportRow_userId_stableKey_key" ON "BankImportRow"("userId", "stableKey");
CREATE UNIQUE INDEX "BankImportRow_batchId_sourceRow_key" ON "BankImportRow"("batchId", "sourceRow");
CREATE INDEX "BankImportRow_userId_externalKey_idx" ON "BankImportRow"("userId", "externalKey");
CREATE INDEX "BankImportRow_userId_contentKey_idx" ON "BankImportRow"("userId", "contentKey");
CREATE INDEX "BankImportRow_userId_dayAmountKey_idx" ON "BankImportRow"("userId", "dayAmountKey");
