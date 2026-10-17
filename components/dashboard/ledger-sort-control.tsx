'use client';

import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { TableHead } from '@/components/ui/table';
import { LEDGER_SORT_OPTIONS, type LedgerSort, type LedgerSortBy } from '@/lib/ledger-sort';

type SortProps = { sort: LedgerSort; onChange: (sort: LedgerSort) => void };

export function LedgerSortControl({ id, sort, onChange }: SortProps & { id: string }) {
  return <div className="ledger-sort-control">
    <Label htmlFor={id}>Sortierung</Label>
    <select id={id} value={`${sort.sortBy}:${sort.sortOrder}`} onChange={event => {
      const option = LEDGER_SORT_OPTIONS.find(item => `${item.sortBy}:${item.sortOrder}` === event.target.value);
      if (option) onChange({ sortBy: option.sortBy, sortOrder: option.sortOrder });
    }}>
      {LEDGER_SORT_OPTIONS.map(option => <option key={`${option.sortBy}:${option.sortOrder}`} value={`${option.sortBy}:${option.sortOrder}`}>{option.label}</option>)}
    </select>
  </div>;
}

export function SortableLedgerHead({ field, label, sort, onChange, numeric = false }: SortProps & { field: LedgerSortBy; label: string; numeric?: boolean }) {
  const active = sort.sortBy === field;
  const nextOrder = active ? (sort.sortOrder === 'asc' ? 'desc' : 'asc') : field === 'description' ? 'asc' : 'desc';
  const Icon = active ? (sort.sortOrder === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return <TableHead className={numeric ? 'text-right font-medium' : 'font-medium'} aria-sort={active ? (sort.sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}>
    <button type="button" className={`ledger-sort-heading ${numeric ? 'ml-auto' : ''}`} onClick={() => onChange({ sortBy: field, sortOrder: nextOrder })} aria-label={`${label}: ${nextOrder === 'asc' ? 'aufsteigend' : 'absteigend'} sortieren`}>
      {label}<Icon aria-hidden="true" className={active ? 'text-primary' : 'text-muted-foreground'} />
    </button>
  </TableHead>;
}
