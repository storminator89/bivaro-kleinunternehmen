-- Keep first-administrator bootstrap consumption durable across restarts and
-- user deletion. The token itself remains server configuration and is never
-- persisted in the database.
ALTER TABLE "AppSettings" ADD COLUMN "bootstrapConsumedAt" DATETIME;

-- Existing installations already had an administrator before the bootstrap
-- proof existed. Mark those installations as consumed so deleting the last
-- user can never reopen first-admin provisioning.
UPDATE "AppSettings"
SET "bootstrapConsumedAt" = CURRENT_TIMESTAMP
WHERE "bootstrapConsumedAt" IS NULL
  AND EXISTS (SELECT 1 FROM "User");

-- Older installations may have users but no settings row yet. Preserve the
-- historical default of closed public registration in that case.
INSERT INTO "AppSettings" ("singletonKey", "allowRegistration", "bootstrapConsumedAt", "createdAt", "updatedAt")
SELECT 'global', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "User")
  AND NOT EXISTS (SELECT 1 FROM "AppSettings" WHERE "singletonKey" = 'global');
