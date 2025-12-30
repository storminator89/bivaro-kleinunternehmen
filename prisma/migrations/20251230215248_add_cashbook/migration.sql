-- CreateTable
CREATE TABLE "CashBook" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL DEFAULT 'Hauptkasse',
    "description" TEXT,
    "initialBalance" REAL NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "CashBook_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CashTransaction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "runningBalance" REAL NOT NULL,
    "category" TEXT,
    "receiptNumber" TEXT,
    "taxRelevant" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "cashBookId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "expenseId" INTEGER,
    "incomeId" INTEGER,
    CONSTRAINT "CashTransaction_cashBookId_fkey" FOREIGN KEY ("cashBookId") REFERENCES "CashBook" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CashTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CashTransaction_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CashTransaction_incomeId_fkey" FOREIGN KEY ("incomeId") REFERENCES "Income" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CashBook_userId_idx" ON "CashBook"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CashTransaction_expenseId_key" ON "CashTransaction"("expenseId");

-- CreateIndex
CREATE UNIQUE INDEX "CashTransaction_incomeId_key" ON "CashTransaction"("incomeId");

-- CreateIndex
CREATE INDEX "CashTransaction_cashBookId_idx" ON "CashTransaction"("cashBookId");

-- CreateIndex
CREATE INDEX "CashTransaction_userId_idx" ON "CashTransaction"("userId");

-- CreateIndex
CREATE INDEX "CashTransaction_date_idx" ON "CashTransaction"("date");

-- CreateIndex
CREATE INDEX "CashTransaction_type_idx" ON "CashTransaction"("type");
