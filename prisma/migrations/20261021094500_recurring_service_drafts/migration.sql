-- Planning and per-period replay receipts only; no historical financial rewrite.
CREATE TABLE "ServiceBillingPlan" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "stableKey" TEXT NOT NULL,
 "userId" TEXT NOT NULL,
 "customerId" INTEGER NOT NULL,
 "name" TEXT NOT NULL,
 "cadence" TEXT NOT NULL,
 "anchorDate" TEXT NOT NULL,
 "taxMode" TEXT NOT NULL,
 "items" JSONB NOT NULL,
 "nextPeriod" INTEGER NOT NULL DEFAULT 0,
 "status" TEXT NOT NULL DEFAULT 'ACTIVE',
 "revision" INTEGER NOT NULL DEFAULT 1,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" DATETIME NOT NULL,
 CONSTRAINT "ServiceBillingPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "ServiceBillingPlan_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "ServiceBillingPeriod" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "userId" TEXT NOT NULL,
 "planId" TEXT NOT NULL,
 "periodIndex" INTEGER NOT NULL,
 "periodStart" TEXT NOT NULL,
 "periodEnd" TEXT NOT NULL,
 "action" TEXT NOT NULL,
 "invoiceId" INTEGER,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ServiceBillingPeriod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "ServiceBillingPeriod_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ServiceBillingPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ServiceBillingPeriod_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ServiceBillingPlan_userId_stableKey_key" ON "ServiceBillingPlan"("userId", "stableKey");
CREATE INDEX "ServiceBillingPlan_userId_status_idx" ON "ServiceBillingPlan"("userId", "status");
CREATE UNIQUE INDEX "ServiceBillingPeriod_invoiceId_key" ON "ServiceBillingPeriod"("invoiceId");
CREATE UNIQUE INDEX "ServiceBillingPeriod_planId_periodIndex_key" ON "ServiceBillingPeriod"("planId", "periodIndex");
CREATE INDEX "ServiceBillingPeriod_userId_planId_idx" ON "ServiceBillingPeriod"("userId", "planId");
