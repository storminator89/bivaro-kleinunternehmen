'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { IncomingDocument } from '@/lib/purchase-documents/types';
import { PURCHASE_RULES_VERSION, PURCHASE_VALIDATION_VERSION, purchaseValidationLabel, type PurchaseValidationRecord, type PurchaseValidationResponse } from '@/lib/purchase-documents/validation-contract';
import { errorMessage, incomingJson } from './incoming-document-ui';

export function validationExplanation(reason: string): string {
  if (reason === 'SUPPORTED_RULES_PASSED') return 'Die unterstützten XRechnung-Regeln sind erfüllt. Empfänger, Inhalt und Zahlung weiterhin selbst prüfen.';
  if (reason === 'RULE_WARNINGS') return 'Die Prüfung ist durchgelaufen und hat Hinweise gefunden. Vor der fachlichen Freigabe prüfen.';
  if (reason === 'RULE_VIOLATIONS') return 'Technische Regeln sind verletzt. Fehler mit dem Rechnungsaussteller klären; ein korrigiertes Original separat hochladen.';
  if (reason === 'STANDALONE_XML_ONLY') return 'Aktuell werden nur eigenständige XRechnung-XML-Dateien geprüft. PDF-, Foto- und Factur-X-Prüfung sind nicht enthalten.';
  if (reason === 'PROFILE_UNSUPPORTED') return 'Dieses Format, Profil oder dieser Belegtyp wird nicht geprüft. Unterstützt: XRechnung 3.0, CII und UBL Invoice, Rechnungstyp 380.';
  if (reason === 'XML_SCHEMA_HINTS_UNSUPPORTED') return 'Diese Prüfung unterstützt keine XML-Dateien mit externen Schema-Verweisen. Die versionierten Regeln wählen das Schema selbst. Das Original wird nicht verändert; dies ist keine Aussage zur fachlichen Gültigkeit der Rechnung.';
  if (reason === 'ORIGINAL_HASH_MISMATCH') return 'Die Original-Prüfsumme stimmt nicht überein. Dieser Bericht bestätigt keine Gültigkeit.';
  if (reason === 'XML_EXTERNAL_CONTENT') return 'XML enthält eine gesperrte externe Inhaltsreferenz. Es wurden keine externen Inhalte geladen.';
  if (reason === 'XML_SIZE_LIMIT' || reason === 'XML_RESOURCE_LIMIT' || reason === 'XML_PROFILE_LIMIT') return 'Die sichere Prüfgrenze ist überschritten: höchstens 2 MiB XML, 64 Ebenen und 20.000 Elemente.';
  if (reason.startsWith('XML_')) return 'XML ist nicht sicher lesbar oder nicht UTF-8-kodiert. Das archivierte Original bleibt unverändert.';
  if (reason === 'VALIDATOR_TIMEOUT') return 'Die Prüfung hat ihr Zeitlimit erreicht. Kein positives Ergebnis; später erneut versuchen.';
  return 'Prüfwerkzeug oder versionierte Regeln sind nicht verfügbar. Keine technische Freigabe; später erneut versuchen.';
}
export function TechnicalReportDetails({ record }: { record: PurchaseValidationRecord }) {
  const report = record.report;
  const checkLabel = { PASSED: 'Bestanden', WARNINGS: 'Hinweise', FAILED: 'Fehlgeschlagen', NOT_RUN: 'Nicht ausgeführt' };
  return <details className="mt-3 text-xs text-muted-foreground">
    <summary className="min-h-11 cursor-pointer py-3 font-medium focus-visible:outline-2 focus-visible:outline-ring">Prüfdetails und Regeln</summary>
    <dl className="space-y-2 [&_dd]:break-all [&_dt]:font-medium">
      <div><dt>Prüfzeit</dt><dd>{new Date(report.checkedAt).toLocaleString('de-DE')}</dd></div>
      <div><dt>Prüfwerkzeug / Regeln</dt><dd>{report.validatorVersion} · {report.rulesVersion} · {report.checkerVersion}</dd></div>
      <div><dt>Prüfschritte</dt><dd>XML: {checkLabel[report.checks.xml]} · XSD: {checkLabel[report.checks.xsd]} · Schematron: {checkLabel[report.checks.schematron]}</dd></div>
      <div><dt>Profil</dt><dd>{report.profile || 'Nicht erkannt'}</dd></div>
      <div><dt>Original (SHA-256)</dt><dd className="font-mono">{report.originalSha256}</dd></div>
      <div><dt>Regelpaket (SHA-256)</dt><dd className="font-mono">{report.rulesSha256}</dd></div>
      <div><dt>Bericht-ID / Ergebniscode</dt><dd>{record.id} · {report.reasonCode}</dd></div>
    </dl>
    {report.findings.length > 0 && <ul className="mt-4 space-y-3">{report.findings.map((finding, index) => <li key={`${finding.ruleId}-${index}`} className="break-words">
      <span className="font-semibold">{finding.ruleId} · {finding.severity === 'error' ? 'Fehler' : finding.severity === 'warning' ? 'Warnung' : 'Information'}</span><p className="mt-1">{finding.message}</p>
      {finding.field && <details className="mt-1"><summary className="min-h-11 cursor-pointer py-3 focus-visible:outline-2 focus-visible:outline-ring">Feld im XML anzeigen</summary><p className="break-all font-mono">{finding.field}</p></details>}
    </li>)}</ul>}
    {report.findingsTruncated && <p className="mt-3">Der Bericht zeigt höchstens 256 Hinweise. Weitere Hinweise wurden nicht gespeichert.</p>}
  </details>;
}
export function IncomingTechnicalValidation({ document, locked, onBusyChange }: { document: IncomingDocument; locked: boolean; onBusyChange: (busy: boolean) => void }) {
  const [reports, setReports] = useState<PurchaseValidationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const requestId = useRef<string | null>(null);
  const alive = useRef(true);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null); setReports([]); requestId.current = null;
    incomingJson<PurchaseValidationResponse>(`/api/purchase-documents/${document.id}/validation`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setReports(result.reports); })
      .catch(value => { if (!controller.signal.aborted) setError(errorMessage(value)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [document.id, document.originalRef.sha256, refresh]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  async function validate() {
    if (busyRef.current || locked || loading) return;
    busyRef.current = true; setBusy(true); setError(null); onBusyChange(true);
    try {
      requestId.current ??= crypto.randomUUID();
      const result = await incomingJson<PurchaseValidationResponse>(`/api/purchase-documents/${document.id}/validation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: document.revision, expectedSha256: document.originalRef.sha256, requestId: requestId.current, checkerVersion: PURCHASE_VALIDATION_VERSION, rulesVersion: PURCHASE_RULES_VERSION }) });
      if (!alive.current) return;
      setReports(result.reports); requestId.current = null;
      requestAnimationFrame(() => resultHeading.current?.focus({ preventScroll: true }));
    } catch (value) { if (alive.current) setError(errorMessage(value)); }
    finally { busyRef.current = false; if (alive.current) { setBusy(false); onBusyChange(false); } }
  }
  const latest = reports.find(record => record.current) ?? reports[0];
  const actionable = latest?.report.findings.filter(finding => finding.severity !== 'information').slice(0, 3) ?? [];
  return <section aria-label="Technische E-Rechnungsprüfung" className="mb-5 border-y border-border py-4 text-sm">
    <h3 ref={resultHeading} tabIndex={-1} className="flex items-center gap-2 font-semibold outline-none"><Shield className="size-4 shrink-0" aria-hidden="true" />Technische E-Rechnungsprüfung</h3>
    <p className="mt-2 text-xs text-muted-foreground">Auslesen ist keine Validierung. Geprüft werden unterstützte XSD-/Schematron-Regeln, nicht Identität, Zahlung oder steuerliche Freigabe.</p>
    {loading ? <p role="status" className="mt-3 text-muted-foreground">Prüfhistorie wird geladen…</p> : latest ? <div className="mt-3 space-y-2" role="status">
      <p className="font-medium">{latest.current ? purchaseValidationLabel(latest.report) : 'Historischer Prüfbericht · keine aktuelle technische Freigabe'}</p>
      <p className="text-muted-foreground">{latest.current ? validationExplanation(latest.report.reasonCode) : 'Importierte Berichte oder ältere Prüfversionen bleiben als Nachweis erhalten. Für einen aktuellen Stand die Prüfung bewusst neu starten.'}</p>
      {actionable.length > 0 && <ul className="space-y-2 border-l-2 border-caution pl-3">{actionable.map((finding, index) => <li key={`${finding.ruleId}-${index}`} className="break-words"><span className="font-medium">{finding.ruleId}</span>: {finding.message}</li>)}</ul>}
      <TechnicalReportDetails record={latest} />
    </div> : !error && <p className="mt-3 text-muted-foreground">Noch kein technischer Prüfbericht. Das Auslesen und der Buchungsstatus bleiben davon unabhängig.</p>}
    {error && <div ref={errorRef} tabIndex={-1} role="alert" className="mt-3 space-y-2 border-l-2 border-caution pl-3 outline-none"><p className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p><p className="text-xs text-muted-foreground">Kein positives Ergebnis aus dieser Anfrage. Ein vorheriger Bericht bleibt unverändert erhalten.</p><Button variant="ghost" disabled={busy || locked} onClick={() => setRefresh(value => value + 1)}>Prüfhistorie neu laden</Button></div>}
    <Button variant="outline" className="mt-3 min-h-11 max-w-full whitespace-normal" disabled={busy || locked || loading} onClick={validate}>{busy && <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />}{busy ? 'Technische Prüfung läuft…' : error ? 'Prüfung sicher erneut versuchen' : latest ? 'Erneut technisch prüfen' : 'Technisch prüfen'}</Button>
    <p className="mt-2 text-xs text-muted-foreground">Nur eigenständige XRechnung-XML (CII / UBL Invoice), höchstens 2 MiB. Lokal ohne Dokument-Upload. Ein neuer Lauf bewahrt ältere Berichte und bucht nichts.</p>
    {reports.length > 1 && <details className="mt-3 text-xs text-muted-foreground"><summary className="min-h-11 cursor-pointer py-3 font-medium focus-visible:outline-2 focus-visible:outline-ring">Weitere Prüfberichte ({reports.length - 1}, höchstens 20 angezeigt)</summary><ul className="space-y-3">{reports.filter(record => record.id !== latest?.id).map(record => <li key={record.id}><p className="font-medium">{record.current ? purchaseValidationLabel(record.report) : 'Historischer Bericht · keine aktuelle Freigabe'}</p><TechnicalReportDetails record={record} /></li>)}</ul></details>}
  </section>;
}
