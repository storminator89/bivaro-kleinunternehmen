import { Prisma } from '@prisma/client';
import { createFinancialAuditLog } from '@/lib/audit-log';
import { inTransaction } from '@/lib/db-transaction';

export class IncomeMutationError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'IncomeMutationError';
  }
}

export type ManualIncomeCreate = {
  description: string;
  amount: number;
  date: Date;
  customerId: number | null;
  taxRelevant: boolean;
};

export type ManualIncomeUpdate = {
  description?: string;
  amount?: number;
  date?: Date;
  customerId?: number | null;
  taxRelevant?: boolean;
};

type IncomeRecord = Prisma.IncomeGetPayload<{ include: { customer: { select: { id: true; name: true } } } }>;

function auditValues(income: { id: number; description: string; amount: number; date: Date; customerId: number | null; taxRelevant: boolean; userId: string }) {
  return {
    id: income.id,
    description: income.description,
    amount: income.amount,
    date: income.date,
    customerId: income.customerId,
    taxRelevant: income.taxRelevant,
    userId: income.userId,
  };
}

async function assertCustomerOwner(tx: Prisma.TransactionClient, userId: string, customerId: number | null) {
  if (customerId === null) return;
  const customer = await tx.customer.findFirst({ where: { id: customerId, userId }, select: { id: true } });
  if (!customer) throw new IncomeMutationError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
}

function financialMetadata(userId: string, operation: string, incomeId: number) {
  return {
    actorId: userId,
    tenantId: userId,
    operation,
    originalReference: `income:${incomeId}`,
    reason: 'manual income mutation',
  } as const;
}

export async function createManualIncome(userId: string, input: ManualIncomeCreate): Promise<IncomeRecord> {
  return inTransaction(async tx => {
    await assertCustomerOwner(tx, userId, input.customerId);
    const income = await tx.income.create({
      data: { ...input, userId },
      include: { customer: { select: { id: true, name: true } } },
    });
    await createFinancialAuditLog({
      userId,
      action: 'CREATE',
      entityType: 'Income',
      entityId: income.id,
      entityName: income.description,
      newValues: auditValues(income),
      metadata: financialMetadata(userId, 'income.create', income.id),
    }, tx);
    return income;
  });
}

export async function updateManualIncome(userId: string, id: number, input: ManualIncomeUpdate): Promise<IncomeRecord> {
  return inTransaction(async tx => {
    const existing = await tx.income.findFirst({
      where: { id, userId },
      include: { invoice: true, cashTransaction: true },
    });
    if (!existing) throw new IncomeMutationError(404, 'NOT_FOUND', 'Income not found');
    if (existing.invoice || existing.cashTransaction) {
      throw new IncomeMutationError(409, 'LINKED_BOOKING', 'Linked bookings must be changed through their invoice or cashbook');
    }
    await assertCustomerOwner(tx, userId, input.customerId === undefined ? existing.customerId : input.customerId);

    const income = await tx.income.update({
      // Ownership and linked-booking guards above run in this same transaction;
      // the primary key is sufficient for the mutation after those checks.
      where: { id },
      data: {
        ...(input.description !== undefined && { description: input.description }),
        ...(input.amount !== undefined && { amount: input.amount }),
        ...(input.date !== undefined && { date: input.date }),
        ...(input.customerId !== undefined && { customerId: input.customerId }),
        ...(input.taxRelevant !== undefined && { taxRelevant: input.taxRelevant }),
      },
      include: { customer: { select: { id: true, name: true } } },
    });
    await createFinancialAuditLog({
      userId,
      action: 'UPDATE',
      entityType: 'Income',
      entityId: income.id,
      entityName: income.description,
      oldValues: auditValues(existing),
      newValues: auditValues(income),
      metadata: financialMetadata(userId, 'income.update', income.id),
    }, tx);
    return income;
  });
}

export async function deleteManualIncome(userId: string, id: number): Promise<void> {
  await inTransaction(async tx => {
    const existing = await tx.income.findFirst({
      where: { id, userId },
      include: { invoice: true, cashTransaction: true },
    });
    if (!existing) throw new IncomeMutationError(404, 'NOT_FOUND', 'Income not found');
    if (existing.invoice || existing.cashTransaction) {
      throw new IncomeMutationError(409, 'LINKED_BOOKING', 'Linked bookings must be changed through their invoice or cashbook');
    }
    await tx.income.delete({ where: { id } });
    await createFinancialAuditLog({
      userId,
      action: 'DELETE',
      entityType: 'Income',
      entityId: existing.id,
      entityName: existing.description,
      oldValues: auditValues(existing),
      metadata: financialMetadata(userId, 'income.delete', existing.id),
    }, tx);
  });
}
