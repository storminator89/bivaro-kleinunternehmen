-- Preserve immutable historical events and their Income projections verbatim.
DROP INDEX "PaymentJournalEvent_invoiceId_key";
DROP INDEX "Income_invoiceId_key";
CREATE INDEX "PaymentJournalEvent_userId_invoiceId_id_idx"
  ON "PaymentJournalEvent"("userId", "invoiceId", "id");
CREATE INDEX "Income_userId_invoiceId_idx" ON "Income"("userId", "invoiceId");
