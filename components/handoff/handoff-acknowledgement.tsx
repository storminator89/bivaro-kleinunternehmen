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
  return <section className={styles.manualNote} aria-labelledby="handoff-receipt-title">
    <h3 id="handoff-receipt-title">Nach dem Download: sichere Übergabe selbst prüfen</h3>
    <ol><li>ZIP öffnen und README.txt, manifest.json sowie enthaltene Originale prüfen.</li><li>Mit Ihrer Kanzlei einen sicheren Kanal und das nutzbare Format abstimmen. Kein Passwort teilen.</li><li>Paket selbst übergeben und Empfang außerhalb von Bivaro klären. Erst dann optional eine eigene Notiz speichern.</li></ol>
    <p>Bivaro versendet nichts und kann weder Zustellung, Empfang noch fachliche Annahme prüfen. Ein gestarteter Download ist kein Empfangsnachweis.</p>
    {savedAt ? <p aria-live="polite"><strong>Von Ihnen manuell als empfangen notiert:</strong> {new Date(savedAt).toLocaleString('de-DE', { timeZone: 'UTC' })} UTC. Keine Bestätigung durch eine Kanzlei.</p> : loaded ? <p>Für diesen Paketstand ist derzeit keine gespeicherte Empfangsnotiz verfügbar. Das beweist nicht, dass nie eine Übergabe stattgefunden hat.</p> : !error && <p aria-live="polite">Empfangsnotiz wird geladen…</p>}
    <div className={styles.approval}><label><input type="checkbox" checked={checked} disabled={!downloadStarted || busy} onChange={event => setChecked(event.target.checked)} /><span>Ich habe den Empfang selbst außerhalb von Bivaro geprüft und möchte dies als eigene Notiz zu diesem Paketstand festhalten.</span></label><Button type="button" variant="outline" disabled={!downloadStarted || !checked || busy} onClick={save}>{busy ? 'Notiz wird gespeichert' : 'Manuelle Empfangsnotiz speichern'}</Button></div>
    {!downloadStarted && <p className={styles.muted}>Nach dem ZIP-Download verfügbar. Ein Download allein speichert keine Empfangsnotiz.</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <p className={styles.muted}>Die Notiz wird in Bivaros Protokolldaten gespeichert und hier für denselben Paketstand angezeigt. Die Aufbewahrung ist begrenzt; sie ist nicht Teil des Übergabe-ZIP oder eines garantierten Backup-/Restore-Nachweises. Bewahren Sie externe Empfangsbelege separat auf.</p>
  </section>;
}
