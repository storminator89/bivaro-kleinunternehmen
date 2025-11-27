/**
 * Security Utilities Module
 * 
 * Provides security helpers for input validation, sanitization,
 * file path validation, and other security-critical operations.
 */

import path from 'path';
import crypto from 'crypto';

/**
 * Maximum file sizes by type (in bytes)
 */
export const FILE_SIZE_LIMITS = {
  image: 10 * 1024 * 1024,     // 10MB for images (logos)
  pdf: 10 * 1024 * 1024,       // 10MB for PDFs
  document: 5 * 1024 * 1024,   // 5MB for other documents
  default: 5 * 1024 * 1024,    // 5MB default
} as const;

/**
 * Allowed MIME types by category
 */
export const ALLOWED_MIME_TYPES = {
  image: ['image/jpeg', 'image/png', 'image/jpg', 'image/gif', 'image/webp'],
  pdf: ['application/pdf'],
  document: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
} as const;

/**
 * Allowed file extensions by category
 */
export const ALLOWED_EXTENSIONS = {
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
  pdf: ['.pdf'],
  document: ['.pdf', '.doc', '.docx'],
} as const;

/**
 * Validate and sanitize a file path to prevent path traversal attacks
 * 
 * @param baseDir - The base directory (e.g., 'data/uploads')
 * @param fileName - The filename to validate
 * @returns The sanitized full path or null if invalid
 */
export function validateFilePath(baseDir: string, fileName: string): string | null {
  if (!fileName || typeof fileName !== 'string') {
    return null;
  }

  // Extract only the basename to prevent directory traversal
  const sanitizedFileName = path.basename(fileName);
  
  // Check for empty or dangerous characters
  if (!sanitizedFileName || sanitizedFileName.startsWith('.') || sanitizedFileName.includes('\0')) {
    return null;
  }

  const fullPath = path.join(baseDir, sanitizedFileName);
  const resolvedPath = path.resolve(fullPath);
  const resolvedBaseDir = path.resolve(baseDir);

  // Ensure the resolved path is within the base directory
  if (!resolvedPath.startsWith(resolvedBaseDir + path.sep) && resolvedPath !== resolvedBaseDir) {
    return null;
  }

  return resolvedPath;
}

/**
 * Generate a secure random filename
 * 
 * @param originalName - Original filename
 * @param prefix - Optional prefix for the filename
 * @returns Secure filename with UUID
 */
export function generateSecureFilename(originalName: string, prefix?: string): string {
  const extension = path.extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, '');
  const uuid = crypto.randomUUID();
  const prefixStr = prefix ? `${prefix}_` : '';
  return `${prefixStr}${uuid}${extension}`;
}

/**
 * Validate file type by checking both MIME type and extension
 * 
 * @param file - The file to validate
 * @param category - The category of allowed types
 * @returns Whether the file type is valid
 */
export function validateFileType(
  file: { type: string; name: string },
  category: keyof typeof ALLOWED_MIME_TYPES
): boolean {
  const allowedMimeTypes: readonly string[] = ALLOWED_MIME_TYPES[category] || [];
  const allowedExtensions: readonly string[] = ALLOWED_EXTENSIONS[category] || [];
  
  const mimeValid = allowedMimeTypes.includes(file.type);
  const extension = path.extname(file.name).toLowerCase();
  const extValid = allowedExtensions.includes(extension);
  
  return mimeValid && extValid;
}

/**
 * Validate file size
 * 
 * @param size - File size in bytes
 * @param category - The category for size limit
 * @returns Whether the file size is valid
 */
export function validateFileSize(
  size: number,
  category: keyof typeof FILE_SIZE_LIMITS = 'default'
): boolean {
  const maxSize = FILE_SIZE_LIMITS[category] || FILE_SIZE_LIMITS.default;
  return size > 0 && size <= maxSize;
}

/**
 * Sanitize a string for safe use in database queries and display
 * Removes potentially dangerous characters while preserving readability
 * 
 * @param input - The string to sanitize
 * @param maxLength - Maximum allowed length
 * @returns Sanitized string
 */
export function sanitizeString(input: string, maxLength: number = 255): string {
  if (!input || typeof input !== 'string') {
    return '';
  }
  
  return input
    .trim()
    .substring(0, maxLength)
    // Remove null bytes
    .replace(/\0/g, '')
    // Remove control characters except newlines and tabs
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Sanitize HTML to prevent XSS attacks
 * Simple approach - escape HTML entities
 * 
 * @param input - The string to sanitize
 * @returns HTML-safe string
 */
export function escapeHtml(input: string): string {
  if (!input || typeof input !== 'string') {
    return '';
  }
  
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;',
    '`': '&#x60;',
    '=': '&#x3D;',
  };
  
  return input.replace(/[&<>"'`=/]/g, (char) => htmlEntities[char] || char);
}

/**
 * Validate email format
 * 
 * @param email - Email to validate
 * @returns Whether the email format is valid
 */
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') {
    return false;
  }
  
  // RFC 5322 compliant email regex (simplified)
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  
  return emailRegex.test(email) && email.length <= 254;
}

/**
 * Validate password strength
 * 
 * @param password - Password to validate
 * @returns Object with validation result and message
 */
export function validatePassword(password: string): { valid: boolean; message?: string } {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: 'Passwort ist erforderlich' };
  }
  
  if (password.length < 8) {
    return { valid: false, message: 'Passwort muss mindestens 8 Zeichen lang sein' };
  }
  
  if (password.length > 128) {
    return { valid: false, message: 'Passwort darf maximal 128 Zeichen lang sein' };
  }
  
  // Check for at least one uppercase, one lowercase, and one digit
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Passwort muss mindestens einen Großbuchstaben enthalten' };
  }
  
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Passwort muss mindestens einen Kleinbuchstaben enthalten' };
  }
  
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Passwort muss mindestens eine Zahl enthalten' };
  }
  
  return { valid: true };
}

/**
 * Rate limit key generator for IP-based limiting
 * 
 * @param ip - IP address
 * @param action - The action being rate limited
 * @returns Rate limit key
 */
export function getRateLimitKey(ip: string, action: string): string {
  // Normalize IP (handle IPv6 and IPv4)
  const normalizedIp = ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip;
  return `ratelimit:${action}:${normalizedIp}`;
}

/**
 * Generate CSRF token
 * 
 * @returns CSRF token
 */
export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Security headers for API responses
 */
export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
} as const;

/**
 * Add security headers to a Response
 * 
 * @param response - The response to add headers to
 * @returns Response with security headers
 */
export function addSecurityHeaders(headers: Headers): void {
  Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
    headers.set(key, value);
  });
}
