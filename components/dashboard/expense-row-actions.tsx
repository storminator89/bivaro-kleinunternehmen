'use client';

import Link from 'next/link';
import { Copy, FileText, LockKeyhole, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ExpenseReceiptActions } from './expense-receipt-actions';
import type { Expense } from '@/types/dashboard';

type Props = { expense: Expense; compact?: boolean; isDeleting: boolean; onEdit: (expense: Expense) => void; onDuplicate: (expense: Expense) => void; onDelete: (id: number) => void; onViewReceipt: (url: string) => void };
/** Source-bound records deliberately expose only supported read actions, never guaranteed-conflict mutations. */
export function ExpenseRowActions({ expense, compact = false, isDeleting, onEdit, onDuplicate, onDelete, onViewReceipt }: Props) {
  const sourceAvailable = Number.isSafeInteger(expense.sourceDocumentId) && (expense.sourceDocumentId ?? 0) > 0;
  if (expense.sourceLinked) return <div className={`min-w-0 max-w-full space-y-2 whitespace-normal ${compact ? 'ml-auto w-64 text-left' : ''}`}>
    <p className="flex items-center gap-1.5 text-xs font-semibold"><LockKeyhole className="size-3.5 shrink-0" aria-hidden="true" />Beleggebunden · schreibgeschützt</p>
    <p className="whitespace-normal break-words text-xs leading-relaxed text-muted-foreground">Originalzuordnung geschützt: kein allgemeines Ändern oder Löschen. Auch eine nachträgliche Kassenbuch-Zuordnung wird hier nicht unterstützt.</p>
    {!sourceAvailable && <p className="text-xs text-caution-foreground">Originalzuordnung nicht bestätigt. Details prüfen; kein Originalzugriff über diese Liste.</p>}
    <div className="flex flex-wrap gap-2"><Button asChild variant="outline" size="sm" className="min-h-11"><Link href={`/expenses/${expense.id}`} aria-label={`Gespeicherte Ausgabe zu ${expense.description} ansehen`}><FileText className="size-4" aria-hidden="true" />Ausgabe ansehen</Link></Button>{sourceAvailable && <TooltipProvider><ExpenseReceiptActions expense={expense} onViewReceipt={onViewReceipt} compact={compact} /></TooltipProvider>}</div>
  </div>;
  if (!compact) return <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" className="min-h-11" onClick={() => onEdit(expense)}>Bearbeiten</Button><ExpenseReceiptActions expense={expense} onViewReceipt={onViewReceipt} /><Button variant="ghost" size="sm" className="min-h-11 text-destructive" disabled={isDeleting} onClick={() => onDelete(expense.id)}>Löschen</Button></div>;
  return <TooltipProvider><div className="flex justify-end gap-2">
    <ExpenseReceiptActions expense={expense} onViewReceipt={onViewReceipt} compact />
    <Action title="Duplizieren"><Button variant="outline" size="icon" aria-label={`${expense.description} duplizieren`} onClick={() => onDuplicate(expense)}><Copy className="size-4" aria-hidden="true" /></Button></Action>
    <Action title="Bearbeiten"><Button variant="outline" size="icon" aria-label={`${expense.description} bearbeiten`} onClick={() => onEdit(expense)}><Pencil className="size-4" aria-hidden="true" /></Button></Action>
    <Action title="Löschen"><Button variant="outline" size="icon" aria-label={`${expense.description} löschen`} className="border-critical/30 text-critical hover:bg-critical-surface" disabled={isDeleting} onClick={() => onDelete(expense.id)}><Trash2 className="size-4" aria-hidden="true" /></Button></Action>
  </div></TooltipProvider>;
}
function Action({ title, children }: { title: string; children: React.ReactNode }) {
  return <Tooltip><TooltipTrigger asChild>{children}</TooltipTrigger><TooltipContent><p>{title}</p></TooltipContent></Tooltip>;
}
