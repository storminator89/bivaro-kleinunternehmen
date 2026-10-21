import Link from 'next/link';
import type { HandoffPreview, HandoffReadiness } from './handoff-model';
import styles from './handoff.module.css';

export function HandoffTasks({ preview, readiness }: { preview: HandoffPreview; readiness: HandoffReadiness }) {
  const i = readiness.incoming;
  const uncertainPayments = new Set(preview.manifest.warnings.filter(w => w.code === 'PAYMENT_DATE_UNCERTAIN').map(w => w.recordId)).size;
  const missing = preview.manifest.originalCounts.missing + preview.manifest.originalCounts.notAttached;
  return <section className={styles.tasks} aria-labelledby="handoff-tasks-title">
    <h3 id="handoff-tasks-title">Vor der Übergabe klären</h3>
    <p className={styles.muted}>Dies sind konkrete Datenhinweise, keine Freigabe. Ungebuchte Eingangsbelege fehlen im ZIP. Prüfen Sie zusätzlich Ihre Bank- und eigenen Unterlagen.</p>
    <div className={styles.taskCards}>
      <section><h4>{i.datedCount} {i.datedCount === 1 ? 'offener Eingangsbeleg' : 'offene Eingangsbelege'} im Zeitraum</h4><p>Nur „Zu prüfen“, nach gespeichertem Belegdatum. Bereits gebuchte oder verworfene Belege zählen nicht als offen.</p>{i.datedCount > 0 ? <><ul>{i.datedExamples.map(row => <li key={row.id}><Link href={`/purchases?document=${row.id}`}>Beleg #{row.id}: {row.originalFileName}</Link></li>)}</ul>{i.datedCount > i.datedExamples.length && <p>Erste {i.datedExamples.length} von {i.datedCount}; weitere im Belegeingang.</p>}<Link href="/purchases">Weitere Belege prüfen</Link></> : <p>Keine datierten offenen Eingangsbelege in dieser Auswahl.</p>}</section>
      <section><h4>{i.undatedCount} {i.undatedCount === 1 ? 'offener Eingangsbeleg' : 'offene Eingangsbelege'} ohne Belegdatum</h4><p>Jahreszuordnung unbekannt — arbeitsbereichsweit, nicht automatisch diesem Zeitraum zugerechnet. Davon {i.undatedUploadedInPeriod} im gewählten Zeitraum hochgeladen. Upload ist kein Belegdatum.</p>{i.undatedCount > 0 && <ul>{i.undatedExamples.map(row => <li key={row.id}><Link href={`/purchases?document=${row.id}`}>Datum klären: Beleg #{row.id}, {row.originalFileName}</Link></li>)}</ul>}</section>
      <section><h4>{uncertainPayments} {uncertainPayments === 1 ? 'historischer Zahlungsnachweis' : 'historische Zahlungsnachweise'} mit unsicherem Datum</h4><p>Aus den Warnungen dieses Paketstands, einschließlich Rechnungskontext. „Unbekannt“ bedeutet weder null Euro noch keine Zahlung. Vor einer Jahreszuordnung mit Original- und Banknachweisen abgleichen; das Paket erfindet kein Zahlungsdatum.</p>{uncertainPayments > 0 && <Link href="/dashboard?tab=invoices">Rechnungen und Zahlungsverläufe prüfen</Link>}</section>
      <section><h4>{missing} {missing === 1 ? 'fehlende Originaldatei' : 'fehlende Originaldateien'} im Paket</h4><p>Aus der verbindlichen Paketvorschau. Betroffene Datensätze und Prüfziele finden Sie bei den Warnungen unten. Auch null fehlende Dateien beweist nicht, dass alle Geschäftsvorfälle erfasst wurden.</p>{missing > 0 && <a href="#handoff-warning-title">Zu den betroffenen Datensätzen</a>}</section>
    </div>
    <p className={styles.muted}>Aufgabe öffnen, mit „Zurück“ zur unveränderten Zeitraumwahl zurückkehren und die Vorschau neu laden. Die Prüfliste ist eine Momentaufnahme, keine Live-Überwachung.</p>
    <p className={styles.muted}>Prüfaufgaben geladen: {new Date(readiness.checkedAt).toLocaleString('de-DE', { timeZone: 'UTC' })} UTC.</p>
  </section>;
}
