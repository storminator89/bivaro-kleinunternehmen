import { reminderBalance, normalizeReminderOptions, composeReminderText } from '@/lib/reminder-workbench';
import { hasServiceBillingDraftMarker } from '@/lib/service-billing';
import { randomUUID } from 'node:crypto';
import { readFile } from 'fs/promises';
import { basename, extname } from 'path';
import type { SendMailOptions, Transporter } from 'nodemailer';
import { createDocumentMailTransport } from '@/lib/smtp-transport';
import { prisma } from '@/lib/prisma';
import { createAuditLog, createFinancialAuditLog } from '@/lib/audit-log';
import { inTransaction } from '@/lib/db-transaction';
import { findOwnedUploadedFile } from '@/lib/upload-ownership';
import { recordDocumentDelivery } from '@/lib/email-delivery';
import { attachmentSha256, emailStorageScope, prepareEmailOutbox, claimEmailOutbox, finishEmailAttempt, readEmailOutbox, validateEmailRequestId, classifyEmailTransportError, EmailOutboxConflict, type EmailRetry } from '@/lib/email-outbox';
import { getSmtpSettingsStatus, resolveSmtpConfiguration } from '@/lib/smtp-settings';

export type EmailDocumentType = 'invoice' | 'quote' | 'reminder';

export class EmailDeliveryRecordingError extends Error {
  constructor(readonly messageId: string) {
    super('Der SMTP-Server hat die Nachricht angenommen, aber die Versandprotokollierung ist fehlgeschlagen. Prüfen Sie den Versand, bevor Sie die Nachricht erneut senden.');
    this.name = 'EmailDeliveryRecordingError';
  }
}

export type ReminderEmailContext = {
  reminderLevel?: number;
  fee?: number;
  dueDays?: number;
  notes?: string | null;
};

export type EmailDraftRequest = {
  documentType: EmailDocumentType;
  id: number;
  reminder?: ReminderEmailContext;
};

export type EmailDraft = {
  documentType: EmailDocumentType;
  id: number;
  from: string;
  replyTo?: string;
  to: string;
  subject: string;
  text: string;
  attachmentFileName: string;
  attachmentUrl: string;
  documentLabel: string;
  emailConfigured: boolean;
  missingConfiguration: string[];
  /** Internal UI context only. Never copied into subject, body or attachments. */
  internalCustomerNote: string | null;
  attachmentSha256: string;
  storageScope: string;
};

export type SendEmailRequest = EmailDraftRequest & {
  requestId?: string;
  attachmentSha256?: string;
  reviewedFrom?: string;
  reviewedReplyTo?: string | null;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text: string;
};

type LoadedDocument = {
  invoice: NonNullable<Awaited<ReturnType<typeof getDocumentInvoice>>>;
  settings: Awaited<ReturnType<typeof getUserSettings>>;
  attachmentPath: string;
  attachmentUrl: string;
  attachmentFileName: string;
  attachmentContentType: string;
  customer: {
    id: number;
    name: string;
    email: string | null;
  } | null;
};

const REMINDER_LEVEL_LABELS: Record<number, string> = {
  1: 'Zahlungserinnerung',
  2: '1. Mahnung',
  3: '2. Mahnung',
  4: 'Letzte Mahnung',
};

const SIMPLE_EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function getAttachmentContentType(fileName: string): string {
  return extname(fileName).toLowerCase() === '.xml' ? 'application/xml' : 'application/pdf';
}

export function normalizeEmailDraftRequest(body: unknown): EmailDraftRequest {
  if (!body || typeof body !== 'object') {
    throw new Error('Ungültige Anfrage');
  }

  const data = body as Record<string, unknown>;
  const documentType = data.documentType;
  const id = Number(data.id);

  if (documentType !== 'invoice' && documentType !== 'quote' && documentType !== 'reminder') {
    throw new Error('Ungültiger Dokumenttyp');
  }

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('Ungültige Dokument-ID');
  }

  return {
    documentType,
    id,
    reminder: documentType === 'reminder' ? normalizeReminderContext(data.reminder) : undefined,
  };
}

