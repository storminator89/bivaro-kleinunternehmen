"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Archive, Check, Clock3, Download, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { durationToQuantity, formatManualDuration, parseManualDuration } from '@/lib/service-duration';
import styles from './service-workbench.module.css';
import { ServiceStatement } from './service-statement';

type ServiceProject = {
  id: number;
  customerId: number;
  name: string;
  archivedAt: string | null;
};

type BillingNote = {
  id: number;
  customerId: number;
  serviceDate: string;
  description: string;
  quantity: number;
  unit: string;
  projectId: number | null;
  durationMinutes: number | null;
  project?: Pick<ServiceProject, 'id' | 'name' | 'archivedAt'> | null;
  captureKey?: string | null;
  invoiceId?: number | null;
  invoice?: { id: number; invoiceNumber: string } | null;
};

type ServiceWorkbenchProps = {
  customer: { id: number; name: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type Filters = { project: string; from: string; to: string; status: 'all' | 'open' | 'linked' };
const EMPTY_FILTERS: Filters = { project: 'all', from: '', to: '', status: 'all' };
const BILLING_UNITS = ['Stück', 'Stunde', 'Tag', 'Pauschal'] as const;
const quantityFormatter = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 12 });

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function matchesFilters(note: BillingNote, filters: Filters) {
  const date = note.serviceDate.slice(0, 10);
  const linked = Boolean(note.invoiceId || note.invoice?.id);
  return (filters.project === 'all' || (filters.project === 'none' ? !note.projectId : note.projectId === Number(filters.project)))
    && (!filters.from || date >= filters.from)
    && (!filters.to || date <= filters.to)
    && (filters.status === 'all' || (filters.status === 'linked' ? linked : !linked));
}

class WorkbenchRequestError extends Error {
  constructor(message: string, readonly status: number | null, readonly code?: string) { super(message); }
}

type PendingCapture = { captureKey: string; customerId: number; projectId: number | null; serviceDate: string; description: string; quantity?: number; unit?: string; duration?: string };

function matchesPending(note: BillingNote, pending: PendingCapture): boolean {
  const minutes = pending.duration ? parseManualDuration(pending.duration) : null;
  return note.captureKey === pending.captureKey && note.customerId === pending.customerId && note.projectId === pending.projectId
    && note.serviceDate.slice(0, 10) === pending.serviceDate && note.description === pending.description
    && note.durationMinutes === minutes && note.quantity === (minutes === null ? pending.quantity : durationToQuantity(minutes))
    && note.unit === (minutes === null ? pending.unit : 'Stunde');
}

async function requestJson<T>(url: string, init: RequestInit | undefined, fallback: string): Promise<T> {
  const response = await fetch(url, init);
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : fallback;
    throw new WorkbenchRequestError(message, response.status, data && typeof data === 'object' && 'code' in data && typeof data.code === 'string' ? data.code : undefined);
  }
  if (data === null) throw new WorkbenchRequestError(fallback, null);
  return data as T;
}

