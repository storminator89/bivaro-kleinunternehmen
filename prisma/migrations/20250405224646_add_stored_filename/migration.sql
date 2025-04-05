/*
  Warnings:

  - Added the required column `storedFileName` to the `Invoice` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Invoice" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fileName" TEXT NOT NULL,
    "storedFileName" TEXT NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invoiceDate" DATETIME,
    "dueDate" DATETIME,
    "invoiceNumber" TEXT,
    "parsedData" JSONB NOT NULL,
    "totalAmount" REAL,
    "paidStatus" BOOLEAN NOT NULL DEFAULT false,
    "paidDate" DATETIME,
    "customerId" INTEGER,
    CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Invoice" ("customerId", "dueDate", "fileName", "id", "invoiceDate", "invoiceNumber", "paidDate", "paidStatus", "parsedData", "totalAmount", "uploadedAt") SELECT "customerId", "dueDate", "fileName", "id", "invoiceDate", "invoiceNumber", "paidDate", "paidStatus", "parsedData", "totalAmount", "uploadedAt" FROM "Invoice";
DROP TABLE "Invoice";
ALTER TABLE "new_Invoice" RENAME TO "Invoice";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
