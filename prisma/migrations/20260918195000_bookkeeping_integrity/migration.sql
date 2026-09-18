-- Additive changes preserve historical amounts, document numbers and files.
ALTER TABLE "Expense" ADD COLUMN "recurringExpenseId" INTEGER REFERENCES "RecurringExpense"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD COLUMN "scheduledDate" DATETIME;
CREATE UNIQUE INDEX "Expense_recurringExpenseId_scheduledDate_key" ON "Expense"("recurringExpenseId", "scheduledDate");
CREATE INDEX "Expense_userId_date_idx" ON "Expense"("userId", "date");
CREATE INDEX "Income_userId_date_idx" ON "Income"("userId", "date");

ALTER TABLE "Invoice" ADD COLUMN "convertedFromQuoteId" INTEGER REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Invoice_convertedFromQuoteId_key" ON "Invoice"("convertedFromQuoteId");
DROP INDEX IF EXISTS "Invoice_invoiceNumber_key";
CREATE UNIQUE INDEX "Invoice_userId_invoiceNumber_key" ON "Invoice"("userId", "invoiceNumber");
CREATE INDEX "Invoice_userId_type_uploadedAt_idx" ON "Invoice"("userId", "type", "uploadedAt");
CREATE INDEX "Invoice_userId_status_idx" ON "Invoice"("userId", "status");

CREATE TABLE "InvoiceNumberCounter" (
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "value" INTEGER NOT NULL,
  PRIMARY KEY ("userId", "type", "year")
);
