-- CreateTable
CREATE TABLE "EmailOutbox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "invoiceId" INTEGER,
    "sourceInvoiceId" INTEGER NOT NULL,
    "documentType" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "attachmentSha256" TEXT NOT NULL,
    "storedFileName" TEXT NOT NULL,
    "attachmentFileName" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "replyTo" TEXT,
    "to" TEXT NOT NULL,
    "cc" TEXT NOT NULL,
    "bcc" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PREPARED',
    "currentAttemptId" TEXT,
    "processingExpiresAt" DATETIME,
    "messageId" TEXT,
    "errorCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EmailOutbox_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EmailOutbox_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmailOutboxAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "outboxId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "duplicateRiskAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "uncertaintyRecordedAt" DATETIME,
    "state" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "messageId" TEXT,
    "errorCode" TEXT,
    CONSTRAINT "EmailOutboxAttempt_outboxId_fkey" FOREIGN KEY ("outboxId") REFERENCES "EmailOutbox" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "EmailOutbox_userId_invoiceId_createdAt_idx" ON "EmailOutbox"("userId", "invoiceId", "createdAt");

CREATE INDEX "EmailOutbox_userId_documentType_attachmentSha256_idx" ON "EmailOutbox"("userId", "documentType", "attachmentSha256");

-- CreateIndex
CREATE UNIQUE INDEX "EmailOutbox_userId_requestId_key" ON "EmailOutbox"("userId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailOutbox_userId_fingerprint_key" ON "EmailOutbox"("userId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "EmailOutboxAttempt_outboxId_requestId_key" ON "EmailOutboxAttempt"("outboxId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailOutboxAttempt_outboxId_sequence_key" ON "EmailOutboxAttempt"("outboxId", "sequence");


-- A send always refers to the exact confirmed envelope. Only detaching an old
-- invoice relation is permitted during an explicit destructive restore.
CREATE TRIGGER EmailOutbox_immutable_envelope BEFORE UPDATE ON EmailOutbox
WHEN NEW.id IS NOT OLD.id OR NEW.userId IS NOT OLD.userId OR NEW.sourceInvoiceId IS NOT OLD.sourceInvoiceId
 OR NEW.documentType IS NOT OLD.documentType OR NEW.requestId IS NOT OLD.requestId
 OR NEW.fingerprint IS NOT OLD.fingerprint OR NEW.attachmentSha256 IS NOT OLD.attachmentSha256
 OR NEW.storedFileName IS NOT OLD.storedFileName OR NEW.attachmentFileName IS NOT OLD.attachmentFileName
 OR NEW."from" IS NOT OLD."from" OR NEW.replyTo IS NOT OLD.replyTo OR NEW."to" IS NOT OLD."to"
 OR NEW.cc IS NOT OLD.cc OR NEW.bcc IS NOT OLD.bcc OR NEW.subject IS NOT OLD.subject OR NEW.text IS NOT OLD.text
 OR NEW.createdAt IS NOT OLD.createdAt OR (NEW.invoiceId IS NOT OLD.invoiceId AND NEW.invoiceId IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'EmailOutbox envelope is immutable'); END;
CREATE TRIGGER EmailOutbox_no_delete BEFORE DELETE ON EmailOutbox
BEGIN SELECT RAISE(ABORT, 'EmailOutbox evidence cannot be deleted'); END;
CREATE TRIGGER EmailOutboxAttempt_immutable_identity BEFORE UPDATE ON EmailOutboxAttempt
WHEN NEW.id IS NOT OLD.id OR NEW.outboxId IS NOT OLD.outboxId OR NEW.requestId IS NOT OLD.requestId OR NEW.sequence IS NOT OLD.sequence
 OR NEW.duplicateRiskAcknowledged IS NOT OLD.duplicateRiskAcknowledged
 OR (OLD.uncertaintyRecordedAt IS NOT NULL AND NEW.uncertaintyRecordedAt IS NOT OLD.uncertaintyRecordedAt)
 OR NEW.startedAt IS NOT OLD.startedAt OR (OLD.state NOT IN ('PROCESSING', 'UNKNOWN') AND (
 NEW.state IS NOT OLD.state OR NEW.finishedAt IS NOT OLD.finishedAt OR NEW.messageId IS NOT OLD.messageId OR NEW.errorCode IS NOT OLD.errorCode))
BEGIN SELECT RAISE(ABORT, 'EmailOutbox attempt is immutable'); END;
CREATE TRIGGER EmailOutboxAttempt_no_delete BEFORE DELETE ON EmailOutboxAttempt
BEGIN SELECT RAISE(ABORT, 'EmailOutbox attempt evidence cannot be deleted'); END;
