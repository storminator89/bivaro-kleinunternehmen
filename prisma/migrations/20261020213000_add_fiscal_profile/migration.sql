-- Additive only: no tax status is inferred for existing users and no invoice
-- original, parsed data, amount or historical tax selection is changed.
ALTER TABLE "Settings" ADD COLUMN "fiscalTaxRegime" TEXT NOT NULL DEFAULT 'UNSET';
ALTER TABLE "Settings" ADD COLUMN "fiscalEffectiveFrom" TEXT;
ALTER TABLE "Settings" ADD COLUMN "fiscalConfirmedAt" DATETIME;
