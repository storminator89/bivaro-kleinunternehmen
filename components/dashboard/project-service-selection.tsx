"use client";

import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { calculateInvoiceAmounts } from "@/lib/invoice-calculation";
import { formatManualDuration, summarizeServiceDuration } from "@/lib/service-duration";
import type { DocumentTaxMode } from "@/lib/document-tax-profile";

export interface ProjectServiceNote {
  id: number;
  customerId: number;
  serviceDate: string;
  description: string;
  quantity: number;
  unit: string;
  projectId: number | null;
  durationMinutes: number | null;
  project: { id: number; name: string; archivedAt: string | null } | null;
}

export interface SelectedProjectService {
  id: number;
  source: ProjectServiceNote | null;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  taxRate: number;
  taxCategory?: "S" | "E" | "Z";
}

interface ProjectServiceSelectionProps {
  customerName: string;
  notes: ProjectServiceNote[];
  selected: SelectedProjectService[];
  loading: boolean;
  error: string | null;
  taxMode: DocumentTaxMode | "";
  taxReady: boolean;
  onToggle: (note: ProjectServiceNote, checked: boolean) => void;
  onRetry: () => void;
}

const formatQuantity = (value: number) => value.toLocaleString("de-DE", { maximumFractionDigits: 12 });
const formatPrice = (value: number) => value.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
function formatLineNet(item: SelectedProjectService): string {
  try { return formatPrice(calculateInvoiceAmounts([item]).lines[0].netAmount); }
  catch { return "Betrag prüfen"; }
}
const formatDate = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("de-DE");
const projectName = (note: ProjectServiceNote) => note.project
  ? `${note.project.name}${note.project.archivedAt ? " (archiviert)" : ""}`
  : "Ohne Projekt";

function SourceQuantity({ note }: { note: ProjectServiceNote }) {
  return <>{note.durationMinutes != null ? `${formatManualDuration(note.durationMinutes)} → ` : "Ohne Zeitangabe · "}{formatQuantity(note.quantity)} {note.unit}</>;
}

