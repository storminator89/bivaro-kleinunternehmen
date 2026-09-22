/**
 * Safe, exact matching for customer price history.
 *
 * This module deliberately does not guess prices.  It only exposes finite
 * EUR line prices from explicitly issued invoices and keeps the original
 * invoice reference/date so callers can show where a suggestion came from.
 */

export type PriceHistoryTaxCategory = 'S' | 'E' | 'Z';

export type PriceHistoryEntry = {
  invoiceId: number;
  invoiceNumber: string | null;
  invoiceDate: string;
  description: string;
  unit: string;
  unitPrice: number;
  taxRate: number;
  taxCategory: PriceHistoryTaxCategory;
  exemptionReason?: string;
  currency: 'EUR';
};

export type PriceHistoryInvoice = {
  id: number;
  invoiceNumber: string | null;
  invoiceDate: Date | string | null;
  uploadedAt: Date | string;
  parsedData: unknown;
};

export type PriceHistoryTenantIdentity = {
  companyName?: string | null;
  email?: string | null;
  taxNumber?: string | null;
};

export type PriceHistoryMatch = Pick<PriceHistoryEntry, 'description' | 'unit' | 'taxRate'> & {
  taxCategory?: PriceHistoryTaxCategory | string;
  exemptionReason?: string;
};

export const PRICE_HISTORY_INVOICE_LIMIT = 200;
export const PRICE_HISTORY_ENTRY_LIMIT = 1_000;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord | null {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isRecord(value) ? value : null;
}

/**
 * Imported incoming invoices can also be marked PAID/ISSUED. Require positive
 * seller identity evidence; lifecycle status alone does not prove direction.
 */
export function isPriceHistoryInvoiceFromTenant(
  invoice: Pick<PriceHistoryInvoice, 'parsedData'>,
  tenant: PriceHistoryTenantIdentity,
): boolean {
  const data = asRecord(invoice.parsedData);
  const seller = data && asRecord(data.sellerInfo);
  if (!seller) return false;

  const sellerName = normalizedText(seller.name)?.toLocaleLowerCase('de-DE');
  const tenantName = normalizedText(tenant.companyName)?.toLocaleLowerCase('de-DE');
  for (const key of ['email', 'taxNumber'] as const) {
    const sellerValue = normalizedText(seller[key])?.toLocaleLowerCase('de-DE');
    const tenantValue = normalizedText(tenant[key])?.toLocaleLowerCase('de-DE');
    if (sellerValue && tenantValue && sellerValue !== tenantValue) return false;
  }
  return Boolean(sellerName && tenantName && sellerName === tenantName);
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizedText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/gu, ' ');
  return text || null;
}

/** Canonical display/matching form for line descriptions. */
export function normalizePriceHistoryDescription(value: unknown): string | null {
  return normalizedText(value);
}

/**
 * The editor uses German labels while imported e-invoices use UN/ECE unit
 * codes. Mapping both to one canonical value prevents a C62/Stück mismatch.
 */
export function normalizePriceHistoryUnit(value: unknown): string | null {
  const text = normalizedText(value);
  if (!text) return null;
  const key = text.toLocaleLowerCase('de-DE');
  const known: Record<string, string> = {
    c62: 'Stück',
    stück: 'Stück',
    stueck: 'Stück',
    piece: 'Stück',
    pcs: 'Stück',
    hur: 'Stunde',
    stunde: 'Stunde',
    hour: 'Stunde',
    hours: 'Stunde',
    days: 'Tag',
    day: 'Tag',
    tag: 'Tag',
    ls: 'Pauschal',
    pauschal: 'Pauschal',
    'lump sum': 'Pauschal',
  };
  return known[key] || text;
}

export function normalizePriceHistoryTaxCategory(value: unknown): PriceHistoryTaxCategory | null {
  if (typeof value !== 'string') return null;
  const category = value.trim().toUpperCase();
  return category === 'S' || category === 'E' || category === 'Z' ? category : null;
}

/**
 * Derive only categories that are unambiguous. A zero rate without an
 * explicit category or exemption reason is intentionally rejected: it may
 * be a small-business exemption (E) or a genuine zero rate (Z).
 */
export function resolvePriceHistoryTaxCategory(
  taxRate: number,
  taxCategory: unknown,
  exemptionReason: string | undefined,
): PriceHistoryTaxCategory | null {
  const explicit = normalizePriceHistoryTaxCategory(taxCategory);
  if (explicit === 'S') return taxRate > 0 ? explicit : null;
  if (explicit === 'E') return taxRate === 0 && exemptionReason ? explicit : null;
  if (explicit === 'Z') return taxRate === 0 ? explicit : null;
  if (taxRate > 0) return 'S';
  return exemptionReason ? 'E' : null;
}

