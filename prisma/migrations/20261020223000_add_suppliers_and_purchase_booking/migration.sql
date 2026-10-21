CREATE TABLE "Supplier" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "address" TEXT,
  "postalCode" TEXT,
  "city" TEXT,
  "country" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "taxId" TEXT,
  "vatId" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Supplier_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "Supplier_userId_name_idx" ON "Supplier"("userId", "name");
ALTER TABLE "PurchaseDocument" ADD COLUMN "supplierId" INTEGER REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseDocument" ADD COLUMN "selectedSupplierSnapshot" JSONB;
