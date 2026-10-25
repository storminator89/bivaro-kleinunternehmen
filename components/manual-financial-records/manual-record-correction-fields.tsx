'use client';

import styles from './manual-record.module.css';

type Props = { amount: string; reason: string; onAmountChange: (amount: string) => void; onReasonChange: (reason: string) => void };
/** Labels must not contain the controlled textarea: its mutable text content
 * otherwise becomes part of its own exact accessible label after typing.
 */
export function ManualRecordCorrectionFields({ amount, reason, onAmountChange, onReasonChange }: Props) {
  return <div className={styles.stack}>
    <div><label htmlFor="manual-record-amount">Neuer wirksamer Betrag (EUR)</label><input id="manual-record-amount" inputMode="decimal" autoComplete="off" value={amount} maxLength={18} onChange={event => onAmountChange(event.target.value)} /></div>
    <div><label htmlFor="manual-record-reason">Nachvollziehbarer Korrekturgrund</label><textarea id="manual-record-reason" rows={3} maxLength={1000} value={reason} onChange={event => onReasonChange(event.target.value)} /></div>
  </div>;
}
