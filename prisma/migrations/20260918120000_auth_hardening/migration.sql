-- Add the session generation used to revoke JWTs after security-sensitive
-- account changes.
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- Give AppSettings one stable logical row.  Existing duplicate rows are kept
-- for later review, but receive deterministic legacy keys before the unique
-- index is created so deployment does not fail on an old race-created row.
ALTER TABLE "AppSettings" ADD COLUMN "singletonKey" TEXT NOT NULL DEFAULT 'global';
UPDATE "AppSettings"
SET "singletonKey" = 'legacy-' || CAST("id" AS TEXT)
WHERE "id" NOT IN (SELECT MIN("id") FROM "AppSettings");
CREATE UNIQUE INDEX "AppSettings_singletonKey_key" ON "AppSettings"("singletonKey");

-- Shared SQLite-backed TTL buckets.  Authentication hashes logical keys before
-- storing them, so raw email addresses and IPs never become database keys.
CREATE TABLE "RateLimitBucket" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowStartedAt" DATETIME NOT NULL,
    "blockedUntil" DATETIME,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "RateLimitBucket_key_key" ON "RateLimitBucket"("key");
CREATE INDEX "RateLimitBucket_updatedAt_idx" ON "RateLimitBucket"("updatedAt");
