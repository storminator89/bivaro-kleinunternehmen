-- Keep ownership and financial history when access is revoked.
ALTER TABLE "User" ADD COLUMN "deactivatedAt" DATETIME;
