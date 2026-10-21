'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { HandoffPreview } from './handoff-model';
import styles from './handoff.module.css';

export function HandoffAcknowledgement({ preview, downloadStarted }: { preview: HandoffPreview; downloadStarted: boolean }) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const gate = useRef(false);
  const readRequest = useRef<AbortController | null>(null);
  const m = preview.manifest;
  const identity = { from: m.period.from, to: m.period.to, sourceFingerprint: m.sourceFingerprint, formatVersion: m.formatVersion };
  const query = new URLSearchParams({ ...identity, formatVersion: String(identity.formatVersion) });
  const endpoint = `/api/handoff-acknowledgement?${query}`;
  useEffect(() => {
    const controller = new AbortController();
    readRequest.current = controller;
    setLoaded(false); setSavedAt(null); setError(''); setChecked(false);
    fetch(endpoint, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error();
      const body = await response.json();
      if (body.acknowledgedAt !== null && (typeof body.acknowledgedAt !== 'string' || !Number.isFinite(Date.parse(body.acknowledgedAt)))) throw new Error();
      if (!controller.signal.aborted) { setSavedAt(body.acknowledgedAt); setLoaded(true); }
    }).catch(() => { if (!controller.signal.aborted) setError('Eine gespeicherte Empfangsnotiz konnte nicht geladen werden. Bitte die Vorschau erneut laden.'); });
    return () => controller.abort();
  }, [endpoint]);

  async function save() {
    if (!checked || !downloadStarted || gate.current) return;
    gate.current = true; readRequest.current?.abort(); setBusy(true); setError('');
    try {
      const response = await fetch('/api/handoff-acknowledgement', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...identity, selfRecorded: true }) });
      if (!response.ok) throw new Error();
      const body = await response.json();
      if (typeof body.acknowledgedAt !== 'string' || !Number.isFinite(Date.parse(body.acknowledgedAt))) throw new Error();
      setSavedAt(body.acknowledgedAt); setLoaded(true); setChecked(false);
    } catch { setError('Empfangsnotiz nicht als gespeichert bestätigt. Prüfen Sie nach erneutem Laden den Stand, bevor Sie es erneut versuchen.'); }
    finally { gate.current = false; setBusy(false); }
  }
  return <details className={styles.manualNote} open={downloadStarted}>
    <summary id="handoff-receipt-title">Empfang notieren (optional)</summary>

    <p>Download ist kein Empfangsnachweis. Zustellung und Annahme selbst prüfen.</p>
    {savedAt ? <p aria-live="polite"><strong>Von Ihnen manuell als empfangen notiert:</strong> {new Date(savedAt).toLocaleString('de-DE', { timeZone: 'UTC' })} UTC. Keine Bestätigung durch eine Kanzlei.</p> : loaded ? <p>Keine Empfangsnotiz für diesen Paketstand vorhanden; Übergabe unbekannt.</p> : !error && <p aria-live="polite">Empfangsnotiz wird geladen…</p>}
    <div className={styles.approval}><label><input type="checkbox" checked={checked} disabled={!downloadStarted || busy} onChange={event => setChecked(event.target.checked)} /><span>Ich habe den Empfang außerhalb von Bivaro geprüft und notiere ihn selbst.</span></label><Button type="button" variant="outline" disabled={!downloadStarted || !checked || busy} onClick={save}>{busy ? 'Notiz wird gespeichert' : 'Manuelle Empfangsnotiz speichern'}</Button></div>
    {!downloadStarted && <p className={styles.muted}>Nach dem ZIP-Download verfügbar. Ein Download allein speichert keine Empfangsnotiz.</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <p className={styles.muted}>Notiz nur im App-Protokoll, begrenzt aufbewahrt. Nicht im ZIP oder Backup. Empfangsnachweis separat sichern.</p>
  </details>;
}
