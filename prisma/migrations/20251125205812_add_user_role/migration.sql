/*
  Warnings:

  - You are about to drop the column `paidDate` on the `Invoice` table. All the data in the column will be lost.
  - You are about to drop the column `paidStatus` on the `Invoice` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "city" TEXT;
ALTER TABLE "Customer" ADD COLUMN "zipCode" TEXT;

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN "depreciationYears" INTEGER;

-- CreateTable
CREATE TABLE "Settings" (
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
    "logoUrl" TEXT
);

-- CreateTable
CREATE TABLE "InvoiceTemplate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

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
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "paidAt" DATETIME,
    "customerId" INTEGER,
    CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Invoice" ("customerId", "dueDate", "fileName", "id", "invoiceDate", "invoiceNumber", "parsedData", "storedFileName", "totalAmount", "uploadedAt") SELECT "customerId", "dueDate", "fileName", "id", "invoiceDate", "invoiceNumber", "parsedData", "storedFileName", "totalAmount", "uploadedAt" FROM "Invoice";
DROP TABLE "Invoice";
ALTER TABLE "new_Invoice" RENAME TO "Invoice";
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("createdAt", "email", "id", "name", "password") SELECT "createdAt", "email", "id", "name", "password" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
