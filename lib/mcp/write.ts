import { McpOperationError } from './errors';
import { z } from 'zod';
import { inTransaction } from '@/lib/db-transaction';
import { createFinancialAuditLog } from '@/lib/audit-log';
import { collectionSelect, recordVersion } from './read';
import type { McpPrincipal } from './auth';
import { mcpConfig } from './config';

export function assertMcpWrite(principal: McpPrincipal) {
  // Recheck on execution as well as tool discovery. Tokens cannot enable the server switch.
  if (!principal.canWrite || !mcpConfig()?.writes) throw new McpOperationError('MCP-Schreibzugriff ist gesperrt.');
}
const text = z.string().trim().max(255);
export const customerSchema = z.object({ id: z.number().int().positive().optional(), expectedVersion: z.string().regex(/^[a-f0-9]{64}$/).optional(), name: text.min(1), contactPerson: text.nullable().default(null), email: z.union([z.email(), z.literal('')]).nullable().default(null), phone: text.nullable().default(null), address: z.string().max(2000).nullable().default(null), zipCode: text.nullable().default(null), city: text.nullable().default(null), taxNumber: text.nullable().default(null) }).strict();
export async function saveMcpCustomer(principal: McpPrincipal, raw: z.input<typeof customerSchema>) {
  assertMcpWrite(principal);
  const { id, expectedVersion, ...data } = customerSchema.parse(raw);
  if (id !== undefined && !expectedVersion) throw new McpOperationError('Kunden zuerst lesen und _version als expectedVersion übergeben.');
  return inTransaction(async tx => {
    const old = id === undefined ? null : await tx.customer.findFirst({ where: { id, userId: principal.userId }, select: collectionSelect('customers') });
    if (id !== undefined && (!old || recordVersion(old) !== expectedVersion)) throw new McpOperationError('Kunde fehlt oder wurde geändert. Neu lesen.');
    const row = id === undefined ? await tx.customer.create({ data: { ...data, userId: principal.userId } }) : await tx.customer.update({ where: { id, userId: principal.userId }, data });
    await createFinancialAuditLog({ userId: principal.userId, action: old ? 'UPDATE' : 'CREATE', entityType: 'Customer', entityId: row.id, entityName: row.name,
      oldValues: old ?? undefined, newValues: data, metadata: { actorId: principal.userId, tenantId: principal.userId, operation: 'mcp.customer.save', originalReference: `customer:${row.id}`, reason: `Explicit MCP write via ${principal.accessId}` } }, tx);
    return { id: row.id, created: old === null };
  });
}
