import { readFile } from 'fs/promises';
import { basename, extname } from 'path';
import nodemailer, { type SendMailOptions } from 'nodemailer';
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit-log';
import { findOwnedUploadedFile } from '@/lib/upload-ownership';

export type EmailDocumentType = 'invoice' | 'quote' | 'reminder';

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
};

export type SendEmailRequest = EmailDraftRequest & {
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

  return {
    ...draftRequest,
    to,
    cc,
    bcc,
    subject,
    text,
  };
}

export async function buildDocumentEmailDraft(userId: string, request: EmailDraftRequest): Promise<EmailDraft> {
  const loaded = await loadEmailDocument(userId, request);
  const configuration = getEmailConfigurationStatus(loaded.settings.email);
  const companyName = loaded.settings.companyName || 'Ihr Unternehmen';
  const recipient = loaded.customer?.email || '';
  const replyTo = loaded.settings.email || undefined;

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
    };
  }

  if (request.documentType === 'reminder') {
    const reminder = normalizeReminderContext(request.reminder);
    const invoiceNumber = loaded.invoice.invoiceNumber || loaded.invoice.fileName;
    const levelLabel = REMINDER_LEVEL_LABELS[reminder.reminderLevel ?? 1] || REMINDER_LEVEL_LABELS[1];
    const paymentDueDate = addDays(new Date(), reminder.dueDays ?? 14);
    const total = (loaded.invoice.totalAmount || 0) + (reminder.fee || 0);

    return {
      documentType: request.documentType,
      id: request.id,
      from: configuration.from,
      replyTo,
      to: recipient,
      subject: `${levelLabel} zu Rechnung ${invoiceNumber}`,
      text: [
        `Sehr geehrte Damen und Herren,`,
        '',
        `zu unserer Rechnung ${invoiceNumber} konnten wir bislang keinen Zahlungseingang feststellen.`,
        loaded.invoice.dueDate ? `Die Rechnung war fällig am ${formatDate(loaded.invoice.dueDate)}.` : '',
        `Bitte überweisen Sie den offenen Betrag${reminder.fee ? ` inklusive Mahngebühr` : ''} in Höhe von ${formatCurrency(total)} bis spätestens ${formatDate(paymentDueDate)}.`,
        '',
        reminder.notes ? `Hinweis: ${reminder.notes}` : '',
        '',
        `Die ursprüngliche Rechnung finden Sie nochmals im Anhang.`,
        '',
        `Mit freundlichen Grüßen`,
        companyName,
      ].filter((line) => line !== '').join('\n'),
      attachmentFileName: loaded.attachmentFileName,
      attachmentUrl: loaded.attachmentUrl,
      documentLabel: `${levelLabel} zu Rechnung ${invoiceNumber}`,
      emailConfigured: configuration.configured,
      missingConfiguration: configuration.missing,
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
  };
}

export async function sendDocumentEmail(userId: string, request: SendEmailRequest) {
  const loaded = await loadEmailDocument(userId, request);
  const configuration = getRequiredEmailConfiguration(loaded.settings.email);
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

  const transport = nodemailer.createTransport({
    host: configuration.host,
    port: configuration.port,
    secure: configuration.secure,
    requireTLS: !configuration.secure,
    auth: configuration.auth,
    tls: {
      minVersion: 'TLSv1.2',
    },
  });

  const info = await transport.sendMail(mail);

  if (request.documentType === 'reminder') {
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

  if (loaded.invoice.status === 'DRAFT') {
    await prisma.invoice.update({
      where: { id: loaded.invoice.id, userId },
      data: { status: 'SENT' },
    });
  }

  await createAuditLog({
    userId,
    action: 'EMAIL_SENT',
    entityType: request.documentType === 'quote' ? 'Quote' : 'Invoice',
    entityId: loaded.invoice.id,
    entityName: loaded.invoice.invoiceNumber || loaded.invoice.fileName,
    metadata: {
      messageId: info.messageId,
      to: splitEmailList(request.to),
      attachmentFileName: loaded.attachmentFileName,
    },
  });

  return { messageId: info.messageId };
}

async function loadEmailDocument(userId: string, request: EmailDraftRequest): Promise<LoadedDocument> {
  const [invoice, settings] = await Promise.all([
    getDocumentInvoice(userId, request),
    getUserSettings(userId),
  ]);

  if (!invoice) {
    throw new Error('Dokument nicht gefunden');
  }

  const sanitizedFileName = basename(invoice.storedFileName);
  const attachmentPath = await findOwnedUploadedFile(userId, sanitizedFileName);
  if (!attachmentPath) {
    throw new Error('Datei nicht gefunden');
  }

  const customer = invoice.customer || invoice.income?.customer || null;
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
      income: {
        include: {
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

function getEmailConfigurationStatus(settingsEmail?: string | null) {
  const missing: string[] = [];
  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.EMAIL_FROM?.trim() || settingsEmail?.trim() || process.env.SMTP_USER?.trim() || '';

  if (!host) missing.push('SMTP_HOST');
  if (!from) missing.push('EMAIL_FROM oder Firmen-E-Mail');
  if ((process.env.SMTP_USER && !process.env.SMTP_PASSWORD) || (!process.env.SMTP_USER && process.env.SMTP_PASSWORD)) {
    missing.push('SMTP_USER und SMTP_PASSWORD müssen gemeinsam gesetzt sein');
  }

  return {
    configured: missing.length === 0,
    missing,
    from,
  };
}

function getRequiredEmailConfiguration(settingsEmail?: string | null) {
  const status = getEmailConfigurationStatus(settingsEmail);
  if (!status.configured) {
    throw new Error(`E-Mail-Konfiguration unvollständig: ${status.missing.join(', ')}`);
  }

  const port = Number(process.env.SMTP_PORT || '587');
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('SMTP_PORT ist ungültig');
  }

  const secure = process.env.SMTP_SECURE
    ? process.env.SMTP_SECURE === 'true'
    : port === 465;
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASSWORD;

  return {
    host: process.env.SMTP_HOST as string,
    port,
    secure,
    from: status.from,
    auth: user && pass ? { user, pass } : undefined,
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

function formatCurrency(value: number) {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
  }).format(value);
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
