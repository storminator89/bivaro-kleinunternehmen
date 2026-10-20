-- CreateTable
CREATE TABLE "PurchaseDocument" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "storedFileName" TEXT NOT NULL,
    "originalSha256" TEXT NOT NULL,
    "originalByteCount" INTEGER NOT NULL,
    "mediaType" TEXT NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadRequestId" TEXT NOT NULL,
    "parsedData" JSONB,
    "parseStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "parserVersion" TEXT,
    "parseErrorCode" TEXT,
    "supplierName" TEXT,
    "invoiceNumber" TEXT,
    "invoiceDate" DATETIME,
    "currency" TEXT,
    "totalAmount" REAL,
    "reviewStatus" TEXT NOT NULL DEFAULT 'REVIEW',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "expenseId" INTEGER,
    "approvalRequestId" TEXT,
    "approvalFingerprint" TEXT,
    "approvedAt" DATETIME,
    "dismissedAt" DATETIME,
    "dismissalReason" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PurchaseDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PurchaseDocument_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseDocument_expenseId_key" ON "PurchaseDocument"("expenseId");

-- CreateIndex
CREATE INDEX "PurchaseDocument_userId_reviewStatus_uploadedAt_idx" ON "PurchaseDocument"("userId", "reviewStatus", "uploadedAt");

-- CreateIndex
CREATE INDEX "PurchaseDocument_userId_supplierName_invoiceNumber_idx" ON "PurchaseDocument"("userId", "supplierName", "invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseDocument_userId_originalSha256_key" ON "PurchaseDocument"("userId", "originalSha256");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseDocument_userId_uploadRequestId_key" ON "PurchaseDocument"("userId", "uploadRequestId");
