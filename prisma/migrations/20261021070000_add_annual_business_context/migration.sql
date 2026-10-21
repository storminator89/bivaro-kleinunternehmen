-- Additive, no Settings or document changes; existing users have no declarations.
CREATE TABLE "AnnualBusinessContextRevision" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "userId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "contextYear" INTEGER NOT NULL CHECK ("contextYear" BETWEEN 1901 AND 9999),
  "effectiveFrom" TEXT NOT NULL,
  "foundingYear" INTEGER,
  "previousYearTurnoverCents" TEXT,
  "previousYearExternalTurnoverCents" TEXT,
  "completeness" TEXT NOT NULL CHECK ("completeness" IN ('UNKNOWN', 'PARTIAL', 'COMPLETE')),
  "sourceNote" TEXT NOT NULL,
  "declaredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnnualBusinessContextRevision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AnnualBusinessContextRevision_userId_revision_key" ON "AnnualBusinessContextRevision"("userId", "revision");
CREATE INDEX "AnnualBusinessContextRevision_userId_contextYear_revision_idx" ON "AnnualBusinessContextRevision"("userId", "contextYear", "revision");
CREATE TRIGGER "annual_context_no_update" BEFORE UPDATE ON "AnnualBusinessContextRevision" BEGIN SELECT RAISE(ABORT, 'Annual context history is immutable'); END;
CREATE TRIGGER "annual_context_no_delete" BEFORE DELETE ON "AnnualBusinessContextRevision" BEGIN SELECT RAISE(ABORT, 'Annual context history is immutable'); END;
