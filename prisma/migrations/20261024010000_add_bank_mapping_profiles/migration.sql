CREATE TABLE "BankMappingProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "deletedAt" DATETIME,
    "deleteMutationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    PRIMARY KEY ("userId", "id"),
    CONSTRAINT "BankMappingProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "BankMappingProfile_userId_deletedAt_idx" ON "BankMappingProfile"("userId", "deletedAt");
CREATE TABLE "BankMappingProfileRevision" (
    "userId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "mutationId" TEXT NOT NULL,
    "configuration" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("userId", "profileId", "revision"),
    CONSTRAINT "BankMappingProfileRevision_userId_profileId_fkey" FOREIGN KEY ("userId", "profileId") REFERENCES "BankMappingProfile" ("userId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BankMappingProfileRevision_userId_profileId_mutationId_key" ON "BankMappingProfileRevision"("userId", "profileId", "mutationId");
