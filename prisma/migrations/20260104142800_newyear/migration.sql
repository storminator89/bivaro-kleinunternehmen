-- Add Invoice type column for credit notes support
ALTER TABLE "Invoice" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'INVOICE';
ALTER TABLE "Invoice" ADD COLUMN "originalInvoiceId" INTEGER REFERENCES "Invoice"("id") ON DELETE SET NULL;
ALTER TABLE "Invoice" ADD COLUMN "cancellationReason" TEXT;

-- CreateTable Documentation for GoBD Verfahrensdokumentation
CREATE TABLE "Documentation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Verfahrensdokumentation',
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "Documentation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Documentation_userId_idx" ON "Documentation"("userId");