export function ServiceWorkbench({ customer, open, onOpenChange }: ServiceWorkbenchProps) {
  const openerRef = useRef<HTMLElement | null>(null);
  const openerCustomerIdRef = useRef<number | null>(null);
  const pendingRef = useRef(false);
  return (
    <Dialog open={open} onOpenChange={nextOpen => {
      if (!nextOpen && pendingRef.current && !confirm('Speicherstatus noch unklar. Beim erneuten Öffnen zuerst den Bestand prüfen. Trotzdem schließen?')) return;
      if (!nextOpen) pendingRef.current = false;
      onOpenChange(nextOpen);
    }}>
      <DialogContent
        className={styles.dialog}
        onOpenAutoFocus={() => {
          const active = document.activeElement;
          openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
          openerCustomerIdRef.current = customer?.id ?? null;
        }}
        onCloseAutoFocus={event => {
          const opener = openerRef.current;
          // Closing clears customer; retain its identity and reject hidden responsive duplicates.
          const customerId = openerCustomerIdRef.current;
          const usable = (element: HTMLElement | null): element is HTMLElement => Boolean(element
            && customerId !== null && element.dataset.serviceWorkbenchReturn === String(customerId)
            && element.isConnected && element.getClientRects().length > 0
            && getComputedStyle(element).visibility === 'visible'
            && !element.matches(':disabled, [aria-disabled="true"]')
            && !element.closest('[inert], [hidden], [role="dialog"], [role="menu"]'));
          const target = usable(opener) ? opener : customerId !== null && Number.isSafeInteger(customerId) && customerId > 0
            ? Array.from(document.querySelectorAll<HTMLElement>(`[data-service-workbench-return="${customerId}"]`)).find(usable)
            : null;
          if (target) {
            event.preventDefault();
            target.focus();
          }
          openerRef.current = null;
          openerCustomerIdRef.current = null;
        }}
      >
        <DialogHeader className={styles.header}>
          <DialogTitle className="pr-7 leading-snug">Leistungsnotizen: {customer?.name || 'Kunde'}</DialogTitle>
          <DialogDescription className="sr-only">Offene Leistungen zur späteren Übernahme in eine Rechnung.</DialogDescription>
        </DialogHeader>
        {open && customer && <CustomerServices key={customer.id} customerId={customer.id} onPendingChange={pending => { pendingRef.current = pending; }} />}
      </DialogContent>
    </Dialog>
  );
}

