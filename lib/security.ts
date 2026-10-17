/** Input validation shared by registration and user management. */

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
export { validatePassword } from "@/lib/password-policy";
