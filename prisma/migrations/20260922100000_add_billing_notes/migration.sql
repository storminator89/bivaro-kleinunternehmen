-- Customer context is additive; existing customers default to showing their
-- note in the editor and send preview.
ALTER TABLE "Customer" ADD COLUMN "internalNote" TEXT;
ALTER TABLE "Customer" ADD COLUMN "noteVisibility" TEXT NOT NULL DEFAULT 'BOTH' CHECK ("noteVisibility" IN ('EDITOR', 'SEND', 'BOTH'));

CREATE TABLE "BillingNote" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "customerId" INTEGER NOT NULL,
    "serviceDate" DATETIME NOT NULL,
    "description" TEXT NOT NULL CHECK (length("description") BETWEEN 1 AND 500),
    "quantity" REAL NOT NULL DEFAULT 1 CHECK ("quantity" > 0 AND "quantity" = "quantity"),
    "unit" TEXT NOT NULL DEFAULT 'Stunde' CHECK (length("unit") BETWEEN 1 AND 100),
    "invoiceId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BillingNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BillingNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BillingNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "BillingNote_userId_customerId_invoiceId_idx" ON "BillingNote"("userId", "customerId", "invoiceId");
CREATE INDEX "BillingNote_userId_serviceDate_idx" ON "BillingNote"("userId", "serviceDate");
