-- Additive only; existing invoices and counter identities are not modified.
CREATE TABLE "DocumentNumberingPolicy" (
  "userId" TEXT NOT NULL, "type" TEXT NOT NULL, "revision" INTEGER NOT NULL,
  "formatVersion" INTEGER NOT NULL DEFAULT 1, "prefix" TEXT NOT NULL,
  "includeYear" BOOLEAN NOT NULL, "sequenceWidth" INTEGER NOT NULL,
  "startSequence" INTEGER NOT NULL, "effectiveYear" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("userId", "type", "revision"),
  CONSTRAINT "DocumentNumberingPolicy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DocumentNumberingPolicy_bounds" CHECK ("type" IN ('INVOICE','QUOTE','CREDIT_NOTE') AND "revision" BETWEEN 1 AND 100 AND "formatVersion" = 1 AND length("prefix") <= 16 AND ("prefix" = '' OR ("prefix" GLOB '[A-Z]*' AND "prefix" NOT GLOB '*[^A-Z0-9_-]*')) AND "includeYear" IN (0,1) AND "sequenceWidth" BETWEEN 1 AND 10 AND "startSequence" BETWEEN 1 AND 2147483647 AND "effectiveYear" BETWEEN 1900 AND 9999)
);

-- Additive metadata only; no existing number, bytes or financial field is changed.
ALTER TABLE "Invoice" ADD COLUMN "quoteCreateRequestId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "quoteCreateFingerprint" TEXT;
CREATE UNIQUE INDEX "Invoice_userId_quoteCreateRequestId_key" ON "Invoice"("userId", "quoteCreateRequestId");

CREATE UNIQUE INDEX "Invoice_userId_id_key" ON "Invoice"("userId", "id");
CREATE TABLE "QuoteCreateReceipt" (
  "userId" TEXT NOT NULL, "requestId" TEXT NOT NULL, "fingerprint" TEXT NOT NULL, "pdfSha256" TEXT NOT NULL,
  "invoiceUserId" TEXT, "invoiceId" INTEGER,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("userId", "requestId"),
  CONSTRAINT "QuoteCreateReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "QuoteCreateReceipt_invoice_fkey" FOREIGN KEY ("invoiceUserId", "invoiceId") REFERENCES "Invoice" ("userId", "id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "QuoteCreateReceipt_owner_check" CHECK (("invoiceUserId" IS NULL AND "invoiceId" IS NULL) OR ("invoiceUserId" IS NOT NULL AND "invoiceUserId" = "userId" AND "invoiceId" IS NOT NULL)),
  CONSTRAINT "QuoteCreateReceipt_identity_check" CHECK (length("requestId") = 36 AND "requestId" NOT GLOB '*[^0-9a-f-]*' AND length("fingerprint") = 64 AND "fingerprint" NOT GLOB '*[^0-9a-f]*' AND length("pdfSha256") = 64 AND "pdfSha256" NOT GLOB '*[^0-9a-f]*')
);
CREATE UNIQUE INDEX "QuoteCreateReceipt_invoiceUserId_invoiceId_key" ON "QuoteCreateReceipt"("invoiceUserId", "invoiceId");
