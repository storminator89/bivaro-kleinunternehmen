'use client';

import { useLayoutEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { RECORD_SEARCH_GROUPS, type RecordSearchType } from '@/lib/record-search/contract';
import { useRecordListHandoff, useRecordListSearch } from './record-list-search-provider';

export function RecordListSearchNotice({ type, searchInputId, onClear }: { type: RecordSearchType; searchInputId: string; onClear?: (clear: () => void) => void }) {
  const search = useRecordListSearch(type);
  const { clear } = useRecordListHandoff();
  const notice = useRef<HTMLDivElement>(null);
  const revision = search?.revision;
  useLayoutEffect(() => { if (revision !== undefined) notice.current?.focus({ preventScroll: true }); }, [revision]);
  if (!search) return null;
  return <div ref={notice} tabIndex={-1} role="region" aria-label={`Suchfilter · ${RECORD_SEARCH_GROUPS[type].title}`} className="col-span-full mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-4 outline-none focus-visible:outline-2 focus-visible:outline-ring">
    <div className="min-w-0"><p className="break-words text-sm font-medium">Suchtreffer für „{search.query}“</p><p className="mt-1 text-xs text-muted-foreground">{type === 'customer' ? 'Nur Kundennamen' : type === 'outbound' ? 'Nur Nummern von Rechnungen und Gutschriften' : 'Nur Rechnungsnummern und ursprüngliche Dateinamen'} · nur für diese Ansicht, nicht gespeichert.</p></div>
    <Button variant="outline" onClick={event => {
      const trigger = event.currentTarget;
      const finish = () => {
        clear();
        requestAnimationFrame(() => {
          if (document.activeElement === document.body || document.activeElement === trigger) document.getElementById(searchInputId)?.focus({ preventScroll: true });
        });
      };
      if (onClear) onClear(finish); else finish();
    }}>Suchfilter löschen</Button>
  </div>;
}