export function normalizeSendEmailRequest(body: unknown): SendEmailRequest {
  const draftRequest = normalizeEmailDraftRequest(body);
  const data = body as Record<string, unknown>;
  const subject = normalizeSingleLineText(data.subject, 'Betreff', 200);
  const text = normalizeMultilineText(data.text, 'E-Mail-Text', 20000);
  const to = normalizeEmailList(data.to, 'Empfänger');
  const cc = data.cc ? normalizeEmailList(data.cc, 'CC') : '';
  const bcc = data.bcc ? normalizeEmailList(data.bcc, 'BCC') : '';

  const requestId = draftRequest.documentType === 'reminder' ? randomUUID() : validateEmailRequestId(data.requestId);
  if (draftRequest.documentType !== 'reminder' && (typeof data.attachmentSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(data.attachmentSha256))) throw new EmailOutboxConflict('Bitte den Originalanhang erneut in der Vorschau prüfen.');
  if (draftRequest.documentType !== 'reminder' && (typeof data.reviewedFrom !== 'string' || (data.reviewedReplyTo !== null && typeof data.reviewedReplyTo !== 'string'))) throw new EmailOutboxConflict('Bitte den Absender erneut in der Vorschau prüfen.');
  return {
    ...draftRequest,
    reviewedFrom: typeof data.reviewedFrom === 'string' ? data.reviewedFrom : undefined,
    reviewedReplyTo: typeof data.reviewedReplyTo === 'string' ? data.reviewedReplyTo : null,
    requestId,
    attachmentSha256: typeof data.attachmentSha256 === 'string' ? data.attachmentSha256 : '',
    to,
    cc,
    bcc,
    subject,
    text,
  };
}

