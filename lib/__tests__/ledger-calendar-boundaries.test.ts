import { describe, expect, it } from 'vitest';
import { getLedgerDateFilter } from '@/lib/business-date';
import { getDateRange } from '@/lib/accounting';

describe('ledger calendar boundaries', () => {
  it('includes leap day and handles the January rollover', () => {
    expect(getLedgerDateFilter('lastMonth', new Date('2024-03-15T12:00:00Z'))).toEqual({
      gte: new Date('2024-02-01T00:00:00Z'), lt: new Date('2024-03-01T00:00:00Z'),
    });
    expect(getLedgerDateFilter('lastMonth', new Date('2026-01-15T12:00:00Z'))).toEqual({
      gte: new Date('2025-12-01T00:00:00Z'), lt: new Date('2026-01-01T00:00:00Z'),
    });
    expect(getLedgerDateFilter('all')).toBeUndefined();
    expect(getLedgerDateFilter(null)).toBeUndefined();
  });

  it('clamps rolling months using UTC fields across daylight saving changes', () => {
    const range = getDateRange('last3Months', new Date('2026-05-31T00:00:00Z'));
    expect(range.start?.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(range.endExclusive?.toISOString()).toBe('2026-05-31T00:00:00.001Z');
  });
});
