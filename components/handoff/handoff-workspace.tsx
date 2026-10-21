'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, Loader2, RotateCcw, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { HandoffReview } from './handoff-review';
import { HandoffTasks } from './handoff-tasks';
import { HandoffAcknowledgement } from './handoff-acknowledgement';
import { HandoffRequestGate, handoffFilename, handoffPeriodQuery, initialHandoffSelection, readHandoffPreview, readHandoffReadiness, type HandoffReadiness, type HandoffPreview, type HandoffSelection } from './handoff-model';
import styles from './handoff.module.css';

class HandoffHttpError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function checkResponse(response: Response) {
  if (response.ok) return;
  const body = await response.json().catch(() => null);
  const message = response.status === 401 ? 'Ihre Sitzung ist abgelaufen. Melden Sie sich erneut an und prüfen Sie danach die Vorschau.'
    : typeof body?.error === 'string' ? body.error : 'Die Anfrage ist fehlgeschlagen. Bitte erneut versuchen.';
  throw new HandoffHttpError(message, response.status);
}

export function HandoffWorkspace({ initialSelection, currentYear }: { initialSelection: HandoffSelection; currentYear: string }) {
  const [selection, setSelection] = useState(initialSelection);
  const [preview, setPreview] = useState<HandoffPreview | null>(null);
  const [readiness, setReadiness] = useState<HandoffReadiness | null>(null);
  const [downloadStarted, setDownloadStarted] = useState(false);
  const [busy, setBusy] = useState<'preview' | 'download' | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<{ message: string; login: boolean; focus?: boolean } | null>(null);
  const [notice, setNotice] = useState('');
  const gate = useRef(new HandoffRequestGate()).current;
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const selectionHeading = useRef<HTMLHeadingElement>(null);
  const previousPreview = useRef(false);
  const errorHeading = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error?.focus) errorHeading.current?.focus(); }, [error]);
  const downloadUrls = useRef(new Set<string>());

  useEffect(() => {
    if (preview) reviewHeading.current?.focus();
    else if (previousPreview.current) selectionHeading.current?.focus();
    previousPreview.current = Boolean(preview);
  }, [preview]);

  useEffect(() => {
    const restoreSelection = () => {
      gate.cancel();
      setBusy(null);
      setPreview(null);
      setReadiness(null);
      setDownloadStarted(false);
      setAcknowledged(false);
      setError(null);
      setNotice('Zeitraum aus der Navigation übernommen. Bitte die Vorschau neu laden.');
      setSelection(initialHandoffSelection(new URLSearchParams(window.location.search), currentYear));
    };
    window.addEventListener('popstate', restoreSelection);
    const urls = downloadUrls.current;
    return () => {
      gate.cancel();
      window.removeEventListener('popstate', restoreSelection);
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [gate, currentYear]);

  function cancel() {
    gate.cancel();
    setBusy(null);
    setNotice(preview ? 'Download abgebrochen. Ihre Vorschau bleibt geöffnet.' : 'Vorschau abgebrochen. Sie können den Zeitraum ändern oder erneut laden.');
    setError(null);
  }

  function changeSelection(patch: Partial<HandoffSelection>) {
    setSelection(previous => ({ ...previous, ...patch }));
    setError(null);
    setNotice('');
  }

  function editPeriod() {
    gate.cancel();
    setBusy(null);
    setPreview(null);
    setReadiness(null);
    setDownloadStarted(false);
    setAcknowledged(false);
    setError(null);
    setNotice('');
  }

  async function loadPreview(event?: React.FormEvent) {
    event?.preventDefault();
    if (gate.active) return;
    let query: URLSearchParams;
    try { query = handoffPeriodQuery(selection); }
    catch (failure) {
      setNotice('');
      setError({ message: failure instanceof Error ? failure.message : 'Bitte den Zeitraum prüfen.', login: false, focus: true });
      return;
    }
    const controller = gate.begin();
    if (!controller) return;
    setBusy('preview');
    setError(null);
    setNotice('');
    setAcknowledged(false);
    setDownloadStarted(false);
    setPreview(null);
    setReadiness(null);
    // Only the deliberate period choice persists. A reload never downloads a file.
    window.history.replaceState(window.history.state, '', `/handoff?${query}`);
    const readinessQuery = query.toString();
    query.set('preview', '1');
    try {
      const [response, tasksResponse] = await Promise.all([
        fetch(`/api/accountant-export?${query}`, { signal: controller.signal, cache: 'no-store' }),
        fetch(`/api/handoff-readiness?${readinessQuery}`, { signal: controller.signal, cache: 'no-store' }),
      ]);
      await checkResponse(response);
      await checkResponse(tasksResponse);
      const result = readHandoffPreview(await response.json());
      const tasks = readHandoffReadiness(await tasksResponse.json(), result.manifest.period);
      if (gate.isCurrent(controller)) { setPreview(result); setReadiness(tasks); }
    } catch (failure) {
      if (!gate.isCurrent(controller)) return;
      setError({ message: failure instanceof TypeError ? 'Keine Verbindung zum Server. Bitte erneut versuchen.' : failure instanceof Error ? failure.message : 'Die Anfrage ist fehlgeschlagen. Bitte erneut versuchen.', login: failure instanceof HandoffHttpError && failure.status === 401, focus: true });
    } finally {
      if (gate.finish(controller)) setBusy(null);
    }
  }

  async function download() {
    if (!preview || !acknowledged || gate.active) return;
    const approved = preview;
    const controller = gate.begin();
    if (!controller) return;
    setBusy('download');
    setError(null);
    setNotice('');
    const query = new URLSearchParams({ from: approved.manifest.period.from, to: approved.manifest.period.to, expectedFingerprint: approved.manifest.sourceFingerprint });
    try {
      const response = await fetch(`/api/accountant-export?${query}`, { signal: controller.signal, cache: 'no-store' });
      await checkResponse(response);
      if (response.headers.get('content-type')?.split(';')[0] !== 'application/zip') throw new Error('Der Server hat kein ZIP-Paket geliefert. Bitte erneut versuchen.');
      const blob = await response.blob();
      if (!gate.isCurrent(controller)) return;
      const url = URL.createObjectURL(blob);
      downloadUrls.current.add(url);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = handoffFilename(response.headers.get('content-disposition'), approved.manifest.period);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.current.delete(url); }, 60_000);
      setDownloadStarted(true);
      setNotice(`ZIP-Download gestartet${approved.manifest.warningCount ? ` – mit ${approved.manifest.warningCount} ${approved.manifest.warningCount === 1 ? 'Warnung' : 'Warnungen'}` : ''}. Prüfen Sie die heruntergeladene Datei und stimmen Sie die sichere Übergabe mit Ihrer Kanzlei ab. Es wurde nichts an eine Kanzlei gesendet.`);
    } catch (failure) {
      if (!gate.isCurrent(controller)) return;
      if (failure instanceof HandoffHttpError && failure.status === 409) {
        setPreview(null);
      setReadiness(null);
      setDownloadStarted(false);
        setAcknowledged(false);
      }
      setError({ message: failure instanceof TypeError ? 'Keine Verbindung zum Server. Bitte erneut versuchen.' : failure instanceof Error ? failure.message : 'Die Anfrage ist fehlgeschlagen. Bitte erneut versuchen.', login: failure instanceof HandoffHttpError && failure.status === 401 });
    } finally {
      if (gate.finish(controller)) setBusy(null);
    }
  }

  const loginQuery = (() => { try { return handoffPeriodQuery(selection).toString(); } catch { return ''; } })();
  return <div className={styles.workspace}>
    <PageHeader title="Unterlagen übergeben" description="Bivaro-ZIP · Kein DATEV-/ELSTER-Export oder Backup." actions={<Button asChild variant="outline"><Link href="/settings#handoff-settings"><ArrowLeft aria-hidden="true" />Einstellungen</Link></Button>} />
    <ol className={styles.steps} aria-label="Schritte zur Übergabe"><li aria-current={!preview ? 'step' : undefined}><span>1</span>Zeitraum wählen</li><li aria-current={preview ? 'step' : undefined}><span>2</span>Paket prüfen und herunterladen</li></ol>
    <div className={styles.layout}>
      <section className={styles.sheet} aria-labelledby={preview ? 'handoff-review-heading' : 'handoff-period-heading'}>
        {!preview ? <>
          <h2 id="handoff-period-heading" ref={selectionHeading} tabIndex={-1}>Zeitraum</h2>
          {selection.mode === 'range' && <p className={styles.muted}>Maximal 366 Tage, einschließlich Anfang und Ende (UTC).</p>}
          <form onSubmit={loadPreview} aria-busy={busy === 'preview'}>
            <fieldset disabled={Boolean(busy)} className={styles.periodFields}>
              <legend className="sr-only">Zeitraum festlegen</legend>
              <div className={styles.modeChoices}>
                <label><input type="radio" name="period-mode" value="year" checked={selection.mode === 'year'} onChange={() => changeSelection({ mode: 'year' })} />Kalenderjahr</label>
                <label><input type="radio" name="period-mode" value="range" checked={selection.mode === 'range'} onChange={() => changeSelection({ mode: 'range' })} />Eigener Zeitraum</label>
              </div>
              {selection.mode === 'year' ? <div className={styles.yearField}><Label htmlFor="handoff-year">Kalenderjahr</Label><Input id="handoff-year" name="year" type="text" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder={currentYear} required value={selection.year} onChange={event => changeSelection({ year: event.target.value })} /></div>
              : <div className={styles.dateFields}><div><Label htmlFor="handoff-from">Von einschließlich</Label><Input id="handoff-from" name="from" type="date" min="0001-01-01" max="9999-12-31" required value={selection.from} onChange={event => changeSelection({ from: event.target.value })} /></div><div><Label htmlFor="handoff-to">Bis einschließlich</Label><Input id="handoff-to" name="to" type="date" min={selection.from || '0001-01-01'} max="9999-12-31" required value={selection.to} onChange={event => changeSelection({ to: event.target.value })} /></div></div>}
            </fieldset>
            <div className={styles.actions}><Button type="submit" disabled={Boolean(busy)}>{busy === 'preview' ? <><Loader2 aria-hidden="true" className="animate-spin" />Vorschau wird erstellt</> : <><RotateCcw aria-hidden="true" />Vorschau laden</>}</Button>{busy && <Button type="button" variant="outline" onClick={cancel}>Abbrechen</Button>}</div>
          </form>

        </> : <>
          <h2 id="handoff-review-heading" ref={reviewHeading} tabIndex={-1}>Paket prüfen und herunterladen</h2>
          {readiness && <HandoffTasks preview={preview} readiness={readiness} />}
          <HandoffReview preview={preview} />
          <div className={styles.approval}>
            <label><input type="checkbox" checked={acknowledged} disabled={Boolean(busy)} onChange={event => setAcknowledged(event.target.checked)} /><span>Ich habe Umfang und Warnungen geprüft. Fachliche Vollständigkeit ist nicht bestätigt.</span></label>

          </div>
          <div className={styles.actions}><Button type="button" disabled={!acknowledged || Boolean(busy)} onClick={download}>{busy === 'download' ? <><Loader2 aria-hidden="true" className="animate-spin" />ZIP wird erstellt</> : <><Download aria-hidden="true" />ZIP herunterladen</>}</Button>{busy ? <Button type="button" variant="outline" onClick={cancel}>Abbrechen</Button> : <Button type="button" variant="outline" onClick={editPeriod}><ArrowLeft aria-hidden="true" />Zeitraum ändern</Button>}</div>
          <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => loadPreview()}><RotateCcw aria-hidden="true" />Vorschau aktualisieren</Button>
          <HandoffAcknowledgement key={preview.manifest.sourceFingerprint} preview={preview} downloadStarted={downloadStarted} />
        </>}
        {error && <div role="alert" tabIndex={-1} ref={errorHeading} className={styles.error}><AlertTriangle aria-hidden="true" /><div><strong>{preview ? 'Download nicht gestartet' : 'Vorschau nicht verfügbar'}</strong><p>{error.message}</p>{error.login && <Link href={`/login?callbackUrl=${encodeURIComponent(`/handoff${loginQuery ? `?${loginQuery}` : ''}`)}`}>Erneut anmelden</Link>}{!error.login && <p>Ihre Zeitraum-Auswahl bleibt erhalten. {!preview ? 'Laden Sie die Vorschau erneut.' : 'Sie können den Download erneut versuchen.'}</p>}</div></div>}
        <p role="status" aria-live="polite" className={styles.status}>{busy ? (busy === 'preview' ? 'Die Vorschau und Originaldateien werden geprüft.' : 'Das bestätigte ZIP-Paket wird erstellt. Bitte warten oder abbrechen.') : notice}</p>
      </section>
      <details className={styles.scope}>
        <summary id="handoff-scope-title">Paketinhalt und Grenzen</summary>
        <p>Ein begrenztes Arbeitspaket im Bivaro-Format 2, kein Direktimport in eine Kanzleisoftware.</p>
        <ul><li>Einnahmen, Ausgaben, Rechnungen und Gutschriften sowie Kassenbewegungen als CSV und JSON.</li><li>Zugehörige Kunden und Kassenbücher, vorhandene unveränderte Originaldateien.</li><li>Eine Paketbeschreibung sowie manifest.json mit Zählungen, Warnungen und Datei-Prüfsummen.</li></ul>
        <details><summary>Wie wird der Zeitraum ausgewählt?</summary><p>Ausgaben und Kassenbewegungen folgen ihrem gespeicherten Datum. Einnahmen folgen dem gespeicherten Datum oder dem Zahlungsdatum der eigenen verknüpften Rechnung. Rechnungen folgen Rechnungs-/ersatzweise Uploaddatum, Zahlung oder verknüpfter Einnahme. Ursprungsrechnungen von Gutschriften können als Kontext außerhalb des Zeitraums enthalten sein. Die genauen Regeln stehen in README.txt.</p></details>
        <details><summary>Grenzen und ausgeschlossene Daten</summary>
        <p>Kein DATEV-Format oder zugesicherter DATEV-Import, keine ELSTER-Einreichung, kein vollständiger GoBD-Prüfexport und kein wiederherstellbares Backup.</p>
        <p>Nicht enthalten: Angebote, ungebuchte Eingangsbelege, wiederkehrende Vorlagen und nicht betroffene Stammdaten. Original-Zahlungsnachweise stehen in payments.csv, einschließlich historischer Datumsunsicherheit; Korrekturen und tatsächliche Erstattungen in adjustments.csv. Dies sind operative Nachweise, keine freigegebene Steuer-/EÜR-Zuordnung. Einnahme und Zahlungsnachweis bilden denselben Eingang ab und dürfen nicht addiert werden.</p>
        <p>Passwörter, API-Schlüssel, SMTP-/Hosteinstellungen und Sicherheitslogs werden nicht exportiert.</p>
        </details><h3>Sichere Übergabe</h3>
        <p>ZIP selbst über einen abgestimmten sicheren Kanal übergeben. Kein automatischer Versand.</p>
        <Link href="/help#export">Export und Grenzen nachlesen</Link>
      </details>
    </div>
  </div>;
}
