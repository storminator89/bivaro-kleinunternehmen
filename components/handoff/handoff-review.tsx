import { AlertTriangle, FileArchive } from 'lucide-react';
import { formatBusinessDateDisplay } from '@/lib/business-date';
import { handoffWarningTarget, type HandoffPreview } from './handoff-model';
import Link from 'next/link';
import styles from './handoff.module.css';

const countLabels = [
  ['incomes', 'Einnahmen'], ['expenses', 'Ausgaben'], ['invoices', 'Rechnungen und Gutschriften'],
  ['payments', 'Original-Zahlungsnachweise'], ['adjustments', 'Korrektur- und Erstattungsnachweise'],
  ['cashTransactions', 'Kassenbewegungen'], ['customers', 'Zugehörige Kunden'], ['cashBooks', 'Zugehörige Kassenbücher'],
] as const;

export function HandoffReview({ preview }: { preview: HandoffPreview }) {
  const { manifest: m } = preview;
  const absent = m.originalCounts.missing + m.originalCounts.notAttached;
  const hasRecords = countLabels.some(([key]) => m.counts[key] > 0);
  return <div className={styles.review}>
    <div className={styles.reviewHeading}>
      <FileArchive aria-hidden="true" />
      <div><h3>Vorschau für Ihre Übergabe</h3><p>{formatBusinessDateDisplay(m.period.from)} bis {formatBusinessDateDisplay(m.period.to)} · beide Tage eingeschlossen</p></div>
    </div>
    <dl className={styles.counts}>{countLabels.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{m.counts[key].toLocaleString('de-DE')}</dd></div>)}</dl>
    <p className={styles.notice} role="note">{m.fiscalMappingStatus === 'UNREVIEWED' ? <><strong>Steuerlich nicht freigegeben</strong> (UNREVIEWED). Korrekturen und Erstattungen vor EÜR oder Steuerexport fachlich prüfen.</> : 'Zahlungszuordnung unverändert (UNCHANGED) · keine steuerliche Freigabe.'}</p>
    {!hasRecords && <p className={styles.notice}>Keine Datensätze im gewählten Zeitraum. Ein Download enthält nur die leeren Tabellen und die Paketbeschreibung. Prüfen Sie Ihre Auswahl.</p>}
    <div className={styles.originals}>
      <h3>Originaldateien</h3>
      <p><strong>{m.originalCounts.included.toLocaleString('de-DE')}</strong> unverändert enthalten</p>
      {absent > 0 && <div className={styles.warning} role="note"><AlertTriangle aria-hidden="true" /><div><strong>{absent.toLocaleString('de-DE')} {absent === 1 ? 'Original fehlt' : 'Originale fehlen'}</strong><p>Fehlende oder nicht lesbare referenzierte Dateien: {m.originalCounts.missing}. Ausgaben ohne hinterlegtes Original: {m.originalCounts.notAttached}. Die betroffenen Datensätze bleiben enthalten. Klären Sie die fehlenden Originale vor der Übergabe.</p></div></div>}
      {absent === 0 && <p className={styles.muted}>Für die ausgewählten Datensätze wurden keine fehlenden Originale festgestellt. Das ist keine Vollständigkeitsprüfung Ihrer Unterlagen.</p>}
    </div>
    {m.warningCount > 0 ? <section className={styles.warningSection} aria-labelledby="handoff-warning-title">
      <h3 id="handoff-warning-title" tabIndex={-1}><AlertTriangle aria-hidden="true" />{m.warningCount.toLocaleString('de-DE')} {m.warningCount === 1 ? 'Warnung' : 'Warnungen'} vor der Übergabe prüfen</h3>
      <p>Das Paket wird mit diesen Warnungen erstellt, nicht als vollständig geprüft freigegeben.</p>
      <details><summary>Warnungen anzeigen</summary><ul>{m.warnings.slice(0, 50).map((warning, index) => <li key={`${warning.code}-${warning.recordId}-${index}`}><strong>{warning.recordType}{warning.recordId !== null ? ` #${warning.recordId}` : ''}:</strong> {warning.message}{handoffWarningTarget(warning) && <><br /><Link href={handoffWarningTarget(warning)!.href}>{handoffWarningTarget(warning)!.label}</Link></>}</li>)}</ul>{m.warningCount > 50 && <p>Hier sind die ersten 50 von {m.warningCount} Warnungen sichtbar. Alle Warnungen stehen in manifest.json im Paket.</p>}</details>
    </section> : <p className={styles.notice}>Keine technischen Warnungen in dieser Vorschau. Die fachliche Prüfung und der Abgleich mit Ihren eigenen Unterlagen bleiben erforderlich.</p>}
    <section className={styles.packageIdentity}><h3>Paketstand und Wiederholbarkeit</h3><p>Manifestversion {m.formatVersion} · Zahlungsvertrag {m.paymentContractVersion} · Vorschau erstellt: {new Date(m.generatedAt).toLocaleString('de-DE', { timeZone: 'UTC' })} UTC.</p><p>Dateiname: {preview.filename}</p><p>Quellfingerabdruck (SHA-256): <code>{m.sourceFingerprint}</code></p><p>Gleiche Auswahl und unveränderte Quellen ergeben denselben Quellfingerabdruck. Die Erstellzeit und ZIP-Bytes können sich unterscheiden. Ein neuer Datenstand erfordert eine neue Vorschau; alte Empfangsnotizen bestätigen ihn nicht.</p></section>
    <p className={styles.muted}>Rechnung, Einnahme und verknüpfte Kassenbewegung sind verschiedene Sichten desselben Vorgangs. Addieren Sie diese Tabellen nicht miteinander.</p>
  </div>;
}
