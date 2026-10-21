import type { PaymentSummary } from '@/lib/full-payment-form';
import type { LedgerSortBy, LedgerSortOrder } from '@/lib/ledger-sort';
// Typdefinitionen für das Dashboard

export type Expense = {
  id: number;
  description: string;
  amount: number;
  date: string;
  category?: string;
  taxRelevant: boolean;
  taxDeductiblePercentage?: number;
  receiptFileName?: string;
  storedReceiptFileName?: string;
  depreciationYears?: number;
  /** Any incoming source relation locks generic mutations, even if its metadata is inconsistent. */
  sourceLinked?: boolean;
  /** Only a same-tenant, consistent booked source ID may leave the server. */
  sourceDocumentId?: number | null;
};

export type Income = {
  id: number;
  description: string;
  amount: number;
  date: string;
  customerId?: number;
  customerName?: string;
  taxRelevant: boolean;
  invoicePaidStatus?: boolean;
  invoiceStatus?: string;
  invoiceId?: number;
  invoicePaidAt?: string | null;
  paymentJournalEvent?: { id: number; amountCents: string; paidAt: string | null; dateCertainty: string; source: string } | null;
};

export type DashboardEditData = Omit<Partial<Expense & Income>, 'amount'> & {
  amount: string;
};

export type Customer = {
  id: number;
  name: string;
  email?: string;
  address?: string;
  zipCode?: string;
  city?: string;
  taxNumber?: string;
  createdAt: string;
};

export type Invoice = {
  id: number;
  type?: 'INVOICE' | 'CREDIT_NOTE' | 'QUOTE';
  fileName: string;
  uploadedAt: string;
  invoiceNumber?: string;
  totalAmount?: number;
  status: string;
  issuanceState?: 'UNKNOWN' | 'UNISSUED' | 'ISSUED';
  paidAt?: string | null;
  incomes?: { id: number }[];
  paymentSummary?: PaymentSummary | null;
  paymentReviewRequired?: boolean;
  canRecordPayment?: boolean;
  invoiceDate?: string;
  dueDate?: string;
  validUntil?: string;
  originalInvoiceId?: number;
  cancellationReason?: string;
  customer?: { id: number; name: string } | null;
  hasEInvoiceXml?: boolean;
  hasPdfFile?: boolean;
};

export type Quote = {
  id: number;
  fileName: string;
  uploadedAt: string;
  invoiceNumber?: string;
  totalAmount?: number;
  status: string;
  invoiceDate?: string;
  validUntil?: string;
  customer?: { id: number; name: string } | null;
};

export type FilterState = {
  expenses: {
    sortBy?: LedgerSortBy;
    sortOrder?: LedgerSortOrder;
    category: string;
    dateRange: 'all' | 'thisMonth' | 'lastMonth' | 'thisYear';
    taxRelevant: 'all' | 'yes' | 'no';
    hasReceipt: 'all' | 'yes' | 'no';
    searchTerm: string;
  };
  incomes: {
    sortBy?: LedgerSortBy;
    sortOrder?: LedgerSortOrder;
    customer: string;
    dateRange: 'all' | 'thisMonth' | 'lastMonth' | 'thisYear';
    taxRelevant: 'all' | 'yes' | 'no';
    searchTerm: string;
  };
  invoices: {
    paidStatus: 'all' | 'paid' | 'unpaid' | 'partial';
    dateRange: 'all' | 'thisMonth' | 'lastMonth' | 'thisYear';
    searchTerm: string;
    sortBy: 'date' | 'invoiceNumber' | 'amount';
    sortOrder: 'asc' | 'desc';
  };
  quotes: {
    statusFilter: string;
    searchTerm: string;
  };
};

export type TimeRange = 'all' | 'last3Months' | 'last6Months' | 'thisYear' | 'lastYear';

export type DepreciationDetail = {
  id: number;
  description: string;
  date: string;
  totalAmount: number;
  years: number;
  currentYearAmount: number;
  remainingAmount: number;
  calculationExplanation: string;
};

export interface DashboardMonthlyData {
  month: number;
  monthName: string;
  revenue: number;
  expenses: number;
  profit: number;
}

export interface YearComparisonData {
  currentYear: number;
  lastYear: number;
  period?: 'toDate' | 'fullYear';
  comparisonThroughMonth?: number;
  availableYears?: number[];
  revenueThisYearTotal: number;
  revenueLastYearTotal: number;
  expensesThisYearTotal: number;
  expensesLastYearTotal: number;
  revenueThisYearToDate: number;
  revenueLastYearToDate: number;
  expensesThisYearToDate: number;
  expensesLastYearToDate: number;
  monthlyDataThisYear: DashboardMonthlyData[];
  monthlyDataLastYear: DashboardMonthlyData[];
}
