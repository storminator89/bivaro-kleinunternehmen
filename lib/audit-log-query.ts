export interface AuditLogFilters {
  entityType: string;
  action: string;
  startDate: string;
  endDate: string;
}

export interface AuditLogQuery {
  filters: AuditLogFilters;
  page: number;
}

interface AuditLogQueryState {
  draft: AuditLogFilters;
  query: AuditLogQuery;
}

export type AuditLogQueryAction =
  | { type: 'edit'; field: keyof AuditLogFilters; value: string }
  | { type: 'apply' }
  | { type: 'reset' }
  | { type: 'page'; page: number }
  | { type: 'retry' };

function defaultFilters(): AuditLogFilters {
  return { entityType: 'all', action: 'all', startDate: '', endDate: '' };
}

export function initialAuditLogQueryState(): AuditLogQueryState {
  return { draft: defaultFilters(), query: { filters: defaultFilters(), page: 1 } };
}

/** A draft never changes the active query. Applying/resetting changes filters and page together. */
export function auditLogQueryReducer(state: AuditLogQueryState, action: AuditLogQueryAction): AuditLogQueryState {
  switch (action.type) {
    case 'edit':
      return { ...state, draft: { ...state.draft, [action.field]: action.value } };
    case 'apply':
      return { ...state, query: { filters: { ...state.draft }, page: 1 } };
    case 'reset':
      return initialAuditLogQueryState();
    case 'page':
      return { ...state, query: { filters: state.query.filters, page: Math.max(1, action.page) } };
    case 'retry':
      return { ...state, query: { ...state.query } };
  }
}

export function auditLogQueryParams({ filters, page }: AuditLogQuery): URLSearchParams {
  const params = new URLSearchParams({ page: page.toString(), limit: '25' });
  if (filters.entityType && filters.entityType !== 'all') params.set('entityType', filters.entityType);
  if (filters.action && filters.action !== 'all') params.set('action', filters.action);
  // Preserve the existing API date contract: date-only start, local end-of-day.
  if (filters.startDate) params.set('startDate', new Date(filters.startDate).toISOString());
  if (filters.endDate) params.set('endDate', new Date(filters.endDate + 'T23:59:59').toISOString());
  return params;
}
