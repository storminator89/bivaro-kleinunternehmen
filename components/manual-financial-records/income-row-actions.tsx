'use client';

import { Button } from '@/components/ui/button';
import type { Income } from '@/types/dashboard';
import styles from './manual-record.module.css';
import { ManualRecordStatus, type ManualRecordOpener } from './manual-record-status';

type Props = { income: Income; compact?: boolean; isDeleting: boolean; onEdit: (income: Income) => void; onDuplicate: (income: Income) => void; onDelete: (id: number) => void; onManualRecord?: ManualRecordOpener };
export function IncomeRowActions({ income, isDeleting, onEdit, onDuplicate, onDelete, onManualRecord }: Props) {
  return <div className={styles.rowActions}>
    <ManualRecordStatus kind="income" id={income.id} description={income.description} state={income.manualRecordState} onOpen={onManualRecord} />
    {income.manualRecordState !== 'FINALIZED' && <>
      <Button variant="outline" size="sm" className="min-h-11" aria-label={`${income.description} bearbeiten`} onClick={() => onEdit(income)}>Bearbeiten</Button>
      <Button variant="outline" size="sm" className="min-h-11" aria-label={`${income.description} duplizieren`} onClick={() => onDuplicate(income)}>Duplizieren</Button>
      <Button variant="ghost" size="sm" className="min-h-11 text-destructive" aria-label={`${income.description} löschen`} disabled={isDeleting} onClick={() => onDelete(income.id)}>Löschen</Button>
    </>}
  </div>;
}
