/*
  Warnings:

  - Added the required column `userId` to the `Customer` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `Expense` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `Income` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `Invoice` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `InvoiceTemplate` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `Settings` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Customer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT,
    "zipCode" TEXT,
    "city" TEXT,
    "taxNumber" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    CONSTRAINT "Customer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Customer" ("address", "city", "createdAt", "email", "id", "name", "taxNumber", "zipCode") SELECT "address", "city", "createdAt", "email", "id", "name", "taxNumber", "zipCode" FROM "Customer";
DROP TABLE "Customer";
ALTER TABLE "new_Customer" RENAME TO "Customer";
CREATE TABLE "new_Expense" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "description" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category" TEXT,
    "receiptUrl" TEXT,
    "taxRelevant" BOOLEAN NOT NULL DEFAULT true,
    "taxDeductiblePercentage" REAL,
    "receiptFileName" TEXT,
    "storedReceiptFileName" TEXT,
    "depreciationYears" INTEGER,
    "userId" TEXT NOT NULL,
    CONSTRAINT "Expense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Expense" ("amount", "category", "date", "depreciationYears", "description", "id", "receiptFileName", "receiptUrl", "storedReceiptFileName", "taxDeductiblePercentage", "taxRelevant") SELECT "amount", "category", "date", "depreciationYears", "description", "id", "receiptFileName", "receiptUrl", "storedReceiptFileName", "taxDeductiblePercentage", "taxRelevant" FROM "Expense";
DROP TABLE "Expense";
ALTER TABLE "new_Expense" RENAME TO "Expense";
CREATE TABLE "new_Income" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "description" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customerId" INTEGER,
    "invoiceId" INTEGER,
    "taxRelevant" BOOLEAN NOT NULL DEFAULT true,
    "userId" TEXT NOT NULL,
    CONSTRAINT "Income_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Income_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Income_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Income" ("amount", "customerId", "date", "description", "id", "invoiceId", "taxRelevant") SELECT "amount", "customerId", "date", "description", "id", "invoiceId", "taxRelevant" FROM "Income";
DROP TABLE "Income";
ALTER TABLE "new_Income" RENAME TO "Income";
CREATE UNIQUE INDEX "Income_invoiceId_key" ON "Income"("invoiceId");
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
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "paidAt" DATETIME,
    "customerId" INTEGER,
    "userId" TEXT NOT NULL,
    CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Invoice" ("customerId", "dueDate", "fileName", "id", "invoiceDate", "invoiceNumber", "paidAt", "parsedData", "status", "storedFileName", "totalAmount", "uploadedAt") SELECT "customerId", "dueDate", "fileName", "id", "invoiceDate", "invoiceNumber", "paidAt", "parsedData", "status", "storedFileName", "totalAmount", "uploadedAt" FROM "Invoice";
DROP TABLE "Invoice";
ALTER TABLE "new_Invoice" RENAME TO "Invoice";
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");
CREATE TABLE "new_InvoiceTemplate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "InvoiceTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_InvoiceTemplate" ("createdAt", "data", "id", "name", "updatedAt") SELECT "createdAt", "data", "id", "name", "updatedAt" FROM "InvoiceTemplate";
DROP TABLE "InvoiceTemplate";
ALTER TABLE "new_InvoiceTemplate" RENAME TO "InvoiceTemplate";
CREATE TABLE "new_Settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "companyName" TEXT,
    "companyAddress" TEXT,
    "email" TEXT,
    "telephone" TEXT,
    "taxNumber" TEXT,
    "bankName" TEXT,
    "iban" TEXT,
    "bic" TEXT,
    "footerText" TEXT,
    "logoUrl" TEXT,
    "userId" TEXT NOT NULL,
    CONSTRAINT "Settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Settings" ("bankName", "bic", "companyAddress", "companyName", "email", "footerText", "iban", "id", "logoUrl", "taxNumber", "telephone") SELECT "bankName", "bic", "companyAddress", "companyName", "email", "footerText", "iban", "id", "logoUrl", "taxNumber", "telephone" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
CREATE UNIQUE INDEX "Settings_userId_key" ON "Settings"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