export async function buildDocumentEmailDraft(userId: string, request: EmailDraftRequest): Promise<EmailDraft> {
  const loaded = await loadEmailDocument(userId, request);
  const originalHash = attachmentSha256(await readFile(loaded.attachmentPath));
  const storageScope = emailStorageScope(userId);
  const configuration = await getEmailConfigurationStatus(loaded.settings.email);
  const companyName = loaded.settings.companyName || 'Ihr Unternehmen';
  const recipient = loaded.customer?.email || '';
  const replyTo = loaded.settings.email || undefined;
  // Scope again: legacy document relations are not proof of customer ownership.
  const customerContext = loaded.customer ? await prisma.customer.findFirst({
    where: { id: loaded.customer.id, userId },
    select: { internalNote: true, noteVisibility: true },
  }) : null;
  const internalCustomerNote = customerContext
    && ['SEND', 'BOTH'].includes(customerContext.noteVisibility)
    ? customerContext.internalNote : null;

  if (request.documentType === 'quote') {
    const quoteNumber = loaded.invoice.invoiceNumber || loaded.invoice.fileName;
    return {
      documentType: request.documentType,
      id: request.id,
      from: configuration.from,
      replyTo,
      to: recipient,
      subject: `Angebot ${quoteNumber} von ${companyName}`,
      text: [
        `Sehr geehrte Damen und Herren,`,
        '',
        `anbei erhalten Sie unser Angebot ${quoteNumber}.`,
        loaded.invoice.validUntil ? `Das Angebot ist gültig bis ${formatDate(loaded.invoice.validUntil)}.` : '',
        '',
        `Bei Fragen melden Sie sich gerne bei uns.`,
        '',
        `Mit freundlichen Grüßen`,
        companyName,
      ].filter((line) => line !== '').join('\n'),
      attachmentFileName: loaded.attachmentFileName,
      attachmentUrl: loaded.attachmentUrl,
      documentLabel: `Angebot ${quoteNumber}`,
      emailConfigured: configuration.configured,
      missingConfiguration: configuration.missing,
      internalCustomerNote,
      attachmentSha256: originalHash,
      storageScope,
    };
  }

  if (request.documentType === 'reminder') {
    const reminder = normalizeReminderContext(request.reminder);
    const invoiceNumber = loaded.invoice.invoiceNumber || loaded.invoice.fileName;
    const levelLabel = REMINDER_LEVEL_LABELS[reminder.reminderLevel ?? 1] || REMINDER_LEVEL_LABELS[1];
    const paymentDueDate = addDays(new Date(), reminder.dueDays ?? 14);
    const balance = reminderBalance(loaded.invoice);
    const options = normalizeReminderOptions(reminder);

    return {
      documentType: request.documentType,
      id: request.id,
      from: configuration.from,
      replyTo,
      to: recipient,
      subject: `${levelLabel} zu Rechnung ${invoiceNumber}`,
      text: composeReminderText(invoiceNumber, balance, options, companyName, paymentDueDate),
      attachmentFileName: loaded.attachmentFileName,
      attachmentUrl: loaded.attachmentUrl,
      documentLabel: `${levelLabel} zu Rechnung ${invoiceNumber}`,
      emailConfigured: configuration.configured,
      missingConfiguration: configuration.missing,
      internalCustomerNote,
      attachmentSha256: originalHash,
      storageScope,
    };
  }

  const invoiceNumber = loaded.invoice.invoiceNumber || loaded.invoice.fileName;
  return {
    documentType: request.documentType,
    id: request.id,
    from: configuration.from,
    replyTo,
    to: recipient,
    subject: `Rechnung ${invoiceNumber} von ${companyName}`,
    text: [
      `Sehr geehrte Damen und Herren,`,
      '',
      `anbei erhalten Sie unsere Rechnung ${invoiceNumber}.`,
      loaded.invoice.dueDate ? `Bitte überweisen Sie den Rechnungsbetrag bis zum ${formatDate(loaded.invoice.dueDate)}.` : '',
      '',
      `Bei Fragen melden Sie sich gerne bei uns.`,
      '',
      `Mit freundlichen Grüßen`,
      companyName,
    ].filter((line) => line !== '').join('\n'),
    attachmentFileName: loaded.attachmentFileName,
    attachmentUrl: loaded.attachmentUrl,
    documentLabel: `Rechnung ${invoiceNumber}`,
    emailConfigured: configuration.configured,
    missingConfiguration: configuration.missing,
    internalCustomerNote,
    attachmentSha256: originalHash,
    storageScope,
  };
}

/** Bound the whole SMTP operation below the durable processing lease, not just idle sockets. */
export async function sendOutboxMail(transport: Pick<Transporter, 'sendMail' | 'close'>, mail: SendMailOptions, abort?: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      abort?.();
      transport.close?.();
      reject(Object.assign(new Error('SMTP outcome uncertain after deadline'), { code: 'ETIMEDOUT' }));
    }, 45_000);
  });
  try { return await Promise.race([transport.sendMail(mail), deadline]); }
  finally { if (timer) clearTimeout(timer); abort?.(); }
}

