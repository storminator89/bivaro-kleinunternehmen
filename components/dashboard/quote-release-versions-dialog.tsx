'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { OwnerQuoteReleaseState } from '@/lib/quote-release-owner-contract';
import {
  createOwnerQuoteReleaseUncertainty, OwnerQuoteReleaseReviewRequiredError, OwnerQuoteReleaseStorageError,
  ownerQuoteReleaseCanCapture, ownerQuoteReleaseClientBody, ownerQuoteReleaseClientGate, ownerQuoteReleaseLocalDateTime,
  parseOwnerQuoteReleaseClientReceipt, parseOwnerQuoteReleaseClientState, transitionOwnerQuoteReleaseClientGate,
  type OwnerQuoteReleaseClientReceipt,
} from '@/lib/quote-release-owner-client';

const UNKNOWN = 'Der Ausgang des Speicherversuchs ist unklar. Es könnte bereits eine Version gespeichert sein. Nicht erneut senden: erst den Stand ausdrücklich neu laden, Verlauf prüfen und eine weitere neue Version bewusst bestätigen.';
const AUTH = 'Ihre Anmeldung ist nicht mehr gültig. Die bisherige Ansicht wurde entfernt. Bitte neu anmelden und diesen Dialog erneut öffnen.';
const dateLabel = (value: string) => new Date(value).toLocaleString('de-DE');
async function responseError(response: Response, fallback: string): Promise<string> {
  try { const value: unknown = await response.json(); if (value && typeof value === 'object' && 'error' in value && typeof value.error === 'string') return value.error.slice(0, 1000); } catch { /* Retain known HTTP failure, never resubmit. */ }
  return fallback;
}

