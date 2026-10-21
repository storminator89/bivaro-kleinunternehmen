'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2, ScanText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AiProviderSettingsDto } from '@/lib/ai-provider/types';
import type { AiExtractionJob, AiExtractionResult } from '@/lib/purchase-documents/ai-types';
import type { IncomingDocument } from '@/lib/purchase-documents/types';
import { formatSourceAmount, formatSourceDate } from './incoming-document-ui';
import { aiJson, aiRequestError, aiStatusLabel } from './ai-receipt-ui';

export function AiReceiptSuggestions({ result }: { result: AiExtractionResult }) {
  return <section aria-label="Ungeprüfte KI-Vorschläge" className="mt-4 space-y-4 text-sm">
    <p className="border-l-2 border-caution pl-3">KI-Vorschläge können falsch oder unvollständig sein. Keine Konformitäts- oder Zahlungsprüfung. Fehlende Angaben bleiben offen; alles am unveränderten Original prüfen.</p>
    <dl className="grid gap-4 sm:grid-cols-2 [&_dt]:text-xs [&_dt]:text-muted-foreground [&_dd]:mt-1 [&_dd]:break-words"><div><dt>Lieferant · KI-Vorschlag</dt><dd>{result.supplierName || 'Nicht erkannt'}</dd></div><div><dt>Rechnungsnummer · KI-Vorschlag</dt><dd>{result.invoiceNumber || 'Nicht erkannt'}</dd></div><div><dt>Rechnungsdatum · KI-Vorschlag</dt><dd>{formatSourceDate(result.invoiceDate)}</dd></div><div><dt>Dokumenttyp · KI-Vorschlag</dt><dd>{result.documentType === 'INVOICE' ? 'Rechnung' : result.documentType === 'CREDIT_NOTE' ? 'Gutschrift · nicht als Ausgabe übernehmen' : 'Unbekannt'}</dd></div><div><dt>Brutto · KI-Vorschlag</dt><dd className="font-semibold tabular-nums">{formatSourceAmount(result.grossAmount, result.currency)}</dd></div><div><dt>Netto / Steuer · KI-Vorschlag</dt><dd className="tabular-nums">{formatSourceAmount(result.netAmount, result.currency)} / {formatSourceAmount(result.taxAmount, result.currency)}</dd></div></dl>
    <p className="text-xs text-muted-foreground">{result.lineItemsComplete === true ? 'Das Modell meldet die Positionsliste als vollständig; am Original prüfen.' : result.lineItemsComplete === false ? 'Das Modell meldet eine unvollständige Positionsliste.' : 'Vollständigkeit der Positionsliste nicht angegeben.'}</p>
    <p className="text-xs text-muted-foreground">Ein tatsächliches Zahlungsdatum wird nicht aus dem Beleg abgeleitet. Herkunft: KI · ungeprüft (AI_UNREVIEWED).</p>
    {result.lineItems.length > 0 && <details><summary className="min-h-11 cursor-pointer py-3 font-medium focus-visible:outline-2 focus-visible:outline-ring">{result.lineItems.length} Positionsvorschläge prüfen</summary><ol className="divide-y divide-border">{result.lineItems.map((line, index) => <li key={index} className="min-w-0 py-3"><p className="break-words font-medium">{index + 1}. {line.description || 'Beschreibung nicht erkannt'}</p><dl className="mt-2 grid grid-cols-2 gap-3 text-xs [&_dt]:text-muted-foreground [&_dd]:mt-1 [&_dd]:break-words [&_dd]:tabular-nums"><div><dt>Menge</dt><dd>{line.quantity ?? 'Nicht erkannt'}</dd></div><div><dt>Einzelpreis</dt><dd>{formatSourceAmount(line.unitPrice, result.currency)}</dd></div><div><dt>Positionsbetrag</dt><dd>{formatSourceAmount(line.amount, result.currency)}</dd></div><div><dt>Steuersatz</dt><dd>{line.taxRate === null ? 'Nicht erkannt' : `${line.taxRate} %`}</dd></div></dl></li>)}</ol></details>}
    {result.warnings.length > 0 && <details><summary className="min-h-11 cursor-pointer py-3 font-medium focus-visible:outline-2 focus-visible:outline-ring">KI-Prüfhinweise ({result.warnings.length})</summary><ul className="list-disc space-y-2 break-words pl-5">{result.warnings.map((warning, index) => <li key={index}>{warning.message}</li>)}</ul></details>}
  </section>;
}

