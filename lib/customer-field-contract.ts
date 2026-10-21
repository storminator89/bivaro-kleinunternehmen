/** Existing backup-safe customer field budgets. CSV and backup must agree so
 * every newly accepted import can be exported and restored without truncation.
 * These do not retroactively truncate or rewrite manually created legacy data.
 */
export const CUSTOMER_FIELD_LIMITS = {
  name: 255,
  contactPerson: 255,
  email: 320,
  phone: 64,
  address: 1_000,
  zipCode: 32,
  city: 255,
  taxNumber: 128,
} as const;

/** Explicit CSV/restore business identity: name, email and postal address.
 * A display name alone is never sufficient to map historical relations. */
export function customerBusinessIdentity(customer: Record<string, unknown>): string {
  return JSON.stringify(['name', 'email', 'address', 'zipCode', 'city'].map(field => {
    const value = customer[field];
    if (value === null || value === undefined) return '';
    if (typeof value !== 'string') throw new Error('Ungültige Kundenidentität');
    return value.normalize('NFKC').trim().toLocaleLowerCase('de-DE').replace(/\s+/g, ' ');
  }));
}