export function QuoteReleaseVersionsDialog({ quoteId, quoteLabel, ownerSessionKey, onClose }: { quoteId: number; quoteLabel: string; ownerSessionKey: string; onClose: () => void }) {
  const id = useId();
  const [state, setState] = useState<OwnerQuoteReleaseState | null>(null);
  const [stateQuoteId, setStateQuoteId] = useState(quoteId);
  const [stateOwner, setStateOwner] = useState(ownerSessionKey);
  const [receipt, setReceipt] = useState<OwnerQuoteReleaseClientReceipt | null>(null);
  const [reason, setReason] = useState('');
  const [expiry, setExpiry] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const storageBlocked = useRef(true);
  const uncertainty = useRef<ReturnType<typeof createOwnerQuoteReleaseUncertainty> | null>(null);
  const [gate, setGate] = useState(ownerQuoteReleaseClientGate);
  const gateRef = useRef(gate);
  const activeQuote = useRef(quoteId);
  const activeOwner = useRef(ownerSessionKey);
  const scope = useRef(0);
  const readSequence = useRef(0);
  const readAbort = useRef<AbortController | null>(null);
  const saveAbort = useRef<AbortController | null>(null);
  const move = useCallback((event: Parameters<typeof transitionOwnerQuoteReleaseClientGate>[1]) => {
    gateRef.current = transitionOwnerQuoteReleaseClientGate(gateRef.current, event);
    setGate(gateRef.current);
  }, []);
  const blockStorage = useCallback(() => {
    storageBlocked.current = true; setStorageError(new OwnerQuoteReleaseStorageError().message);
  }, []);
  const requireAuthentication = useCallback(() => {
    setState(null); setReceipt(null); setReason(''); setExpiry(''); setError(AUTH); move({ type: 'auth-required' });
  }, [move]);
  const load = useCallback(async (explicit: boolean) => {
    if (activeQuote.current !== quoteId || activeOwner.current !== ownerSessionKey || gateRef.current.pending || gateRef.current.unauthorized) return;
    try {
      if (!uncertainty.current) throw new OwnerQuoteReleaseStorageError();
      if (uncertainty.current.read() && !gateRef.current.uncertain) move({ type: 'uncertainty-found' });
    } catch { blockStorage(); }
    const currentScope = scope.current, sequence = ++readSequence.current;
    readAbort.current?.abort();
    const controller = new AbortController(); readAbort.current = controller;
    const current = () => scope.current === currentScope && activeQuote.current === quoteId && activeOwner.current === ownerSessionKey && readSequence.current === sequence && !controller.signal.aborted;
    move({ type: 'read-start' }); setState(null); setError(null);
    try {
      const response = await fetch(`/api/quotes/${quoteId}/releases`, { cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal: controller.signal });
      if (!current()) return;
      if (response.status === 401) { requireAuthentication(); return; }
      if (!response.ok) throw new Error(await responseError(response, 'Der Versionsstand konnte nicht geladen werden. Ihre Eingaben bleiben erhalten.'));
      const value: unknown = await response.json();
      if (!current()) return;
      const next = parseOwnerQuoteReleaseClientState(value, quoteId);
      setState(next); move({ type: 'read-ok', explicit });
    } catch (cause) {
      if (!current()) return;
      move({ type: 'read-failed' }); setState(null);
      setError(cause instanceof Error ? cause.message : 'Der Versionsstand konnte nicht geladen werden.');
    }
  }, [blockStorage, move, ownerSessionKey, quoteId, requireAuthentication]);

  const invalidateRequests = useCallback(() => {
    scope.current++; readSequence.current++; readAbort.current?.abort(); saveAbort.current?.abort();
    const previous = gateRef.current;
    gateRef.current = ownerQuoteReleaseClientGate(previous.uncertain || previous.pending, previous.unauthorized);
    storageBlocked.current = true; uncertainty.current = null;
  }, []);

  useEffect(() => {
    const unauthorized = activeOwner.current === ownerSessionKey && gateRef.current.unauthorized;
    scope.current++; activeQuote.current = quoteId; activeOwner.current = ownerSessionKey;
    let persisted = false;
    storageBlocked.current = true; setStorageError(null);
    try {
      // Only one metadata-scoped bit survives close/reopen/navigation/reload in this tab.
      uncertainty.current = createOwnerQuoteReleaseUncertainty(() => window.sessionStorage, ownerSessionKey, quoteId);
      persisted = uncertainty.current.read(); storageBlocked.current = false;
    } catch { blockStorage(); }
    const next = ownerQuoteReleaseClientGate(persisted, unauthorized);
    gateRef.current = next; setGate(next); setStateQuoteId(quoteId); setStateOwner(ownerSessionKey); setState(null); setReceipt(null); setReason(''); setExpiry(''); setError(next.unauthorized ? AUTH : null);
    void load(false);
    return invalidateRequests;
  }, [blockStorage, invalidateRequests, load, ownerSessionKey, quoteId]);

  const inScope = stateQuoteId === quoteId && stateOwner === ownerSessionKey && activeQuote.current === quoteId && activeOwner.current === ownerSessionKey;
  const visible = inScope && !gate.unauthorized ? state : null;
  const visibleReceipt = inScope && !gate.unauthorized ? receipt : null;
  const busy = gate.pending || gate.reading;
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!inScope || activeQuote.current !== quoteId || activeOwner.current !== ownerSessionKey || storageBlocked.current || !visible?.expected || !ownerQuoteReleaseCanCapture(gateRef.current)) return;
    let body;
    try { body = ownerQuoteReleaseClientBody(visible.expected, expiry, reason, visible.validUntil); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Bitte Ihre Eingaben prüfen.'); return; }
    const marker = uncertainty.current;
    if (!marker) { blockStorage(); return; }
    let priorUncertainty: boolean;
    try {
      const attempt = marker.begin(gateRef.current.uncertain && gateRef.current.freshReview && gateRef.current.acknowledged);
      priorUncertainty = attempt.priorUncertainty || gateRef.current.uncertain;
    } catch (cause) {
      if (cause instanceof OwnerQuoteReleaseReviewRequiredError) { move({ type: 'uncertainty-found' }); setError(UNKNOWN); }
      else blockStorage();
      return; // No POST without a verified write-ahead bit.
    }
    // Synchronous ref gate closes the double-click window before React rerenders.
    move({ type: 'save-start' }); setError(null); setReceipt(null);
    const currentScope = scope.current, controller = new AbortController(); saveAbort.current = controller;
    const current = () => scope.current === currentScope && activeQuote.current === quoteId && activeOwner.current === ownerSessionKey && !controller.signal.aborted;
    try {
      const response = await fetch(`/api/quotes/${quoteId}/releases`, { method: 'POST', cache: 'no-store', credentials: 'same-origin', redirect: 'error',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      if (!current()) return;
      if (response.status === 401) { requireAuthentication(); return; }
      if (!response.ok && !(response.status >= 400 && response.status < 500)) { move({ type: 'save-unknown' }); setError(UNKNOWN); return; }
      if (!response.ok) {
        const message = await responseError(response, 'Nicht gespeichert. Bitte den Stand neu laden und Ihre Eingaben erneut prüfen.');
        if (!current()) return;
        try { marker.knownRejected(priorUncertainty); } catch { blockStorage(); }
        move({ type: 'save-rejected' }); setError(`${message} Bitte vor einem weiteren Versuch den Stand neu laden und bewusst prüfen.`); return;
      }
      const value: unknown = await response.json();
      if (!current()) return;
      const saved = parseOwnerQuoteReleaseClientReceipt(value, body);
      setReceipt(saved);
      try { marker.confirmed(saved, body); } catch { blockStorage(); }
      move({ type: 'save-confirmed' });
      // A confirmed receipt permits only a state refresh, never another POST.
      await load(false);
    } catch {
      if (!current()) return;
      move({ type: 'save-unknown' }); setError(UNKNOWN);
    } finally { if (saveAbort.current === controller) saveAbort.current = null; }
  }
  function close() { if (!gateRef.current.pending) onClose(); }
  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" showCloseButton={!gate.pending}
      onInteractOutside={event => { if (gateRef.current.pending) event.preventDefault(); }} onEscapeKeyDown={event => { if (gateRef.current.pending) event.preventDefault(); }}>
      <DialogHeader>
        <DialogTitle>Interne Angebotsversionen</DialogTitle>
        <DialogDescription>{gate.unauthorized ? 'Anmeldung erforderlich. Bitte neu anmelden und den Dialog erneut öffnen.' : `${quoteLabel}. Nur interne Belege: kein Versand, keine Online-Freigabe und keine Kundenzustimmung.`}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4" aria-busy={busy}>
        {(storageError || error) && <p role="alert" className="rounded-lg border border-destructive/30 bg-critical-surface p-3 text-sm text-critical-foreground">{storageError || error}</p>}
        {!gate.unauthorized && gate.uncertain && <div className="space-y-2 rounded-lg border border-amber-500/40 p-3 text-sm">
          <p>{UNKNOWN} Auch ein gleicher Hash beweist weder den Ausgang noch die Absicht eines früheren Versuchs. Die Markierung bleibt beim Schließen und Neuladen in diesem Browser-Tab erhalten; andere Tabs oder Geräte werden damit nicht abgeglichen.</p>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={gate.acknowledged} disabled={!gate.freshReview || !gate.ready || busy || gate.unauthorized}
              onChange={event => move({ type: 'acknowledge', checked: event.target.checked })} className="mt-1 size-4 shrink-0" />
            <span>Ich habe den ausdrücklich neu geladenen Stand und Verlauf geprüft. Ich möchte bewusst eine weitere neue interne Version anlegen; der frühere Ausgang bleibt ungeklärt.</span>
          </label>
        </div>}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" disabled={busy || gate.unauthorized} onClick={() => void load(true)}>{gate.reading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}{gate.uncertain ? 'Stand ausdrücklich neu laden' : 'Stand neu laden'}</Button>
          {gate.reading && <p role="status" className="text-sm text-muted-foreground">Versionsstand wird geladen …</p>}
        </div>
        {visibleReceipt && <div role="status" className="space-y-1 rounded-lg border p-3 text-sm">
          <p className="font-medium">Interne Version {visibleReceipt.revision} gespeichert. Es wurde nichts gesendet oder öffentlich freigegeben.</p>
          <p>Gespeichert: {dateLabel(visibleReceipt.createdAt)}</p>
          <details>
            <summary className="cursor-pointer font-medium">Technische Belegdetails</summary>
            <p>Beleg-ID: <span className="break-all font-mono">{visibleReceipt.releaseId}</span></p>
            <p className="break-all font-mono text-xs">SHA-256: {visibleReceipt.snapshotSha256}</p>
          </details>
        </div>}
        {visible && <details open={gate.uncertain} className="space-y-2 rounded-lg border p-3">
          <summary className="cursor-pointer font-medium">Gespeicherte Versionen ({visible.totalVersions}) anzeigen</summary>
          {visible.hasMore && <p className="text-sm text-muted-foreground">Angezeigt werden nur die neuesten 20 Versionen. Ältere Belege bleiben gespeichert.</p>}
          {!visible.history.length && <p className="text-sm text-muted-foreground">Noch keine interne Version gespeichert.</p>}
          <ol className="space-y-2">{visible.history.map(item => <li key={item.id} className="space-y-1 rounded-lg border p-3 text-sm">
            <p className="font-medium">Version {item.generation}{item.current ? ' · aktueller interner Stand' : ''}{item.permanentlyClosed ? ' · dauerhaft geschlossen' : item.revokedAt ? ' · geschlossen' : ''}</p>
            <p>{dateLabel(item.createdAt)} · Ablauf: {dateLabel(item.expiresAt)}</p>
            {item.revokedAt && <p>Geschlossen: {dateLabel(item.revokedAt)}</p>}
            <details>
              <summary className="cursor-pointer text-xs font-medium">Technische Belegdetails</summary>
              <p className="break-all font-mono text-xs">{item.id}<br />SHA-256: {item.snapshotSha256}</p>
            </details>
            {item.response && <p>Vorhandener Rückmeldeeintrag: {item.response.decision === 'ACCEPT' ? 'Annahme' : 'Ablehnung'} am {dateLabel(item.response.recordedAt)}. Kein Nachweis der Empfängeridentität.</p>}
          </li>)}</ol>
        </details>}
        {!gate.unauthorized && <form onSubmit={save} className="space-y-4 border-t pt-4">
          <p className="text-sm text-muted-foreground">Nur unveränderte moderne Angebote mit passendem Erstellungsbeleg kommen infrage. Ältere oder geänderte Angebote werden nicht nachträglich umgebunden. Originalbytes, Eigentum und Gültigkeit prüft der Server beim Speichern erneut.</p>
          {visible?.eligibility === 'UNAVAILABLE' && <p className="text-sm">Für diesen Angebotsstand ist keine neue interne Version verfügbar. Vorhandene Belege bleiben unverändert.</p>}
          {visible?.expected && <p className="text-sm">Geprüfter Revisionsstand: {visible.expected.revision}. Jede bewusste Speicherung legt einen neuen Beleg an, auch bei gleichem Inhalt.</p>}
          <div className="space-y-2">
            <Label htmlFor={`${id}-reason`}>Grund für diese neue interne Version</Label>
            <Textarea id={`${id}-reason`} required maxLength={500} rows={3} value={reason} disabled={gate.pending || gate.unauthorized}
              onChange={event => { setReason(event.target.value); move({ type: 'acknowledge', checked: false }); }} />
            <p className="text-xs text-muted-foreground">Nur intern protokolliert. {reason.length}/500 Zeichen</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-expiry`}>Ablauf der internen Version (Ihre lokale Zeit)</Label>
            <Input id={`${id}-expiry`} type="datetime-local" step={60} required value={expiry} disabled={gate.pending || gate.unauthorized}
              max={visible?.validUntil ? ownerQuoteReleaseLocalDateTime(new Date(visible.validUntil)) : undefined}
              onChange={event => { setExpiry(event.target.value); move({ type: 'acknowledge', checked: false }); }} />
            {visible?.validUntil && <p className="text-xs text-muted-foreground">Höchstens bis zur Angebotsgültigkeit: {dateLabel(visible.validUntil)}.</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={gate.pending} onClick={close}>Schließen</Button>
            <Button type="submit" disabled={!inScope || !!storageError || !visible?.expected || !ownerQuoteReleaseCanCapture(gate) || !reason.trim() || !expiry}>
              {gate.pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}Neue interne Version bewusst speichern
            </Button>
          </DialogFooter>
        </form>}
        {gate.unauthorized && <DialogFooter><Button type="button" variant="outline" onClick={close}>Schließen</Button></DialogFooter>}
      </div>
    </DialogContent>
  </Dialog>;
}
