import { Prisma, type Supplier } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { inTransaction } from '@/lib/db-transaction';
import { createFinancialAuditLog } from '@/lib/audit-log';
import { PurchaseDocumentError } from '@/lib/purchase-documents/errors';
import { expectedRevision } from '@/lib/purchase-documents/service';

export const supplierSelect = { id: true, name: true, address: true, postalCode: true, city: true, country: true, email: true, phone: true, taxId: true, vatId: true, revision: true } satisfies Prisma.SupplierSelect;
export type SupplierDto = Prisma.SupplierGetPayload<{ select: typeof supplierSelect }>;
export type SupplierList = { items: SupplierDto[]; total: number; page: number; limit: number };
const limits = { name: 255, address: 1_000, postalCode: 30, city: 255, country: 100, email: 255, phone: 100, taxId: 100, vatId: 100 } as const;
export function supplierSnapshot(supplier: SupplierDto): SupplierDto {
  return Object.fromEntries(Object.keys(supplierSelect).map(key => [key, supplier[key as keyof SupplierDto]])) as SupplierDto;
}
export function validateSupplierInput(input: Record<string, unknown>): Omit<SupplierDto, 'id' | 'revision'> {
  const result: Record<string, string | null> = {};
  for (const [key, max] of Object.entries(limits)) {
    const value = input[key];
    if (value !== null && value !== undefined && typeof value !== 'string') throw new PurchaseDocumentError(`Ungültiges Lieferantenfeld: ${key}.`);
    const text = typeof value === 'string' ? value.trim() : '';
    if (text.length > max || /[\u0000-\u001f\u007f]/.test(text)) throw new PurchaseDocumentError(`Ungültiges Lieferantenfeld: ${key}.`);
    result[key] = text || null;
  }
  if (!result.name) throw new PurchaseDocumentError('Lieferantenname ist erforderlich.');
  if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) throw new PurchaseDocumentError('Ungültige E-Mail-Adresse.');
  return result as Omit<SupplierDto, 'id' | 'revision'>;
}
export async function listSuppliers(userId: string, params: URLSearchParams): Promise<SupplierList> {
  const pageText = params.get('page') ?? '1', limitText = params.get('limit') ?? '25';
  const search = params.get('search')?.trim() ?? '';
  const page = Number(pageText), limit = Number(limitText);
  if (!/^\d+$/.test(pageText) || !/^\d+$/.test(limitText) || !Number.isSafeInteger(page) || page < 1 || page > 100_000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 || search.length > 200) throw new PurchaseDocumentError('Ungültige Lieferantensuche.');
  const where: Prisma.SupplierWhereInput = { userId, ...(search ? { OR: [{ name: { contains: search } }, { city: { contains: search } }, { vatId: { contains: search } }] } : {}) };
  const [items, total] = await prisma.$transaction([prisma.supplier.findMany({ where, select: supplierSelect, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: limit, skip: (page - 1) * limit }), prisma.supplier.count({ where })]);
  return { items, total, page, limit };
}
export async function createSupplier(userId: string, input: Record<string, unknown>): Promise<SupplierDto> {
  const values = validateSupplierInput(input);
  return inTransaction(async tx => {
    const supplier = await tx.supplier.create({ data: { ...values, userId }, select: supplierSelect });
    await supplierAudit(tx, userId, 'CREATE', supplier);
    return supplier;
  });
}
async function supplierAudit(tx: Prisma.TransactionClient, userId: string, action: 'CREATE' | 'UPDATE' | 'DELETE', supplier: SupplierDto | Supplier, previous?: Supplier) {
  await createFinancialAuditLog({ userId, action, entityType: 'Supplier', entityId: supplier.id, entityName: supplier.name,
    ...(previous ? { oldValues: supplierSnapshot(previous) } : {}), ...(action !== 'DELETE' ? { newValues: supplierSnapshot(supplier) } : { oldValues: supplierSnapshot(supplier) }),
    metadata: { actorId: userId, tenantId: userId, operation: `supplier.${action.toLowerCase()}`, originalReference: `supplier:${supplier.id}`, reason: 'explicit purchase-side contact action; original snapshots unchanged' } }, tx);
}
export async function updateSupplier(userId: string, id: number, input: Record<string, unknown>): Promise<SupplierDto> {
  const revision = expectedRevision(input.expectedRevision), values = validateSupplierInput(input);
  return inTransaction(async tx => {
    const current = await tx.supplier.findFirst({ where: { userId, id } });
    if (!current) throw new PurchaseDocumentError('Lieferant nicht gefunden.', 404, 'NOT_FOUND');
    const changed = await tx.supplier.updateMany({ where: { userId, id, revision }, data: { ...values, revision: { increment: 1 } } });
    if (changed.count !== 1) throw new PurchaseDocumentError('Lieferant wurde inzwischen geändert. Bitte neu laden.', 409, 'REVISION_CONFLICT');
    const supplier = await tx.supplier.findUniqueOrThrow({ where: { id }, select: supplierSelect });
    await supplierAudit(tx, userId, 'UPDATE', supplier, current);
    return supplier;
  });
}
export async function deleteSupplier(userId: string, id: number, revision: number): Promise<void> {
  await inTransaction(async tx => {
    const current = await tx.supplier.findFirst({ where: { userId, id } });
    if (!current) throw new PurchaseDocumentError('Lieferant nicht gefunden.', 404, 'NOT_FOUND');
    if (current.revision !== revision) throw new PurchaseDocumentError('Lieferant wurde inzwischen geändert. Bitte neu laden.', 409, 'REVISION_CONFLICT');
    if (await tx.purchaseDocument.count({ where: { supplierId: id } })) throw new PurchaseDocumentError('Referenzierte Lieferanten können nicht gelöscht werden.', 409, 'SUPPLIER_REFERENCED');
    await tx.supplier.delete({ where: { userId, id, revision } });
    await supplierAudit(tx, userId, 'DELETE', current);
  });
}