export async function sendDocumentEmail(userId: string, request: SendEmailRequest, retry?: EmailRetry): Promise<{ outbox?: Awaited<ReturnType<typeof readEmailOutbox>>; messageId?: string; warning?: string; reminder?: unknown }> {
  // Legacy wholly unpaid reminders remain outside this first outbox slice.
  // Their existing fresh payment-evidence guard stays unchanged.
  if (request.documentType === 'reminder') return sendLegacyReminderEmail(userId, request);
  const loaded = await loadEmailDocument(userId, request);
  const configuration = await getRequiredEmailConfiguration(loaded.settings.email);
  const attachment = await readFile(loaded.attachmentPath);
  const originalHash = attachmentSha256(attachment);
  if (originalHash !== request.attachmentSha256) throw new EmailOutboxConflict('Der Originalanhang wurde geändert. Bitte eine neue Vorschau prüfen und bestätigen.');
  const saved = retry
    ? await readEmailOutbox(userId, retry.outboxId)
    : await prisma.emailOutbox.findUnique({ where: { userId_requestId: { userId, requestId: validateEmailRequestId(request.requestId) } } });
  if (saved && (saved.invoiceId !== loaded.invoice.id || saved.documentType !== request.documentType
    || saved.storedFileName !== loaded.invoice.storedFileName || saved.attachmentSha256 !== originalHash
    || saved.to !== request.to || saved.cc !== (request.cc || '') || saved.bcc !== (request.bcc || '')
    || saved.subject !== request.subject || saved.text !== request.text)) {
    throw new EmailOutboxConflict('Die bestätigte E-Mail oder das Original wurde geändert. Bitte eine neue Vorschau prüfen.');
  }
  if (retry && (!saved || saved.requestId !== request.requestId)) throw new EmailOutboxConflict('Versandauftrag nicht gefunden.');
  if (!saved && (request.reviewedFrom !== configuration.from || (request.reviewedReplyTo ?? null) !== (loaded.settings.email || null))) {
    throw new EmailOutboxConflict('Der Absender wurde geändert. Bitte eine neue Vorschau prüfen und bestätigen.');
  }
  const envelope = {
    userId, invoiceId: loaded.invoice.id, sourceInvoiceId: loaded.invoice.id, documentType: request.documentType,
    attachmentSha256: originalHash, storedFileName: loaded.invoice.storedFileName, attachmentFileName: loaded.attachmentFileName,
    from: saved?.from ?? configuration.from, replyTo: saved ? saved.replyTo : loaded.settings.email || null,
    to: request.to, cc: request.cc || '', bcc: request.bcc || '', subject: request.subject, text: request.text,
  };
  const outbox = await prepareEmailOutbox(envelope, validateEmailRequestId(request.requestId));
  if (retry && retry.outboxId !== outbox.id) throw new EmailOutboxConflict('Der gespeicherte Versandauftrag stimmt nicht mehr mit der Vorschau überein.');
  const claimed = await claimEmailOutbox(userId, outbox.id, retry);
  if (!claimed) return { outbox: await readEmailOutbox(userId, outbox.id) };
  const controller = new AbortController();
  const transport = createDocumentMailTransport(configuration, { signal: controller.signal });
  const mail: SendMailOptions = {
    from: outbox.from, replyTo: outbox.replyTo || undefined,
    to: splitEmailList(outbox.to), cc: outbox.cc ? splitEmailList(outbox.cc) : undefined,
    bcc: outbox.bcc ? splitEmailList(outbox.bcc) : undefined,
    subject: outbox.subject, text: outbox.text, html: textToHtml(outbox.text),
    attachments: [{ filename: outbox.attachmentFileName, content: attachment, contentType: loaded.attachmentContentType }],
  };
  try {
    // Reserve issuance before contacting SMTP.  If SMTP succeeds but the
    // follow-up status write fails, the marker still keeps the draft locked
    // against deletion.  A concurrent payment can win between these steps;
    // the later CAS below then leaves PAID untouched.
    await inTransaction(async tx => {
      const active = await tx.emailOutbox.findFirst({ where: { id: outbox.id, userId, invoiceId: loaded.invoice.id, currentAttemptId: claimed.attemptId, state: 'PROCESSING' } });
      if (!active) throw new EmailOutboxConflict('Versandauftrag wurde unterbrochen. Bitte Versandverlauf prüfen.');
      const current = await tx.invoice.findFirst({
        where: { id: loaded.invoice.id, userId },
        select: { status: true, issuanceState: true, invoiceNumber: true, fileName: true, storedFileName: true },
      });
      if (!current || current.storedFileName !== outbox.storedFileName) throw new EmailOutboxConflict('Das Original wurde inzwischen ersetzt. Bitte neue Vorschau prüfen.');
      if (current.status !== 'DRAFT' || current.issuanceState === 'ISSUED') return;
      await tx.invoice.update({ where: { id: loaded.invoice.id, userId }, data: { issuanceState: 'ISSUED' } });
      await createFinancialAuditLog({
        userId,
        action: 'STATUS_CHANGED',
        entityType: request.documentType === 'quote' ? 'Quote' : 'Invoice',
        entityId: loaded.invoice.id,
        entityName: current.invoiceNumber || current.fileName,
        oldValues: { status: current.status, issuanceState: current.issuanceState },
        newValues: { status: current.status, issuanceState: 'ISSUED' },
        metadata: {
          actorId: userId,
          tenantId: userId,
          operation: 'invoice.issue-attempt',
          originalReference: current.invoiceNumber ?? `invoice:${loaded.invoice.id}`,
          reason: 'document email prepared for delivery',
        },
      }, tx);
    });
  } catch {
    controller.abort();
    await finishEmailAttempt(userId, outbox.id, claimed.attemptId, { state: 'FAILED', errorCode: 'PREPARATION_FAILED' });
    return { outbox: await readEmailOutbox(userId, outbox.id) };
  }
  let info;
  try {
    // Never place SMTP inside a retried database transaction.
    info = await sendOutboxMail(transport, mail, () => controller.abort());
  } catch (error) {
    await finishEmailAttempt(userId, outbox.id, claimed.attemptId, classifyEmailTransportError(error));
    return { outbox: await readEmailOutbox(userId, outbox.id) };
  }
  if (Array.isArray(info.accepted) && info.accepted.length === 0) {
    await finishEmailAttempt(userId, outbox.id, claimed.attemptId, { state: 'FAILED', errorCode: 'RECIPIENT_REJECTED' });
    return { outbox: await readEmailOutbox(userId, outbox.id) };
  }
  const partiallyAccepted = Array.isArray(info.rejected) && info.rejected.length > 0;
  const messageId = typeof info.messageId === 'string' ? info.messageId.slice(0, 998) : '';
  try {
    // Persist acceptance independently from invoice status/audit projection.
    await finishEmailAttempt(userId, outbox.id, claimed.attemptId, { state: 'ACCEPTED', messageId, errorCode: partiallyAccepted ? 'PARTIAL_RECIPIENTS' : undefined });
  } catch {
    // The persisted PROCESSING attempt will recover to UNKNOWN, never retry itself.
    throw new EmailDeliveryRecordingError(messageId);
  }
  try {
    const projection = await recordDocumentDelivery({ userId, invoiceId: loaded.invoice.id, documentType: request.documentType,
      expectedStatus: loaded.invoice.status, messageId, outbox: { id: outbox.id, attemptId: claimed.attemptId, attachmentSha256: outbox.attachmentSha256, storedFileName: outbox.storedFileName } });
    if ('projectionSkipped' in projection) return { messageId, outbox: await readEmailOutbox(userId, outbox.id), warning: 'SMTP angenommen; das Original wurde inzwischen ersetzt. Der neue Dokumentstatus bleibt unverändert.' };
  } catch {
    // SMTP acceptance already survives reload; this failure must never invite resend.
    return { messageId, outbox: await readEmailOutbox(userId, outbox.id), warning: 'SMTP angenommen; Dokumentstatus konnte nicht aktualisiert werden.' };
  }
  return { messageId, outbox: await readEmailOutbox(userId, outbox.id) };
}

