/**
 * Private, tenant-scoped storage for uploaded documents.
 *
 * `storedName` is an opaque server-generated identifier. User supplied file
 * names are metadata only and are never used as a filesystem path.
 */

import crypto from 'crypto';
import fs from 'fs';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import path from 'path';

/** Base directory is deliberately outside `public/`. */
export const UPLOAD_BASE_DIR = path.join(process.cwd(), 'data', 'uploads');

/** Legacy directory used only for controlled, backwards-compatible reads. */
export const LEGACY_UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');

const SAFE_TENANT_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_STORED_NAME = /^[a-f0-9-]{36}\.[a-z0-9]{1,16}$/;
const SAFE_LEGACY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,240}$/;

function assertTenantId(userId: string): void {
  if (typeof userId !== 'string' || !SAFE_TENANT_ID.test(userId)) {
    throw new Error('Ungültige Mandanten-ID');
  }
}

/** Return whether a value can be used as a server-generated stored name. */
export function isSafeStoredFileName(storedName: unknown): storedName is string {
  return typeof storedName === 'string'
    && storedName.length <= 256
    && !storedName.includes('/')
    && !storedName.includes('\\')
    && !storedName.includes('\0')
    && SAFE_STORED_NAME.test(storedName);
}

/** Return whether a legacy filename is safe to resolve below a fixed root. */
export function isSafeLegacyFileName(storedName: unknown): storedName is string {
  return typeof storedName === 'string'
    && storedName.length <= 241
    && !storedName.includes('/')
    && !storedName.includes('\\')
    && !storedName.includes('\0')
    && storedName !== '.'
    && storedName !== '..'
    && SAFE_LEGACY_NAME.test(storedName);
}

/** Present old logo references through the authenticated route after upgrades. */
export function privateLogoUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/^\/api\/files\/logo\?file=([^&]+)$/u) || value.match(/^\/uploads\/([^/]+)$/u);
  if (!match) return null;
  try {
    const name = decodeURIComponent(match[1]);
    return isSafeLegacyFileName(name) ? `/api/files/logo?file=${encodeURIComponent(name)}` : null;
  } catch { return null; }
}

function assertSafeStoredName(storedName: string): void {
  if (!isSafeStoredFileName(storedName)) {
    throw new Error('Ungültige gespeicherte Dateireferenz');
  }
}

function assertWithinRoot(candidate: string, root: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('Dateipfad liegt außerhalb des privaten Speicherbereichs');
  }
  return resolvedCandidate;
}

/** Tenant directory. The tenant ID is validated before it is joined. */
export function tenantUploadDir(userId: string): string {
  assertTenantId(userId);
  return assertWithinRoot(path.join(UPLOAD_BASE_DIR, userId), UPLOAD_BASE_DIR);
}

/** Ensure the private tenant directory exists. */
export async function ensureTenantUploadDir(userId: string): Promise<string> {
  const directory = tenantUploadDir(userId);
  await mkdir(directory, { recursive: true });
  return directory;
}

/** Synchronous counterpart for synchronous route code. */
export function ensureTenantUploadDirSync(userId: string): string {
  const directory = tenantUploadDir(userId);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

/** Resolve an opaque stored name below the current tenant's private folder. */
export function getTenantUploadPath(userId: string, storedName: string): string {
  assertTenantId(userId);
  assertSafeStoredName(storedName);
  const directory = tenantUploadDir(userId);
  return assertWithinRoot(path.join(directory, storedName), directory);
}

/** Strict legacy resolver, for callers that already checked DB ownership. */
export function getLegacyUploadPath(storedName: string, directory = UPLOAD_BASE_DIR): string {
  if (!isSafeLegacyFileName(storedName)) {
    throw new Error('Ungültige Legacy-Dateireferenz');
  }
  return assertWithinRoot(path.join(directory, storedName), directory);
}

/** Resolve a safe upload path in the tenant folder, if the file exists. */
export function findTenantUploadedFile(userId: string, storedName: string): string | null {
  try {
    const filePath = getTenantUploadPath(userId, storedName);
    return fs.existsSync(filePath) ? filePath : null;
  } catch {
    return null;
  }
}

/**
 * Find an upload for compatibility with old records.
 *
 * When `userId` is supplied, the tenant folder is checked first. The legacy
 * fallback remains deliberately narrow; callers must additionally verify that
 * the database reference belongs exclusively to the current tenant because a
 * legacy root has no filesystem ownership metadata.
 */
export function findUploadedFile(storedName: string, userId?: string): string | null {
  if (userId) {
    const tenantPath = findTenantUploadedFile(userId, storedName);
    if (tenantPath) return tenantPath;
  }

  if (!isSafeLegacyFileName(storedName)) return null;

  const privateLegacyPath = getLegacyUploadPath(storedName, UPLOAD_BASE_DIR);
  if (fs.existsSync(privateLegacyPath)) return privateLegacyPath;

  const publicLegacyPath = getLegacyUploadPath(storedName, LEGACY_UPLOAD_DIR);
  if (fs.existsSync(publicLegacyPath)) return publicLegacyPath;

  return null;
}

function extensionFor(originalName: string): string {
  const baseName = path.basename(originalName || 'upload');
  const extension = path.extname(baseName).toLowerCase();
  return /^\.[a-z0-9]{1,16}$/.test(extension) ? extension : '.bin';
}

/** Allocate an opaque tenant filename without creating a file. */
export function createTenantStoredName(originalName: string): string {
  return `${crypto.randomUUID()}${extensionFor(originalName)}`;
}

/** Store bytes under a new opaque filename in the tenant folder. */
export async function writeTenantFile(
  userId: string,
  originalName: string,
  bytes: Uint8Array,
): Promise<string> {
  await ensureTenantUploadDir(userId);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const storedName = createTenantStoredName(originalName);
    const filePath = getTenantUploadPath(userId, storedName);
    try {
      await writeFile(filePath, bytes, { flag: 'wx', mode: 0o600 });
      return storedName;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt === 2) throw error;
    }
  }
  throw new Error('Datei konnte nicht gespeichert werden');
}

export async function readTenantFile(userId: string, storedName: string): Promise<Buffer> {
  return readFile(getTenantUploadPath(userId, storedName));
}

export async function deleteTenantFile(userId: string, storedName: string): Promise<void> {
  await unlink(getTenantUploadPath(userId, storedName));
}

/** Strict root helper retained for compatibility with old callers. */
export function getUploadPath(filename: string): string {
  return getLegacyUploadPath(filename, UPLOAD_BASE_DIR);
}

/** Validate a resolved path against the private upload root. */
export function isPathWithinUploadDir(filePath: string): boolean {
  try {
    assertWithinRoot(filePath, UPLOAD_BASE_DIR);
    return true;
  } catch {
    return false;
  }
}

/** Synchronous root directory helper retained for existing callers. */
export function ensureUploadDirExists(): void {
  fs.mkdirSync(UPLOAD_BASE_DIR, { recursive: true });
}
