import { describe, expect, it } from 'vitest';
import { auditLogQueryParams, auditLogQueryReducer, initialAuditLogQueryState } from '@/lib/audit-log-query';

describe('audit log draft and applied query contract', () => {
  it('keeps every draft edit off the active page until one atomic apply resets it to page one', () => {
    let state = auditLogQueryReducer(initialAuditLogQueryState(), { type: 'page', page: 3 });
    const previousQuery = state.query;
    const fields = { entityType: 'Customer', action: 'CREATE', startDate: '2026-10-01', endDate: '2026-10-25' };
    for (const field of ['entityType', 'action', 'startDate', 'endDate'] as const) {
      state = auditLogQueryReducer(state, { type: 'edit', field, value: fields[field] });
      expect(state.query).toBe(previousQuery);
    }
    state = auditLogQueryReducer(state, { type: 'apply' });
    expect(state.query).toEqual({ filters: fields, page: 1 });
    expect(state.query.filters).not.toBe(state.draft);
    expect(previousQuery.page).toBe(3);
    const applied = state.query;
    state = auditLogQueryReducer(state, { type: 'edit', field: 'action', value: 'DELETE' });
    expect(state.query).toBe(applied);
    expect(state.query.filters.action).toBe('CREATE');
  });

  it('pages and retries only the applied filters, including with an unapplied draft', () => {
    let state = auditLogQueryReducer(initialAuditLogQueryState(), { type: 'edit', field: 'entityType', value: 'Customer' });
    state = auditLogQueryReducer(state, { type: 'apply' });
    state = auditLogQueryReducer(state, { type: 'edit', field: 'entityType', value: 'Invoice' });
    state = auditLogQueryReducer(state, { type: 'page', page: 2 });
    expect(state.query).toEqual({ filters: { entityType: 'Customer', action: 'all', startDate: '', endDate: '' }, page: 2 });
    const failedQuery = state.query;
    const retry = auditLogQueryReducer(state, { type: 'retry' });
    expect(retry.query).toEqual(failedQuery);
    expect(retry.query).not.toBe(failedQuery);
    expect(retry.draft.entityType).toBe('Invoice');
  });

  it('resets applied filters, draft and a later page together and can reload already-default results', () => {
    let state = auditLogQueryReducer(initialAuditLogQueryState(), { type: 'edit', field: 'action', value: 'DELETE' });
    state = auditLogQueryReducer(state, { type: 'apply' });
    state = auditLogQueryReducer(state, { type: 'page', page: 4 });
    state = auditLogQueryReducer(state, { type: 'edit', field: 'entityType', value: 'Invoice' });
    const reset = auditLogQueryReducer(state, { type: 'reset' });
    expect(reset).toEqual(initialAuditLogQueryState());
    expect(auditLogQueryReducer(reset, { type: 'reset' }).query).not.toBe(reset.query);
    expect(auditLogQueryReducer(reset, { type: 'apply' }).query).not.toBe(reset.query);
  });

  it('preserves the exact backend filter, limit and date interpretation without a tenant override', () => {
    const filters = { entityType: 'Invoice', action: 'UPDATE', startDate: '2026-10-01', endDate: '2026-10-25' };
    const params = auditLogQueryParams({ filters, page: 2 });
    expect(Object.fromEntries(params)).toEqual({
      page: '2', limit: '25', entityType: 'Invoice', action: 'UPDATE',
      startDate: '2026-10-01T00:00:00.000Z',
      endDate: new Date(2026, 9, 25, 23, 59, 59).toISOString(),
    });
    expect(params.has('userId')).toBe(false);
    expect(Object.fromEntries(auditLogQueryParams(initialAuditLogQueryState().query))).toEqual({ page: '1', limit: '25' });
  });
});
