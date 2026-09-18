import { prisma } from '@/lib/prisma';
import {
  findTenantUploadedFile,
  findUploadedFile,
  isSafeLegacyFileName,
} from '@/lib/upload-path';

/**
 * Legacy files were stored in a shared root before tenant folders existed.
 * Their only ownership metadata is the set of database references. A root
 * file is usable only when every reference to that filename belongs to the
 * current tenant. A filename referenced by two tenants is intentionally
 * treated as inaccessible until it is migrated explicitly.
 */
export async function isLegacyFileOwnedByUser(
  userId: string,
  storedName: string,
): Promise<boolean> {
  if (!isSafeLegacyFileName(storedName)) return false;

  const [invoices, expenses, settings] = await Promise.all([
    prisma.invoice.findMany({
      where: { storedFileName: storedName },
      select: { userId: true },
    }),
    prisma.expense.findMany({
      where: { storedReceiptFileName: storedName },
      select: { userId: true },
    }),
    prisma.settings.findMany({
      where: { logoUrl: { contains: storedName } },
      select: { userId: true, logoUrl: true },
    }),
  ]);

  const logoReferences = settings.filter((setting) => {
    if (!setting.logoUrl) return false;
    try {
      const value = new URL(setting.logoUrl, 'http://localhost').searchParams.get('file');
      return value === storedName || setting.logoUrl.endsWith(`/uploads/${storedName}`);
    } catch {
      return setting.logoUrl.endsWith(`/uploads/${storedName}`);
    }
  });

  const owners = new Set([
    ...invoices.map((record) => record.userId),
    ...expenses.map((record) => record.userId),
    ...logoReferences.map((record) => record.userId),
  ]);

  return owners.size > 0 && owners.size === 1 && owners.has(userId);
}

/** Resolve a tenant file, with a guarded legacy fallback for old records. */
export async function findOwnedUploadedFile(
  userId: string,
  storedName: string,
): Promise<string | null> {
  const tenantPath = findTenantUploadedFile(userId, storedName);
  if (tenantPath) return tenantPath;

  if (!(await isLegacyFileOwnedByUser(userId, storedName))) return null;
  return findUploadedFile(storedName, userId);
}
