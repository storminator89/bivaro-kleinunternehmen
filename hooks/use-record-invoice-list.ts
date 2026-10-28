'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRecordListSearch } from '@/components/record-search/record-list-search-provider';
import { fetchRecordList } from '@/lib/record-search/list-handoff';
import type { InvoiceListSort } from '@/lib/invoice-list-sort';
import type { Invoice } from '@/types/dashboard';

type InvoiceList = { items: Invoice[]; total: number; page: number; pageSize: number };

/** Existing invoice DTO/ledger, with a disposable body-only search transport. */
export function useRecordInvoiceList(enabled: boolean, defaultPageSize: number, sort: InvoiceListSort) {
  const search = useRecordListSearch('outbound');
  const scope = JSON.stringify([search?.revision, sort.sortBy, sort.sortOrder]);
  const [pagination, setPagination] = useState({ scope, page: 1, pageSize: defaultPageSize });
  const page = pagination.scope === scope ? pagination.page : 1;
  const pageSize = pagination.pageSize;
  const query = useQuery({
    // The key is opaque. Search text is not retained in query metadata/cache keys.
    queryKey: ['dashboard', 'invoices', 'list', 'palette', search?.revision ?? null, page, pageSize, sort.sortBy, sort.sortOrder],
    queryFn: ({ signal }) => fetchRecordList<InvoiceList>('outbound', search!.query, { page, pageSize, sortBy: sort.sortBy, sortOrder: sort.sortOrder }, signal),
    enabled: enabled && search !== null,
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });
  const setPage = (value: number) => { if (search) setPagination({ scope, page: value, pageSize }); };
  const setPageSize = (value: number) => { if (search) setPagination({ scope, page: 1, pageSize: value }); };
  const load = (nextPage: number, nextPageSize: number) => {
    if (!search) return;
    setPagination({ scope, page: nextPage, pageSize: nextPageSize });
  };
  return { active: search !== null, query, page, pageSize, setPage, setPageSize, load };
}
