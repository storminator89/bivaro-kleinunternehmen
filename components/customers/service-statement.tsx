"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatBusinessDateDisplay } from '@/lib/business-date';
import { formatManualDuration } from '@/lib/service-duration';
import { MAX_STATEMENT_NOTES, STATEMENT_NOTICE, type ServiceStatementResult, type StatementFilters } from '@/lib/service-statement';
import { readStatementResponse, STATEMENT_DOWNLOAD_ERROR, StatementRequestError } from '@/lib/service-statement-client';
import styles from './service-workbench.module.css';

type Note = { id: number; serviceDate: string; description: string; projectId: number | null; durationMinutes: number | null; quantity: number; unit: string; invoiceId?: number | null; invoice?: { id: number } | null };
type Project = { id: number; name: string; archivedAt: string | null };
type Props = { customerId: number; notes: Note[]; projects: Project[]; filters: StatementFilters; disabled: boolean };
const PAGE_SIZE = 25;

export function ServiceStatement({ customerId, notes, projects, filters, disabled }: Props) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button type="button" variant="outline" disabled={disabled}><Download aria-hidden="true" className="h-4 w-4" />Aufstellung</Button></DialogTrigger>
    <DialogContent className={styles.statementDialog}>
      <DialogHeader className={styles.statementHeader}>
        <DialogTitle>Leistungsaufstellung</DialogTitle>
        <DialogDescription>{STATEMENT_NOTICE}. Nur ausdrücklich ausgewählte Leistungen.</DialogDescription>
      </DialogHeader>
      {open && <StatementContent customerId={customerId} notes={notes} projects={projects} filters={filters} onClose={() => setOpen(false)} />}
    </DialogContent>
  </Dialog>;
}