export function IncomingAiExtraction({ document, locked, onDocument, onRefresh, onBusyChange }: { document: IncomingDocument; locked: boolean; onDocument: (document: IncomingDocument) => void; onRefresh: () => void; onBusyChange: (busy: boolean) => void }) {
  const [settings, setSettings] = useState<AiProviderSettingsDto | null>(null);
  const [job, setJob] = useState<AiExtractionJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'run' | 'apply' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { if (job || error) setExpanded(true); }, [job, error]);
  const [costAccepted, setCostAccepted] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [needsStatusCheck, setNeedsStatusCheck] = useState(false);
  const active = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    Promise.all([
      aiJson<AiProviderSettingsDto>('/api/settings/ai-provider', { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setSettings(result); }),
      aiJson<{ extraction: AiExtractionJob | null }>(`/api/purchase-documents/${document.id}/ai-extraction`, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) { setJob(result.extraction); setNeedsStatusCheck(false); } }),
    ]).catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'KI-Status nicht verfügbar.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [document.id, refresh]);
  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.status) || busy) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      aiJson<{ extraction: AiExtractionJob | null }>(`/api/purchase-documents/${document.id}/ai-extraction`, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setJob(result.extraction); }).catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'KI-Status unklar.'); });
    }, 3000);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [job, busy, document.id]);
  async function mutate(operation: 'run' | 'apply') {
    if (active.current || locked || needsStatusCheck || (operation === 'apply' && !job)) return;
    if (operation === 'run' && (!settings || !costAccepted)) return;
    active.current = true; setBusy(operation); onBusyChange(true); setError(null);
    try {
      const result = await aiJson<{ extraction: AiExtractionJob; document: IncomingDocument }>(`/api/purchase-documents/${document.id}/ai-extraction${operation === 'apply' ? '/apply' : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(operation === 'apply' ? { expectedRevision: document.revision, jobId: job?.id } : { expectedRevision: document.revision, expectedConfigVersion: settings!.version, expectedConfigRevision: settings!.configurationRevision, acknowledgeCost: true, retry: job?.configRevision === settings!.configurationRevision && (job?.status === 'failed' || job?.status === 'unknown') }) });
      if (!result.extraction || !result.document || result.document.id !== document.id || result.extraction.sourceSha256 !== document.originalRef.sha256) throw new Error('Antwort unklar oder einem anderen Original zugeordnet. Gespeicherten Status prüfen.');
      if (alive.current) { setJob(result.extraction); onDocument(result.document); setCostAccepted(false); }
    } catch (caught) { if (alive.current) { setNeedsStatusCheck(true); setCostAccepted(false); setError(`${caught instanceof Error ? caught.message : 'KI-Ergebnis unklar.'} Original und Eingaben bleiben erhalten. Status zuerst prüfen; keine automatische Wiederholung.`); } }
    finally { active.current = false; if (alive.current) { setBusy(null); onBusyChange(false); } }
  }
  const supported = document.originalRef.mediaType !== 'application/xml';
  const pending = job?.status === 'queued' || job?.status === 'running';
  const differentConfig = !!job && !!settings && job.configRevision !== settings.configurationRevision;
  const mayRun = !needsStatusCheck && settings?.enabled && settings.configured && supported && document.reviewState === 'REVIEW' && (!job || differentConfig || job.status === 'failed' || job.status === 'unknown');
  return <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)} aria-labelledby="incoming-ai-heading" className="mb-5 border-y border-border py-2">
    <summary className="min-h-11 cursor-pointer py-3"><h3 id="incoming-ai-heading" className="inline-flex items-center gap-2 font-semibold"><ScanText className="size-4 shrink-0" aria-hidden="true" />Optionales KI-Auslesen</h3></summary>
    <p role="status" className="mt-2 flex items-center gap-2 text-sm font-medium">{(loading || busy || pending) && <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />}{busy === 'run' ? 'KI analysiert · Original bereits gespeichert' : busy === 'apply' ? 'Vorschläge werden in leere Entwurfsfelder übernommen…' : loading ? 'KI-Status wird geladen…' : aiStatusLabel(job?.status ?? null)}</p>
    <p className="mt-1 text-xs text-muted-foreground">Original bleibt erhalten. Vor Wiederholung den Status prüfen.</p>
    {error && <p role="alert" className="mt-3 border-l-2 border-destructive pl-3 text-sm text-destructive">{error}</p>}
    {job?.errorCode && !error && <p className="mt-3 text-sm text-caution-foreground">{aiRequestError(0, { code: job.errorCode })}</p>}
    {!loading && !supported && <p className="mt-3 text-sm text-muted-foreground">XML wird über eingebettete Rechnungsdaten ausgelesen. Keine zusätzliche kostenpflichtige KI-Analyse vorgesehen.</p>}
    {!loading && supported && settings && !settings.configured && <p className="mt-3 text-sm">Noch kein nutzbarer KI-Anbieter eingerichtet. <Link className="inline-flex min-h-11 items-center text-primary underline" href="/settings#ai-receipt-settings">Anbieter einrichten</Link> oder den Prüfentwurf manuell ausfüllen.</p>}
    {!loading && supported && settings?.configured && !settings.enabled && <p className="mt-3 text-sm">KI-Auslesen ist deaktiviert. <Link className="inline-flex min-h-11 items-center text-primary underline" href="/settings#ai-receipt-settings">In Einstellungen aktivieren</Link> oder manuell prüfen.</p>}
    {!loading && !settings && <p className="mt-3 text-sm">Anbieterstatus nicht bekannt. Status aktualisieren oder den Prüfentwurf manuell ausfüllen.</p>}
    {needsStatusCheck && <p className="mt-3 text-sm">Vor einer weiteren KI-Aktion zuerst „Nur KI-Status aktualisieren“ wählen. Ein laufender oder abgeschlossener Versuch wird nicht erneut gestartet.</p>}
    {differentConfig && <p className="mt-3 border-l-2 border-caution pl-3 text-sm">Diese Analyse stammt aus einer früheren Anbieter-Konfiguration. Sie wurde nicht mit der aktuellen Konfiguration ausgeführt. Eine neue Analyse benötigt erneut Ihre Kostenfreigabe.</p>}
    {job?.result && <AiReceiptSuggestions result={job.result} />}
    {job && <details className="mt-3 text-xs text-muted-foreground"><summary className="min-h-11 cursor-pointer py-3 focus-visible:outline-2 focus-visible:outline-ring">Herkunft dieser Analyse</summary><dl className="space-y-2 [&_dd]:break-all"><div><dt>Analyse / Anbieter-Konfigurationsversion</dt><dd>{job.id} / {job.configVersion}</dd></div><div><dt>Konfigurationskennung</dt><dd>{job.configRevision}</dd></div><div><dt>Original-Prüfsumme (SHA-256)</dt><dd className="font-mono">{job.sourceSha256}</dd></div><div><dt>Ausgangsrevision / erstellt</dt><dd>{job.sourceRevision} / {formatSourceDate(job.createdAt)}</dd></div></dl><p className="mt-2">Ungeprüfte KI-Vorschläge zu diesem Original; keine Zahlungs- oder Buchungsbestätigung.</p></details>}
    {job?.status === 'completed' && <div className="mt-4 space-y-3 text-sm"><p>{job.draftApplied ? 'Sichere leere Entwurfsfelder wurden automatisch ergänzt. Gespeicherten Entwurf laden und am Original prüfen.' : 'Vorschläge noch nicht in den Prüfentwurf übernommen. Nur leere Felder können ergänzt werden; eigene Angaben bleiben erhalten.'}</p>{document.reviewState === 'REVIEW' && <div className="flex flex-wrap gap-2">{!job.draftApplied && <Button variant="outline" disabled={locked || !!busy || needsStatusCheck} onClick={() => void mutate('apply')}>Leere Entwurfsfelder ergänzen</Button>}<Button variant="outline" disabled={locked || !!busy} onClick={onRefresh}>Gespeicherten Entwurf laden</Button></div>}</div>}
    {mayRun && !loading && <div className="mt-4 space-y-3 text-sm"><p className="break-words">Beleginhalte werden an <strong className="break-all">{settings.baseUrl}</strong> gesendet · Modell {settings.model}. Anbietergebühren möglich, Höhe unbekannt.</p><label className="flex min-h-11 items-start gap-3"><input type="checkbox" checked={costAccepted} disabled={locked || !!busy} onChange={event => setCostAccepted(event.target.checked)} className="mt-1 size-4 shrink-0 accent-primary" /><span>Übermittlung und mögliche Kosten für diese {job ? 'erneute ' : ''}Analyse freigeben.</span></label><Button disabled={locked || !!busy || !costAccepted} onClick={() => void mutate('run')}>{differentConfig ? 'Mit aktueller Konfiguration analysieren' : job ? 'KI-Analyse bewusst wiederholen' : 'Diesen Beleg mit KI auslesen'}</Button></div>}
    {locked && <p className="mt-3 text-xs text-muted-foreground">KI-Aktionen gesperrt: eigene Eingaben zuerst speichern oder die offene Belegaktion abschließen. Es wird nichts überschrieben.</p>}
    <Button className="mt-3" variant="ghost" disabled={!!busy || loading} onClick={() => { setCostAccepted(false); setRefresh(value => value + 1); }}>Nur KI-Status aktualisieren</Button>
  </details>;
}
