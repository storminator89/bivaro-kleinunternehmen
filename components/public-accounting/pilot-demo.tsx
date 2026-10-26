import { createPilotDemoWorksheet, formatPilotDemoAmount, pilotDemo, pilotDemoLimits, pilotDemoSteps } from '@/lib/pilot-demo';
import styles from './pilot-demo.module.css';

/** Server-rendered text walkthrough. Native links/details need no demo JS or API. */
export function PilotDemo() {
  return <div className={styles.demo}>
    <p className={styles.label}>Synthetischer Textablauf · kein Produkt-Screenshot</p>
    <p>Ein erfundener Musterbetrieb zeigt fünf zusammenhängende Schritte. Lesen und Beispiele öffnen ist ohne Anmeldung möglich; es werden keine echten Vorgänge angelegt.</p>
    <p className={styles.limit}>{pilotDemoLimits}</p>
    <nav aria-label="Schritte im synthetischen Beispiel" className={styles.index}>
      <ol>{pilotDemoSteps.map((step, index) => <li key={step.id}><a href={`#${step.id}`}>{index + 1}. {step.title}</a></li>)}</ol>
    </nav>

    <ol className={styles.steps}>
      {pilotDemoSteps.map((step, index) => <li key={step.id}>
        <section id={step.id} aria-labelledby={`${step.id}-title`}>
          <h3 id={`${step.id}-title`}>{index + 1}. {step.title}</h3>
          <p>{step.story}</p>
          <p>{step.action}</p>
          <p className={styles.result}><strong>{step.result}</strong></p>
          {step.id === 'demo-beleg' && <details className={styles.details}>
            <summary>Synthetischen Textbeleg ansehen</summary>
            <figure className={styles.receipt}>
              <figcaption>Erfundener Textbeleg · keine echte Rechnung</figcaption>
              <dl>
                <div><dt>Beispiel-ID</dt><dd>{pilotDemo.receiptId}</dd></div>
                <div><dt>Beschreibung</dt><dd>Erfundenes Büromaterial</dd></div>
                <div><dt>Beispiel-Zahlungsdatum</dt><dd>03.10.2026</dd></div>
                <div><dt>Beispielbetrag</dt><dd>{formatPilotDemoAmount(pilotDemo.expenseCents)}</dd></div>
              </dl>
              <p>Nur zum Verständnis des Belegbezugs. Kein Original, kein Import und keine Aussage zum Vorsteuerabzug.</p>
              <a href="#demo-beleg">Zurück zum Schritt „Ausgabe mit Beleg verbinden“</a>
            </figure>
          </details>}
          {step.id === 'demo-korrektur' || step.id === 'demo-uebergabe'
            ? <p className={styles.warning}>{step.caution}</p>
            : <details className={styles.details}><summary>Worauf Sie achten sollten: {step.title}</summary><p>{step.caution}</p></details>}
          <div className={styles.links}>
            {index < pilotDemoSteps.length - 1
              ? <a href={`#${pilotDemoSteps[index + 1].id}`}>Weiter: {pilotDemoSteps[index + 1].title}</a>
              : <a href="#umstieg">Nächster Schritt: Umstieg vorbereiten</a>}
            <a href={step.guideHref}>{step.guideLabel}</a>
          </div>
        </section>
      </li>)}
    </ol>

    <details className={styles.details}>
      <summary>Produkt, Konzept und offene Nachweise unterscheiden</summary>
      <p>Der Text beschreibt Bedienwege am Quellstand <code>{pilotDemo.sourceRef.slice(0, 8)}</code>, Erklärblatt-Version {pilotDemo.version}. Er ist kein aus einem abgenommenen Build erzeugtes PDF, Original, Screenshot oder Übergabepaket. Versionierte Produktdateien, Browser-Abnahme und freiwilliger Empfängerreview bleiben gesonderte Nachweise.</p>
      <p>Für diesen einfachen Inlandsfall in Euro wird ein geklärtes Kleinunternehmerprofil angenommen. Ausland/Reverse Charge, Anzahlungen/Schlussrechnungen, Kassenbuch, ungeklärte Altzahlungen und vollständige Regelbesteuerung werden hier nicht demonstriert. Bei solchen oder ungeklärten Fällen stoppen und fachlich prüfen lassen.</p>
      <p>Selbstbetrieb, betreute Instanz und SaaS haben denselben fachlichen Ablauf. Verfügbarkeit und Zuständigkeit für Einrichtung, Updates, Sicherung, Wiederherstellung und Ausstieg mit dem Betreiber klären. Nicht zugesagte Varianten bleiben Konzept, kein buchbares Angebot.</p>
    </details>
    <div className={styles.worksheet}>
      <a href={pilotDemo.worksheetHref} download="bivaro-pilot-v1.txt">Synthetisches Erklärblatt herunterladen (.txt)</a>
      <p>Nur die erfundene Geschichte und ihre Grenzen, kein Produktexport. Falls der Download nicht startet, den Text unten öffnen und kopieren.</p>
      <details className={styles.details}>
        <summary>Dasselbe Erklärblatt zum Lesen und Kopieren</summary>
        <pre className={styles.sheet}>{createPilotDemoWorksheet()}</pre>
      </details>
    </div>
  </div>;
}
