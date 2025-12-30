/**
 * Types for Kassenbuch (Cash Book) functionality
 * Compliant with German § 146 AO requirements
 */

export type CashTransactionType = 'EINNAHME' | 'AUSGABE';

export interface CashBook {
  id: number;
  name: string;
  description?: string | null;
  initialBalance: number;
  currency: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  userId: string;
  // Computed field
  currentBalance?: number;
  transactionCount?: number;
}

export interface CashTransaction {
  id: number;
  date: string;
  type: CashTransactionType;
  description: string;
  amount: number;
  runningBalance: number;
  category?: string | null;
  receiptNumber?: string | null;
  taxRelevant: boolean;
  notes?: string | null;
  cashBookId: number;
  userId: string;
  expenseId?: number | null;
  incomeId?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CashCount {
  date: string;
  countedAmount: number;
  systemBalance: number;
  difference: number;
  notes?: string;
}

export interface DailyBalance {
  date: string;
  openingBalance: number;
  totalIncome: number;
  totalExpense: number;
  closingBalance: number;
  transactionCount: number;
}

export interface CashBookSummary {
  cashBook: CashBook;
  currentBalance: number;
  todayIncome: number;
  todayExpense: number;
  transactionCount: number;
  lastTransaction?: CashTransaction;
}

// API Request/Response types
export interface CreateCashBookRequest {
  name: string;
  description?: string;
  initialBalance?: number;
  currency?: string;
}

export interface CreateCashTransactionRequest {
  cashBookId: number;
  date?: string;
  type: CashTransactionType;
  description: string;
  amount: number;
  category?: string;
  receiptNumber?: string;
  taxRelevant?: boolean;
  notes?: string;
  expenseId?: number;
  incomeId?: number;
}

export interface CashBookFilters {
  startDate?: string;
  endDate?: string;
  type?: CashTransactionType;
  category?: string;
  search?: string;
}

export interface PaginatedCashTransactions {
  items: CashTransaction[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