export function ProjectServiceSelection({ customerName, notes, selected, loading, error, taxMode, taxReady, onToggle, onRetry }: ProjectServiceSelectionProps) {
  const [projectFilter, setProjectFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const selectedIds = new Set(selected.map(item => item.id));
  // Keep selected source snapshots in the options even after a safe reload.
  const projects = new Map<number, NonNullable<ProjectServiceNote["project"]>>();
  [...notes, ...selected.flatMap(item => item.source ? [item.source] : [])].forEach(note => {
    if (note.project) projects.set(note.project.id, note.project);
  });
  const invalidRange = Boolean(fromDate && toDate && fromDate > toDate);
  const filtered = notes.filter(note => {
    const day = note.serviceDate.slice(0, 10);
    const matchesProject = projectFilter === "all"
      || (projectFilter === "none" ? note.projectId == null : String(note.projectId) === projectFilter);
    return matchesProject && !invalidRange && (!fromDate || day >= fromDate) && (!toDate || day <= toDate);
  });
  const visibleIds = new Set(filtered.map(note => note.id));
  const hiddenSelectedCount = selected.filter(item => !visibleIds.has(item.id)).length;
  const duration = summarizeServiceDuration(selected.map(item => ({ durationMinutes: item.source?.durationMinutes ?? null })));
  const zeroPriceCount = selected.filter(item => item.unitPrice === 0).length;
  const hasFilters = projectFilter !== "all" || Boolean(fromDate || toDate);

  return (
    <section className="min-w-0 space-y-4 rounded-lg border border-primary/20 bg-primary/5 p-3 sm:p-4" aria-labelledby="billing-notes-title">
      <header className="space-y-1">
        <h2 id="billing-notes-title" className="text-sm font-semibold">Leistungsnotizen übernehmen</h2>
        <p className="break-words text-sm">Kunde: <strong>{customerName}</strong></p>
        <p className="text-xs leading-relaxed text-muted-foreground">Quelle: offene Leistungsnotizen. Auswahl ergänzt nur Positionen, erstellt keine Rechnung. Startpreis: 0,00 € netto; Preise und Steuer legen Sie fest.</p>
      </header>

      {(notes.length > 0 || selected.length > 0) && <div className="space-y-2">
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <div className="min-w-0 space-y-1 sm:col-span-2">
            <Label htmlFor="invoice-service-project">Projekt</Label>
            <select id="invoice-service-project" value={projectFilter} onChange={event => setProjectFilter(event.target.value)} className="flex min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm outline-2 outline-transparent focus-visible:outline-ring">
              <option value="all">Alle Projekte</option>
              <option value="none">Ohne Projekt</option>
              {[...projects.values()].sort((a, b) => a.name.localeCompare(b.name, "de")).map(project => <option key={project.id} value={project.id}>{project.name}{project.archivedAt ? " (archiviert)" : ""}</option>)}
            </select>
          </div>
          <div className="min-w-0 space-y-1"><Label htmlFor="invoice-service-from">Leistung ab</Label><Input id="invoice-service-from" type="date" value={fromDate} max={toDate || undefined} onChange={event => setFromDate(event.target.value)} aria-invalid={invalidRange} aria-describedby={invalidRange ? "invoice-service-range-error" : undefined} /></div>
          <div className="min-w-0 space-y-1"><Label htmlFor="invoice-service-to">Leistung bis</Label><Input id="invoice-service-to" type="date" value={toDate} min={fromDate || undefined} onChange={event => setToDate(event.target.value)} aria-invalid={invalidRange} aria-describedby={invalidRange ? "invoice-service-range-error" : undefined} /></div>
        </div>
        {invalidRange && <p id="invoice-service-range-error" role="alert" className="text-sm text-destructive">Das Enddatum muss am oder nach dem Startdatum liegen.</p>}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <p>Filter ändern die Auswahl nicht.</p>
          {hasFilters && <Button type="button" variant="ghost" size="sm" onClick={() => { setProjectFilter("all"); setFromDate(""); setToDate(""); }}>Filter zurücksetzen</Button>}
        </div>
      </div>}

      {loading ? <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Leistungsnotizen werden geladen …</p>
        : error ? <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{error} Ihre Auswahl bleibt erhalten.</p><Button type="button" variant="outline" size="sm" onClick={onRetry}><RefreshCw className="h-4 w-4" aria-hidden="true" /> Erneut laden</Button></div>
          : notes.length === 0 ? <p className="text-sm text-muted-foreground">Keine offenen Leistungsnotizen vorhanden.</p>
            : <div className="space-y-2">
              <p className="text-xs text-muted-foreground" role="status">{filtered.length} von {notes.length} Leistungen sichtbar</p>
              {filtered.length === 0 && <p className="text-sm text-muted-foreground">Keine Leistungen für diesen Filter. Ihre Auswahl bleibt erhalten.</p>}
              <div className="max-h-80 space-y-2 overflow-y-auto p-1">
                {filtered.map(note => <label key={note.id} className="flex min-h-11 min-w-0 cursor-pointer items-start gap-3 rounded-md border bg-background p-3 text-sm hover:bg-muted/50 has-[:checked]:border-primary/50">
                  <input type="checkbox" checked={selectedIds.has(note.id)} onChange={event => onToggle(note, event.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" aria-label={`Leistungsnotiz ${note.description} übernehmen`} />
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="block break-words font-medium">{note.description}</span>
                    <span className="block break-words text-xs text-muted-foreground">{projectName(note)} · {formatDate(note.serviceDate)}</span>
                    <span className="block break-words text-xs tabular-nums"><SourceQuantity note={note} /></span>
                  </span>
                </label>)}
              </div>
            </div>}

      {selected.length > 0 && <section className="min-w-0 space-y-3 rounded-md border bg-background p-3" aria-labelledby="invoice-service-selection-title">
        <div className="space-y-1" aria-live="polite">
          <h3 id="invoice-service-selection-title" className="text-sm font-semibold">{selected.length} {selected.length === 1 ? "Leistung ausgewählt" : "Leistungen ausgewählt"}</h3>
          <p className="text-sm tabular-nums">Manuelle Quelldauer: <strong>{formatManualDuration(duration.durationMinutes)} Std.</strong> · {duration.quantityOnlyCount} ohne Zeitangabe</p>
          {hiddenSelectedCount > 0 && <p className="text-xs text-muted-foreground">{hiddenSelectedCount} davon nicht in der aktuellen Liste sichtbar; unten vollständig enthalten.</p>}
        </div>
        {zeroPriceCount > 0 && <p className="rounded-md border border-amber-300/70 bg-amber-50 p-2 text-sm font-medium text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100" role="status">{zeroPriceCount} {zeroPriceCount === 1 ? "Position hat" : "Positionen haben"} noch 0,00 € Einzelpreis. Vor Erstellung bewusst festlegen.</p>}
        <p className="text-xs text-muted-foreground">Steuer: {taxMode === "small-business" ? "§ 19" : taxMode === "standard" ? "je Position" : "noch offen"}{taxReady ? " · Dokumentauswahl festgelegt; Positionen prüfen" : " · noch prüfen"}. Stundenmenge auf 12 Nachkommastellen gerundet; Cent-Abweichungen möglich. Rechnung rundet je Position auf Cent.</p>
        <ul className="divide-y">
          {selected.map(item => <li key={item.id} className="min-w-0 space-y-1 py-2 text-xs first:pt-0">
            <p className="break-words text-sm font-medium">{item.description}</p>
            <p className="break-words text-muted-foreground">Quelle: Notiz #{item.id}{item.source && <> · {projectName(item.source)} · {formatDate(item.source.serviceDate)} · <SourceQuantity note={item.source} /></>}</p>
            {item.source && item.description !== item.source.description && <p className="break-words text-muted-foreground">Originalbeschreibung: {item.source.description}</p>}
            <p className="break-words tabular-nums">Aktuelle Position: {formatQuantity(item.quantity)} {item.unit} · {formatPrice(item.unitPrice)} netto / Einheit · {formatLineNet(item)} Positionsnetto · {taxMode === "small-business" ? "§ 19, keine USt." : item.taxCategory === "E" ? "steuerbefreit" : item.taxCategory === "Z" ? "Nullsteuersatz" : `${formatQuantity(item.taxRate)} % USt.`}</p>
            {item.source && (item.description !== item.source.description || item.quantity !== item.source.quantity || item.unit !== item.source.unit) && <p className="text-amber-800 dark:text-amber-200">Position weicht von der Quelle ab. Für die Zuordnung müssen Beschreibung, Menge und Einheit zur Originalnotiz passen.</p>}
          </li>)}
        </ul>
        <a href="#invoice-positions-title" className="inline-flex min-h-11 items-center rounded-sm text-sm font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">Preise und Steuer prüfen</a>
      </section>}
    </section>
  );
}
