'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { ArrowLeft, Download, Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import type { ExpenseDetailResponse } from '@/lib/expense-detail';
import { documentHref, documentIdFromQuery, errorMessage, formatSourceDate, incomingJson, IncomingRequestError } from './incoming-document-ui';

export function ExpenseRecord({ data }: { data: ExpenseDetailResponse }) {
  const { expense, source } = data;
  return <section className="rounded-xl border border-border bg-card p-5 sm:p-6" aria-labelledby="expense-record-heading">
    <div className="border-b border-border pb-5"><h2 id="expense-record-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Gespeicherte Ausgabe #{expense.id}</h2><p className="mt-2 text-3xl font-semibold tabular-nums">{new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(expense.amount)}</p><p className="mt-3 break-words font-medium">{expense.description}</p></div>
    <dl className="grid gap-x-6 gap-y-5 py-5 text-sm sm:grid-cols-2 [&_dt]:text-muted-foreground [&_dd]:mt-1 [&_dd]:break-words [&_dd]:font-medium">
      <div><dt>Erfasstes Zahlungsdatum</dt><dd>{formatSourceDate(expense.date)}</dd></div><div><dt>Kategorie</dt><dd>{expense.category || 'Keine Kategorie'}</dd></div>
      <div><dt>Steuerliche Berücksichtigung</dt><dd>{expense.taxRelevant ? 'Ja' : 'Nein'}</dd></div><div><dt>Erfasster betrieblicher / abziehbarer Anteil</dt><dd>{expense.taxDeductiblePercentage === null ? 'Nicht angegeben' : `${expense.taxDeductiblePercentage.toLocaleString('de-DE')} %`}</dd></div>
      <div><dt>Abschreibungsdauer</dt><dd>{expense.depreciationYears === null ? 'Keine mehrjährige Abschreibung erfasst' : `${expense.depreciationYears} Jahre`}</dd></div>
    </dl>
    <p className="border-t border-border py-4 text-xs text-muted-foreground">Angezeigt werden die tatsächlich gespeicherten Angaben, keine Bankbestätigung. Steuerliche Berücksichtigung und Anteil bestätigen keine rechtliche Abziehbarkeit.</p>
    {source ? <section aria-labelledby="expense-source-heading" className="space-y-3 border-t border-border pt-5"><h3 id="expense-source-heading" className="font-semibold">Verknüpftes unverändertes Original</h3><p className="break-all text-sm">{source.originalFileName}</p><dl className="grid gap-3 text-sm sm:grid-cols-2 [&_dt]:text-muted-foreground [&_dd]:mt-1 [&_dd]:break-words"><div><dt>Rechnungsnummer laut Original</dt><dd>{source.invoiceNumber || 'Nicht ausgelesen'}</dd></div><div><dt>Rechnungsdatum laut Original</dt><dd>{formatSourceDate(source.invoiceDate)}</dd></div><div className="sm:col-span-2"><dt>Gewählter Kontakt-Snapshot · nicht die Originalangabe</dt><dd>{source.selectedSupplierSnapshot?.name || 'Kein Snapshot vorhanden'}</dd></div></dl><p className="text-xs text-muted-foreground">Die Ausgabe ist an diesen Eingangsbeleg gebunden. Erneutes Laden erstellt keine weitere Ausgabe. Allgemeines Ändern oder Löschen ist zum Schutz der Originalzuordnung gesperrt. Eine nachträgliche Kassenbuch-Zuordnung wird in dieser Version nicht unterstützt.</p><div className="flex flex-wrap gap-2"><Button asChild variant="outline"><a href={`/api/purchase-documents/${source.id}/original`} download><Download className="size-4" aria-hidden="true" />Original herunterladen</a></Button><Button asChild variant="outline"><Link href={documentHref(source.id)}>Eingangsbeleg ansehen</Link></Button></div><details className="text-xs text-muted-foreground"><summary className="min-h-11 cursor-pointer py-3 focus-visible:outline-2 focus-visible:outline-ring">Original-Prüfsumme (SHA-256)</summary><p className="break-all font-mono">{source.originalSha256}</p></details></section> : <p className="text-sm text-muted-foreground">Diese Ausgabe hat keinen verknüpften Eingangsbeleg.</p>}
  </section>;
}
export function ExpenseDetail({ id }: { id: string }) {
  const { data: session } = useSession();
  return <ExpenseDetailContent key={session?.user?.id ?? 'signed-out'} id={id} />;
}
function ExpenseDetailContent({ id }: { id: string }) {
  const safeId = documentIdFromQuery(id);
  const [data, setData] = useState<ExpenseDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (safeId === null) { setLoading(false); setError('Diese Ausgabe wurde nicht gefunden oder ist nicht zugänglich.'); return; }
    const controller = new AbortController(); setLoading(true); setError(null);
    incomingJson<ExpenseDetailResponse>(`/api/expenses/${safeId}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof IncomingRequestError && error.status === 404 ? 'Diese Ausgabe wurde nicht gefunden oder ist nicht zugänglich.' : errorMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [safeId, refresh]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  return <div className="mx-auto max-w-3xl space-y-6"><PageHeader section="Buchhaltung" title="Ausgabe ansehen" description="Gespeicherte Buchung und ihr Originalbezug — schreibgeschützte Ansicht." /><Button asChild variant="ghost"><Link href="/dashboard?tab=expenses"><ArrowLeft className="size-4" aria-hidden="true" />Zur Ausgabenübersicht</Link></Button>{loading ? <p role="status" className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Ausgabe wird geladen…</p> : error ? <div ref={errorRef} role="alert" tabIndex={-1} className="space-y-3 rounded-xl border border-border bg-card p-5 outline-none"><p className="text-sm text-critical-foreground">{error}</p>{safeId !== null && <Button variant="outline" onClick={() => setRefresh(value => value + 1)}>Erneut laden</Button>}<p className="text-xs text-muted-foreground">Ein Ladefehler bedeutet nicht, dass die Buchung fehlgeschlagen ist. Keine zweite Ausgabe anlegen.</p></div> : data && <ExpenseRecord data={data} />}</div>;
}
