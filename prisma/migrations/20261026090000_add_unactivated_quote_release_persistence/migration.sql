-- Inactive quote-release history foundation: additive tables, checks and triggers.
-- This migration does not enable public tokens, response endpoints or delivery.
-- Requires foreign_keys=ON on every connection; use migrations, not schema push.
-- Other quote-release schema revisions require a data-preserving upgrade.
-- Production deployment/recovery acceptance remains a separate requirement.
-- See docs/roadmap/quote-release-persistence-integration-gates-85.md.

CREATE TABLE "QuoteReleaseAuthority" (
 "id" TEXT NOT NULL PRIMARY KEY CHECK(typeof("id")='text' AND length("id")=36 AND substr("id",9,1)='-' AND substr("id",14,1)='-' AND substr("id",19,1)='-' AND substr("id",24,1)='-' AND substr("id",15,1)='4' AND substr("id",20,1) IN ('8','9','a','b') AND length(replace("id",'-',''))=32 AND replace("id",'-','') NOT GLOB '*[^0-9a-f]*'),
 "userId" TEXT NOT NULL,
 "sourceUserId" TEXT,
 "sourceInvoiceId" INTEGER,
 "revision" INTEGER NOT NULL DEFAULT 0 CHECK(typeof("revision")='integer' AND "revision" BETWEEN 0 AND 2147483647),
 "currentReleaseId" TEXT CHECK("currentReleaseId" IS NULL OR (typeof("currentReleaseId")='text' AND length("currentReleaseId")=36 AND substr("currentReleaseId",9,1)='-' AND substr("currentReleaseId",14,1)='-' AND substr("currentReleaseId",19,1)='-' AND substr("currentReleaseId",24,1)='-' AND substr("currentReleaseId",15,1)='4' AND substr("currentReleaseId",20,1) IN ('8','9','a','b') AND length(replace("currentReleaseId",'-',''))=32 AND replace("currentReleaseId",'-','') NOT GLOB '*[^0-9a-f]*')),
 -- Target-only mirror, deliberately NOT an FK to Customer: an AFTER DELETE
 -- assertion can detect missed child SET NULL maintenance and abort the delete.
 "boundCustomerId" INTEGER CHECK("boundCustomerId" IS NULL OR (typeof("boundCustomerId")='integer' AND "boundCustomerId">0)),
 UNIQUE("userId","id"),
 UNIQUE("sourceUserId","sourceInvoiceId"),
 CHECK(("sourceUserId" IS NULL AND "sourceInvoiceId" IS NULL) OR ("sourceUserId" IS NOT NULL AND "sourceInvoiceId" IS NOT NULL AND "sourceUserId"="userId" AND typeof("sourceInvoiceId")='integer' AND "sourceInvoiceId">0)),
 FOREIGN KEY("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("sourceUserId","sourceInvoiceId") REFERENCES "Invoice"("userId","id") ON DELETE SET NULL ON UPDATE RESTRICT,
 FOREIGN KEY("userId","id","currentReleaseId") REFERENCES "QuoteRelease"("userId","authorityId","id") ON DELETE RESTRICT ON UPDATE RESTRICT
) WITHOUT ROWID;
CREATE INDEX "QuoteReleaseAuthority_boundCustomerId_idx" ON "QuoteReleaseAuthority"("boundCustomerId");

CREATE TABLE "QuoteRelease" (
 "id" TEXT NOT NULL PRIMARY KEY CHECK(typeof("id")='text' AND length("id")=36 AND substr("id",9,1)='-' AND substr("id",14,1)='-' AND substr("id",19,1)='-' AND substr("id",24,1)='-' AND substr("id",15,1)='4' AND substr("id",20,1) IN ('8','9','a','b') AND length(replace("id",'-',''))=32 AND replace("id",'-','') NOT GLOB '*[^0-9a-f]*'),
 "userId" TEXT NOT NULL,
 "authorityId" TEXT NOT NULL CHECK(typeof("authorityId")='text' AND length("authorityId")=36 AND substr("authorityId",9,1)='-' AND substr("authorityId",14,1)='-' AND substr("authorityId",19,1)='-' AND substr("authorityId",24,1)='-' AND substr("authorityId",15,1)='4' AND substr("authorityId",20,1) IN ('8','9','a','b') AND length(replace("authorityId",'-',''))=32 AND replace("authorityId",'-','') NOT GLOB '*[^0-9a-f]*'),
 "generation" INTEGER NOT NULL CHECK(typeof("generation")='integer' AND "generation" BETWEEN 1 AND 2147483647),
 "previousReleaseId" TEXT CHECK("previousReleaseId" IS NULL OR (typeof("previousReleaseId")='text' AND length("previousReleaseId")=36 AND substr("previousReleaseId",9,1)='-' AND substr("previousReleaseId",14,1)='-' AND substr("previousReleaseId",19,1)='-' AND substr("previousReleaseId",24,1)='-' AND substr("previousReleaseId",15,1)='4' AND substr("previousReleaseId",20,1) IN ('8','9','a','b') AND length(replace("previousReleaseId",'-',''))=32 AND replace("previousReleaseId",'-','') NOT GLOB '*[^0-9a-f]*')),
 "version" INTEGER NOT NULL DEFAULT 1 CHECK("version"=1),
 "sourceFingerprint" TEXT NOT NULL CHECK(typeof("sourceFingerprint")='text' AND length("sourceFingerprint")=64 AND "sourceFingerprint" NOT GLOB '*[^0-9a-f]*'),
 "originalSha256" TEXT NOT NULL CHECK(typeof("originalSha256")='text' AND length("originalSha256")=64 AND "originalSha256" NOT GLOB '*[^0-9a-f]*'),
 "originalBytes" INTEGER NOT NULL CHECK(typeof("originalBytes")='integer' AND "originalBytes" BETWEEN 1 AND 26214400),
 "snapshotSha256" TEXT NOT NULL CHECK(typeof("snapshotSha256")='text' AND length("snapshotSha256")=64 AND "snapshotSha256" NOT GLOB '*[^0-9a-f]*'),
 "originalArchiveName" TEXT NOT NULL CHECK(length("originalArchiveName") BETWEEN 1 AND 255 AND instr("originalArchiveName",'/')=0 AND instr("originalArchiveName",char(92))=0 AND "originalArchiveName" NOT IN ('.','..')),
 -- Private retained source JSON, NOT a public recipient DTO or live customer lookup.
 "sourcePayload" TEXT NOT NULL CHECK(json_valid("sourcePayload") AND length(CAST("sourcePayload" AS BLOB))<=1048576),
 "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK(typeof("createdAt")='text' AND length("createdAt")=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',"createdAt") IS "createdAt"),
 "expiresAt" TEXT NOT NULL CHECK((typeof("expiresAt")='text' AND length("expiresAt")=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',"expiresAt") IS "expiresAt") AND "expiresAt">"createdAt"),
 "revokedAt" TEXT CHECK("revokedAt" IS NULL OR ((typeof("revokedAt")='text' AND length("revokedAt")=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',"revokedAt") IS "revokedAt") AND "revokedAt">="createdAt")),
 -- Defaults closed. Fresh owner intent must explicitly use 0. Detached historical
 -- imports always use immutable access1 and never activate a current pointer.
 "restoredAccessDisabled" INTEGER NOT NULL DEFAULT 1 CHECK(typeof("restoredAccessDisabled")='integer' AND "restoredAccessDisabled" IN (0,1)),
 UNIQUE("userId","authorityId","id"),
 UNIQUE("userId","authorityId","generation"),
 UNIQUE("userId","originalArchiveName"),
 FOREIGN KEY("userId","authorityId") REFERENCES "QuoteReleaseAuthority"("userId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("userId","authorityId","previousReleaseId") REFERENCES "QuoteRelease"("userId","authorityId","id") ON DELETE RESTRICT ON UPDATE RESTRICT
) WITHOUT ROWID;

CREATE TABLE "QuoteElectronicResponse" (
 "userId" TEXT NOT NULL,
 "requestId" TEXT NOT NULL CHECK(typeof("requestId")='text' AND length("requestId")=36 AND substr("requestId",9,1)='-' AND substr("requestId",14,1)='-' AND substr("requestId",19,1)='-' AND substr("requestId",24,1)='-' AND substr("requestId",15,1)='4' AND substr("requestId",20,1) IN ('8','9','a','b') AND length(replace("requestId",'-',''))=32 AND replace("requestId",'-','') NOT GLOB '*[^0-9a-f]*'),
 "authorityId" TEXT NOT NULL CHECK(typeof("authorityId")='text' AND length("authorityId")=36 AND substr("authorityId",9,1)='-' AND substr("authorityId",14,1)='-' AND substr("authorityId",19,1)='-' AND substr("authorityId",24,1)='-' AND substr("authorityId",15,1)='4' AND substr("authorityId",20,1) IN ('8','9','a','b') AND length(replace("authorityId",'-',''))=32 AND replace("authorityId",'-','') NOT GLOB '*[^0-9a-f]*'),
 "releaseId" TEXT NOT NULL CHECK(typeof("releaseId")='text' AND length("releaseId")=36 AND substr("releaseId",9,1)='-' AND substr("releaseId",14,1)='-' AND substr("releaseId",19,1)='-' AND substr("releaseId",24,1)='-' AND substr("releaseId",15,1)='4' AND substr("releaseId",20,1) IN ('8','9','a','b') AND length(replace("releaseId",'-',''))=32 AND replace("releaseId",'-','') NOT GLOB '*[^0-9a-f]*'),
 "version" INTEGER NOT NULL DEFAULT 1 CHECK("version"=1),
 "snapshotSha256" TEXT NOT NULL CHECK(typeof("snapshotSha256")='text' AND length("snapshotSha256")=64 AND "snapshotSha256" NOT GLOB '*[^0-9a-f]*'),
 "decision" TEXT NOT NULL CHECK("decision" IN ('ACCEPT','REJECT')),
 -- JS command parser remains normative for UTF-16/trim/control semantics.
 "comment" TEXT CHECK("comment" IS NULL OR (typeof("comment")='text' AND length("comment") BETWEEN 1 AND 500 AND "comment"=trim("comment"))),
 "recordedAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK(typeof("recordedAt")='text' AND length("recordedAt")=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',"recordedAt") IS "recordedAt"),
 PRIMARY KEY("userId","requestId"),
 UNIQUE("userId","releaseId"),
 FOREIGN KEY("userId","authorityId","releaseId") REFERENCES "QuoteRelease"("userId","authorityId","id") ON DELETE RESTRICT ON UPDATE RESTRICT
) WITHOUT ROWID;

CREATE TRIGGER "QuoteReleaseAuthority_initial_insert" BEFORE INSERT ON "QuoteReleaseAuthority"
WHEN EXISTS(SELECT 1 FROM "QuoteReleaseAuthority" a WHERE a."id"=NEW."id"
 OR (NEW."sourceUserId" IS NOT NULL AND a."sourceUserId"=NEW."sourceUserId" AND a."sourceInvoiceId"=NEW."sourceInvoiceId"))
 OR NEW."currentReleaseId" IS NOT NULL
 OR NOT (
  (NEW."sourceUserId" IS NULL AND NEW."sourceInvoiceId" IS NULL AND NEW."boundCustomerId" IS NULL)
  OR (NEW."revision"=0 AND NEW."sourceUserId" IS NEW."userId" AND NEW."sourceInvoiceId" IS NOT NULL AND EXISTS (
   SELECT 1 FROM "Invoice" q WHERE q."id"=NEW."sourceInvoiceId" AND q."userId"=NEW."userId" AND q."type"='QUOTE'
    AND q."customerId" IS NEW."boundCustomerId"
    AND (q."customerId" IS NULL OR EXISTS(SELECT 1 FROM "Customer" c WHERE c."id"=q."customerId" AND c."userId"=q."userId"))
  ))
 )
BEGIN SELECT RAISE(ABORT,'Authority requires a fresh owned source or permanently detached closed identity'); END;

CREATE TRIGGER "QuoteReleaseAuthority_immutable_delete" BEFORE DELETE ON "QuoteReleaseAuthority"
BEGIN SELECT RAISE(ABORT,'Quote release authority cannot be deleted or reset'); END;

CREATE TRIGGER "QuoteReleaseAuthority_monotonic_update" BEFORE UPDATE ON "QuoteReleaseAuthority"
WHEN NEW."userId" IS NOT OLD."userId" OR NEW."id" IS NOT OLD."id"
 OR OLD."revision">=2147483647 OR NEW."revision"<>OLD."revision"+1
 OR (OLD."sourceInvoiceId" IS NOT NULL AND NEW."sourceInvoiceId" IS NOT NULL AND (NEW."sourceInvoiceId" IS NOT OLD."sourceInvoiceId" OR NEW."sourceUserId" IS NOT OLD."sourceUserId"))
 OR (OLD."sourceInvoiceId" IS NULL AND (NEW."sourceInvoiceId" IS NOT NULL OR NEW."sourceUserId" IS NOT NULL))
 OR (NEW."sourceInvoiceId" IS NULL AND (NEW."sourceUserId" IS NOT NULL OR NEW."boundCustomerId" IS NOT NULL OR NEW."currentReleaseId" IS NOT NULL
   OR EXISTS(SELECT 1 FROM "QuoteRelease" retained WHERE retained."userId"=OLD."userId" AND retained."authorityId"=OLD."id")))
 OR (NEW."sourceInvoiceId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "Invoice" q WHERE q."id"=NEW."sourceInvoiceId" AND q."userId"=NEW."sourceUserId" AND q."userId"=NEW."userId" AND q."type"='QUOTE' AND q."customerId" IS NEW."boundCustomerId"
   AND (q."customerId" IS NULL OR EXISTS(SELECT 1 FROM "Customer" c WHERE c."id"=q."customerId" AND c."userId"=q."userId"))))
 OR (NEW."boundCustomerId" IS NOT OLD."boundCustomerId" AND NEW."currentReleaseId" IS NOT NULL)
 OR (NEW."currentReleaseId" IS NOT NULL AND (NEW."revision">=2147483647 OR NOT EXISTS (
  SELECT 1 FROM "QuoteRelease" r WHERE r."id"=NEW."currentReleaseId" AND r."userId"=NEW."userId" AND r."authorityId"=NEW."id"
   AND r."generation"=NEW."revision" AND r."previousReleaseId" IS OLD."currentReleaseId"
   AND r."revokedAt" IS NULL AND r."restoredAccessDisabled"=0
   AND r."createdAt"<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND r."expiresAt">strftime('%Y-%m-%dT%H:%M:%fZ','now')
 )))
BEGIN SELECT RAISE(ABORT,'Quote release authority transition is stale, invalid or exhausted'); END;

CREATE TRIGGER "QuoteReleaseAuthority_retire_previous" AFTER UPDATE ON "QuoteReleaseAuthority"
WHEN OLD."currentReleaseId" IS NOT NULL AND NEW."currentReleaseId" IS NOT OLD."currentReleaseId"
BEGIN
 UPDATE "QuoteRelease" SET "revokedAt"=CASE WHEN "createdAt">strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN "createdAt" ELSE strftime('%Y-%m-%dT%H:%M:%fZ','now') END
 WHERE "userId"=OLD."userId" AND "authorityId"=OLD."id" AND "id"=OLD."currentReleaseId" AND "revokedAt" IS NULL;
END;

-- Generation and previousReleaseId are an exact revision/pointer CAS. Inserting
-- a fresh row activates it via one AFTER trigger; no orphan PREPARED row exists.
CREATE TRIGGER "QuoteRelease_fresh_insert" BEFORE INSERT ON "QuoteRelease"
WHEN EXISTS(SELECT 1 FROM "QuoteRelease" r WHERE r."id"=NEW."id" OR (r."userId"=NEW."userId" AND ((r."authorityId"=NEW."authorityId" AND r."generation"=NEW."generation") OR r."originalArchiveName"=NEW."originalArchiveName")))
 OR NOT (
  (NEW."restoredAccessDisabled"=0 AND NEW."generation"<2147483647 AND NEW."revokedAt" IS NULL
   AND NEW."createdAt"=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND EXISTS (
    SELECT 1 FROM "QuoteReleaseAuthority" a JOIN "Invoice" q ON q."id"=a."sourceInvoiceId" AND q."userId"=a."sourceUserId"
    WHERE a."userId"=NEW."userId" AND a."id"=NEW."authorityId" AND a."revision"<2147483647
     AND NEW."generation"=a."revision"+1 AND NEW."previousReleaseId" IS a."currentReleaseId"
     AND q."type"='QUOTE' AND q."status" IN ('DRAFT','SENT') AND q."customerId" IS a."boundCustomerId"
     AND NOT EXISTS(SELECT 1 FROM "Invoice" child WHERE child."convertedFromQuoteId"=q."id")
   ))
  OR (NEW."restoredAccessDisabled"=1 AND NEW."createdAt"<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND EXISTS (
    SELECT 1 FROM "QuoteReleaseAuthority" a WHERE a."userId"=NEW."userId" AND a."id"=NEW."authorityId"
     AND a."sourceUserId" IS NULL AND a."sourceInvoiceId" IS NULL AND a."currentReleaseId" IS NULL AND a."boundCustomerId" IS NULL
     AND NEW."generation"<=a."revision"
     AND NEW."generation">COALESCE((SELECT max(r."generation") FROM "QuoteRelease" r WHERE r."userId"=NEW."userId" AND r."authorityId"=NEW."authorityId"),0)
     AND (NEW."previousReleaseId" IS NULL OR EXISTS(SELECT 1 FROM "QuoteRelease" previous WHERE previous."id"=NEW."previousReleaseId" AND previous."userId"=NEW."userId" AND previous."authorityId"=NEW."authorityId" AND previous."generation"<NEW."generation"))
   ))
 )
BEGIN SELECT RAISE(ABORT,'Release requires exact fresh authority or detached permanently closed history'); END;

CREATE TRIGGER "QuoteRelease_activate_insert" AFTER INSERT ON "QuoteRelease"
WHEN NEW."restoredAccessDisabled"=0
BEGIN
 UPDATE "QuoteReleaseAuthority" SET "revision"=NEW."generation", "currentReleaseId"=NEW."id"
 WHERE "userId"=NEW."userId" AND "id"=NEW."authorityId" AND "revision"=NEW."generation"-1
  AND "currentReleaseId" IS NEW."previousReleaseId";
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM "QuoteReleaseAuthority" a WHERE a."userId"=NEW."userId" AND a."id"=NEW."authorityId" AND a."revision"=NEW."generation" AND a."currentReleaseId"=NEW."id")
 THEN RAISE(ABORT,'Quote release activation lost its authority CAS') END;
END;

CREATE TRIGGER "QuoteRelease_immutable_update" BEFORE UPDATE ON "QuoteRelease"
WHEN NEW."id" IS NOT OLD."id"
 OR NEW."userId" IS NOT OLD."userId"
 OR NEW."authorityId" IS NOT OLD."authorityId"
 OR NEW."generation" IS NOT OLD."generation"
 OR NEW."previousReleaseId" IS NOT OLD."previousReleaseId"
 OR NEW."version" IS NOT OLD."version"
 OR NEW."sourceFingerprint" IS NOT OLD."sourceFingerprint"
 OR NEW."originalSha256" IS NOT OLD."originalSha256"
 OR NEW."originalBytes" IS NOT OLD."originalBytes"
 OR NEW."snapshotSha256" IS NOT OLD."snapshotSha256"
 OR NEW."originalArchiveName" IS NOT OLD."originalArchiveName"
 OR NEW."sourcePayload" IS NOT OLD."sourcePayload"
 OR NEW."createdAt" IS NOT OLD."createdAt"
 OR NEW."expiresAt" IS NOT OLD."expiresAt"
 OR (NEW."revokedAt" IS NOT OLD."revokedAt" AND (OLD."revokedAt" IS NOT NULL OR NEW."revokedAt" IS NULL OR EXISTS(SELECT 1 FROM "QuoteReleaseAuthority" a WHERE a."userId"=OLD."userId" AND a."id"=OLD."authorityId" AND a."currentReleaseId"=OLD."id")))
 OR (NEW."restoredAccessDisabled" IS NOT OLD."restoredAccessDisabled" AND (OLD."restoredAccessDisabled"<>0 OR NEW."restoredAccessDisabled"<>1 OR EXISTS(SELECT 1 FROM "QuoteReleaseAuthority" a WHERE a."userId"=OLD."userId" AND a."id"=OLD."authorityId" AND a."currentReleaseId"=OLD."id")))
BEGIN SELECT RAISE(ABORT,'Quote release binding is immutable; retire authority before disabling access'); END;

CREATE TRIGGER "QuoteRelease_immutable_delete" BEFORE DELETE ON "QuoteRelease"
BEGIN SELECT RAISE(ABORT,'Quote release history and original must be retained'); END;

CREATE TRIGGER "QuoteElectronicResponse_current_insert" BEFORE INSERT ON "QuoteElectronicResponse"
WHEN EXISTS(SELECT 1 FROM "QuoteElectronicResponse" e WHERE e."userId"=NEW."userId" AND (e."requestId"=NEW."requestId" OR e."releaseId"=NEW."releaseId"))
 OR NOT EXISTS (
  SELECT 1 FROM "QuoteRelease" r JOIN "QuoteReleaseAuthority" a ON a."userId"=r."userId" AND a."id"=r."authorityId"
  WHERE r."id"=NEW."releaseId" AND r."userId"=NEW."userId" AND r."authorityId"=NEW."authorityId"
   AND r."snapshotSha256"=NEW."snapshotSha256" AND r."version"=NEW."version"
   AND r."createdAt"<=NEW."recordedAt" AND NEW."recordedAt"<r."expiresAt"
   AND (r."revokedAt" IS NULL OR NEW."recordedAt"<=r."revokedAt")
   AND (
    (r."restoredAccessDisabled"=0 AND a."currentReleaseId"=r."id" AND a."revision"=r."generation" AND r."revokedAt" IS NULL
     AND NEW."recordedAt"=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND EXISTS (
      SELECT 1 FROM "Invoice" q WHERE q."id"=a."sourceInvoiceId" AND q."userId"=a."sourceUserId" AND q."type"='QUOTE'
       AND q."status" IN ('DRAFT','SENT') AND q."customerId" IS a."boundCustomerId"
       AND NOT EXISTS(SELECT 1 FROM "Invoice" child WHERE child."convertedFromQuoteId"=q."id")
     ))
    OR (r."restoredAccessDisabled"=1 AND a."sourceUserId" IS NULL AND a."sourceInvoiceId" IS NULL AND a."boundCustomerId" IS NULL
     AND a."currentReleaseId" IS NULL AND NEW."recordedAt"<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))
   )
 )
BEGIN SELECT RAISE(ABORT,'Response requires live current consent or detached closed historical evidence'); END;

CREATE TRIGGER "QuoteElectronicResponse_immutable_update" BEFORE UPDATE ON "QuoteElectronicResponse"
BEGIN SELECT RAISE(ABORT,'Electronic quote response is append-only'); END;
CREATE TRIGGER "QuoteElectronicResponse_immutable_delete" BEFORE DELETE ON "QuoteElectronicResponse"
BEGIN SELECT RAISE(ABORT,'Electronic quote response cannot be deleted'); END;

-- Explicit guards also cover INSERT OR REPLACE regardless of delete-trigger recursion.
CREATE TRIGGER "QuoteRelease_source_insert_restrict" BEFORE INSERT ON "Invoice"
WHEN EXISTS(SELECT 1 FROM "QuoteReleaseAuthority" a WHERE a."sourceInvoiceId"=NEW."id")
 OR EXISTS(SELECT 1 FROM "Invoice" i WHERE
   (i."id"=NEW."id" OR (i."userId"=NEW."userId" AND i."invoiceNumber"=NEW."invoiceNumber")
    OR i."convertedFromQuoteId"=NEW."convertedFromQuoteId"
    OR (i."userId"=NEW."userId" AND i."quoteCreateRequestId"=NEW."quoteCreateRequestId"))
   AND EXISTS(SELECT 1 FROM "QuoteReleaseAuthority" a WHERE a."sourceInvoiceId"=i."id" OR a."sourceInvoiceId"=i."convertedFromQuoteId"))
BEGIN SELECT RAISE(ABORT,'Insertion conflicts with retained quote source or conversion child'); END;
CREATE TRIGGER "QuoteRelease_source_conflicting_update" BEFORE UPDATE ON "Invoice"
WHEN EXISTS(SELECT 1 FROM "Invoice" i WHERE i."id"<>OLD."id" AND
   (i."id"=NEW."id" OR (i."userId"=NEW."userId" AND i."invoiceNumber"=NEW."invoiceNumber")
    OR i."convertedFromQuoteId"=NEW."convertedFromQuoteId"
    OR (i."userId"=NEW."userId" AND i."quoteCreateRequestId"=NEW."quoteCreateRequestId"))
   AND EXISTS(SELECT 1 FROM "QuoteReleaseAuthority" a WHERE a."sourceInvoiceId"=i."id" OR a."sourceInvoiceId"=i."convertedFromQuoteId"))
BEGIN SELECT RAISE(ABORT,'Update conflicts with retained quote source or conversion child'); END;
CREATE TRIGGER "QuoteRelease_source_delete_tombstone" BEFORE DELETE ON "Invoice"
WHEN EXISTS(SELECT 1 FROM "QuoteReleaseAuthority" a WHERE a."sourceUserId"=OLD."userId" AND a."sourceInvoiceId"=OLD."id")
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM "QuoteReleaseAuthority" a JOIN "QuoteRelease" r ON r."userId"=a."userId" AND r."authorityId"=a."id" WHERE a."sourceUserId"=OLD."userId" AND a."sourceInvoiceId"=OLD."id")
 THEN RAISE(ABORT,'Quote with release history cannot be deleted') END;
 UPDATE "QuoteReleaseAuthority" SET "revision"="revision"+1, "currentReleaseId"=NULL, "boundCustomerId"=NULL, "sourceUserId"=NULL, "sourceInvoiceId"=NULL
 WHERE "sourceUserId"=OLD."userId" AND "sourceInvoiceId"=OLD."id";
END;
CREATE TRIGGER "QuoteRelease_customer_replace_restrict" BEFORE INSERT ON "Customer"
WHEN EXISTS(SELECT 1 FROM "QuoteReleaseAuthority" a WHERE a."boundCustomerId"=NEW."id")
BEGIN SELECT RAISE(ABORT,'Retained quote customer cannot be replaced by insertion'); END;
CREATE TRIGGER "QuoteRelease_customer_key_restrict" BEFORE UPDATE ON "Customer"
WHEN (OLD."id" IS NOT NEW."id" OR OLD."userId" IS NOT NEW."userId")
 AND EXISTS(SELECT 1 FROM "QuoteReleaseAuthority" a WHERE a."boundCustomerId" IN (OLD."id",NEW."id"))
BEGIN SELECT RAISE(ABORT,'Retained quote customer identity cannot be reassigned'); END;

-- No UPDATE OF list: explicit OLD/NEW references are checked against main schema.
-- The WHERE clause intentionally has NO active-pointer filter: NULL also bumps.
CREATE TRIGGER "QuoteRelease_source_changed" AFTER UPDATE ON "Invoice"
WHEN (OLD."type"='QUOTE' OR NEW."type"='QUOTE') AND (
 NEW."userId" IS NOT OLD."userId"
 OR NEW."type" IS NOT OLD."type"
 OR NEW."customerId" IS NOT OLD."customerId"
 OR NEW."fileName" IS NOT OLD."fileName"
 OR NEW."storedFileName" IS NOT OLD."storedFileName"
 OR NEW."invoiceNumber" IS NOT OLD."invoiceNumber"
 OR NEW."invoiceDate" IS NOT OLD."invoiceDate"
 OR NEW."dueDate" IS NOT OLD."dueDate"
 OR NEW."validUntil" IS NOT OLD."validUntil"
 OR NEW."totalAmount" IS NOT OLD."totalAmount"
 OR NEW."parsedData" IS NOT OLD."parsedData"
 OR NEW."status" IS NOT OLD."status"
 OR NEW."issuanceState" IS NOT OLD."issuanceState"
 OR NEW."originalInvoiceId" IS NOT OLD."originalInvoiceId"
 OR NEW."cancellationReason" IS NOT OLD."cancellationReason"
)
BEGIN
 UPDATE "QuoteReleaseAuthority" SET "revision"="revision"+1, "currentReleaseId"=NULL, "boundCustomerId"=NEW."customerId"
 WHERE ("sourceUserId"=OLD."userId" AND "sourceInvoiceId"=OLD."id") OR ("sourceUserId"=NEW."userId" AND "sourceInvoiceId"=NEW."id");
END;

-- FK ON DELETE SET NULL occurs before this parent's AFTER trigger. If child
-- maintenance did not clear its retained mirror, reject/rollback the delete.
CREATE TRIGGER "QuoteRelease_customer_delete_assertion" AFTER DELETE ON "Customer"
WHEN EXISTS(SELECT 1 FROM "QuoteReleaseAuthority" a WHERE a."boundCustomerId"=OLD."id")
BEGIN SELECT RAISE(ABORT,'Customer deletion missed retained quote authority invalidation'); END;

CREATE TRIGGER "QuoteRelease_conversion_inserted" AFTER INSERT ON "Invoice"
WHEN NEW."convertedFromQuoteId" IS NOT NULL
BEGIN
 UPDATE "QuoteReleaseAuthority" SET "revision"="revision"+1, "currentReleaseId"=NULL
 WHERE "sourceInvoiceId"=NEW."convertedFromQuoteId";
END;

CREATE TRIGGER "QuoteRelease_conversion_changed" AFTER UPDATE ON "Invoice"
WHEN (OLD."convertedFromQuoteId" IS NOT NEW."convertedFromQuoteId" OR OLD."userId" IS NOT NEW."userId" OR OLD."type" IS NOT NEW."type")
 AND (OLD."convertedFromQuoteId" IS NOT NULL OR NEW."convertedFromQuoteId" IS NOT NULL)
BEGIN
 UPDATE "QuoteReleaseAuthority" SET "revision"="revision"+1, "currentReleaseId"=NULL
 WHERE "sourceInvoiceId" IN (OLD."convertedFromQuoteId",NEW."convertedFromQuoteId");
END;

CREATE TRIGGER "QuoteRelease_conversion_deleted" AFTER DELETE ON "Invoice"
WHEN OLD."convertedFromQuoteId" IS NOT NULL
BEGIN
 UPDATE "QuoteReleaseAuthority" SET "revision"="revision"+1, "currentReleaseId"=NULL
 WHERE "sourceInvoiceId"=OLD."convertedFromQuoteId";
END;