function StatementContent({ customerId, notes, projects, filters: initialFilters, onClose }: Omit<Props, 'disabled'> & { onClose: () => void }) {
  const [filters, setFilters] = useState(initialFilters);
  const [selected, setSelected] = useState<number[]>([]);
  const [approved, setApproved] = useState(false);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(ServiceStatementResult & { url: string }) | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);
  const previewRef = useRef<HTMLHeadingElement>(null);
  const dateError = Boolean(filters.from && filters.to && filters.from > filters.to);
  const matching = useMemo(() => notes.filter(note => {
    const linked = Boolean(note.invoiceId || note.invoice?.id);
    return (filters.project === 'all' || (filters.project === 'none' ? note.projectId === null : note.projectId === Number(filters.project)))
      && (!filters.from || note.serviceDate.slice(0, 10) >= filters.from) && (!filters.to || note.serviceDate.slice(0, 10) <= filters.to)
      && (filters.status === 'all' || (filters.status === 'linked' ? linked : !linked));
  }), [notes, filters]);
  const selectedNotes = matching.filter(note => selected.includes(note.id));
  const lastPage = Math.max(0, Math.ceil(matching.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = matching.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  useEffect(() => () => {
    requestRef.current?.abort();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);
  useEffect(() => { if (result) previewRef.current?.focus(); }, [result]);

  const changeFilters = (change: Partial<StatementFilters>) => {
    setFilters(current => ({ ...current, ...change })); setSelected([]); setApproved(false); setPage(0); setError(null);
  };
  const createPreview = async () => {
    if (requestRef.current || !approved || !selectedNotes.length || !filters.from || !filters.to || dateError) return;
    const controller = new AbortController();
    requestRef.current = controller; setBusy(true); setError(null);
    try {
      const response = await fetch('/api/billing-notes/statement', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', signal: controller.signal,
        body: JSON.stringify({ customerId, ...filters, descriptionsApproved: true, notes: selectedNotes.map(note => ({ id: note.id, description: note.description })) }),
      });
      const data = await readStatementResponse(response);
      const bytes = Uint8Array.from(atob(data.pdfBase64), char => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      if (controller.signal.aborted) { URL.revokeObjectURL(url); return; }
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = url;
      setResult({ ...data, url });
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof StatementRequestError ? cause.message : STATEMENT_DOWNLOAD_ERROR);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  if (result) {
    const { snapshot } = result;
    return <div className={styles.statementContent}>
      <h2 ref={previewRef} tabIndex={-1} className={styles.statementTitle}>Vorschau bereit</h2>
      <p className={styles.statementScope}>{snapshot.customer.name} · {formatBusinessDateDisplay(snapshot.filters.from)} – {formatBusinessDateDisplay(snapshot.filters.to)}<br />
        {snapshot.filters.project === 'all' ? 'Alle Projekte' : snapshot.filters.project === 'none' ? 'Ohne Projekt' : `${snapshot.filters.projectName}${snapshot.filters.projectArchived ? ' · archiviert' : ''}`} · {snapshot.filters.status === 'all' ? 'Alle Leistungen' : snapshot.filters.status === 'open' ? 'Offen' : 'Rechnung zugeordnet'}<br />
        Datenstand (UTC): <time dateTime={snapshot.generatedAt}>{snapshot.generatedAt}</time></p>
      <dl className={styles.summary} aria-label="Summen der Aufstellung">
        <div><dt>Bekannte Dauer</dt><dd>{formatManualDuration(snapshot.totals.durationMinutes)} <span>HH:MM · {snapshot.totals.durationMinutes} Minuten</span></dd></div>
        <div><dt>Ohne Zeitangabe</dt><dd>{snapshot.totals.quantityOnlyCount} <span>nicht als 0 gezählt</span></dd></div>
      </dl>
      <details className={styles.statementDetails}><summary>{snapshot.rows.length} ausgewählte Leistungen prüfen</summary>
        {snapshot.rows.map(row => <article className={styles.note} key={row.id}><h3 className={styles.statementTitle}>{row.description}</h3><p className={styles.hint}>{formatBusinessDateDisplay(row.serviceDate)} · {row.projectName || 'Ohne Projekt'}{row.projectArchived ? ' · archiviert' : ''} · {row.status === 'open' ? 'Offen' : 'Rechnung zugeordnet'}<br />{row.durationMinutes === null ? 'Dauer nicht erfasst' : `${formatManualDuration(row.durationMinutes)} HH:MM (${row.durationMinutes} Minuten)`} · {String(row.quantity).replace('.', ',')} {row.unit}</p></article>)}
      </details>
      <p className={styles.hint}>Dateivorschau und Download verwenden dieselbe unveränderte PDF-Datei. Keine Leistung wird abgerechnet.</p>
      <div className={styles.projectActions}>
        <Button asChild><a href={result.url} download={result.filename}><Download aria-hidden="true" className="h-4 w-4" />PDF herunterladen</a></Button>
        <Button asChild variant="outline"><a href={result.url} target="_blank" rel="noopener noreferrer">Dateivorschau öffnen</a></Button>
      </div>
      <Button type="button" variant="ghost" onClick={() => { setResult(null); if (urlRef.current) URL.revokeObjectURL(urlRef.current); urlRef.current = null; setApproved(false); }}>Auswahl ändern</Button>
      <Button type="button" variant="outline" onClick={onClose}>Schließen</Button>
    </div>;
  }

  return <div className={styles.statementContent}>
    <fieldset disabled={busy} className={styles.statementFields}>
      <legend className="sr-only">Filter und explizite Auswahl</legend>
      <div className={styles.statementFilters}>
        <div className={styles.field}><Label htmlFor="statement-from">Aufstellung von</Label><Input id="statement-from" type="date" value={filters.from} required onChange={event => changeFilters({ from: event.target.value })} /></div>
        <div className={styles.field}><Label htmlFor="statement-to">Aufstellung bis</Label><Input id="statement-to" type="date" value={filters.to} required aria-invalid={dateError} min={filters.from || undefined} onChange={event => changeFilters({ to: event.target.value })} /></div>
        <div className={styles.field}><Label htmlFor="statement-project">Projekt der Aufstellung</Label><select id="statement-project" className={styles.select} value={filters.project} onChange={event => changeFilters({ project: event.target.value })}><option value="all">Alle Projekte</option><option value="none">Ohne Projekt</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}{project.archivedAt ? ' · archiviert' : ''}</option>)}</select></div>
        <div className={styles.field}><Label htmlFor="statement-status">Status der Aufstellung</Label><select id="statement-status" className={styles.select} value={filters.status} onChange={event => changeFilters({ status: event.target.value as StatementFilters['status'] })}><option value="all">Alle Leistungen</option><option value="open">Offen</option><option value="linked">Rechnung zugeordnet</option></select></div>
      </div>
      {dateError && <p role="alert" className={styles.fieldError}>Beginn darf nicht nach Ende liegen.</p>}
      {(!filters.from || !filters.to) && <p className={styles.hint}>Bitte Beginn und Ende des Zeitraums wählen.</p>}
      <p className={styles.selectionCount}>{selectedNotes.length} von höchstens {MAX_STATEMENT_NOTES} Leistungen ausgewählt. Keine automatische Auswahl.</p>
      {!matching.length ? <p role="status" className={styles.hint}>Keine passenden Leistungen. Bitte Filter anpassen.</p> : <>
        <div className={styles.statementSelection}>
          {visible.map(note => <label key={note.id} className={styles.statementChoice}>
            <input type="checkbox" checked={selected.includes(note.id)} disabled={!selected.includes(note.id) && selectedNotes.length >= MAX_STATEMENT_NOTES} onChange={event => { setSelected(current => event.target.checked ? [...current, note.id] : current.filter(id => id !== note.id)); setApproved(false); }} />
            <span><strong>{note.description}</strong><span>{formatBusinessDateDisplay(note.serviceDate)} · {note.durationMinutes === null ? 'Dauer nicht erfasst' : `${formatManualDuration(note.durationMinutes)} HH:MM`} · {String(note.quantity).replace('.', ',')} {note.unit} · {note.invoiceId || note.invoice?.id ? 'Rechnung zugeordnet' : 'Offen'}</span></span>
          </label>)}
        </div>
        {lastPage > 0 && <nav aria-label="Seiten der Leistungsauswahl" className={styles.projectActions}><Button type="button" variant="outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Vorherige</Button><span className={styles.hint}>Seite {currentPage + 1} / {lastPage + 1}</span><Button type="button" variant="outline" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Nächste</Button></nav>}
      </>}
      <label className={styles.statementChoice}><input type="checkbox" checked={approved} disabled={!selectedNotes.length} onChange={event => setApproved(event.target.checked)} /><span>Beschreibungen im PDF übernehmen. Interne Kundenhinweise werden nicht ausgegeben.</span></label>
    </fieldset>
    {error && <p role="alert" className={styles.fieldError}>{error} Ihre Auswahl bleibt erhalten; Sie können sicher erneut versuchen.</p>}
    <div className={styles.statementActions}>
      <Button type="button" disabled={busy || !approved || !selectedNotes.length || !filters.from || !filters.to || dateError} onClick={() => void createPreview()}>{busy && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}{busy ? 'Vorschau wird erstellt …' : 'Vorschau erstellen'}</Button>
      <Button type="button" variant="outline" onClick={onClose}>Abbrechen</Button>
    </div>
  </div>;
}
