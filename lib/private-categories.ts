/**
 * Private Categories Helper Library
 * Constants and utilities for Privatentnahme/Privateinlage categories
 * These are non-tax-relevant money flows between private and business assets
 */

export const PRIVATE_CATEGORIES = {
    ENTNAHME: 'Privatentnahme',
    EINLAGE: 'Privateinlage',
} as const;

/**
 * Check if a category is a private category (Privatentnahme or Privateinlage)
 * These categories should automatically be marked as non-tax-relevant
 */
export function isPrivateCategory(category: string | null | undefined): boolean {
    if (!category) return false;
    const normalized = category.toLowerCase().trim();
    return normalized === 'privatentnahme' || normalized === 'privateinlage';
}

/**
 * Check if the category is Privatentnahme (private withdrawal from business)
 */
export function isPrivateWithdrawal(category: string | null | undefined): boolean {
    if (!category) return false;
    return category.toLowerCase().trim() === 'privatentnahme';
}

/**
 * Check if the category is Privateinlage (private deposit to business)
 */
export function isPrivateDeposit(category: string | null | undefined): boolean {
    if (!category) return false;
    return category.toLowerCase().trim() === 'privateinlage';
}
