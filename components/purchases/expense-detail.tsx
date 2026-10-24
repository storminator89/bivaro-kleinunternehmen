'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { ArrowLeft, Download, Loader2 } from 'lucide-react';
import styles from './document-workspace.module.css';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import type { ExpenseDetailResponse } from '@/lib/expense-detail';
import { documentHref, documentIdFromQuery, errorMessage, formatSourceDate, incomingJson, IncomingRequestError } from './incoming-document-ui';

export function ExpenseRecord({ data }: { data: ExpenseDetailResponse }) {
  const { expense, source } = data;
  return <section className={styles.expenseRecord} aria-labelledby="expense-record-heading">
    <div className={styles.expenseSummary}><h2 id="expense-record-heading" className={styles.expenseLabel}>Gespeicherte Ausgabe #{expense.id}</h2><p className={styles.expenseAmount}>{new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(expense.amount)}</p><p className="mt-3 break-words font-medium">{expense.description}</p></div>
    <dl className={styles.expenseFacts}>
      <div><dt>Zahlungsdatum</dt><dd>{formatSourceDate(expense.date)}</dd></div><div><dt>Kategorie</dt><dd>{expense.category || 'Keine Kategorie'}</dd></div>
      <div><dt>Steuerrelevant</dt><dd>{expense.taxRelevant ? 'Ja' : 'Nein'}</dd></div><div><dt>Abziehbarer Anteil</dt><dd>{expense.taxDeductiblePercentage === null ? 'Nicht angegeben' : `${expense.taxDeductiblePercentage.toLocaleString('de-DE')} %`}</dd></div>
      <div><dt>Abschreibungsdauer</dt><dd>{expense.depreciationYears === null ? 'Keine' : `${expense.depreciationYears} Jahre`}</dd></div>
    </dl>
    <p className={styles.expenseNotice}>Zahlung und Abziehbarkeit nicht extern geprüft.</p>
    {source ? <section aria-labelledby="expense-source-heading" className={styles.expenseSource}><h3 id="expense-source-heading" className="font-semibold">Verknüpftes unverändertes Original</h3><p className="break-all text-sm">{source.originalFileName}</p>{source.reviewedSourceSnapshot && <p className="border-l-2 border-primary pl-3 text-sm">Manuelle Foto-Originalprüfung bestätigt · bewusst freigegeben. Käufer: {source.reviewedSourceSnapshot.buyerName}. Gespeicherter betrieblicher Zweck: {source.reviewedSourceSnapshot.businessPurpose}. Keine externe Identitäts-, Bank- oder steuerliche Konformitätsprüfung.</p>}<dl className="grid gap-3 text-sm sm:grid-cols-2 [&_dt]:text-muted-foreground [&_dd]:mt-1 [&_dd]:break-words"><div><dt>{source.reviewedSourceSnapshot ? 'Rechnungsnummer · manuelle Fotoprüfung' : 'Rechnungsnummer laut Original'}</dt><dd>{source.reviewedSourceSnapshot?.invoiceNumber || source.invoiceNumber || 'Nicht ausgelesen'}</dd></div><div><dt>{source.reviewedSourceSnapshot ? 'Rechnungsdatum · manuelle Fotoprüfung' : 'Rechnungsdatum laut Original'}</dt><dd>{formatSourceDate(source.reviewedSourceSnapshot?.invoiceDate ?? source.invoiceDate)}</dd></div><div className="sm:col-span-2"><dt>Gewählter Kontakt-Snapshot · nicht die Originalangabe</dt><dd>{source.selectedSupplierSnapshot?.name || 'Kein Snapshot vorhanden'}</dd></div></dl><p className="text-xs text-muted-foreground">Beleggebunden: Ändern, Löschen und nachträgliche Kassenbuch-Zuordnung gesperrt.</p><div className="flex flex-wrap gap-2"><Button asChild variant="outline"><a href={`/api/purchase-documents/${source.id}/original`} download><Download className="size-4" aria-hidden="true" />Original herunterladen</a></Button><Button asChild variant="outline"><Link href={documentHref(source.id)}>Eingangsbeleg ansehen</Link></Button></div><details className="text-xs text-muted-foreground"><summary className="min-h-11 cursor-pointer py-3 focus-visible:outline-2 focus-visible:outline-ring">Original-Prüfsumme (SHA-256)</summary><p className="break-all font-mono">{source.originalSha256}</p></details></section> : <p className={styles.expenseSource}>Kein verknüpfter Eingangsbeleg.</p>}
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
  return <div className={styles.detailWorkspace}><PageHeader title="Ausgabe ansehen" actions={<Button asChild variant="outline"><Link href="/dashboard?tab=expenses"><ArrowLeft className="size-4" aria-hidden="true" />Ausgaben</Link></Button>} />{loading ? <p role="status" className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Ausgabe wird geladen…</p> : error ? <div ref={errorRef} role="alert" tabIndex={-1} className="space-y-3 rounded-xl border border-border bg-card p-5 outline-none"><p className="text-sm text-critical-foreground">{error}</p>{safeId !== null && <Button variant="outline" onClick={() => setRefresh(value => value + 1)}>Erneut laden</Button>}<p className="text-xs text-muted-foreground">Ein Ladefehler bedeutet nicht, dass die Buchung fehlgeschlagen ist. Keine zweite Ausgabe anlegen.</p></div> : data && <ExpenseRecord data={data} />}</div>;
}
