/**
 * Audit Log Library
 * 
 * Provides secure, comprehensive audit logging for all data changes.
 * Tracks who changed what, when, and what the old/new values were.
 */

import { prisma } from '@/lib/prisma';
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
  | 'VIEW'
  | 'DOWNLOAD';

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
  | 'Session';

export interface AuditLogEntry {
  userId: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string | number;
  entityName?: string;
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
  metadata?: Record<string, any>;
}

// Fields to exclude from audit logs (sensitive data)
const SENSITIVE_FIELDS = [
  'password',
  'keyHash',
  'iban',
  'bic',
  'bankName',
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
function sanitizeValues(values: Record<string, any> | undefined): string | null {
  if (!values) return null;
  
  const sanitized: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(values)) {
    // Skip sensitive fields entirely
    if (SENSITIVE_FIELDS.includes(key)) {
      sanitized[key] = '[REDACTED]';
      continue;
    }
    
    // Mask certain fields
    if (MASKED_FIELDS.includes(key) && typeof value === 'string') {
      if (key === 'email' && value.includes('@')) {
        const [local, domain] = value.split('@');
        sanitized[key] = `${local.substring(0, 2)}***@${domain}`;
      } else if (value.length > 4) {
        sanitized[key] = `${value.substring(0, 2)}***${value.substring(value.length - 2)}`;
      } else {
        sanitized[key] = '***';
      }
      continue;
    }
    
    // Handle nested objects
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      sanitized[key] = JSON.parse(sanitizeValues(value) || '{}');
      continue;
    }
    
    // Handle dates
    if (value instanceof Date) {
      sanitized[key] = value.toISOString();
      continue;
    }
    
    sanitized[key] = value;
  }
  
  return JSON.stringify(sanitized);
}

/**
 * Calculate which fields changed between old and new values
 */
function getChangedFields(
  oldValues: Record<string, any> | undefined, 
  newValues: Record<string, any> | undefined
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

/**
 * Create an audit log entry
 */
export async function createAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    const { ipAddress, userAgent } = await getClientInfo();
    const changedFields = getChangedFields(entry.oldValues, entry.newValues);
    
    await prisma.auditLog.create({
      data: {
        userId: entry.userId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId?.toString() || null,
        entityName: entry.entityName || null,
        oldValues: sanitizeValues(entry.oldValues),
        newValues: sanitizeValues(entry.newValues),
        changedFields: changedFields.length > 0 ? JSON.stringify(changedFields) : null,
        ipAddress,
        userAgent: userAgent?.substring(0, 500) || null, // Truncate long user agents
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      },
    });
  } catch (error) {
    // Log error but don't throw - audit logging should not break main functionality
    console.error('Failed to create audit log:', error);
  }
}

/**
 * Convenience function for logging entity creation
 */
export async function auditCreate(
  userId: string,
  entityType: AuditEntityType,
  entity: { id: number | string; [key: string]: any },
  entityName?: string
): Promise<void> {
  await createAuditLog({
    userId,
    action: 'CREATE',
    entityType,
    entityId: entity.id,
    entityName: entityName || entity.name || entity.description || entity.invoiceNumber,
    newValues: entity,
  });
}

/**
 * Convenience function for logging entity updates
 */
export async function auditUpdate(
  userId: string,
  entityType: AuditEntityType,
  entityId: number | string,
  oldValues: Record<string, any>,
  newValues: Record<string, any>,
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
  entity: { id: number | string; [key: string]: any },
  entityName?: string
): Promise<void> {
  await createAuditLog({
    userId,
    action: 'DELETE',
    entityType,
    entityId: entity.id,
    entityName: entityName || entity.name || entity.description || entity.invoiceNumber,
    oldValues: entity,
  });
}

/**
 * Log a login attempt
 */
export async function auditLogin(
  userId: string,
  success: boolean,
  metadata?: Record<string, any>
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
  metadata?: Record<string, any>
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
  metadata?: Record<string, any>
): Promise<void> {
  await createAuditLog({
    userId,
    action,
    entityType: 'Backup',
    metadata,
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

  const where: any = {};

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
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const result = await prisma.auditLog.deleteMany({
    where: {
      createdAt: { lt: cutoffDate },
    },
  });

  return result.count;
}