function normalizeReason(value: unknown): string | undefined {
  return normalizedText(value) || undefined;
}

function validDate(value: unknown): string | null {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sameRate(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.000001;
}

export function matchesPriceHistoryEntry(entry: PriceHistoryEntry, criteria: PriceHistoryMatch): boolean {
  const description = normalizePriceHistoryDescription(criteria.description);
  const unit = normalizePriceHistoryUnit(criteria.unit);
  const category = resolvePriceHistoryTaxCategory(criteria.taxRate, criteria.taxCategory, criteria.exemptionReason);
  if (!description || !unit || !category || !Number.isFinite(criteria.taxRate)) return false;
  if (entry.description.toLocaleLowerCase('de-DE') !== description.toLocaleLowerCase('de-DE')) return false;
  if (entry.unit !== unit || !sameRate(entry.taxRate, criteria.taxRate) || entry.taxCategory !== category) return false;

  // An exemption reason is part of the treatment when supplied. This keeps
  // explicit E categories with different legal reasons separate, while old
  // generated small-business lines (where the reason was not stored per line)
  // still match another E line with no reason.
  const entryReason = normalizeReason(entry.exemptionReason);
  const criteriaReason = normalizeReason(criteria.exemptionReason);
  if ((entryReason || criteriaReason) && entryReason !== criteriaReason) return false;
  return true;
}

export function filterPriceHistoryEntries(entries: PriceHistoryEntry[], criteria: PriceHistoryMatch): PriceHistoryEntry[] {
  return entries.filter(entry => matchesPriceHistoryEntry(entry, criteria));
}

/** Extract sanitized entries from database rows. */
export function extractPriceHistoryEntries(invoices: PriceHistoryInvoice[]): PriceHistoryEntry[] {
  const entries: PriceHistoryEntry[] = [];

  invoiceLoop: for (const invoice of invoices) {
    if (!Number.isSafeInteger(invoice.id) || invoice.id <= 0) continue;
    const data = asRecord(invoice.parsedData);
    if (!data || String(data.currency || '').trim().toUpperCase() !== 'EUR') continue;

    const rawItems = Array.isArray(data.lineItems)
      ? data.lineItems
      : Array.isArray(data.items)
        ? data.items
        : [];
    if (!rawItems.length) continue;

    const invoiceDate = validDate(invoice.invoiceDate ?? data.invoiceDate ?? invoice.uploadedAt);
    if (!invoiceDate) continue;
    const invoiceNumber = typeof invoice.invoiceNumber === 'string'
      ? normalizedText(invoice.invoiceNumber)
      : typeof data.invoiceNumber === 'string' ? normalizedText(data.invoiceNumber) : null;

    for (const rawItem of rawItems) {
      if (!isRecord(rawItem)) continue;
      const description = normalizePriceHistoryDescription(rawItem.description);
      const unit = normalizePriceHistoryUnit(rawItem.unit);
      const unitPrice = finiteNumber(rawItem.unitPrice);
      const taxRate = finiteNumber(rawItem.taxRate);
      if (!description || !unit || unitPrice === null || unitPrice < 0 || taxRate === null || taxRate < 0) continue;

      // A price quoted per 100 units is not the editor's per-unit price. Keep
      // it out of suggestions unless the source explicitly means one unit.
      const baseQuantity = finiteNumber(rawItem.baseQuantity);
      if (rawItem.baseQuantity !== undefined && rawItem.baseQuantity !== null && baseQuantity === null) continue;
      if (baseQuantity !== null && baseQuantity !== 1) continue;

      const exemptionReason = normalizeReason(rawItem.exemptionReason);
      const rawCategory = normalizedText(rawItem.taxCategory);
      if (rawCategory && !normalizePriceHistoryTaxCategory(rawCategory)) continue;
      const taxCategory = resolvePriceHistoryTaxCategory(taxRate, rawItem.taxCategory, exemptionReason);
      if (!taxCategory) continue;

      const effectiveReason = taxCategory === 'E' ? exemptionReason : undefined;

      entries.push({
        invoiceId: invoice.id,
        invoiceNumber,
        invoiceDate,
        description,
        unit,
        unitPrice,
        taxRate,
        taxCategory,
        ...(effectiveReason ? { exemptionReason: effectiveReason } : {}),
        currency: 'EUR',
      });
      if (entries.length >= PRICE_HISTORY_ENTRY_LIMIT) break invoiceLoop;
    }
  }

  // Keep the newest source rows first even if a caller did not pre-sort them.
  return entries.sort((left, right) => {
    const dateDifference = Date.parse(right.invoiceDate) - Date.parse(left.invoiceDate);
    return dateDifference || right.invoiceId - left.invoiceId;
  });
}
