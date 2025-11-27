/**
 * Centralized Upload Path Configuration
 * 
 * SECURITY: All uploads are stored in `data/uploads` which is OUTSIDE the public folder.
 * Files must be served through authenticated API routes, not directly accessible via URL.
 */

import path from 'path';
import fs from 'fs';

/**
 * Base upload directory - PRIVATE (not in public folder)
 * This prevents direct URL access to uploaded files
 */
export const UPLOAD_BASE_DIR = path.join(process.cwd(), 'data', 'uploads');

/**
 * Get the full path for a file in the upload directory
 * @param filename - The filename (will be sanitized)
 * @returns Full path to the file
 */
export function getUploadPath(filename: string): string {
  // Sanitize filename to prevent path traversal
  const sanitizedFilename = path.basename(filename);
  return path.join(UPLOAD_BASE_DIR, sanitizedFilename);
}

/**
 * Validate that a path is within the upload directory
 * @param filePath - The path to validate
 * @returns true if path is safe, false otherwise
 */
export function isPathWithinUploadDir(filePath: string): boolean {
  const resolvedPath = path.resolve(filePath);
  const resolvedUploadDir = path.resolve(UPLOAD_BASE_DIR);
  return resolvedPath.startsWith(resolvedUploadDir + path.sep) || resolvedPath === resolvedUploadDir;
}

/**
 * Ensure the upload directory exists
 */
export function ensureUploadDirExists(): void {
  if (!fs.existsSync(UPLOAD_BASE_DIR)) {
    fs.mkdirSync(UPLOAD_BASE_DIR, { recursive: true });
  }
}

/**
 * Legacy upload directory (public/uploads) - for migration purposes only
 * @deprecated Use UPLOAD_BASE_DIR instead
 */
export const LEGACY_UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');

/**
 * Check if a file exists in either the new or legacy upload location
 * Returns the path where the file was found, or null if not found
 */
export function findUploadedFile(filename: string): string | null {
  const sanitizedFilename = path.basename(filename);
  
  // Check new location first
  const newPath = path.join(UPLOAD_BASE_DIR, sanitizedFilename);
  if (fs.existsSync(newPath)) {
    return newPath;
  }
  
  // Fall back to legacy location for backwards compatibility
  const legacyPath = path.join(LEGACY_UPLOAD_DIR, sanitizedFilename);
  if (fs.existsSync(legacyPath)) {
    return legacyPath;
  }
  
  return null;
}
