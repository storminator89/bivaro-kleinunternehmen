import Link from 'next/link';
import type { HandoffPreview, HandoffReadiness } from './handoff-model';
import styles from './handoff.module.css';

export function HandoffTasks({ preview, readiness }: { preview: HandoffPreview; readiness: HandoffReadiness }) {
  const i = readiness.incoming;
  const uncertainPayments = new Set(preview.manifest.warnings.filter(w => w.code === 'PAYMENT_DATE_UNCERTAIN').map(w => w.recordId)).size;
  const missing = preview.manifest.originalCounts.missing + preview.manifest.originalCounts.notAttached;
  return <section className={styles.tasks} aria-labelledby="handoff-tasks-title">
    <h3 id="handoff-tasks-title">Vor der Übergabe klären</h3>
    {i.datedCount === 0 && i.undatedCount === 0 && uncertainPayments === 0 && missing === 0 && <p>Keine offenen Prüfpunkte im erfassten Bestand.</p>}

    <div className={styles.taskCards}>
      <section hidden={i.datedCount === 0}><h4>{i.datedCount} {i.datedCount === 1 ? 'offener Eingangsbeleg' : 'offene Eingangsbelege'} im Zeitraum</h4>{i.datedCount > 0 ? <><ul>{i.datedExamples.map(row => <li key={row.id}><Link href={`/purchases?document=${row.id}`}>Beleg #{row.id}: {row.originalFileName}</Link></li>)}</ul>{i.datedCount > i.datedExamples.length && <p>Erste {i.datedExamples.length} von {i.datedCount}; weitere im Belegeingang.</p>}<Link href="/purchases">Weitere Belege prüfen</Link></> : null}</section>
      <section hidden={i.undatedCount === 0}><h4>{i.undatedCount} {i.undatedCount === 1 ? 'offener Eingangsbeleg' : 'offene Eingangsbelege'} ohne Belegdatum</h4>{i.undatedCount > 0 && <p>Jahreszuordnung unbekannt · arbeitsbereichsweit. Davon {i.undatedUploadedInPeriod} im Zeitraum hochgeladen; Upload ist kein Belegdatum.</p>}{i.undatedCount > 0 && <ul>{i.undatedExamples.map(row => <li key={row.id}><Link href={`/purchases?document=${row.id}`}>Datum klären: Beleg #{row.id}, {row.originalFileName}</Link></li>)}</ul>}</section>
      <section hidden={uncertainPayments === 0}><h4>{uncertainPayments} {uncertainPayments === 1 ? 'historischer Zahlungsnachweis' : 'historische Zahlungsnachweise'} mit unsicherem Datum</h4>{uncertainPayments > 0 && <p>Unbekannt ist nicht null. Jahreszuordnung mit Original- und Banknachweisen prüfen.</p>}{uncertainPayments > 0 && <Link href="/dashboard?tab=invoices">Rechnungen und Zahlungsverläufe prüfen</Link>}</section>
      <section hidden={missing === 0}><h4>{missing} {missing === 1 ? 'fehlende Originaldatei' : 'fehlende Originaldateien'} im Paket</h4>{missing > 0 && <a href="#handoff-warning-title">Zu den betroffenen Datensätzen</a>}</section>
    </div>
    <p className={styles.muted}>Ungebuchte Belege fehlen im ZIP. Nach Korrekturen neu laden.</p>
    <p className={styles.muted}>Stand {new Date(readiness.checkedAt).toLocaleString('de-DE', { timeZone: 'UTC' })} UTC · keine Freigabe.</p>
  </section>;
}
