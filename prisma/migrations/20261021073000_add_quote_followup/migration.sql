ALTER TABLE "Invoice" ADD COLUMN "quoteFollowUpOn" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "quoteResponseNote" TEXT;
CREATE INDEX "Invoice_userId_type_quoteFollowUpOn_idx" ON "Invoice"("userId", "type", "quoteFollowUpOn");
