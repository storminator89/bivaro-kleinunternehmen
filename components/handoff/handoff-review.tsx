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
      <div><h3>Paketinhalt</h3><p>{formatBusinessDateDisplay(m.period.from)} bis {formatBusinessDateDisplay(m.period.to)}</p></div>
    </div>
    <dl className={styles.counts}>{countLabels.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{m.counts[key].toLocaleString('de-DE')}</dd></div>)}</dl>
    <p className={styles.notice} role="note">{m.fiscalMappingStatus === 'UNREVIEWED' ? <><strong>Steuerlich nicht freigegeben.</strong> Korrekturen und Erstattungen prüfen.</> : 'Steuerlich ungeprüft.'}</p>
    {!hasRecords && <p className={styles.notice}>Keine Datensätze im gewählten Zeitraum. Das ZIP enthält nur leere Tabellen und die Paketbeschreibung.</p>}
    <div className={styles.originals}>
      <h3>Originaldateien</h3>
      <p><strong>{m.originalCounts.included.toLocaleString('de-DE')}</strong> unverändert enthalten</p>
      {absent > 0 && <div className={styles.warning} role="note"><AlertTriangle aria-hidden="true" /><div><strong>{absent.toLocaleString('de-DE')} {absent === 1 ? 'Original fehlt' : 'Originale fehlen'}</strong><p>Fehlende oder nicht lesbare referenzierte Dateien: {m.originalCounts.missing}. Ausgaben ohne hinterlegtes Original: {m.originalCounts.notAttached}. Datensätze bleiben enthalten; Originale vor Übergabe klären.</p></div></div>}
      {absent === 0 && <p className={styles.muted}>Keine fehlenden Originale festgestellt; Vollständigkeit ungeprüft.</p>}
    </div>
    {m.warningCount > 0 ? <section className={styles.warningSection} aria-labelledby="handoff-warning-title">
      <h3 id="handoff-warning-title" tabIndex={-1}><AlertTriangle aria-hidden="true" />{m.warningCount.toLocaleString('de-DE')} {m.warningCount === 1 ? 'Warnung' : 'Warnungen'} vor der Übergabe prüfen</h3>
      <p>Warnungen bleiben im Paket enthalten.</p>
      <details><summary>Warnungen anzeigen</summary><ul>{m.warnings.slice(0, 50).map((warning, index) => <li key={`${warning.code}-${warning.recordId}-${index}`}><strong>{warning.recordType}{warning.recordId !== null ? ` #${warning.recordId}` : ''}:</strong> {warning.message}{handoffWarningTarget(warning) && <><br /><Link href={handoffWarningTarget(warning)!.href}>{handoffWarningTarget(warning)!.label}</Link></>}</li>)}</ul>{m.warningCount > 50 && <p>Hier sind die ersten 50 von {m.warningCount} Warnungen sichtbar. Alle Warnungen stehen in manifest.json im Paket.</p>}</details>
    </section> : <p className={styles.notice}>Keine technischen Warnungen.</p>}
    <details className={styles.packageIdentity}><summary>Paketstand und Prüfsumme</summary><p>Manifestversion {m.formatVersion} · Zahlungsvertrag {m.paymentContractVersion} · Vorschau erstellt: {new Date(m.generatedAt).toLocaleString('de-DE', { timeZone: 'UTC' })} UTC.</p><p>Dateiname: {preview.filename}</p><p>Quellfingerabdruck (SHA-256): <code>{m.sourceFingerprint}</code></p><p>Gleiche Auswahl und unveränderte Quellen ergeben denselben Quellfingerabdruck. Die Erstellzeit und ZIP-Bytes können sich unterscheiden. Ein neuer Datenstand erfordert eine neue Vorschau; alte Empfangsnotizen bestätigen ihn nicht.</p><p>Rechnung, Einnahme und Kassenbewegung desselben Vorgangs nicht addieren. Unterlagen fachlich prüfen; keine Vollständigkeitsprüfung.</p></details>

  </div>;
}
