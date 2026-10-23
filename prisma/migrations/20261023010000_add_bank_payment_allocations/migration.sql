-- Add allocation evidence; never rewrite a receipt, Income, or historical v2 hash.
PRAGMA foreign_keys=OFF;
DROP TRIGGER "PaymentAdjustment_owned_insert";
DROP TRIGGER "PaymentAdjustment_capacity_insert";
DROP TRIGGER "PaymentAdjustment_immutable_update";
DROP TRIGGER "PaymentAdjustment_immutable_delete";
DROP TRIGGER "PaymentOperation_immutable_update";
DROP TRIGGER "PaymentOperation_immutable_delete";
DROP TRIGGER "PaymentJournalEvent_operation_insert";
DROP TRIGGER "PaymentAdjustment_basis_immutable";
DROP TRIGGER "CashTransaction_no_adjusted_invoice_insert";
DROP TRIGGER "CashTransaction_no_adjusted_invoice_update";
CREATE TABLE "new_PaymentOperation" (
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "userId" TEXT NOT NULL,
 "idempotencyKey" TEXT NOT NULL CHECK(length("idempotencyKey") BETWEEN 1 AND 128),
 "kind" TEXT NOT NULL CHECK("kind" IN ('PAYMENT_RECEIVED','PAYMENT_CORRECTION','CUSTOMER_REFUND','PAYMENT_ALLOCATION_CHANGED')),
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_PaymentOperation" SELECT * FROM "PaymentOperation";
DROP TABLE "PaymentOperation";
ALTER TABLE "new_PaymentOperation" RENAME TO "PaymentOperation";
CREATE UNIQUE INDEX "PaymentOperation_userId_idempotencyKey_key" ON "PaymentOperation"("userId","idempotencyKey");
CREATE TABLE "BankPaymentBinding" (
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "stableKey" TEXT NOT NULL,
 "userId" TEXT NOT NULL, "bankImportRowId" INTEGER NOT NULL, "paymentJournalEventId" INTEGER NOT NULL,
 "idempotencyKey" TEXT NOT NULL CHECK(length("idempotencyKey") BETWEEN 1 AND 128),
 "semanticFingerprint" TEXT NOT NULL CHECK(length("semanticFingerprint")=64), "basisSnapshot" JSONB NOT NULL CHECK(json_valid("basisSnapshot")),
 "contractVersion" INTEGER NOT NULL DEFAULT 1 CHECK("contractVersion"=1), "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("bankImportRowId") REFERENCES "BankImportRow"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("paymentJournalEventId") REFERENCES "PaymentJournalEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("userId","idempotencyKey") REFERENCES "PaymentOperation"("userId","idempotencyKey") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "BankPaymentBinding_bankImportRowId_key" ON "BankPaymentBinding"("bankImportRowId");
CREATE UNIQUE INDEX "BankPaymentBinding_paymentJournalEventId_key" ON "BankPaymentBinding"("paymentJournalEventId");
CREATE UNIQUE INDEX "BankPaymentBinding_userId_bankImportRowId_key" ON "BankPaymentBinding"("userId","bankImportRowId");
CREATE UNIQUE INDEX "BankPaymentBinding_userId_paymentJournalEventId_key" ON "BankPaymentBinding"("userId","paymentJournalEventId");
CREATE UNIQUE INDEX "BankPaymentBinding_userId_idempotencyKey_key" ON "BankPaymentBinding"("userId","idempotencyKey");
CREATE UNIQUE INDEX "BankPaymentBinding_userId_stableKey_key" ON "BankPaymentBinding"("userId","stableKey");
CREATE TABLE "PaymentAllocationChange" (
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "stableKey" TEXT NOT NULL, "userId" TEXT NOT NULL, "bindingId" INTEGER NOT NULL,
 "revision" INTEGER NOT NULL CHECK("revision">0), "previousChangeId" INTEGER, "fromInvoiceId" INTEGER NOT NULL, "toInvoiceId" INTEGER NOT NULL,
 "amountCents" TEXT NOT NULL CHECK(length("amountCents") BETWEEN 1 AND 16 AND "amountCents" NOT GLOB '*[^0-9]*' AND substr("amountCents",1,1) BETWEEN '1' AND '9' AND (length("amountCents")<16 OR "amountCents"<='9007199254740991')),
 "currency" TEXT NOT NULL DEFAULT 'EUR' CHECK("currency"='EUR'), "actionDate" DATETIME NOT NULL,
 "reason" TEXT NOT NULL CHECK(length(trim("reason")) BETWEEN 1 AND 1000), "idempotencyKey" TEXT NOT NULL CHECK(length("idempotencyKey") BETWEEN 1 AND 128),
 "semanticFingerprint" TEXT NOT NULL CHECK(length("semanticFingerprint")=64), "basisSnapshot" JSONB NOT NULL CHECK(json_valid("basisSnapshot")),
 "contractVersion" INTEGER NOT NULL DEFAULT 1 CHECK("contractVersion"=1), "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("bindingId") REFERENCES "BankPaymentBinding"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("previousChangeId") REFERENCES "PaymentAllocationChange"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("fromInvoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("toInvoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("userId","idempotencyKey") REFERENCES "PaymentOperation"("userId","idempotencyKey") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CHECK("fromInvoiceId"<>"toInvoiceId"), CHECK(("revision"=1 AND "previousChangeId" IS NULL) OR ("revision">1 AND "previousChangeId" IS NOT NULL))
);
CREATE UNIQUE INDEX "PaymentAllocationChange_previousChangeId_key" ON "PaymentAllocationChange"("previousChangeId");
CREATE UNIQUE INDEX "PaymentAllocationChange_bindingId_revision_key" ON "PaymentAllocationChange"("bindingId","revision");
CREATE UNIQUE INDEX "PaymentAllocationChange_userId_idempotencyKey_key" ON "PaymentAllocationChange"("userId","idempotencyKey");
CREATE UNIQUE INDEX "PaymentAllocationChange_userId_stableKey_key" ON "PaymentAllocationChange"("userId","stableKey");
CREATE INDEX "PaymentAllocationChange_userId_fromInvoiceId_id_idx" ON "PaymentAllocationChange"("userId","fromInvoiceId","id");
CREATE INDEX "PaymentAllocationChange_userId_toInvoiceId_id_idx" ON "PaymentAllocationChange"("userId","toInvoiceId","id");
CREATE TABLE "new_PaymentAdjustment" (
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "userId" TEXT NOT NULL, "invoiceId" INTEGER NOT NULL,
 "originalPaymentId" INTEGER NOT NULL, "kind" TEXT NOT NULL CHECK("kind" IN ('PAYMENT_CORRECTION','CUSTOMER_REFUND')),
 "amountCents" TEXT NOT NULL CHECK(length("amountCents") BETWEEN 1 AND 16 AND "amountCents" NOT GLOB '*[^0-9]*'
 AND substr("amountCents",1,1) BETWEEN '1' AND '9' AND (length("amountCents")<16 OR "amountCents"<='9007199254740991')),
 "currency" TEXT NOT NULL DEFAULT 'EUR' CHECK("currency"='EUR'),
 "actionDate" DATETIME NOT NULL, "accountingEffectiveOn" DATETIME NOT NULL,
 "reason" TEXT NOT NULL CHECK(length(trim("reason")) BETWEEN 1 AND 1000),
 "reference" TEXT NOT NULL CHECK(length(trim("reference")) BETWEEN 1 AND 255),
 "payoutEvidenceIdentity" TEXT, "cancellationInvoiceId" INTEGER, "basisSnapshot" JSONB,
 "idempotencyKey" TEXT NOT NULL CHECK(length("idempotencyKey") BETWEEN 1 AND 128),
 "semanticFingerprint" TEXT NOT NULL CHECK(length("semanticFingerprint")=64),
 "contractVersion" INTEGER NOT NULL DEFAULT 2 CHECK("contractVersion" IN (2,3)),
 "allocationBindingId" INTEGER, "allocationRevision" INTEGER, "allocationChangeId" INTEGER, "allocationBasisSnapshot" JSONB,
 "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("allocationBindingId") REFERENCES "BankPaymentBinding"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("allocationChangeId") REFERENCES "PaymentAllocationChange"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CHECK(("contractVersion"=2 AND "allocationBindingId" IS NULL AND "allocationRevision" IS NULL AND "allocationChangeId" IS NULL AND "allocationBasisSnapshot" IS NULL)
 OR ("contractVersion"=3 AND "allocationBindingId" IS NOT NULL AND "allocationRevision">=0 AND "allocationBasisSnapshot" IS NOT NULL AND json_valid("allocationBasisSnapshot") AND (("allocationRevision"=0 AND "allocationChangeId" IS NULL) OR ("allocationRevision">0 AND "allocationChangeId" IS NOT NULL)))),
 FOREIGN KEY("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("userId","idempotencyKey") REFERENCES "PaymentOperation"("userId","idempotencyKey") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("originalPaymentId") REFERENCES "PaymentJournalEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("cancellationInvoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CHECK(("kind"='PAYMENT_CORRECTION' AND "cancellationInvoiceId" IS NULL AND "basisSnapshot" IS NULL AND "payoutEvidenceIdentity" IS NULL)
 OR ("kind"='CUSTOMER_REFUND' AND "cancellationInvoiceId" IS NOT NULL AND "basisSnapshot" IS NOT NULL AND "payoutEvidenceIdentity" IS NOT NULL))
);
INSERT INTO "new_PaymentAdjustment" (id,userId,invoiceId,originalPaymentId,kind,amountCents,currency,actionDate,accountingEffectiveOn,reason,reference,payoutEvidenceIdentity,cancellationInvoiceId,basisSnapshot,idempotencyKey,semanticFingerprint,contractVersion,recordedAt) SELECT id,userId,invoiceId,originalPaymentId,kind,amountCents,currency,actionDate,accountingEffectiveOn,reason,reference,payoutEvidenceIdentity,cancellationInvoiceId,basisSnapshot,idempotencyKey,semanticFingerprint,contractVersion,recordedAt FROM "PaymentAdjustment";
DROP TABLE "PaymentAdjustment";
ALTER TABLE "new_PaymentAdjustment" RENAME TO "PaymentAdjustment";
CREATE UNIQUE INDEX "PaymentAdjustment_userId_idempotencyKey_key" ON "PaymentAdjustment"("userId","idempotencyKey");
CREATE UNIQUE INDEX "PaymentAdjustment_userId_payoutEvidenceIdentity_key" ON "PaymentAdjustment"("userId","payoutEvidenceIdentity");
CREATE INDEX "PaymentAdjustment_userId_invoiceId_id_idx" ON "PaymentAdjustment"("userId","invoiceId","id");
CREATE INDEX "PaymentAdjustment_userId_accountingEffectiveOn_idx" ON "PaymentAdjustment"("userId","accountingEffectiveOn");
CREATE INDEX "PaymentAdjustment_originalPaymentId_id_idx" ON "PaymentAdjustment"("originalPaymentId","id");
CREATE TRIGGER "BankPaymentBinding_owned_insert" BEFORE INSERT ON "BankPaymentBinding"
WHEN NOT EXISTS(SELECT 1 FROM "PaymentJournalEvent" p JOIN "Invoice" i ON i.id=p."invoiceId" JOIN "Income" n ON n.id=p."incomeId" JOIN "BankImportRow" r ON r.id=NEW."bankImportRowId" JOIN "BankImportBatch" batch ON batch.id=r."batchId" AND batch."userId"=NEW."userId" JOIN "PaymentOperation" o ON o."userId"=NEW."userId" AND o."idempotencyKey"=NEW."idempotencyKey"
 WHERE p.id=NEW."paymentJournalEventId" AND p."userId"=NEW."userId" AND i."userId"=NEW."userId" AND r."userId"=NEW."userId" AND n."userId"=NEW."userId" AND n."invoiceId"=i.id AND n."customerId"=i."customerId"
 AND i.type='INVOICE' AND i."issuanceState"='ISSUED' AND i."invoiceNumber" IS NOT NULL AND i."customerId" IS NOT NULL AND p."dateCertainty"='ACTUAL' AND p.source='MANUAL' AND p.currency='EUR'
 AND p."idempotencyKey"=NEW."idempotencyKey" AND o.kind='PAYMENT_RECEIVED' AND p.reference='bank-row:'||r."stableKey"
 AND json_extract(r.evidence,'$.amountCents')=p."amountCents" AND json_extract(r.evidence,'$.currency')='EUR'
 AND json_extract(NEW."basisSnapshot",'$.rowStableKey')=r."stableKey" AND json_extract(NEW."basisSnapshot",'$.originalPaymentKey')=p."idempotencyKey"
 AND json_extract(NEW."basisSnapshot",'$.amountCents')=p."amountCents" AND json_extract(NEW."basisSnapshot",'$.receiptConfirmed')=1
 AND json_extract(NEW."basisSnapshot",'$.originInvoiceNumber')=i."invoiceNumber" AND json_extract(NEW."basisSnapshot",'$.currency')='EUR'
 AND json_extract(NEW."basisSnapshot",'$.paidAt')=json_extract(r.evidence,'$.date')
 AND length(json_extract(NEW."basisSnapshot",'$.rowEvidenceHash'))=64 AND length(json_extract(NEW."basisSnapshot",'$.expectedLedgerVersion'))=64
 AND json_extract(NEW."basisSnapshot",'$.taxContext.taxMode')='small-business' AND json_extract(NEW."basisSnapshot",'$.taxContext.taxAmountCents')='0')
 OR EXISTS(SELECT 1 FROM "CashTransaction" c JOIN "PaymentJournalEvent" p ON p."incomeId"=c."incomeId" WHERE p.id=NEW."paymentJournalEventId")
 OR EXISTS(SELECT 1 FROM "PaymentAdjustment" a WHERE a."originalPaymentId"=NEW."paymentJournalEventId")
BEGIN SELECT RAISE(ABORT,'Bank binding evidence or ownership mismatch'); END;
CREATE TRIGGER "PaymentAllocationChange_owned_insert" BEFORE INSERT ON "PaymentAllocationChange"
WHEN NOT EXISTS(SELECT 1 FROM "BankPaymentBinding" b JOIN "PaymentJournalEvent" p ON p.id=b."paymentJournalEventId" JOIN "Invoice" f ON f.id=NEW."fromInvoiceId" JOIN "Invoice" t ON t.id=NEW."toInvoiceId" JOIN "Invoice" origin ON origin.id=p."invoiceId" JOIN "PaymentOperation" o ON o."userId"=NEW."userId" AND o."idempotencyKey"=NEW."idempotencyKey"
 WHERE b.id=NEW."bindingId" AND b."userId"=NEW."userId" AND p."userId"=NEW."userId" AND f."userId"=NEW."userId" AND t."userId"=NEW."userId"
 AND f."customerId" IS NOT NULL AND f."customerId"=t."customerId" AND t."customerId"=origin."customerId"
 AND t.type='INVOICE' AND f.type='INVOICE' AND t."issuanceState"='ISSUED' AND f."issuanceState"='ISSUED'
 AND t."invoiceNumber" IS NOT NULL AND f."invoiceNumber" IS NOT NULL
 AND json_extract(t."parsedData",'$.currency')='EUR' AND json_extract(f."parsedData",'$.currency')='EUR'
 AND (json_extract(t."parsedData",'$.taxMode')='small-business' OR (json_extract(t."parsedData",'$.taxMode') IS NULL
 AND NOT EXISTS(SELECT 1 FROM json_each(COALESCE(json_extract(t."parsedData",'$.lineItems'),json_extract(t."parsedData",'$.items'),'[]')) explicitTax
 WHERE json_extract(explicitTax.value,'$.taxCategory') IS NOT 'E' OR json_extract(explicitTax.value,'$.exemptionReason') IS NOT 'Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG.'))) AND (json_extract(f."parsedData",'$.taxMode')='small-business' OR (json_extract(f."parsedData",'$.taxMode') IS NULL
 AND NOT EXISTS(SELECT 1 FROM json_each(COALESCE(json_extract(f."parsedData",'$.lineItems'),json_extract(f."parsedData",'$.items'),'[]')) explicitTax
 WHERE json_extract(explicitTax.value,'$.taxCategory') IS NOT 'E' OR json_extract(explicitTax.value,'$.exemptionReason') IS NOT 'Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG.')))
 AND p."amountCents"=NEW."amountCents" AND o.kind='PAYMENT_ALLOCATION_CHANGED'
 AND NEW.revision=1+(SELECT COALESCE(MAX(c.revision),0) FROM "PaymentAllocationChange" c WHERE c."bindingId"=b.id)
 AND ((NEW.revision=1 AND NEW."previousChangeId" IS NULL AND NEW."fromInvoiceId"=p."invoiceId") OR EXISTS(SELECT 1 FROM "PaymentAllocationChange" c WHERE c.id=NEW."previousChangeId" AND c."bindingId"=b.id AND c.revision=NEW.revision-1 AND c."toInvoiceId"=NEW."fromInvoiceId"))
 AND json_extract(NEW."basisSnapshot",'$.bindingStableKey')=b."stableKey" AND json_extract(NEW."basisSnapshot",'$.originalPaymentKey')=p."idempotencyKey"
 AND json_extract(NEW."basisSnapshot",'$.expectedAllocationRevision')=NEW.revision-1 AND json_extract(NEW."basisSnapshot",'$.cashNeutralReviewed')=1)
 OR EXISTS(SELECT 1 FROM "PaymentAdjustment" a JOIN "BankPaymentBinding" b ON b."paymentJournalEventId"=a."originalPaymentId" WHERE b.id=NEW."bindingId")
 OR EXISTS(SELECT 1 FROM "CashTransaction" c JOIN "PaymentJournalEvent" p ON p."incomeId"=c."incomeId" JOIN "BankPaymentBinding" b ON b."paymentJournalEventId"=p.id WHERE b.id=NEW."bindingId")
 OR EXISTS(SELECT 1 FROM "PaymentJournalEvent" p WHERE p."userId"=NEW."userId" AND p."idempotencyKey"=NEW."idempotencyKey")
 OR EXISTS(SELECT 1 FROM "PaymentAdjustment" a WHERE a."userId"=NEW."userId" AND a."idempotencyKey"=NEW."idempotencyKey")
BEGIN SELECT RAISE(ABORT,'Allocation head, context, operation or frozen receipt mismatch'); END;
CREATE TRIGGER "PaymentAdjustment_owned_insert" BEFORE INSERT ON "PaymentAdjustment"
WHEN NOT EXISTS(SELECT 1 FROM "PaymentJournalEvent" p JOIN "Invoice" origin ON origin.id=p."invoiceId" JOIN "Invoice" i ON i.id=NEW."invoiceId" JOIN "Income" n ON n.id=p."incomeId"
 WHERE p.id=NEW."originalPaymentId" AND p."userId"=NEW."userId" AND p."dateCertainty"='ACTUAL' AND origin."userId"=NEW."userId" AND i."userId"=NEW."userId" AND i.type='INVOICE' AND i."issuanceState"='ISSUED' AND n."userId"=NEW."userId" AND n."invoiceId"=origin.id AND n."customerId" IS origin."customerId"
 AND ((NEW."contractVersion"=2 AND p."invoiceId"=NEW."invoiceId" AND NOT EXISTS(SELECT 1 FROM "BankPaymentBinding" b WHERE b."paymentJournalEventId"=p.id))
 OR (NEW."contractVersion"=3 AND i."customerId" IS NOT NULL AND i."customerId"=origin."customerId" AND EXISTS(SELECT 1 FROM "BankPaymentBinding" b WHERE b.id=NEW."allocationBindingId" AND b."userId"=NEW."userId" AND b."paymentJournalEventId"=p.id
 AND NEW."allocationRevision"=(SELECT COALESCE(MAX(c.revision),0) FROM "PaymentAllocationChange" c WHERE c."bindingId"=b.id)
 AND ((NEW."allocationRevision"=0 AND p."invoiceId"=NEW."invoiceId" AND NEW."allocationChangeId" IS NULL) OR EXISTS(SELECT 1 FROM "PaymentAllocationChange" c WHERE c.id=NEW."allocationChangeId" AND c."bindingId"=b.id AND c.revision=NEW."allocationRevision" AND c."toInvoiceId"=NEW."invoiceId"))
 AND json_extract(NEW."allocationBasisSnapshot",'$.bindingStableKey')=b."stableKey" AND json_extract(NEW."allocationBasisSnapshot",'$.allocationRevision')=NEW."allocationRevision"
 AND json_extract(NEW."allocationBasisSnapshot",'$.originalPaymentKey')=p."idempotencyKey" AND json_extract(NEW."allocationBasisSnapshot",'$.currentInvoiceNumber')=i."invoiceNumber"
 AND json_extract(NEW."allocationBasisSnapshot",'$.amountCents')=p."amountCents"
 AND json_extract(NEW."allocationBasisSnapshot",'$.contractVersion')=1 AND json_extract(NEW."allocationBasisSnapshot",'$.currency')='EUR'
 AND json_extract(NEW."allocationBasisSnapshot",'$.rowStableKey')=(SELECT r."stableKey" FROM "BankImportRow" r WHERE r.id=b."bankImportRowId")
 AND json_extract(NEW."allocationBasisSnapshot",'$.originInvoiceNumber')=origin."invoiceNumber"
 AND ((NEW."allocationRevision"=0 AND json_extract(NEW."allocationBasisSnapshot",'$.allocationChangeStableKey') IS NULL)
 OR json_extract(NEW."allocationBasisSnapshot",'$.allocationChangeStableKey')=(SELECT c."stableKey" FROM "PaymentAllocationChange" c WHERE c.id=NEW."allocationChangeId"))
 AND json_extract(NEW."allocationBasisSnapshot",'$.taxContext.taxMode')='small-business' AND json_extract(NEW."allocationBasisSnapshot",'$.taxContext.taxAmountCents')='0'))))
 OR EXISTS(SELECT 1 FROM "CashTransaction" c JOIN "PaymentJournalEvent" p ON p."incomeId"=c."incomeId" WHERE p.id=NEW."originalPaymentId")
 OR NOT EXISTS(SELECT 1 FROM "PaymentOperation" o WHERE o."userId"=NEW."userId" AND o."idempotencyKey"=NEW."idempotencyKey" AND o.kind=NEW.kind)
 OR EXISTS(SELECT 1 FROM "PaymentJournalEvent" p WHERE p."userId"=NEW."userId" AND p."idempotencyKey"=NEW."idempotencyKey")
 OR EXISTS(SELECT 1 FROM "PaymentAllocationChange" c WHERE c."userId"=NEW."userId" AND c."idempotencyKey"=NEW."idempotencyKey")
 OR (NEW.kind='CUSTOMER_REFUND' AND NOT EXISTS(SELECT 1 FROM "Invoice" b JOIN "Invoice" i ON i.id=NEW."invoiceId" WHERE b.id=NEW."cancellationInvoiceId" AND b."userId"=NEW."userId" AND b.type='CREDIT_NOTE' AND b."issuanceState"='ISSUED' AND b.status='SENT' AND b."originalInvoiceId"=i.id AND i.status='CANCELLED' AND b."customerId" IS i."customerId" AND b."totalAmount"=-i."totalAmount"))
BEGIN SELECT RAISE(ABORT,'Payment adjustment ownership, allocation, operation or cancellation mismatch'); END;
CREATE TRIGGER "PaymentAdjustment_capacity_insert" BEFORE INSERT ON "PaymentAdjustment"
WHEN CAST(NEW."amountCents" AS INTEGER)+(SELECT COALESCE(SUM(CAST(a."amountCents" AS INTEGER)),0) FROM "PaymentAdjustment" a WHERE a."originalPaymentId"=NEW."originalPaymentId")
 >(SELECT CAST(p."amountCents" AS INTEGER) FROM "PaymentJournalEvent" p WHERE p.id=NEW."originalPaymentId")
BEGIN SELECT RAISE(ABORT,'Payment adjustment exceeds original receipt'); END;
CREATE TRIGGER "PaymentAdjustment_immutable_update" BEFORE UPDATE ON "PaymentAdjustment"
BEGIN SELECT RAISE(ABORT,'Payment adjustments are immutable'); END;
CREATE TRIGGER "PaymentAdjustment_immutable_delete" BEFORE DELETE ON "PaymentAdjustment"
BEGIN SELECT RAISE(ABORT,'Payment adjustments are immutable; restore into an empty target'); END;
CREATE TRIGGER "PaymentOperation_immutable_update" BEFORE UPDATE ON "PaymentOperation"
BEGIN SELECT RAISE(ABORT,'Payment operations are immutable'); END;
CREATE TRIGGER "PaymentOperation_immutable_delete" BEFORE DELETE ON "PaymentOperation"
BEGIN SELECT RAISE(ABORT,'Payment operations are immutable; restore into an empty target'); END;
CREATE TRIGGER "PaymentJournalEvent_operation_insert" BEFORE INSERT ON "PaymentJournalEvent"
WHEN EXISTS(SELECT 1 FROM "PaymentOperation" o WHERE o."userId"=NEW."userId" AND o."idempotencyKey"=NEW."idempotencyKey" AND o.kind<>'PAYMENT_RECEIVED')
 OR EXISTS(SELECT 1 FROM "PaymentAdjustment" a WHERE a."userId"=NEW."userId" AND a."idempotencyKey"=NEW."idempotencyKey")
 OR EXISTS(SELECT 1 FROM "PaymentAllocationChange" c WHERE c."userId"=NEW."userId" AND c."idempotencyKey"=NEW."idempotencyKey")
BEGIN SELECT RAISE(ABORT,'Payment operation key conflict'); END;
CREATE TRIGGER "PaymentAdjustment_basis_immutable" BEFORE UPDATE ON "Invoice"
WHEN (EXISTS(SELECT 1 FROM "PaymentAdjustment" a WHERE a."cancellationInvoiceId"=OLD.id)
 AND (NEW."userId" IS NOT OLD."userId" OR NEW.type IS NOT OLD.type OR NEW.status IS NOT OLD.status OR NEW."issuanceState" IS NOT OLD."issuanceState"
 OR NEW."originalInvoiceId" IS NOT OLD."originalInvoiceId" OR NEW."totalAmount" IS NOT OLD."totalAmount" OR NEW."customerId" IS NOT OLD."customerId"
 OR NEW."invoiceNumber" IS NOT OLD."invoiceNumber" OR NEW."invoiceDate" IS NOT OLD."invoiceDate" OR NEW."cancellationReason" IS NOT OLD."cancellationReason" OR NEW."parsedData" IS NOT OLD."parsedData"))
 OR (EXISTS(SELECT 1 FROM "PaymentAdjustment" a WHERE a."invoiceId"=OLD.id)
 AND (NEW."userId"<>OLD."userId" OR NEW.type<>OLD.type OR NEW."totalAmount" IS NOT OLD."totalAmount"
 OR NEW."customerId" IS NOT OLD."customerId" OR NEW."invoiceNumber" IS NOT OLD."invoiceNumber" OR NEW."parsedData" IS NOT OLD."parsedData"))
BEGIN SELECT RAISE(ABORT,'Adjusted invoice or refund basis is immutable'); END;

CREATE TRIGGER "BankPaymentBinding_immutable_update" BEFORE UPDATE ON "BankPaymentBinding" BEGIN SELECT RAISE(ABORT,'BankPaymentBinding evidence is immutable'); END;
CREATE TRIGGER "BankPaymentBinding_immutable_delete" BEFORE DELETE ON "BankPaymentBinding" BEGIN SELECT RAISE(ABORT,'BankPaymentBinding evidence is immutable'); END;
CREATE TRIGGER "PaymentAllocationChange_immutable_update" BEFORE UPDATE ON "PaymentAllocationChange" BEGIN SELECT RAISE(ABORT,'PaymentAllocationChange evidence is immutable'); END;
CREATE TRIGGER "PaymentAllocationChange_immutable_delete" BEFORE DELETE ON "PaymentAllocationChange" BEGIN SELECT RAISE(ABORT,'PaymentAllocationChange evidence is immutable'); END;
-- Freeze all commercial context touched by an allocation, but allow lifecycle projections.
CREATE TRIGGER "PaymentAllocation_invoice_context_immutable" BEFORE UPDATE ON "Invoice"
WHEN (EXISTS(SELECT 1 FROM "BankPaymentBinding" b JOIN "PaymentJournalEvent" p ON p.id=b."paymentJournalEventId" WHERE p."invoiceId"=OLD.id)
 OR EXISTS(SELECT 1 FROM "PaymentAllocationChange" c WHERE c."fromInvoiceId"=OLD.id OR c."toInvoiceId"=OLD.id))
 AND (NEW."userId" IS NOT OLD."userId" OR NEW.type IS NOT OLD.type OR NEW."issuanceState" IS NOT OLD."issuanceState" OR NEW."customerId" IS NOT OLD."customerId" OR NEW."invoiceNumber" IS NOT OLD."invoiceNumber" OR NEW."totalAmount" IS NOT OLD."totalAmount" OR NEW."parsedData" IS NOT OLD."parsedData")
BEGIN SELECT RAISE(ABORT,'Allocated commercial evidence is immutable'); END;
CREATE TRIGGER "CashTransaction_no_adjusted_invoice_insert" BEFORE INSERT ON "CashTransaction"
WHEN NEW."incomeId" IS NOT NULL AND (EXISTS(SELECT 1 FROM "PaymentJournalEvent" p JOIN "PaymentAdjustment" a ON a."originalPaymentId"=p.id WHERE p."incomeId"=NEW."incomeId")
 OR EXISTS(SELECT 1 FROM "PaymentJournalEvent" p JOIN "BankPaymentBinding" b ON b."paymentJournalEventId"=p.id WHERE p."incomeId"=NEW."incomeId"))
BEGIN SELECT RAISE(ABORT,'Selected bank-bound or adjusted receipt cannot be linked to cashbook'); END;
CREATE TRIGGER "CashTransaction_no_adjusted_invoice_update" BEFORE UPDATE ON "CashTransaction"
WHEN NEW."incomeId" IS NOT NULL AND (EXISTS(SELECT 1 FROM "PaymentJournalEvent" p JOIN "PaymentAdjustment" a ON a."originalPaymentId"=p.id WHERE p."incomeId"=NEW."incomeId")
 OR EXISTS(SELECT 1 FROM "PaymentJournalEvent" p JOIN "BankPaymentBinding" b ON b."paymentJournalEventId"=p.id WHERE p."incomeId"=NEW."incomeId"))
BEGIN SELECT RAISE(ABORT,'Selected bank-bound or adjusted receipt cannot be linked to cashbook'); END;
-- Insert-time supported context guards complement immutable portable evidence validation.
CREATE TRIGGER "BankPaymentBinding_supported_context" BEFORE INSERT ON "BankPaymentBinding"
WHEN NOT EXISTS(SELECT 1 FROM "PaymentJournalEvent" p JOIN "Invoice" i ON i.id=p."invoiceId" JOIN "Income" n ON n.id=p."incomeId" WHERE p.id=NEW."paymentJournalEventId" AND i.type='INVOICE' AND i."issuanceState"='ISSUED' AND i."customerId" IS NOT NULL AND length(trim(i."invoiceNumber"))>0
 AND json_extract(i."parsedData",'$.currency')='EUR' AND (json_extract(i."parsedData",'$.taxMode')='small-business' OR (json_extract(i."parsedData",'$.taxMode') IS NULL
 AND NOT EXISTS(SELECT 1 FROM json_each(COALESCE(json_extract(i."parsedData",'$.lineItems'),json_extract(i."parsedData",'$.items'),'[]')) explicitTax
 WHERE json_extract(explicitTax.value,'$.taxCategory') IS NOT 'E' OR json_extract(explicitTax.value,'$.exemptionReason') IS NOT 'Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG.')))
 AND json_type(i."parsedData",CASE WHEN json_type(i."parsedData",'$.lineItems') IS NOT NULL THEN '$.lineItems' ELSE '$.items' END)='array'
 AND json_array_length(i."parsedData",CASE WHEN json_type(i."parsedData",'$.lineItems') IS NOT NULL THEN '$.lineItems' ELSE '$.items' END)>0
 AND (json_extract(i."parsedData",'$.documentType') IS NULL OR json_extract(i."parsedData",'$.documentType') IN ('380',380,'INVOICE','invoice'))
 AND json_type(i."parsedData",'$.taxAmount') IN ('integer','real') AND json_extract(i."parsedData",'$.taxAmount')=0 AND (json_type(i."parsedData",'$.isAdvanceInvoice') IS NULL OR json_type(i."parsedData",'$.isAdvanceInvoice')='false')
 AND (json_type(i."parsedData",'$.isFinalInvoice') IS NULL OR json_type(i."parsedData",'$.isFinalInvoice')='false') AND (json_type(i."parsedData",'$.reverseCharge') IS NULL OR json_type(i."parsedData",'$.reverseCharge')='false')
 AND NOT EXISTS(SELECT 1 FROM json_each(COALESCE(json_extract(i."parsedData",'$.lineItems'),json_extract(i."parsedData",'$.items'),'[]')) item
 WHERE item.type<>'object' OR (json_type(item.value,'$.taxRate') IS NULL OR json_type(item.value,'$.taxRate') NOT IN ('integer','real') OR json_extract(item.value,'$.taxRate')<>0) OR (json_extract(item.value,'$.taxCategory') IS NOT NULL AND json_extract(item.value,'$.taxCategory')<>'E'))
 AND CAST(round(n.amount*100) AS INTEGER)=CAST(p."amountCents" AS INTEGER) AND n.date IS p."paidAt")
BEGIN SELECT RAISE(ABORT,'Bank receipt requires explicit supported commercial and Income context'); END;
CREATE TRIGGER "PaymentAllocationChange_supported_context" BEFORE INSERT ON "PaymentAllocationChange"
WHEN NOT EXISTS(SELECT 1 FROM "Invoice" f JOIN "Invoice" t ON t.id=NEW."toInvoiceId" WHERE f.id=NEW."fromInvoiceId" AND f.type='INVOICE' AND f."issuanceState"='ISSUED' AND f."customerId" IS NOT NULL AND length(trim(f."invoiceNumber"))>0
 AND json_extract(f."parsedData",'$.currency')='EUR' AND (json_extract(f."parsedData",'$.taxMode')='small-business' OR (json_extract(f."parsedData",'$.taxMode') IS NULL
 AND NOT EXISTS(SELECT 1 FROM json_each(COALESCE(json_extract(f."parsedData",'$.lineItems'),json_extract(f."parsedData",'$.items'),'[]')) explicitTax
 WHERE json_extract(explicitTax.value,'$.taxCategory') IS NOT 'E' OR json_extract(explicitTax.value,'$.exemptionReason') IS NOT 'Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG.')))
 AND json_type(f."parsedData",CASE WHEN json_type(f."parsedData",'$.lineItems') IS NOT NULL THEN '$.lineItems' ELSE '$.items' END)='array'
 AND json_array_length(f."parsedData",CASE WHEN json_type(f."parsedData",'$.lineItems') IS NOT NULL THEN '$.lineItems' ELSE '$.items' END)>0
 AND (json_extract(f."parsedData",'$.documentType') IS NULL OR json_extract(f."parsedData",'$.documentType') IN ('380',380,'INVOICE','invoice'))
 AND json_type(f."parsedData",'$.taxAmount') IN ('integer','real') AND json_extract(f."parsedData",'$.taxAmount')=0 AND (json_type(f."parsedData",'$.isAdvanceInvoice') IS NULL OR json_type(f."parsedData",'$.isAdvanceInvoice')='false')
 AND (json_type(f."parsedData",'$.isFinalInvoice') IS NULL OR json_type(f."parsedData",'$.isFinalInvoice')='false') AND (json_type(f."parsedData",'$.reverseCharge') IS NULL OR json_type(f."parsedData",'$.reverseCharge')='false')
 AND NOT EXISTS(SELECT 1 FROM json_each(COALESCE(json_extract(f."parsedData",'$.lineItems'),json_extract(f."parsedData",'$.items'),'[]')) item
 WHERE item.type<>'object' OR (json_type(item.value,'$.taxRate') IS NULL OR json_type(item.value,'$.taxRate') NOT IN ('integer','real') OR json_extract(item.value,'$.taxRate')<>0) OR (json_extract(item.value,'$.taxCategory') IS NOT NULL AND json_extract(item.value,'$.taxCategory')<>'E')) AND t.type='INVOICE' AND t."issuanceState"='ISSUED' AND t."customerId" IS NOT NULL AND length(trim(t."invoiceNumber"))>0
 AND json_extract(t."parsedData",'$.currency')='EUR' AND (json_extract(t."parsedData",'$.taxMode')='small-business' OR (json_extract(t."parsedData",'$.taxMode') IS NULL
 AND NOT EXISTS(SELECT 1 FROM json_each(COALESCE(json_extract(t."parsedData",'$.lineItems'),json_extract(t."parsedData",'$.items'),'[]')) explicitTax
 WHERE json_extract(explicitTax.value,'$.taxCategory') IS NOT 'E' OR json_extract(explicitTax.value,'$.exemptionReason') IS NOT 'Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG.')))
 AND json_type(t."parsedData",CASE WHEN json_type(t."parsedData",'$.lineItems') IS NOT NULL THEN '$.lineItems' ELSE '$.items' END)='array'
 AND json_array_length(t."parsedData",CASE WHEN json_type(t."parsedData",'$.lineItems') IS NOT NULL THEN '$.lineItems' ELSE '$.items' END)>0
 AND (json_extract(t."parsedData",'$.documentType') IS NULL OR json_extract(t."parsedData",'$.documentType') IN ('380',380,'INVOICE','invoice'))
 AND json_type(t."parsedData",'$.taxAmount') IN ('integer','real') AND json_extract(t."parsedData",'$.taxAmount')=0 AND (json_type(t."parsedData",'$.isAdvanceInvoice') IS NULL OR json_type(t."parsedData",'$.isAdvanceInvoice')='false')
 AND (json_type(t."parsedData",'$.isFinalInvoice') IS NULL OR json_type(t."parsedData",'$.isFinalInvoice')='false') AND (json_type(t."parsedData",'$.reverseCharge') IS NULL OR json_type(t."parsedData",'$.reverseCharge')='false')
 AND NOT EXISTS(SELECT 1 FROM json_each(COALESCE(json_extract(t."parsedData",'$.lineItems'),json_extract(t."parsedData",'$.items'),'[]')) item
 WHERE item.type<>'object' OR (json_type(item.value,'$.taxRate') IS NULL OR json_type(item.value,'$.taxRate') NOT IN ('integer','real') OR json_extract(item.value,'$.taxRate')<>0) OR (json_extract(item.value,'$.taxCategory') IS NOT NULL AND json_extract(item.value,'$.taxCategory')<>'E')))
BEGIN SELECT RAISE(ABORT,'Allocation requires explicit supported zero VAT EUR context'); END;
CREATE TRIGGER "PaymentAdjustment_allocation_supported_context" BEFORE INSERT ON "PaymentAdjustment"
WHEN NEW."contractVersion"=3 AND NOT EXISTS(SELECT 1 FROM "Invoice" i WHERE i.id=NEW."invoiceId" AND i.type='INVOICE' AND i."issuanceState"='ISSUED' AND i."customerId" IS NOT NULL AND length(trim(i."invoiceNumber"))>0
 AND json_extract(i."parsedData",'$.currency')='EUR' AND (json_extract(i."parsedData",'$.taxMode')='small-business' OR (json_extract(i."parsedData",'$.taxMode') IS NULL
 AND NOT EXISTS(SELECT 1 FROM json_each(COALESCE(json_extract(i."parsedData",'$.lineItems'),json_extract(i."parsedData",'$.items'),'[]')) explicitTax
 WHERE json_extract(explicitTax.value,'$.taxCategory') IS NOT 'E' OR json_extract(explicitTax.value,'$.exemptionReason') IS NOT 'Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG.')))
 AND json_type(i."parsedData",CASE WHEN json_type(i."parsedData",'$.lineItems') IS NOT NULL THEN '$.lineItems' ELSE '$.items' END)='array'
 AND json_array_length(i."parsedData",CASE WHEN json_type(i."parsedData",'$.lineItems') IS NOT NULL THEN '$.lineItems' ELSE '$.items' END)>0
 AND (json_extract(i."parsedData",'$.documentType') IS NULL OR json_extract(i."parsedData",'$.documentType') IN ('380',380,'INVOICE','invoice'))
 AND json_type(i."parsedData",'$.taxAmount') IN ('integer','real') AND json_extract(i."parsedData",'$.taxAmount')=0 AND (json_type(i."parsedData",'$.isAdvanceInvoice') IS NULL OR json_type(i."parsedData",'$.isAdvanceInvoice')='false')
 AND (json_type(i."parsedData",'$.isFinalInvoice') IS NULL OR json_type(i."parsedData",'$.isFinalInvoice')='false') AND (json_type(i."parsedData",'$.reverseCharge') IS NULL OR json_type(i."parsedData",'$.reverseCharge')='false')
 AND NOT EXISTS(SELECT 1 FROM json_each(COALESCE(json_extract(i."parsedData",'$.lineItems'),json_extract(i."parsedData",'$.items'),'[]')) item
 WHERE item.type<>'object' OR (json_type(item.value,'$.taxRate') IS NULL OR json_type(item.value,'$.taxRate') NOT IN ('integer','real') OR json_extract(item.value,'$.taxRate')<>0) OR (json_extract(item.value,'$.taxCategory') IS NOT NULL AND json_extract(item.value,'$.taxCategory')<>'E')))
BEGIN SELECT RAISE(ABORT,'Allocation adjustment requires frozen supported context'); END;
-- A financial binding freezes its referenced imported evidence and original Income projection.
CREATE TRIGGER "BankImportRow_bound_immutable_update" BEFORE UPDATE ON "BankImportRow"
WHEN EXISTS(SELECT 1 FROM "BankPaymentBinding" b WHERE b."bankImportRowId"=OLD.id)
BEGIN SELECT RAISE(ABORT,'Bank evidence linked to a receipt is immutable'); END;
CREATE TRIGGER "BankImportBatch_bound_immutable_update" BEFORE UPDATE ON "BankImportBatch"
WHEN EXISTS(SELECT 1 FROM "BankImportRow" r JOIN "BankPaymentBinding" b ON b."bankImportRowId"=r.id WHERE r."batchId"=OLD.id)
BEGIN SELECT RAISE(ABORT,'Bank import linked to a receipt is immutable'); END;
CREATE TRIGGER "Income_bank_binding_immutable_update" BEFORE UPDATE ON "Income"
WHEN EXISTS(SELECT 1 FROM "PaymentJournalEvent" p JOIN "BankPaymentBinding" b ON b."paymentJournalEventId"=p.id WHERE p."incomeId"=OLD.id)
BEGIN SELECT RAISE(ABORT,'Original bank receipt Income is immutable'); END;
-- Legacy certainty cannot be mixed into an allocation-aware graph, in either insertion order.
CREATE TRIGGER "PaymentJournalEvent_no_legacy_allocation_insert" BEFORE INSERT ON "PaymentJournalEvent"
WHEN NEW."dateCertainty"<>'ACTUAL' AND (EXISTS(SELECT 1 FROM "BankPaymentBinding" b JOIN "PaymentJournalEvent" p ON p.id=b."paymentJournalEventId" WHERE p."invoiceId"=NEW."invoiceId")
 OR EXISTS(SELECT 1 FROM "PaymentAllocationChange" c WHERE c."fromInvoiceId"=NEW."invoiceId" OR c."toInvoiceId"=NEW."invoiceId"))
BEGIN SELECT RAISE(ABORT,'Legacy certainty cannot be added to allocation-aware history'); END;
CREATE TRIGGER "BankPaymentBinding_no_legacy_graph_insert" BEFORE INSERT ON "BankPaymentBinding"
WHEN EXISTS(SELECT 1 FROM "PaymentJournalEvent" p JOIN "PaymentJournalEvent" legacy ON legacy."invoiceId"=p."invoiceId" WHERE p.id=NEW."paymentJournalEventId" AND legacy."dateCertainty"<>'ACTUAL')
BEGIN SELECT RAISE(ABORT,'Bank binding cannot mix legacy certainty'); END;
CREATE TRIGGER "PaymentAllocationChange_no_legacy_graph_insert" BEFORE INSERT ON "PaymentAllocationChange"
WHEN EXISTS(SELECT 1 FROM "PaymentJournalEvent" legacy WHERE legacy."invoiceId" IN (NEW."fromInvoiceId",NEW."toInvoiceId") AND legacy."dateCertainty"<>'ACTUAL')
BEGIN SELECT RAISE(ABORT,'Allocation cannot mix legacy certainty'); END;
-- Customer labels may change; deleting the customer may not detach frozen allocation context.
CREATE TRIGGER "Customer_bank_allocation_history_delete" BEFORE DELETE ON "Customer"
WHEN EXISTS(SELECT 1 FROM "Invoice" i WHERE i."customerId"=OLD.id AND
 (EXISTS(SELECT 1 FROM "BankPaymentBinding" b JOIN "PaymentJournalEvent" p ON p.id=b."paymentJournalEventId" WHERE p."invoiceId"=i.id)
 OR EXISTS(SELECT 1 FROM "PaymentAllocationChange" c WHERE c."fromInvoiceId"=i.id OR c."toInvoiceId"=i.id)))
BEGIN SELECT RAISE(ABORT,'Customer must be retained for immutable bank allocation evidence'); END;
PRAGMA foreign_keys=ON;
