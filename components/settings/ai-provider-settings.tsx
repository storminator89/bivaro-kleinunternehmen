'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, ScanText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { AiProviderSettingsDto, AiProviderSettingsInput } from '@/lib/ai-provider/types';
import { aiRequestError } from '@/components/purchases/ai-receipt-ui';

type Form = Pick<AiProviderSettingsInput, 'enabled' | 'autoAnalyzeNewUploads' | 'baseUrl' | 'model' | 'keyAction'> & { apiKey: string };
const fromSettings = (settings: AiProviderSettingsDto): Form => ({ enabled: settings.enabled, autoAnalyzeNewUploads: settings.autoAnalyzeNewUploads, baseUrl: settings.baseUrl, model: settings.model, keyAction: 'keep', apiKey: '' });

export function AiProviderSettings() {
  const [current, setCurrent] = useState<AiProviderSettingsDto | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const [costAccepted, setCostAccepted] = useState(false);
  const active = useRef(false);
  const alive = useRef(true);
  const dirty = !!current && !!form && JSON.stringify(form) !== JSON.stringify(fromSettings(current));
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = useCallback(async () => {
    if (active.current) return;
    active.current = true; setLoading(true); setFeedback(null);
    try {
      const response = await fetch('/api/settings/ai-provider', { cache: 'no-store', credentials: 'same-origin' });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(aiRequestError(response.status, body));
      if (alive.current) { setCurrent(body); setForm(fromSettings(body)); setCostAccepted(false); }
    } catch (error) { if (alive.current) setFeedback({ error: true, text: error instanceof Error && error.message ? error.message : 'KI-Einstellungen konnten nicht geladen werden.' }); }
    finally { active.current = false; if (alive.current) setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function change<K extends keyof Form>(key: K, value: Form[K]) {
    setForm(previous => previous ? { ...previous, [key]: value, ...(key === 'enabled' && !value ? { autoAnalyzeNewUploads: false } : {}), ...(key === 'keyAction' && value !== 'replace' ? { apiKey: '' } : {}), ...(key === 'keyAction' && value === 'remove' ? { enabled: false, autoAnalyzeNewUploads: false } : {}) } : previous);
    setFeedback(null); setCostAccepted(false);
  }
  async function submit(operation: 'save' | 'test') {
    if (active.current || !current || !form) return;
    active.current = true; setBusy(operation); setFeedback(null); setCostAccepted(false);
    try {
      const payload = operation === 'test' ? { expectedVersion: current.version, expectedConfigRevision: current.configurationRevision, acknowledgeCost: true } : { enabled: form.keyAction === 'remove' ? false : form.enabled, autoAnalyzeNewUploads: form.keyAction === 'remove' ? false : form.autoAnalyzeNewUploads, baseUrl: form.baseUrl.trim(), model: form.model.trim(), expectedVersion: current.version, keyAction: form.keyAction, ...(form.keyAction === 'replace' ? { apiKey: form.apiKey } : {}) };
      const response = await fetch(`/api/settings/ai-provider${operation === 'test' ? '/test' : ''}`, { method: operation === 'test' ? 'POST' : 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(aiRequestError(response.status, body));
      if (!alive.current) return;
      if (operation === 'save') { setCurrent(body); setForm(fromSettings(body)); setFeedback({ error: false, text: 'KI-Einstellungen gespeichert. Vorhandene Belege werden nicht nachträglich analysiert.' }); }
      else setFeedback({ error: false, text: 'Verbindung mit einem künstlichen Text erfolgreich getestet. Bild- und PDF-Unterstützung ist damit nicht bestätigt.' });
      setCostAccepted(false);
    } catch (error) { if (alive.current) setFeedback({ error: true, text: `${error instanceof Error ? error.message : 'Verbindung unterbrochen.'} ${operation === 'save' ? 'Eingaben bleiben erhalten. Bei unklarer Antwort zuerst den gespeicherten Stand laden.' : 'Keine automatische Wiederholung. Ein erneuter Test kann erneut Kosten verursachen.'}` }); }
    finally { active.current = false; if (alive.current) setBusy(null); }
  }
  const destinationChanged = !!current?.hasKey && !!form && (form.baseUrl.trim() !== current.baseUrl || form.model.trim() !== current.model);
  return <Card id="ai-receipt-settings" className="scroll-mt-24 min-w-0">
    <CardHeader><CardTitle className="flex items-center gap-2"><ScanText className="size-5 shrink-0" aria-hidden="true" />Belege mit KI auslesen <span className="text-sm font-normal text-muted-foreground">optional</span></CardTitle><CardDescription>Ihr OpenAI-kompatibler Anbieter liefert Vorschläge für den Prüfentwurf. Eine Buchung oder Zahlung entsteht dadurch nicht.</CardDescription></CardHeader>
    <CardContent className="space-y-5">
      {loading ? <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" aria-hidden="true" />KI-Einstellungen werden geladen…</p> : <>
        {feedback && <div role={feedback.error ? 'alert' : 'status'} className={`border-l-2 pl-3 text-sm ${feedback.error ? 'border-destructive text-destructive' : 'border-primary'}`}>{!feedback.error && <CheckCircle2 className="mr-2 inline size-4" aria-hidden="true" />}{feedback.text}</div>}
        {current && form ? <>
          <p className="text-sm font-medium">{current.enabled && current.configured ? 'KI-Auslesen aktiviert' : current.configured ? 'Anbieter gespeichert · KI-Auslesen deaktiviert' : 'Noch nicht vollständig eingerichtet'} · {current.hasKey ? 'Schlüssel gespeichert, wird nie angezeigt' : 'Kein Schlüssel gespeichert'}</p>
          {!current.encryptionAvailable && <p role="status" className="border-l-2 border-caution pl-3 text-sm">Die sichere Schlüsselspeicherung ist serverseitig nicht verfügbar. Betreiber muss die Serverkonfiguration prüfen. Belege lassen sich weiterhin manuell erfassen.</p>}
          <form className="space-y-5" onSubmit={event => { event.preventDefault(); void submit('save'); }}>
            <fieldset disabled={!!busy || !current.encryptionAvailable} className="min-w-0 space-y-5">
              <div className="grid gap-4 sm:grid-cols-2"><div className="min-w-0 space-y-2"><Label htmlFor="ai-base-url">Base URL (HTTPS)</Label><Input id="ai-base-url" type="url" placeholder="https://api.example.com/v1" autoComplete="off" value={form.baseUrl} onChange={event => change('baseUrl', event.target.value)} aria-describedby="ai-provider-help" /></div><div className="min-w-0 space-y-2"><Label htmlFor="ai-model">Modell</Label><Input id="ai-model" autoComplete="off" value={form.model} onChange={event => change('model', event.target.value)} placeholder="Modellname Ihres Anbieters" /></div></div>
              <p id="ai-provider-help" className="text-xs text-muted-foreground">Chat-Completions-kompatibler Endpunkt. Für Fotos braucht das Modell Bildverständnis; PDF-Unterstützung ist anbieterabhängig. Keine universelle Kompatibilitätszusage.</p>
              <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">API-Schlüssel verwalten</legend>{[['keep', 'Gespeicherten Schlüssel behalten'], ['replace', 'Neuen Schlüssel speichern / ersetzen'], ['remove', 'Schlüssel entfernen und KI deaktivieren']].map(([value, label]) => <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"><input type="radio" name="ai-key-action" value={value} checked={form.keyAction === value} onChange={() => change('keyAction', value as Form['keyAction'])} className="size-4 accent-primary" />{label}</label>)}{form.keyAction === 'replace' && <div className="space-y-2"><Label htmlFor="ai-api-key">Neuer API-Schlüssel</Label><Input id="ai-api-key" type="password" autoComplete="new-password" required value={form.apiKey} onChange={event => change('apiKey', event.target.value)} /><p className="text-xs text-muted-foreground">Wird verschlüsselt gespeichert und nie zurückgelesen. Nicht in Prüfnotizen eintragen.</p></div>}{destinationChanged && form.keyAction === 'keep' && <p role="status" className="text-sm text-caution-foreground">Ziel oder Modell geändert: Schlüssel ausdrücklich ersetzen oder entfernen. Ein bestehender Schlüssel wird nicht still an ein neues Ziel übertragen.</p>}</fieldset>
              <div className="flex items-start justify-between gap-4 border-t border-border pt-4"><div><Label htmlFor="ai-enabled">KI-Auslesen aktivieren</Label><p className="mt-1 text-sm text-muted-foreground">Einzelne Analysen können anschließend bewusst gestartet werden.</p></div><Switch id="ai-enabled" disabled={form.keyAction === 'remove'} checked={form.enabled} onCheckedChange={value => change('enabled', value)} /></div>
              <div className="flex items-start justify-between gap-4"><div><Label htmlFor="ai-auto">Neue Uploads automatisch analysieren</Label><p className="mt-1 text-sm text-muted-foreground">Separate Freigabe: nur künftig neu hochgeladene geeignete Belege. Keine nachträgliche Analyse des Archivs, keine automatische Buchung.</p></div><Switch id="ai-auto" disabled={!form.enabled || form.keyAction === 'remove'} checked={form.autoAnalyzeNewUploads} onCheckedChange={value => change('autoAnalyzeNewUploads', value)} /></div>
              <p className="border-l-2 border-primary pl-3 text-sm break-words">Bei einer Analyse werden Beleginhalte an <strong className="break-all">{form.baseUrl.trim() || 'den hier eingetragenen Anbieter'}</strong> gesendet. Es können Anbietergebühren entstehen; Bivaro kennt deren Höhe nicht.</p>
              <Button type="submit" disabled={!!busy || (destinationChanged && form.keyAction === 'keep')}>{busy === 'save' && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}KI-Einstellungen speichern</Button>
            </fieldset>
          </form>
          <details className="border-t border-border pt-3"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">Verbindung prüfen und Datenschutz</summary><div className="space-y-3 py-3 text-sm"><p>Testet nur den gespeicherten, aktivierten Anbieter mit einem künstlichen Text, ohne echten Beleg. Der Test kann kostenpflichtig sein. Eine erfolgreiche Textantwort bestätigt nicht die Belegqualität.</p><p className="break-all text-muted-foreground">Gespeichertes Ziel: {current.baseUrl || 'Keines'} · Modell: {current.model || 'Keines'}</p><label className="flex min-h-11 items-start gap-3"><input type="checkbox" checked={costAccepted} disabled={!!busy || dirty} onChange={event => setCostAccepted(event.target.checked)} className="mt-1 size-4 shrink-0 accent-primary" /><span>Mögliche Kosten für diesen Verbindungstest akzeptieren.</span></label><Button type="button" variant="outline" disabled={!!busy || dirty || !costAccepted || !current.enabled || !current.configured} onClick={() => void submit('test')}>{busy === 'test' && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}Gespeicherte Verbindung testen</Button>{dirty && <p>Änderungen zuerst speichern. Es wird nicht mit ungespeicherten Angaben getestet.</p>}<p className="text-xs text-muted-foreground">Beleg-Backups enthalten weder Anbieter-Konfiguration noch API-Schlüssel. Eine Sicherung richtet auf einem anderen System keine KI-Verbindung ein. Datenschutz und Auftragsverarbeitung beim gewählten Anbieter selbst prüfen.</p></div></details>
        </> : null}
        <Button type="button" variant="outline" disabled={!!busy} onClick={() => { if (!dirty || window.confirm('Ungespeicherte KI-Einstellungen verwerfen und gespeicherten Stand laden?')) void load(); }}>Gespeicherten Stand laden</Button>
      </>}
    </CardContent>
  </Card>;
}
