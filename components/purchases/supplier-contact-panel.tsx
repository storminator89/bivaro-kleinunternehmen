'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SupplierDto, SupplierList } from '@/lib/suppliers';
import type { IncomingDocument, IncomingDocumentResponse } from '@/lib/purchase-documents/types';
import { errorMessage, incomingJson, IncomingRequestError } from './incoming-document-ui';

const fields = [
  ['name', 'Name', 255], ['address', 'Straße / Anschrift', 1000], ['postalCode', 'Postleitzahl', 30],
  ['city', 'Ort', 255], ['country', 'Land', 100], ['email', 'E-Mail', 255], ['phone', 'Telefon', 100],
  ['taxId', 'Steuernummer', 100], ['vatId', 'USt-IdNr.', 100],
] as const;
type Draft = Record<typeof fields[number][0], string>;
const emptyDraft = (): Draft => Object.fromEntries(fields.map(([key]) => [key, ''])) as Draft;

export function SupplierContactPanel({ document, onSelected, onBack }: { document: IncomingDocument; onSelected: (document: IncomingDocument) => void; onBack: () => void }) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<SupplierList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<SupplierDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<SupplierDto | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { if (editing) nameInput.current?.focus(); }, [editing]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    const params = new URLSearchParams({ search: query, page: String(page), limit: '10' });
    incomingJson<SupplierList>(`/api/suppliers?${params}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(error => { if (!controller.signal.aborted) setError(errorMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, page, refresh]);
  function edit(supplier: SupplierDto | 'new') {
    setEditing(supplier); setError(null); setNotice(null);
    setDraft(supplier === 'new' ? emptyDraft() : Object.fromEntries(fields.map(([key]) => [key, supplier[key] ?? ''])) as Draft);
  }
  async function save() {
    if (!editing || lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      const result = await incomingJson<{ supplier: SupplierDto }>(editing === 'new' ? '/api/suppliers' : `/api/suppliers/${editing.id}`, { method: editing === 'new' ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...draft, ...(editing !== 'new' ? { expectedRevision: editing.revision } : {}) }) });
      setLastSaved(result.supplier);
      setNotice(`Kontakt „${result.supplier.name}“ gespeichert. Zum Beleg wird er erst mit „Für diesen Beleg auswählen“ zugeordnet. Bestehende Originale und gespeicherte Zuordnungs-Snapshots bleiben unverändert.`);
      setData(current => current ? { ...current, items: [result.supplier, ...current.items.filter(item => item.id !== result.supplier.id)] } : { items: [result.supplier], total: 1, page: 1, limit: 10 });
      setEditing(null); heading.current?.focus();
      setRefresh(value => value + 1);
      // The saved contact stays visible even when a subsequent refresh fails.
    } catch (error) {
      const ambiguousCreate = editing === 'new' && (!(error instanceof IncomingRequestError) || error.status === 0 || error.status >= 500);
      if (ambiguousCreate) {
        setNotice('Die Speicherantwort ist unklar; der Kontakt könnte schon angelegt sein. Bitte zuerst die Kontaktliste prüfen, nicht denselben Kontakt erneut anlegen. Eine Belegzuordnung wurde nicht gestartet.');
        setQuery(draft.name.trim()); setSearch(draft.name.trim()); setPage(1); setEditing(null); setRefresh(value => value + 1); heading.current?.focus();
      } else setError(errorMessage(error));
    }
    finally { lock.current = false; setBusy(false); }
  }
  async function select(supplier: SupplierDto) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      const result = await incomingJson<IncomingDocumentResponse>(`/api/purchase-documents/${document.id}/supplier`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: document.revision, supplierId: supplier.id }) });
      onSelected(result.document);
    } catch (error) { setError(errorMessage(error)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="space-y-4" aria-labelledby="supplier-contact-heading">
    <div><h3 id="supplier-contact-heading" ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">Lieferantenkontakt auswählen</h3><p className="mt-2 text-sm text-muted-foreground">Kontakte sind Stammdaten, keine geprüfte Identität. Es gibt keinen automatischen Abgleich. Original-Lieferant und Empfänger bleiben unverändert; die Auswahl speichert einen getrennten Kontakt-Snapshot am Beleg.</p></div>
    {notice && <p role="status" className="border-l-2 border-primary pl-3 text-sm">{notice}</p>}
    {error && <div ref={errorRef} tabIndex={-1} role="alert" className="space-y-2 rounded-md bg-critical-surface p-3 text-sm text-critical-foreground outline-none"><p>{error}</p><Button variant="outline" disabled={busy} onClick={() => setRefresh(value => value + 1)}>Kontaktliste neu laden</Button></div>}
    {lastSaved && !editing && (loading || error || !data?.items.some(item => item.id === lastSaved.id)) && <div className="space-y-2 border-y border-border py-4"><p className="text-xs text-muted-foreground">Bereits gespeicherter Kontakt · nicht erneut anlegen</p><p className="break-words font-medium">{lastSaved.name}</p><Button variant="outline" disabled={busy} onClick={() => void select(lastSaved)}>Für diesen Beleg auswählen</Button></div>}
    {editing ? <form className="space-y-4" onSubmit={event => { event.preventDefault(); void save(); }}>
      <h4 className="font-medium">{editing === 'new' ? 'Neuen Kontakt anlegen' : `Kontakt #${editing.id} bearbeiten`}</h4>
      {editing === 'new' && document.supplierCandidate && <Button type="button" variant="outline" disabled={busy} className="h-auto min-h-11 whitespace-normal text-left" onClick={() => { const source = document.supplierCandidate!; setDraft({ ...emptyDraft(), name: source.name ?? '', address: source.address?.replace(/[\r\n]+/g, ', ') ?? '', postalCode: source.zipCode ?? '', city: source.city ?? '', country: source.country ?? '', email: source.email ?? '' }); }}>Lieferantenangaben aus Original als Entwurf übernehmen</Button>}
      <div className="grid gap-4 sm:grid-cols-2">{fields.map(([key, label, max]) => <div key={key} className={key === 'name' || key === 'address' ? 'space-y-2 sm:col-span-2' : 'space-y-2'}><Label htmlFor={`supplier-${key}`}>{label}{key === 'name' ? ' *' : ' (optional)'}</Label><Input ref={key === 'name' ? nameInput : undefined} id={`supplier-${key}`} type={key === 'email' ? 'email' : 'text'} value={draft[key]} maxLength={max} required={key === 'name'} disabled={busy} onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))} /></div>)}</div>
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}Kontakt speichern</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => { setEditing(null); heading.current?.focus(); }}>Bearbeiten abbrechen</Button></div>
    </form> : <>
      <form role="search" aria-label="Lieferantenkontakte suchen" className="space-y-2" onSubmit={event => { event.preventDefault(); setQuery(search.trim()); setPage(1); setRefresh(value => value + 1); }}><Label htmlFor="supplier-search">Name, Ort oder USt-IdNr.</Label><div className="flex gap-2"><Input id="supplier-search" type="search" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} /><Button type="submit" variant="outline" disabled={busy} aria-label="Kontakte suchen"><Search className="size-4" aria-hidden="true" /></Button></div></form>
      <Button variant="outline" disabled={busy} onClick={() => edit('new')}><Plus className="size-4" aria-hidden="true" />Kontakt neu anlegen</Button>
      {loading ? <p role="status" className="py-4 text-sm text-muted-foreground">Kontakte werden geladen…</p> : !error && data && <>
        <p className="text-xs text-muted-foreground">{data.total} Kontakte · Seite {page}</p>
        {data.items.length ? <ul className="divide-y divide-border">{data.items.map(supplier => <li key={supplier.id} className="space-y-2 py-4"><div className="break-words"><p className="font-medium">{supplier.name}</p><p className="text-sm text-muted-foreground">{[supplier.address, supplier.postalCode, supplier.city, supplier.country].filter(Boolean).join(' · ') || 'Keine Anschrift hinterlegt'}</p>{supplier.vatId && <p className="text-xs text-muted-foreground">USt-IdNr. {supplier.vatId}</p>}</div><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} className="h-auto min-h-11 whitespace-normal" onClick={() => void select(supplier)}>Für diesen Beleg auswählen</Button><Button variant="ghost" disabled={busy} onClick={() => edit(supplier)}>Bearbeiten</Button></div></li>)}</ul> : <p className="py-4 text-sm text-muted-foreground">Keine passenden Kontakte. Suche ändern oder einen Kontakt ausdrücklich neu anlegen.</p>}
        {(data.total > 10 || page > 1) && <nav aria-label="Kontaktseiten" className="flex items-center justify-between gap-3"><Button variant="outline" size="icon" aria-label="Vorherige Kontaktseite" disabled={busy || page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft className="size-4" /></Button><Button variant="outline" size="icon" aria-label="Nächste Kontaktseite" disabled={busy || page * 10 >= data.total} onClick={() => setPage(value => value + 1)}><ChevronRight className="size-4" /></Button></nav>}
      </>}
    </>}
    <Button variant="ghost" disabled={busy} onClick={onBack}>Zurück zum Original</Button>
  </section>;
}
