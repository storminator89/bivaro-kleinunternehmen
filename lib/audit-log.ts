/**
 * Audit Log Library
 * 
 * Provides secure, comprehensive audit logging for all data changes.
 * Tracks who changed what, when, and what the old/new values were.
 */

import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { headers } from 'next/headers';

// Action types for audit logging
export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'LOGIN'
  | 'LOGOUT'
  | 'LOGIN_FAILED'
  | 'EXPORT'
  | 'IMPORT'
  | 'BACKUP'
  | 'RESTORE'
  | 'API_KEY_CREATED'
  | 'API_KEY_REVOKED'
  | 'PASSWORD_CHANGED'
  | 'SETTINGS_CHANGED'
  | 'STATUS_CHANGED'
  | 'PAYMENT_RECEIVED'
  | 'REMINDER_SENT'
  | 'EMAIL_SENT'
  | 'VIEW'
  | 'DOWNLOAD'
  | 'CANCELLED'
  | 'CONVERTED'
  | 'AUTH_LOGIN'
  | 'AUTH_LOGIN_FAILED'
  | 'AUTH_LOGIN_RATE_LIMITED'
  | 'AUTH_PASSWORD_CHANGED'
  | 'AUTH_ROLE_CHANGED'
  | 'AUTH_USER_DELETED'
  | 'SECURITY_EVENT';

// Entity types that can be audited
export type AuditEntityType =
  | 'Customer'
  | 'Invoice'
  | 'Expense'
  | 'Income'
  | 'Settings'
  | 'User'
  | 'ApiKey'
  | 'RecurringExpense'
  | 'Reminder'
  | 'InvoiceTemplate'
  | 'Backup'
  | 'Session'
  | 'CreditNote'
  | 'CashBook'
  | 'CashTransaction'
  | 'EURExport'
  | 'Quote'
  | 'Documentation'
  | 'SecurityEvent';

export interface AuditLogEntry {
  userId: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string | number;
  entityName?: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/** Required, deliberately small context for a financial mutation. */
export interface FinancialAuditMetadata {
  actorId: string;
  tenantId: string;
  operation: string;
  originalReference: string;
  reason: string;
}

export type FinancialAuditEntry = Omit<AuditLogEntry, 'metadata'> & {
  metadata: FinancialAuditMetadata;
};

/**
 * A Prisma transaction client is deliberately required for financial audit
 * events.  The existing `createAuditLog` helper remains best effort because
 * it is also used for security telemetry and must not turn an otherwise
 * successful login into an error.  Financial writes use this writer instead;
 * an insert failure is allowed to abort their enclosing transaction.
 */
export type FinancialAuditClient = Prisma.TransactionClient;

// Fields to exclude from audit logs (sensitive data)
const SENSITIVE_FIELDS = [
  'password',
  '_RefreshCw',
  'iban',
  'bic',
  'bankName',
  'token',
  'keyHash',
  'secret',
  'authorization',
];

// Fields to mask partially in logs
const MASKED_FIELDS = [
  'email',
  'taxNumber',
];

/**
 * Sanitize values for audit log storage
 * Removes sensitive fields and masks partial data
 */
function sanitizeValues(values: object | undefined): string | null {
  if (!values) return null;

  const sanitize = (value: unknown, key?: string): unknown => {
    const normalizedKey = key?.toLowerCase();
    if (normalizedKey && SENSITIVE_FIELDS.some(field => normalizedKey === field.toLowerCase() || normalizedKey.includes(field.toLowerCase()))) {
      return '[REDACTED]';
    }
    if (key && MASKED_FIELDS.includes(key) && typeof value === 'string') {
      if (key === 'email' && value.includes('@')) {
        const [local, domain] = value.split('@');
        return `${local.substring(0, 2)}***@${domain}`;
      }
      return value.length > 4 ? `${value.substring(0, 2)}***${value.substring(value.length - 2)}` : '***';
    }
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(item => sanitize(item));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [childKey, sanitize(childValue, childKey)]));
    }
    return value;
  };

  return JSON.stringify(sanitize(values));
}

/**
 * Calculate which fields changed between old and new values
 */
