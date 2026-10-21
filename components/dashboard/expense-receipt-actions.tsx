'use client';

import { Download, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Expense } from '@/types/dashboard';

type ReceiptExpense = Pick<Expense, 'id' | 'description' | 'receiptFileName' | 'storedReceiptFileName'>;
/** XML originals are attachments, not iframe-previewable documents. Metadata only; never inspect source text. */
export function isXmlExpenseReceipt(expense: ReceiptExpense): boolean {
  return [expense.receiptFileName, expense.storedReceiptFileName].some(name => typeof name === 'string' && /\.xml$/i.test(name));
}
export function ExpenseReceiptActions({ expense, onViewReceipt, compact = false }: { expense: ReceiptExpense; onViewReceipt: (url: string) => void; compact?: boolean }) {
  if (!expense.storedReceiptFileName) return null;
  const xml = isXmlExpenseReceipt(expense);
  const downloadLabel = xml ? 'XML-Original herunterladen' : 'Beleg herunterladen';
  const download = <Button asChild variant="outline" size={compact ? 'icon' : 'sm'} className="min-h-11"><a href={`/api/expenses/download?id=${expense.id}&download=true`} download aria-label={`${xml ? 'XML-Original' : 'Beleg'} zu ${expense.description} herunterladen`}><Download className="size-4" aria-hidden="true" />{!compact && downloadLabel}</a></Button>;
  const preview = <Button variant="outline" size={compact ? 'icon' : 'sm'} className="min-h-11" aria-label={`Beleg zu ${expense.description} anzeigen`} onClick={() => onViewReceipt(`/api/expenses/download?id=${expense.id}`)}><Eye className="size-4" aria-hidden="true" />{!compact && 'Beleg ansehen'}</Button>;
  if (!compact) return xml ? download : preview;
  return <>
    {!xml && <Tooltip><TooltipTrigger asChild>{preview}</TooltipTrigger><TooltipContent><p>Beleg anzeigen</p></TooltipContent></Tooltip>}
    <Tooltip><TooltipTrigger asChild>{download}</TooltipTrigger><TooltipContent><p>{downloadLabel}</p></TooltipContent></Tooltip>
  </>;
}