async function sendLegacyReminderEmail(userId: string, request: SendEmailRequest) {
  const loaded = await loadEmailDocument(userId, request);
  const configuration = await getRequiredEmailConfiguration(loaded.settings.email);
  const attachment = await readFile(loaded.attachmentPath);
  const mail: SendMailOptions = {
    from: configuration.from,
    replyTo: loaded.settings.email || undefined,
    to: splitEmailList(request.to),
    cc: request.cc ? splitEmailList(request.cc) : undefined,
    bcc: request.bcc ? splitEmailList(request.bcc) : undefined,
    subject: request.subject,
    text: request.text,
    html: textToHtml(request.text),
    attachments: [
      {
        filename: loaded.attachmentFileName,
        content: attachment,
        contentType: loaded.attachmentContentType,
      },
    ],
  };

  const transport = createDocumentMailTransport(configuration);

  const info = await transport.sendMail(mail);

  const reminderContext = normalizeReminderContext(request.reminder);
  const dueDate = addDays(new Date(), reminderContext.dueDays ?? 14);
  const reminder = await prisma.reminder.create({
    data: {
      invoiceId: request.id,
      reminderLevel: reminderContext.reminderLevel ?? 1,
      fee: reminderContext.fee ?? 0,
      notes: reminderContext.notes || null,
      dueDate,
      userId,
    },
  });

  await createAuditLog({
    userId,
    action: 'REMINDER_SENT',
    entityType: 'Reminder',
    entityId: reminder.id,
    entityName: loaded.invoice.invoiceNumber || loaded.invoice.fileName,
    newValues: {
      invoiceId: request.id,
      reminderLevel: reminder.reminderLevel,
      fee: reminder.fee,
      dueDate: reminder.dueDate,
    },
    metadata: {
      messageId: info.messageId,
      to: splitEmailList(request.to),
    },
  });

  return { messageId: info.messageId, reminder };
}

