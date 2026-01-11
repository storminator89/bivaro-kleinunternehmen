-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Invoice" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL DEFAULT 'INVOICE',
    "fileName" TEXT NOT NULL,
    "storedFileName" TEXT NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invoiceDate" DATETIME,
    "dueDate" DATETIME,
    "invoiceNumber" TEXT,
    "parsedData" JSONB NOT NULL,
    "totalAmount" REAL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "paidAt" DATETIME,
    "originalInvoiceId" INTEGER,
    "cancellationReason" TEXT,
    "customerId" INTEGER,
    "userId" TEXT NOT NULL,
    CONSTRAINT "Invoice_originalInvoiceId_fkey" FOREIGN KEY ("originalInvoiceId") REFERENCES "Invoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Invoice" ("cancellationReason", "customerId", "dueDate", "fileName", "id", "invoiceDate", "invoiceNumber", "originalInvoiceId", "paidAt", "parsedData", "status", "storedFileName", "totalAmount", "type", "uploadedAt", "userId") SELECT "cancellationReason", "customerId", "dueDate", "fileName", "id", "invoiceDate", "invoiceNumber", "originalInvoiceId", "paidAt", "parsedData", "status", "storedFileName", "totalAmount", "type", "uploadedAt", "userId" FROM "Invoice";
DROP TABLE "Invoice";
ALTER TABLE "new_Invoice" RENAME TO "Invoice";
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
