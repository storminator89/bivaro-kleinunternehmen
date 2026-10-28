import { parseInvoiceListSort, type InvoiceListSort } from '@/lib/invoice-list-sort';
import { RECORD_SEARCH_MAX_LENGTH, RECORD_SEARCH_MIN_LENGTH } from './contract';
import { parseIncomingInvoiceDateFilter, type IncomingInvoiceDateFilter } from '@/lib/purchase-documents/invoice-date-filter';

export class FilteredListInputError extends Error {
  constructor() { super('INVALID_FILTERED_LIST_INPUT'); this.name = 'FilteredListInputError'; }
}
export type InvoiceListSearchInput = {
  query: string; page: number; pageSize: number;
  sort?: InvoiceListSort;
  paidStatus: 'all' | 'paid' | 'unpaid' | 'partial';
  dateRange: 'all' | 'thisMonth' | 'lastMonth' | 'thisYear';
};
export type PurchaseListSearchInput = IncomingInvoiceDateFilter & {
  query: string; page: number; limit: number;
  reviewStatus: 'ALL' | 'REVIEW' | 'BOOKED' | 'DISMISSED';
  taskKind: 'all' | 'any' | 'PAYMENT_CHECK' | 'DIRECT_DEBIT_WAIT' | 'CLARIFY';
  taskDue: 'any' | 'due' | 'later' | 'undated';
};
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))) throw new FilteredListInputError();
  return value as Record<string, unknown>;
}
export function filteredListQuery(value: unknown): string {
  if (typeof value !== 'string') throw new FilteredListInputError();
  const query = value.trim();
  if (query.length < RECORD_SEARCH_MIN_LENGTH || query.length > RECORD_SEARCH_MAX_LENGTH) throw new FilteredListInputError();
  return query;
}
function integer(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) throw new FilteredListInputError();
  return value;
}
function choice<T extends string>(value: unknown, choices: readonly T[], fallback: T): T {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !choices.includes(value as T)) throw new FilteredListInputError();
  return value as T;
}
export function customerListSearchInput(value: unknown): { query: string } {
  const input = object(value, ['query']);
  return { query: filteredListQuery(input.query) };
}
export function invoiceListSearchInput(value: unknown): InvoiceListSearchInput {
  const input = object(value, ['query', 'page', 'pageSize', 'paidStatus', 'dateRange', 'sortBy', 'sortOrder']);
  const pageSize = integer(input.pageSize, 20, 100);
  let sort: InvoiceListSort | undefined;
  try { sort = parseInvoiceListSort(input.sortBy, input.sortOrder); } catch { throw new FilteredListInputError(); }
  return { sort, query: filteredListQuery(input.query), page: integer(input.page, 1, Math.floor(Number.MAX_SAFE_INTEGER / pageSize)), pageSize,
    paidStatus: choice(input.paidStatus, ['all', 'paid', 'unpaid', 'partial'], 'all'),
    dateRange: choice(input.dateRange, ['all', 'thisMonth', 'lastMonth', 'thisYear'], 'all') };
}
export function purchaseListSearchInput(value: unknown): PurchaseListSearchInput {
  const input = object(value, ['query', 'page', 'limit', 'reviewStatus', 'taskKind', 'taskDue', 'invoiceDateFrom', 'invoiceDateTo', 'invoiceDateMissing']);
  let dates: IncomingInvoiceDateFilter;
  try { dates = parseIncomingInvoiceDateFilter(input); } catch { throw new FilteredListInputError(); }
  const result: PurchaseListSearchInput = { ...dates, query: filteredListQuery(input.query), page: integer(input.page, 1, 100_000), limit: integer(input.limit, 25, 50),
    reviewStatus: choice(input.reviewStatus, ['ALL', 'REVIEW', 'BOOKED', 'DISMISSED'], 'ALL'),
    taskKind: choice(input.taskKind, ['all', 'any', 'PAYMENT_CHECK', 'DIRECT_DEBIT_WAIT', 'CLARIFY'], 'all'),
    taskDue: choice(input.taskDue, ['any', 'due', 'later', 'undated'], 'any') };
  if ((result.taskKind !== 'all' || result.taskDue !== 'any') && !['ALL', 'REVIEW'].includes(result.reviewStatus)) throw new FilteredListInputError();
  return result;
}
