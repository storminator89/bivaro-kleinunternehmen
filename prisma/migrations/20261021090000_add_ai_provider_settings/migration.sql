-- Optional tenant AI config; credentials encrypted application-side. Never backed up.
CREATE TABLE "AiProviderSettings" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "autoAnalyzeNewUploads" BOOLEAN NOT NULL DEFAULT false,
  "baseUrl" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "configurationRevision" TEXT NOT NULL,
  "keyCiphertext" TEXT,
  "keyIv" TEXT,
  "keyTag" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "AiProviderSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
