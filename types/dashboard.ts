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
  income?: { id: number } | null;
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
    category: string;
    dateRange: 'all' | 'thisMonth' | 'lastMonth' | 'thisYear';
    taxRelevant: 'all' | 'yes' | 'no';
    hasReceipt: 'all' | 'yes' | 'no';
    searchTerm: string;
  };
  incomes: {
    customer: string;
    dateRange: 'all' | 'thisMonth' | 'lastMonth' | 'thisYear';
    taxRelevant: 'all' | 'yes' | 'no';
    searchTerm: string;
  };
  invoices: {
    paidStatus: 'all' | 'paid' | 'unpaid';
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
