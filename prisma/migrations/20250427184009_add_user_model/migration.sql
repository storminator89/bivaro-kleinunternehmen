/*
  Warnings:

  - You are about to drop the column `taxDeductiblePercentage` on the `Expense` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Expense" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "description" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category" TEXT,
    "receiptUrl" TEXT,
    "taxRelevant" BOOLEAN NOT NULL DEFAULT true,
    "receiptFileName" TEXT,
    "storedReceiptFileName" TEXT
);
INSERT INTO "new_Expense" ("amount", "category", "date", "description", "id", "receiptFileName", "receiptUrl", "storedReceiptFileName", "taxRelevant") SELECT "amount", "category", "date", "description", "id", "receiptFileName", "receiptUrl", "storedReceiptFileName", "taxRelevant" FROM "Expense";
DROP TABLE "Expense";
ALTER TABLE "new_Expense" RENAME TO "Expense";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