async function loadEmailDocument(userId: string, request: EmailDraftRequest): Promise<LoadedDocument> {
  const [invoice, settings] = await Promise.all([
    getDocumentInvoice(userId, request),
    getUserSettings(userId),
  ]);

  if (!invoice) {
    throw new Error('Dokument nicht gefunden');
  }

  // Partial reminders use the dedicated fresh-preview/text-download workbench.
  // SMTP remains fail-closed until a durable delivery/outbox contract exists.
  // This also rejects stale OPEN previews after a payment, before transport creation.
  if (request.documentType === 'reminder' && (invoice.type !== 'INVOICE'
    || !['DRAFT', 'SENT'].includes(invoice.status) || invoice.paymentJournalEvents.length > 0
    || invoice.incomes.length > 0 || invoice.paidAt)) {
    throw new Error('Mahnungen für Rechnungen mit Zahlungsnachweisen sind gesperrt. Bitte Restbetrag und Zahlungsjournal prüfen.');
  }
  if (hasServiceBillingDraftMarker(invoice.parsedData)) throw new Error('Bitte den Serviceentwurf zuerst im Rechnungseditor prüfen und eine echte Rechnungsdatei erstellen.');
  if (request.documentType === 'reminder') reminderBalance(invoice);
  const sanitizedFileName = basename(invoice.storedFileName);
  const attachmentPath = await findOwnedUploadedFile(userId, sanitizedFileName);
  if (!attachmentPath) {
    throw new Error('Datei nicht gefunden');
  }

  const linkedCustomer = invoice.customer || (invoice.incomes.length === 1 ? invoice.incomes[0].customer : null);
  const customer = linkedCustomer ? await prisma.customer.findFirst({
    where: { id: linkedCustomer.id, userId },
    select: { id: true, name: true, email: true },
  }) : null;
  const attachmentUrl = invoice.type === 'QUOTE'
    ? `/api/quotes/download?id=${invoice.id}`
    : `/api/invoices/download?id=${invoice.id}`;

  return {
    invoice,
    settings,
    attachmentPath,
    attachmentUrl,
    attachmentFileName: invoice.fileName,
    attachmentContentType: getAttachmentContentType(invoice.fileName),
    customer,
  };
}

async function getDocumentInvoice(userId: string, request: EmailDraftRequest) {
  return prisma.invoice.findFirst({
    where: {
      id: request.id,
      userId,
      type: request.documentType === 'quote' ? 'QUOTE' : { not: 'QUOTE' },
    },
    include: {
      customer: {
        select: { id: true, name: true, email: true },
      },
      paymentAdjustments: true, creditNotes: true, paymentJournalEvents: true,
      incomes: {
        include: {
          cashTransaction: true,
          customer: {
            select: { id: true, name: true, email: true },
          },
        },
      },
    },
  });
}

async function getUserSettings(userId: string) {
  return prisma.settings.findUnique({
    where: { userId },
    select: {
      companyName: true,
      email: true,
    },
  }).then((settings) => settings || { companyName: null, email: null });
}

