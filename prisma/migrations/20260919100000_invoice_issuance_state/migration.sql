-- Add a conservative lifecycle marker. Existing rows are intentionally
-- UNKNOWN and therefore cannot be deleted merely because status is DRAFT.
ALTER TABLE "Invoice" ADD COLUMN "issuanceState" TEXT NOT NULL DEFAULT 'UNKNOWN';
