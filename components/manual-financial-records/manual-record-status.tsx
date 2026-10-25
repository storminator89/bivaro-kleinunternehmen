'use client';

import { Button } from '@/components/ui/button';
import type { ManualFinancialRecordKind, ManualFinancialRecordState } from '@/lib/manual-financial-record-contract';
import styles from './manual-record.module.css';

export type ManualRecordOpener = (kind: ManualFinancialRecordKind, id: number, opener: HTMLButtonElement) => void;
export const manualRecordStateLabel = (state?: ManualFinancialRecordState) => state === 'FINALIZED' ? 'Festgeschrieben' : state === 'RECORDED' ? 'Erfasst · bereits berücksichtigt' : state === 'LEGACY_UNREVIEWED' ? 'Altbestand · noch nicht geprüft' : 'Status frisch prüfen';
export function ManualRecordStatus({ kind, id, description, state, onOpen }: { kind: ManualFinancialRecordKind; id: number; description: string; state?: ManualFinancialRecordState; onOpen?: ManualRecordOpener }) {
  return <div className={styles.rowStatus}>
    <span className={styles.status}>{manualRecordStateLabel(state)}</span>
    {onOpen && <Button type="button" variant="outline" size="sm" className="min-h-11 whitespace-normal" aria-label={`${description}: Status, Original und Verlauf`} onClick={event => onOpen(kind, id, event.currentTarget)}>{state === 'FINALIZED' ? 'Original, Verlauf / Betrag korrigieren' : 'Status / Festschreibung prüfen'}</Button>}
  </div>;
}