function getChangedFields(
  oldValues: Record<string, unknown> | undefined,
  newValues: Record<string, unknown> | undefined
): string[] {
  if (!oldValues || !newValues) return [];

  const changedFields: string[] = [];
  const allKeys = new Set([...Object.keys(oldValues), ...Object.keys(newValues)]);

  for (const key of allKeys) {
    // Skip internal/timestamp fields
    if (['updatedAt', 'createdAt', 'id'].includes(key)) continue;

    const oldVal = JSON.stringify(oldValues[key]);
    const newVal = JSON.stringify(newValues[key]);

    if (oldVal !== newVal) {
      changedFields.push(key);
    }
  }

  return changedFields;
}

/**
 * Get client IP address from request headers
 */
async function getClientInfo(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  try {
    const headersList = await headers();
    const forwardedFor = headersList.get('x-forwarded-for');
    const realIp = headersList.get('x-real-ip');
    const userAgent = headersList.get('user-agent');

    let ipAddress = forwardedFor?.split(',')[0]?.trim() || realIp || null;

    // Anonymize IP (remove last octet for privacy)
    if (ipAddress && ipAddress.includes('.')) {
      const parts = ipAddress.split('.');
      if (parts.length === 4) {
        ipAddress = `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
      }
    }

    return { ipAddress, userAgent };
  } catch {
    return { ipAddress: null, userAgent: null };
  }
}

type AuditEntryForData = Omit<AuditLogEntry, 'metadata'> & {
  metadata?: Record<string, unknown> | FinancialAuditMetadata;
};

async function auditData(entry: AuditEntryForData) {
  const { ipAddress, userAgent } = await getClientInfo();
  const changedFields = getChangedFields(entry.oldValues, entry.newValues);

  return {
    userId: entry.userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId?.toString() || null,
    entityName: entry.entityName || null,
    oldValues: sanitizeValues(entry.oldValues),
    newValues: sanitizeValues(entry.newValues),
    changedFields: changedFields.length > 0 ? JSON.stringify(changedFields) : null,
    ipAddress,
    userAgent: userAgent?.substring(0, 500) || null,
    // Metadata is sanitized too.  In particular, a future caller must not be
    // able to bypass the redaction rules by putting a secret in metadata.
    metadata: sanitizeValues(entry.metadata),
  } satisfies Prisma.AuditLogUncheckedCreateInput;
}

/**
 * Write a financial audit event inside the caller's transaction.
 *
 * This function intentionally propagates database errors.  Callers must
 * invoke it before the transaction callback returns so a failed audit insert
 * rolls back the corresponding invoice/income mutation.
 */
export async function createFinancialAuditLog(
  entry: FinancialAuditEntry,
  tx: FinancialAuditClient,
): Promise<void> {
  await tx.auditLog.create({ data: await auditData(entry) });
}

/**
 * Create an audit log entry
 */
export async function createAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    await prisma.auditLog.create({ data: await auditData(entry) });
  } catch {
    // Log error but don't throw - audit logging should not break main functionality
    console.error('Failed to create audit log');
  }
}

/**
 * Convenience function for logging entity creation
 */
export async function auditCreate(
  userId: string,
  entityType: AuditEntityType,
  entity: { id: number | string;[key: string]: unknown },
  entityName?: string
): Promise<void> {
  const e = entity as Record<string, unknown>;
  await createAuditLog({
    userId,
    action: 'CREATE',
    entityType,
    entityId: entity.id,
    entityName: entityName || (e.name as string) || (e.description as string) || (e.invoiceNumber as string),
    newValues: e,
  });
}

/**
 * Convenience function for logging entity updates
 */
export async function auditUpdate(
  userId: string,
  entityType: AuditEntityType,
  entityId: number | string,
  oldValues: Record<string, unknown>,
  newValues: Record<string, unknown>,
  entityName?: string
): Promise<void> {
  await createAuditLog({
    userId,
    action: 'UPDATE',
    entityType,
    entityId,
    entityName,
    oldValues,
    newValues,
  });
}

/**
 * Convenience function for logging entity deletion
 */
export async function auditDelete(
  userId: string,
  entityType: AuditEntityType,
  entity: { id: number | string;[key: string]: unknown },
  entityName?: string
): Promise<void> {
  const e = entity as Record<string, unknown>;
  await createAuditLog({
    userId,
    action: 'DELETE',
    entityType,
    entityId: entity.id,
    entityName: entityName || (e.name as string) || (e.description as string) || (e.invoiceNumber as string),
    oldValues: e,
  });
}

/**
 * Log a login attempt
 */
export async function auditLogin(
  userId: string,
  success: boolean,
  metadata?: Record<string, unknown>
): Promise<void> {
  await createAuditLog({
    userId,
    action: success ? 'LOGIN' : 'LOGIN_FAILED',
    entityType: 'Session',
    metadata,
  });
}

/**
 * Log a data export
 */
export async function auditExport(
  userId: string,
  entityType: AuditEntityType,
  metadata?: Record<string, unknown>
): Promise<void> {
  await createAuditLog({
    userId,
    action: 'EXPORT',
    entityType,
    metadata,
  });
}

/**
 * Log a backup operation
 */
export async function auditBackup(
  userId: string,
  action: 'BACKUP' | 'RESTORE',
  metadata?: Record<string, unknown>
): Promise<void> {
  await createAuditLog({
    userId,
    action,
    entityType: 'Backup',
    metadata,
  });
}

export type SecurityEventName =
  | 'BACKUP_EXPORT'
  | 'BACKUP_RESTORE_PREVIEW'
  | 'BACKUP_RESTORE'
  | 'FULL_BACKUP_EXPORT'
  | 'FULL_BACKUP_RESTORE'
  | 'AUTH_REGISTRATION'
  | 'AUTH_LOGIN'
  | 'AUTH_LOGIN_FAILED'
  | 'AUTH_LOGIN_RATE_LIMITED'
  | 'AUTH_PASSWORD_CHANGED'
  | 'AUTH_ROLE_CHANGED'
  | 'AUTH_USER_DELETED'
  | 'AUTH_REGISTRATION_SETTINGS_CHANGED'
  | 'ADMIN_USER_CHANGE';

export type SecurityEventOutcome = 'success' | 'failure' | 'blocked';
export type SecurityEventSeverity = 'info' | 'warning' | 'critical';

export async function auditSecurityEvent(
  userId: string,
  event: {
    event: SecurityEventName;
    outcome: SecurityEventOutcome;
    severity: SecurityEventSeverity;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await createAuditLog({
    userId,
    action: 'SECURITY_EVENT',
    entityType: 'SecurityEvent',
    entityName: event.event,
    metadata: {
      event: event.event,
      outcome: event.outcome,
      severity: event.severity,
      ...event.metadata,
    },
  });
}

/**
 * Get audit logs with filtering and pagination
 */
export async function getAuditLogs(options: {
  userId?: string;
  entityType?: AuditEntityType;
  entityId?: string;
  action?: AuditAction;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  pageSize?: number;
}) {
  const {
    userId,
    entityType,
    entityId,
    action,
    startDate,
    endDate,
    page = 1,
    pageSize = 50,
  } = options;

  const where: Prisma.AuditLogWhereInput = {};

  if (userId) where.userId = userId;
  if (entityType) where.entityType = entityType;
  if (entityId) where.entityId = entityId;
  if (action) where.action = action;

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = startDate;
    if (endDate) where.createdAt.lte = endDate;
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    logs,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      hasMore: page * pageSize < total,
    },
  };
}

/**
 * Get audit summary for a specific entity
 */
export async function getEntityAuditHistory(
  entityType: AuditEntityType,
  entityId: string | number
) {
  const logs = await prisma.auditLog.findMany({
    where: {
      entityType,
      entityId: entityId.toString(),
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return logs;
}

/**
 * Clean up old audit logs (retention policy)
 * Default: Keep logs for 2 years
 */
export async function cleanupOldAuditLogs(retentionDays: number = 730): Promise<number> {
  const _today = new Date();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const result = await prisma.auditLog.deleteMany({
    where: {
      createdAt: { lt: cutoffDate },
    },
  });

  return result.count;
}