function CustomerServices({ customerId, onPendingChange }: { customerId: number; onPendingChange: (pending: boolean) => void }) {
  const [notes, setNotes] = useState<BillingNote[]>([]);
  const [projects, setProjects] = useState<ServiceProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [serviceDate, setServiceDate] = useState(localToday);
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState('');
  const [mode, setMode] = useState<'quantity' | 'duration'>('quantity');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('Stück');
  const [duration, setDuration] = useState('');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [newProjectName, setNewProjectName] = useState('');
  const [managedProjectId, setManagedProjectId] = useState('');
  const [managedProjectName, setManagedProjectName] = useState('');
  const [pendingCapture, setPendingCapture] = useState(false);
  const captureRef = useRef<PendingCapture | null>(null);
  const [savedNoteId, setSavedNoteId] = useState<number | null>(null);
  const activeRef = useRef(false);
  const mutationRef = useRef(false);
  const loadRequestRef = useRef(0);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const focusDescriptionRef = useRef(false);

  const loadData = useCallback(async (signal?: AbortSignal) => {
    const requestId = ++loadRequestRef.current;
    setIsLoading(true);
    setLoadError(null);
    setMutationError(null);
    try {
      const [loadedNotes, loadedProjects] = await Promise.all([
        requestJson<BillingNote[]>(`/api/billing-notes?customerId=${customerId}&includeLinked=true`, { cache: 'no-store', signal }, 'Leistungsnotizen konnten nicht geladen werden.'),
        requestJson<ServiceProject[]>(`/api/service-projects?customerId=${customerId}&includeArchived=true`, { cache: 'no-store', signal }, 'Projekte konnten nicht geladen werden.'),
      ]);
      if (!Array.isArray(loadedNotes) || !Array.isArray(loadedProjects)) throw new Error('Leistungen konnten nicht geladen werden. Bitte erneut versuchen.');
      if (activeRef.current && requestId === loadRequestRef.current) {
        setNotes(loadedNotes);
        setProjects(loadedProjects);
        const pending = captureRef.current;
        const recovered = pending && loadedNotes.find(note => matchesPending(note, pending));
        if (recovered) {
          captureRef.current = null;
          setPendingCapture(false);
          setSavedNoteId(recovered.id);
          setDescription(''); setQuantity('1'); setDuration('');
          focusDescriptionRef.current = true;
        }
        setProjectId(current => current && !loadedProjects.some(project => project.id === Number(current) && !project.archivedAt) ? '' : current);
      }
    } catch (error) {
      if (activeRef.current && requestId === loadRequestRef.current && !signal?.aborted) {
        setLoadError(error instanceof Error ? error.message : 'Leistungen konnten nicht geladen werden.');
      }
    } finally {
      if (activeRef.current && requestId === loadRequestRef.current) setIsLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    activeRef.current = true;
    const controller = new AbortController();
    void loadData(controller.signal);
    return () => {
      activeRef.current = false;
      controller.abort();
    };
  }, [loadData]);

  useEffect(() => {
    const unresolved = pendingCapture || busy === 'note';
    onPendingChange(unresolved);
    if (!unresolved) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('beforeunload', warn); };
  }, [pendingCapture, busy, onPendingChange]);

  useEffect(() => {
    if (!busy && focusDescriptionRef.current) {
      focusDescriptionRef.current = false;
      descriptionRef.current?.focus();
    }
  }, [busy]);

  const projectsById = useMemo(() => new Map(projects.map(project => [project.id, project])), [projects]);
  const activeProjects = projects.filter(project => !project.archivedAt);
  const managedProject = projectsById.get(Number(managedProjectId));
  const dateFilterError = Boolean(filters.from && filters.to && filters.from > filters.to);
  const filteredNotes = useMemo(() => notes.filter(note => matchesFilters(note, filters)), [notes, filters]);
  const timedNotes = filteredNotes.filter(note => note.durationMinutes != null);
  const totalMinutes = timedNotes.reduce((sum, note) => sum + (note.durationMinutes ?? 0), 0);
  const quantityOnlyCount = filteredNotes.length - timedNotes.length;
  const openCount = filteredNotes.filter(note => !note.invoiceId && !note.invoice?.id).length;
  const hasFilters = filters.project !== 'all' || Boolean(filters.from || filters.to) || filters.status !== 'all';
  const savedOutsideFilter = savedNoteId !== null && !filteredNotes.some(note => note.id === savedNoteId);
  const dataUnavailable = isLoading || Boolean(loadError);
  const actionsDisabled = Boolean(busy) || dataUnavailable;
  let parsedDuration: number | null = null;
  let durationError: string | null = null;
  if (mode === 'duration' && duration) {
    try {
      parsedDuration = parseManualDuration(duration);
    } catch {
      durationError = 'Dauer als HH:MM eingeben, z. B. 01:30 (1 Minute bis 1000:00).';
    }
  }

  const beginMutation = (action: string) => {
    if (mutationRef.current || (dataUnavailable && !(action === 'note' && captureRef.current))) return false;
    mutationRef.current = true;
    if (action === 'note') onPendingChange(true);
    setBusy(action);
    setMutationError(null);
    return true;
  };

  const endMutation = () => {
    mutationRef.current = false;
    if (activeRef.current) setBusy(null);
  };

  const handleAdd = async (event: FormEvent) => {
    event.preventDefault();
    if (!description.trim() || !serviceDate || !beginMutation('note')) return;
    try {
      const selectedProject = projectId ? projectsById.get(Number(projectId)) : null;
      if (!captureRef.current && projectId && (!selectedProject || selectedProject.archivedAt)) throw new Error('Bitte ein aktives Projekt auswählen oder ohne Projekt erfassen.');
      const amount = Number(quantity);
      if (mode === 'quantity' && (!Number.isFinite(amount) || amount <= 0)) throw new Error('Bitte eine Menge größer als 0 eingeben.');
      const minutes = mode === 'duration' ? parseManualDuration(duration) : null;
      const command = captureRef.current ?? {
        captureKey: crypto.randomUUID(), customerId,
        projectId: projectId ? Number(projectId) : null,
        serviceDate, description: description.trim(),
        ...(minutes === null ? { quantity: amount, unit } : { duration: formatManualDuration(minutes) }),
      };
      captureRef.current = command;
      const created = await requestJson<BillingNote>('/api/billing-notes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command),
      }, 'Leistungsnotiz konnte nicht gespeichert werden.');
      captureRef.current = null;
      if (!activeRef.current) return;
      setPendingCapture(false);
      setNotes(current => [{ ...created, project: created.project ?? selectedProject }, ...current.filter(note => note.id !== created.id)]);
      setSavedNoteId(created.id);
      setDescription('');
      setQuantity('1');
      setDuration('');
      focusDescriptionRef.current = true;
    } catch (error) {
      const knownRejection = error instanceof WorkbenchRequestError && error.status !== null && error.status >= 400 && error.status < 500;
      if (captureRef.current && (!knownRejection || pendingCapture)) {
        if (activeRef.current) setPendingCapture(true);
      } else captureRef.current = null;
      if (error instanceof WorkbenchRequestError && error.code === 'CAPTURE_REMOVED') {
        await loadData();
        captureRef.current = null;
        if (activeRef.current) setPendingCapture(false);
      }
      if (activeRef.current) setMutationError(error instanceof Error ? error.message : 'Leistungsnotiz konnte nicht gespeichert werden.');
    } finally {
      endMutation();
    }
  };

  const handleDelete = async (note: BillingNote) => {
    if (mutationRef.current || pendingCapture || !confirm(note.captureKey ? 'Leistung aus der Übersicht entfernen? Der Erfassungsnachweis bleibt erhalten.' : 'Diese offene Leistungsnotiz endgültig löschen?')) return;
    if (!beginMutation(`delete-${note.id}`)) return;
    try {
      await requestJson(`/api/billing-notes?id=${note.id}`, { method: 'DELETE' }, 'Leistungsnotiz konnte nicht gelöscht werden.');
      if (activeRef.current) setNotes(current => current.filter(item => item.id !== note.id));
    } catch (error) {
      if (activeRef.current) setMutationError(error instanceof Error ? error.message : 'Leistungsnotiz konnte nicht gelöscht werden.');
    } finally {
      endMutation();
    }
  };

  const handleCreateProject = async (event: FormEvent) => {
    event.preventDefault();
    if (!newProjectName.trim() || !beginMutation('project-create')) return;
    try {
      const created = await requestJson<ServiceProject>('/api/service-projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId, name: newProjectName.trim() }),
      }, 'Projekt konnte nicht angelegt werden.');
      if (!activeRef.current) return;
      setProjects(current => [...current, created]);
      setProjectId(String(created.id));
      setManagedProjectId(String(created.id));
      setManagedProjectName(created.name);
      setNewProjectName('');
    } catch (error) {
      if (activeRef.current) setMutationError(error instanceof Error ? error.message : 'Projekt konnte nicht angelegt werden.');
    } finally {
      endMutation();
    }
  };

  const handleUpdateProject = async (change: { name: string } | { archived: boolean }) => {
    if (!managedProject) return;
    if ('archived' in change && change.archived && !confirm('Projekt archivieren? Bisherige Leistungen und Rechnungszuordnungen bleiben erhalten. Neue Leistungen sind erst nach Reaktivierung möglich.')) return;
    if (!beginMutation('project-update')) return;
    try {
      const updated = await requestJson<ServiceProject>('/api/service-projects', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: managedProject.id, ...change }),
      }, 'Projekt konnte nicht geändert werden.');
      if (!activeRef.current) return;
      setProjects(current => current.map(project => project.id === updated.id ? updated : project));
      setManagedProjectName(updated.name);
      if (updated.archivedAt && projectId === String(updated.id)) setProjectId('');
    } catch (error) {
      if (activeRef.current) setMutationError(error instanceof Error ? error.message : 'Projekt konnte nicht geändert werden.');
    } finally {
      endMutation();
    }
  };

  return (
    <>
      {pendingCapture && <p role="status" className={styles.error}>Speicherstatus unklar. Dieselbe Leistung erneut prüfen; es wird keine zweite Notiz angelegt.</p>}
      {mutationError && <div role="alert" className={styles.error}>{mutationError} <span>Ihre Eingaben bleiben erhalten; bitte erneut versuchen.</span><Button type="button" variant="ghost" disabled={Boolean(busy) || isLoading} onClick={() => void loadData()}>Bestand aktualisieren</Button></div>}
      <div className={styles.layout}>
        <section className={styles.capture} aria-labelledby="service-capture-title">
          <div className={styles.sectionHeading}><span>01 / Erfassen</span><h2 id="service-capture-title">Neue Leistung</h2></div>
          <form onSubmit={handleAdd} className={styles.form}>
            <div className={styles.field}>
              <Label htmlFor="billing-note-description">Beschreibung</Label>
              <Input ref={descriptionRef} id="billing-note-description" value={description} onChange={event => setDescription(event.target.value)} placeholder="z. B. Wartung" maxLength={500} disabled={Boolean(busy) || pendingCapture} required />
            </div>
            <div className={styles.field}>
              <Label htmlFor="billing-note-project">Projekt</Label>
              <select id="billing-note-project" className={styles.select} value={projectId} onChange={event => setProjectId(event.target.value)} disabled={actionsDisabled || pendingCapture}>
                <option value="">Ohne Projekt</option>
                {activeProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </div>
            <div className={styles.field}>
              <Label htmlFor="billing-note-date">Leistungsdatum</Label>
              <Input id="billing-note-date" type="date" value={serviceDate} onChange={event => setServiceDate(event.target.value)} disabled={Boolean(busy) || pendingCapture} required />
            </div>
            <fieldset className={styles.mode}>
              <legend>Erfassung</legend>
              <div>
                <label><input type="radio" name="billing-note-mode" value="quantity" checked={mode === 'quantity'} onChange={() => setMode('quantity')} disabled={Boolean(busy) || pendingCapture} />Menge</label>
                <label><input type="radio" name="billing-note-mode" value="duration" checked={mode === 'duration'} onChange={() => setMode('duration')} disabled={Boolean(busy) || pendingCapture} />Manuelle Dauer</label>
              </div>
            </fieldset>
            {mode === 'quantity' ? <div className={styles.amountFields}>
              <div className={styles.field}>
                <Label htmlFor="billing-note-quantity">Menge</Label>
                <Input id="billing-note-quantity" type="number" min="0.000001" step="any" value={quantity} onChange={event => setQuantity(event.target.value)} disabled={Boolean(busy) || pendingCapture} required />
              </div>
              <div className={styles.field}>
                <Label htmlFor="billing-note-unit">Einheit</Label>
                <select id="billing-note-unit" className={styles.select} value={unit} onChange={event => setUnit(event.target.value)} disabled={Boolean(busy) || pendingCapture} required>
                  {BILLING_UNITS.map(option => <option key={option} value={option}>{option}</option>)}
                </select>
              </div>
            </div> : <div className={styles.field}>
              <Label htmlFor="billing-note-duration">Dauer (HH:MM)</Label>
              <Input id="billing-note-duration" type="text" inputMode="text" autoComplete="off" placeholder="01:30" value={duration} onChange={event => setDuration(event.target.value)} maxLength={7} aria-invalid={Boolean(durationError)} aria-describedby="billing-note-duration-help" disabled={Boolean(busy) || pendingCapture} required />
              <p id="billing-note-duration-help" className={durationError ? styles.fieldError : styles.hint}>
                {durationError || (parsedDuration !== null ? `${formatManualDuration(parsedDuration)} → ${quantityFormatter.format(durationToQuantity(parsedDuration))} Stunde` : 'Stunden und Minuten, keine Dezimalzahl. Beispiel: 01:30 → 1,5 Stunde.')}
              </p>
              <p className={styles.hint}>Stundenmenge auf 12 Nachkommastellen gerundet; Cent-Abweichungen möglich. Rechnung rundet je Position auf Cent.</p>
            </div>}
            <Button type="submit" className="w-full" disabled={Boolean(busy) || (!pendingCapture && (dataUnavailable || !description.trim() || (mode === 'duration' && parsedDuration === null)))} aria-label="Leistung speichern – Leistungsnotiz hinzufügen">
              {busy === 'note' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {busy === 'note' ? 'Wird gespeichert …' : pendingCapture ? 'Speicherung prüfen' : 'Leistung speichern'}
            </Button>
            <p className={styles.hint}>Keine Rechnung, kein Preis, keine Zahlung wird automatisch angelegt.</p>
          </form>

          <details className={styles.projectManager}>
            <summary>Projekte verwalten <span>{projects.length}</span></summary>
            <form onSubmit={handleCreateProject} className={styles.form}>
              <div className={styles.field}>
                <Label htmlFor="service-project-new">Neues Projekt</Label>
                <Input id="service-project-new" value={newProjectName} onChange={event => setNewProjectName(event.target.value)} maxLength={120} placeholder="z. B. Website-Relaunch" disabled={Boolean(busy)} required />
              </div>
              <Button type="submit" variant="outline" disabled={actionsDisabled || !newProjectName.trim()}>{busy === 'project-create' ? 'Wird angelegt …' : 'Projekt anlegen'}</Button>
            </form>
            {projects.length > 0 && <form onSubmit={event => { event.preventDefault(); void handleUpdateProject({ name: managedProjectName.trim() }); }} className={styles.projectEdit}>
              <div className={styles.field}>
                <Label htmlFor="service-project-manage">Bestehendes Projekt</Label>
                <select id="service-project-manage" className={styles.select} value={managedProjectId} disabled={Boolean(busy)} onChange={event => {
                  setManagedProjectId(event.target.value);
                  setManagedProjectName(projectsById.get(Number(event.target.value))?.name || '');
                }}>
                  <option value="">Projekt auswählen</option>
                  {projects.map(project => <option key={project.id} value={project.id}>{project.name}{project.archivedAt ? ' · archiviert' : ''}</option>)}
                </select>
              </div>
              {managedProject && <>
                <div className={styles.field}>
                  <Label htmlFor="service-project-name">Projektname</Label>
                  <Input id="service-project-name" value={managedProjectName} onChange={event => setManagedProjectName(event.target.value)} maxLength={120} disabled={Boolean(busy)} required />
                </div>
                <div className={styles.projectActions}>
                  <Button type="submit" variant="outline" disabled={actionsDisabled || !managedProjectName.trim() || managedProjectName.trim() === managedProject.name}>Umbenennen</Button>
                  <Button type="button" variant="ghost" disabled={actionsDisabled} onClick={() => void handleUpdateProject({ archived: !managedProject.archivedAt })}>
                    <Archive className="h-4 w-4" aria-hidden="true" />{managedProject.archivedAt ? 'Reaktivieren' : 'Archivieren'}
                  </Button>
                </div>
                <p className={styles.hint}>Archivierte Projekte bleiben im Verlauf erhalten und sind für neue Leistungen gesperrt.</p>
              </>}
            </form>}
          </details>
        </section>

        <section className={styles.history} aria-labelledby="service-history-title" aria-busy={isLoading}>
          <div className={styles.historyHeading}><div className={styles.sectionHeading}><span>02 / Prüfen</span><h2 id="service-history-title">Leistungsverlauf</h2></div><div className={styles.projectActions}><ServiceStatement customerId={customerId} notes={notes} projects={projects} filters={filters} disabled={actionsDisabled || pendingCapture} /><Button type="button" variant="ghost" disabled={Boolean(busy) || isLoading} onClick={() => void loadData()}>Aktualisieren</Button></div></div>
          <div className={styles.filters}>
            <div className={styles.field}>
              <Label htmlFor="service-filter-project">Projekt filtern</Label>
              <select id="service-filter-project" className={styles.select} value={filters.project} onChange={event => setFilters(current => ({ ...current, project: event.target.value }))}>
                <option value="all">Alle Projekte</option><option value="none">Ohne Projekt</option>
                {projects.map(project => <option key={project.id} value={project.id}>{project.name}{project.archivedAt ? ' · archiviert' : ''}</option>)}
              </select>
            </div>
            <div className={styles.field}>
              <Label htmlFor="service-filter-status">Status</Label>
              <select id="service-filter-status" className={styles.select} value={filters.status} onChange={event => setFilters(current => ({ ...current, status: event.target.value as Filters['status'] }))}>
                <option value="all">Alle Leistungen</option><option value="open">Offen</option><option value="linked">Rechnung zugeordnet</option>
              </select>
            </div>
            <div className={styles.field}><Label htmlFor="service-filter-from">Von</Label><Input id="service-filter-from" type="date" value={filters.from} onChange={event => setFilters(current => ({ ...current, from: event.target.value }))} /></div>
            <div className={styles.field}><Label htmlFor="service-filter-to">Bis</Label><Input id="service-filter-to" type="date" value={filters.to} min={filters.from || undefined} aria-invalid={dateFilterError} onChange={event => setFilters(current => ({ ...current, to: event.target.value }))} /></div>
          </div>
          {hasFilters && <Button type="button" variant="ghost" className={styles.resetFilters} onClick={() => setFilters(EMPTY_FILTERS)}>Filter zurücksetzen</Button>}
          {dateFilterError && <p role="alert" className={styles.fieldError}>Das Enddatum darf nicht vor dem Startdatum liegen.</p>}
          {isLoading ? <div role="status" className={styles.empty}><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /><p>Leistungen werden geladen …</p></div>
            : loadError ? <div role="alert" className={styles.empty}><p className="text-destructive">{loadError}</p><Button type="button" variant="outline" onClick={() => void loadData()}>Erneut laden</Button></div>
              : !dateFilterError && <>
                <dl className={styles.summary} aria-label="Summen der gefilterten Leistungen">
                  <div><dt>Bekannte Dauer</dt><dd>{formatManualDuration(totalMinutes)} <span>HH:MM</span></dd></div>
                  <div><dt>Ohne Zeitangabe</dt><dd>{quantityOnlyCount} <span>{quantityOnlyCount === 1 ? 'Notiz' : 'Notizen'}</span></dd></div>
                  <div><dt>Offene Leistungen</dt><dd>{openCount} <span>von {filteredNotes.length}</span></dd></div>
                </dl>
                <p className={styles.scope}>Für die aktuelle Auswahl. Mengen ohne manuelle Dauer zählen nicht als 0 Stunden.</p>
                {savedOutsideFilter && <p role="status" className={styles.hint}>Leistung gespeichert. Sie liegt außerhalb Ihrer aktuellen Filter.</p>}
                {filteredNotes.length === 0 ? <div className={styles.empty}><Clock3 className="h-6 w-6" aria-hidden="true" /><h3>{hasFilters ? 'Keine passenden Leistungen' : 'Noch keine Leistungen'}</h3><p>{hasFilters ? 'Passen Sie die Filter an.' : 'Erfassen Sie die erste Leistung für diesen Kunden.'}</p></div>
                  : <div className={styles.notes}>
                    {filteredNotes.map(note => {
                      const project = (note.projectId ? projectsById.get(note.projectId) : null) ?? note.project;
                      const invoiceId = note.invoiceId || note.invoice?.id;
                      return <article className={styles.note} key={note.id}>
                        <div className={styles.noteHeading}>
                          <h3>{note.description}</h3>
                          {!invoiceId && <Button type="button" variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => void handleDelete(note)} disabled={Boolean(busy) || pendingCapture} aria-label={`Leistungsnotiz ${note.description} löschen`}>
                            {busy === `delete-${note.id}` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
                          </Button>}
                        </div>
                        <p className={styles.noteMeta}><time dateTime={note.serviceDate.slice(0, 10)}>{new Date(`${note.serviceDate.slice(0, 10)}T12:00:00`).toLocaleDateString('de-DE')}</time><span>{project ? `${project.name}${project.archivedAt ? ' · archiviert' : ''}` : 'Ohne Projekt'}</span></p>
                        <div className={styles.noteFoot}>
                          <p className={styles.noteAmount}>{note.durationMinutes != null
                            ? <><Clock3 className="h-4 w-4" aria-hidden="true" /><strong>{formatManualDuration(note.durationMinutes)}</strong><span>→ {quantityFormatter.format(note.quantity)} {note.unit}</span></>
                            : <><strong>{quantityFormatter.format(note.quantity)} {note.unit}</strong><span>· Dauer nicht erfasst</span></>}
                          </p>
                          {invoiceId ? <div className={styles.linked}>
                            <span className={styles.badge}><Check className="h-3.5 w-3.5" aria-hidden="true" />Rechnung zugeordnet</span>
                            <a href={`/api/invoices/download?id=${invoiceId}`} className={styles.invoiceLink}><Download className="h-3.5 w-3.5" aria-hidden="true" />{note.invoice?.invoiceNumber ? `Rechnung ${note.invoice.invoiceNumber}` : 'Rechnung öffnen'}</a>
                          </div> : <span className={styles.openStatus}>Offen</span>}
                        </div>
                      </article>;
                    })}
                  </div>}
              </>}
          <div className={styles.nextStep}><span>03 / Abrechnen</span><Link href="/dashboard/invoices/new">Im Rechnungseditor auswählen →</Link><p>Kunden dort auswählen; Preise und Steuern prüfen.</p></div>
        </section>
      </div>
    </>
  );
}