function normalizeReminderContext(value: unknown): ReminderEmailContext {
  if (!value || typeof value !== 'object') {
    return { reminderLevel: 1, fee: 0, dueDays: 14, notes: null };
  }

  const data = value as Record<string, unknown>;
  const reminderLevel = Number(data.reminderLevel);
  const fee = Number(data.fee);
  const dueDays = Number(data.dueDays);
  const notes = typeof data.notes === 'string' && data.notes.trim() ? data.notes.trim() : null;

  return {
    reminderLevel: Number.isInteger(reminderLevel) && reminderLevel >= 1 && reminderLevel <= 4 ? reminderLevel : 1,
    fee: Number.isFinite(fee) && fee >= 0 ? Math.round(fee * 100) / 100 : 0,
    dueDays: Number.isInteger(dueDays) && dueDays >= 1 && dueDays <= 365 ? dueDays : 14,
    notes,
  };
}

async function getEmailConfigurationStatus(settingsEmail?: string | null) {
  const configuration = await getSmtpSettingsStatus(settingsEmail);
  const missing: string[] = [];
  if (!configuration.host) missing.push('SMTP_HOST');
  if (!configuration.port) missing.push('SMTP_PORT');
  if (!configuration.from) missing.push('EMAIL_FROM oder Firmen-E-Mail');
  if (configuration.user && !configuration.passwordConfigured) {
    missing.push('SMTP_USER und SMTP_PASSWORD müssen gemeinsam gesetzt sein');
  }
  if (!configuration.user && configuration.passwordConfigured) {
    missing.push('SMTP_USER und SMTP_PASSWORD müssen gemeinsam gesetzt sein');
  }

  return {
    configured: configuration.configured && missing.length === 0,
    missing,
    from: configuration.from || '',
  };
}

async function getRequiredEmailConfiguration(settingsEmail?: string | null) {
  const configuration = await resolveSmtpConfiguration(settingsEmail);
  const status = await getEmailConfigurationStatus(settingsEmail);
  if (!status.configured) {
    throw new Error(`E-Mail-Konfiguration unvollständig: ${status.missing.join(', ') || 'SMTP-Einstellungen prüfen'}`);
  }

  return {
    host: configuration.host as string,
    port: configuration.port as number,
    secure: configuration.secure as boolean,
    source: configuration.source,
    from: configuration.from as string,
    auth: configuration.auth,
  };
}

function normalizeSingleLineText(value: unknown, label: string, maxLength: number) {
  if (typeof value !== 'string') {
    throw new Error(`${label} ist erforderlich`);
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} ist erforderlich`);
  }

  if (normalized.length > maxLength) {
    throw new Error(`${label} ist zu lang`);
  }

  if (/[\r\n]/.test(normalized)) {
    throw new Error(`${label} darf keine Zeilenumbrüche enthalten`);
  }

  return normalized;
}

function normalizeMultilineText(value: unknown, label: string, maxLength: number) {
  if (typeof value !== 'string') {
    throw new Error(`${label} ist erforderlich`);
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} ist erforderlich`);
  }

  if (normalized.length > maxLength) {
    throw new Error(`${label} ist zu lang`);
  }

  return normalized;
}

function normalizeEmailList(value: unknown, label: string) {
  if (typeof value !== 'string') {
    throw new Error(`${label} ist erforderlich`);
  }

  const emails = splitEmailList(value);
  if (emails.length === 0) {
    throw new Error(`${label} ist erforderlich`);
  }

  const invalid = emails.find((email) => !SIMPLE_EMAIL_PATTERN.test(email));
  if (invalid) {
    throw new Error(`Ungültige E-Mail-Adresse in ${label}: ${invalid}`);
  }

  return emails.join(', ');
}

function splitEmailList(value: string) {
  return value
    .split(/[;,]/)
    .map((email) => email.trim())
    .filter(Boolean);
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat('de-DE').format(date);
}

function textToHtml(text: string) {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
