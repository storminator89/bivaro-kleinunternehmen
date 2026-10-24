'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BankImportError } from '@/lib/bank-import-contract';
import { createBankMappingProfileConfiguration, type BankMappingProfile, type BankMappingProfileSummary } from '@/lib/bank-mapping-profile-contract';
import { loadBankMappingProfile, loadBankMappingProfiles, mutateBankMappingProfile } from '@/lib/bank-mapping-profile-client';
import type { BankCsvMapping, BankCsvParsed } from '@/lib/bank-csv';
import styles from './bank-workspace.module.css';

const selectClass = 'min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring';
type Operation = { method: 'POST' | 'DELETE'; payload: unknown };

export function BankMappingProfiles({ mapping, parsed, hasSource, disabled, onApply, onPending, onDetach }: {
  mapping: BankCsvMapping; parsed: BankCsvParsed | null; hasSource: boolean; disabled: boolean;
  onApply: (profile: BankMappingProfile) => Promise<boolean>; onPending: (pending: boolean) => void; onDetach: () => void;
}) {
  const [profiles, setProfiles] = useState<BankMappingProfileSummary[]>([]), [selected, setSelected] = useState(''), [revision, setRevision] = useState(1);
  const [loaded, setLoaded] = useState<BankMappingProfile | null>(null), [name, setName] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(''), [uncertain, setUncertain] = useState(false);
  const [confirmedSignature, setConfirmedSignature] = useState(''), [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const controller = useRef<AbortController | null>(null), alive = useRef(true), pending = useRef<Operation | null>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  const configurationSignature = JSON.stringify({ mapping, headers: parsed?.headers, delimiter: parsed?.delimiter });
  const confirmed = confirmedSignature === configurationSignature;
  const preparing = useRef(false);
  const selectedSummary = profiles.find(item => item.id === selected);
  const locked = busy || uncertain || disabled;
  async function list() {
    if (controller.current || uncertain) return;
    const request = new AbortController(); controller.current = request; setBusy(true); setError('');
    try { const items = await loadBankMappingProfiles(request.signal); if (alive.current) { setProfiles(items); setMessage(items.length ? 'Profil auswählen und ausdrücklich laden.' : 'Noch keine gespeicherten Profile.'); } }
    catch (failure) { if (alive.current && !request.signal.aborted) setError(failure instanceof Error ? failure.message : 'Profile konnten nicht geladen werden.'); }
    finally { if (alive.current) setBusy(false); controller.current = null; }
  }
  async function load() {
    if (locked || !selected || !hasSource || controller.current) return;
    const request = new AbortController(); controller.current = request; setBusy(true); setError(''); setMessage(''); onPending(true);
    try {
      const item = await loadBankMappingProfile(selected, revision, request.signal);
      if (!alive.current) return;
      const matches = await onApply(item);
      if (!alive.current) return;
      setLoaded(item); setName(item.configuration.name); setConfirmedSignature(''); setDeleteConfirmed(false);
      setMessage(matches ? `Revision ${item.revision} geladen. Vorzeichen, Soll/Haben und neue Vorschau vor jedem Import prüfen.` : 'Headerlayout passt nicht. Alle Spaltenrollen und die EUR-Bestätigung wurden entfernt. Bitte manuell neu zuordnen und Vorschau prüfen.');
    } catch (failure) { if (alive.current && !request.signal.aborted) { onDetach(); setError(failure instanceof Error ? failure.message : 'Profil konnte nicht geladen werden. Die Datei bleibt erhalten.'); } }
    finally { if (alive.current) { setBusy(false); onPending(false); } controller.current = null; }
  }
  async function submit(operation: Operation) {
    if (controller.current) return;
    const owner = document.activeElement;
    const request = new AbortController(); controller.current = request; pending.current = operation; setBusy(true); setError(''); onPending(true);
    let unknown = false;
    try {
      const item = await mutateBankMappingProfile(operation.method, operation.payload, request.signal);
      if (!alive.current) return;
      pending.current = null; setUncertain(false); setConfirmedSignature(''); setDeleteConfirmed(false);
      if (item) { await onApply(item); if (!alive.current) return; setLoaded(item); setSelected(item.id); setRevision(item.revision); setName(item.configuration.name); setProfiles(items => [{ id: item.id, revision: item.latestRevision, name: item.configuration.name, accountAlias: item.configuration.mapping.accountAlias }, ...items.filter(value => value.id !== item.id)]); setMessage(`Profil als unveränderliche Revision ${item.revision} gespeichert. Bankumsätze wurden nicht gespeichert.`); }
      else { onDetach(); const id = (operation.payload as { id: string }).id; setProfiles(items => items.filter(value => value.id !== id)); setLoaded(null); setSelected(''); setMessage('Profil gelöscht. Historische Revisionen und Importquittungen bleiben unverändert. Aktuelle Datei und Zuordnung bleiben erhalten.'); requestAnimationFrame(() => { if (alive.current && (document.activeElement === owner || document.activeElement === document.body)) refreshButton.current?.focus(); }); }
    } catch (failure) {
      if (!alive.current) return;
      unknown = !(failure instanceof BankImportError && failure.status < 500);
      setUncertain(unknown);
      if (!unknown) pending.current = null;
      setError(unknown ? 'Ergebnis unklar. Nur dieselbe Aktion erneut prüfen; die Aktionskennung bleibt unverändert. Nach Reload zuerst die Profilliste prüfen.' : failure instanceof Error ? failure.message : 'Profilaktion fehlgeschlagen.');
    } finally { if (alive.current) { setBusy(false); onPending(unknown); } controller.current = null; }
  }
  async function save(update: boolean) {
    if (preparing.current || locked || !parsed || !confirmed || (update && (!loaded || loaded.id !== selected))) return;
    preparing.current = true; setBusy(true); onPending(true); setError('');
    try {
      const configuration = await createBankMappingProfileConfiguration(name, mapping, parsed);
      if (!alive.current) return;
      await submit({ method: 'POST', payload: { id: update ? loaded!.id : crypto.randomUUID(), mutationId: crypto.randomUUID(), expectedRevision: update ? loaded!.latestRevision : 0, configuration } });
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Zuordnung nicht vollständig.'); }
    finally { preparing.current = false; if (alive.current && !pending.current) { setBusy(false); onPending(false); } }
  }
  return <details className={styles.profiles}>
    <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Zuordnungsprofile · nur Einstellungen merken</summary>
    <div className={`${styles.profileContent} space-y-4`}>
      <p className="text-xs text-muted-foreground">Keine Bankzeilen, Referenzen oder Dateiinhalte im Profil. Laden und Speichern nur nach Klick; der Import bleibt eine separate Bestätigung.</p>
      <div className="flex flex-wrap gap-2"><Button ref={refreshButton} type="button" variant="outline" size="sm" disabled={locked} onClick={() => void list()}>Profilliste laden</Button></div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]"><div className="min-w-0 space-y-2"><Label htmlFor="bank-profile">Gespeichertes Profil</Label><select id="bank-profile" className={selectClass} value={selected} disabled={locked} onChange={event => { const item = profiles.find(value => value.id === event.target.value); setSelected(event.target.value); setRevision(item?.revision ?? 1); setLoaded(null); setDeleteConfirmed(false); setMessage(''); }}><option value="">Profil auswählen</option>{profiles.map(item => <option key={item.id} value={item.id}>{item.name} · {item.accountAlias}</option>)}</select></div><div className="space-y-2"><Label htmlFor="bank-profile-revision">Revision</Label><select id="bank-profile-revision" className={selectClass} value={revision} disabled={locked || !selectedSummary} onChange={event => { setRevision(Number(event.target.value)); setLoaded(null); setDeleteConfirmed(false); }}>{Array.from({ length: selectedSummary?.revision ?? 1 }, (_, index) => index + 1).reverse().map(value => <option key={value} value={value}>{value}</option>)}</select></div></div>
      <Button type="button" variant="outline" disabled={locked || !selected || !hasSource} onClick={() => void load()}>Profil ausdrücklich laden</Button>
      <div className="space-y-2 border-t pt-3"><Label htmlFor="bank-profile-name">Profilname</Label><Input id="bank-profile-name" value={name} maxLength={80} disabled={locked} placeholder="z. B. Geschäftskonto CSV" onChange={event => setName(event.target.value)} /></div>
      <label className={styles.confirmation}><input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-primary" checked={confirmed} disabled={locked || !parsed} onChange={event => setConfirmedSignature(event.target.checked ? configurationSignature : '')} /><span>Die Datei hat benannte, eindeutige Überschriften. Kontoalias, Spalten, Vorzeichen (auch Soll/Haben), Dezimalzeichen und Währung habe ich geprüft.</span></label>
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={locked || !parsed || !confirmed || !name.trim()} onClick={() => void save(false)}>Diese Zuordnung merken</Button><Button type="button" variant="outline" disabled={locked || !parsed || !confirmed || !name.trim() || !loaded || loaded.id !== selected} onClick={() => void save(true)}>Als neue Revision aktualisieren</Button></div>
      {loaded && <div className="space-y-2 border-t pt-3"><label className={styles.confirmation}><input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-primary" checked={deleteConfirmed} disabled={locked} onChange={event => setDeleteConfirmed(event.target.checked)} /><span>Dieses Profil löschen; historische Quittungen nicht verändern.</span></label><Button type="button" variant="outline" disabled={locked || !deleteConfirmed || loaded.id !== selected} onClick={() => void submit({ method: 'DELETE', payload: { id: loaded.id, mutationId: crypto.randomUUID(), expectedRevision: loaded.latestRevision } })}>Profil löschen</Button></div>}
      {message && <p role="status" className="text-sm">{message}</p>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {uncertain && <Button type="button" variant="outline" disabled={busy} onClick={() => pending.current && void submit(pending.current)}>Dieselbe Profilaktion erneut prüfen</Button>}
      {busy && <p role="status" className="text-xs text-muted-foreground">Profilaktion wird geprüft…</p>}
    </div>
  </details>;
}
