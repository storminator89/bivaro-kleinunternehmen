-- Host-wide SMTP overrides are deliberately outside tenant backups. Password
-- material is encrypted application-side before it reaches these columns.
CREATE TABLE "SmtpSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "singletonKey" TEXT NOT NULL DEFAULT 'global',
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "secure" BOOLEAN NOT NULL,
    "from" TEXT NOT NULL,
    "user" TEXT,
    "passwordCiphertext" TEXT,
    "passwordIv" TEXT,
    "passwordTag" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "SmtpSettings_singletonKey_key" ON "SmtpSettings"("singletonKey");
