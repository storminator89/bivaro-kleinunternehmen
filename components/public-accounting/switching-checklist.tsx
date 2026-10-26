'use client';

import { useState } from 'react';
import {
  createSwitchingReview,
  createSwitchingState,
  isSwitchingStatus,
  summarizeSwitchingState,
  switchingReviewLimits,
  switchingStatusLabels,
  switchingStatuses,
  switchingTopics,
} from '@/lib/switching-checklist';
import styles from './switching-checklist.module.css';

export function SwitchingChecklist() {
  const [state, setState] = useState(createSwitchingState);
  const [notice, setNotice] = useState('');
  const counts = summarizeSwitchingState(state);
  const review = createSwitchingReview(state);

  function downloadReview() {
    let url: string | undefined;
    let link: HTMLAnchorElement | undefined;
    try {
      url = URL.createObjectURL(new Blob([review], { type: 'text/plain;charset=utf-8' }));
      link = document.createElement('a');
      link.href = url;
      link.download = 'bivaro-manueller-umstiegsreview.txt';
      document.body.appendChild(link);
      link.click();
      setNotice('Download angefordert. Falls keine Datei erscheint, den Reviewbogen unten öffnen und den Text kopieren.');
    } catch {
      setNotice('Download nicht verfügbar. Den Reviewbogen unten öffnen und den Text kopieren. Ihre Auswahl bleibt erhalten.');
    } finally {
      link?.remove();
      // Let the browser consume the download before releasing its local URL.
      if (url) {
        const objectUrl = url;
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
    }
  }

  return <div className={styles.checklist}>
    <p>Bereiten Sie sechs Punkte für ein Gespräch mit Betreiber und Steuerkanzlei vor. Es werden keine Firmen-, Rechnungs- oder Kontodaten abgefragt.</p>
    <p className={styles.privacy}>Nur auf dieser geöffneten Seite: Die Checkliste speichert oder übermittelt Ihre Auswahl nicht. Ein Neuladen setzt sie zurück. Den aktuellen Stand bei Bedarf vorher als Reviewbogen herunterladen.</p>
    <noscript><p>Für Statusauswahl und Download JavaScript aktivieren. Die sechs Prüfpunkte können Sie auch ohne JavaScript lesen und manuell für Ihren Review übernehmen.</p></noscript>
    <p className={styles.limit}>{switchingReviewLimits}</p>

    <div className={styles.progress} role="status" aria-live="polite" aria-atomic="true">
      <strong>{counts.prepared} von {switchingTopics.length} Punkten selbst vorbereitet</strong>
      <span>{counts.open} noch offen · {counts.review} mit Prüfbedarf</span>
      <p>{counts.review > 0
        ? 'Prüfbedarf zuerst mit Betreiber oder fachlicher Prüfstelle klären. Nicht als Umstiegsfreigabe behandeln.'
        : counts.prepared === switchingTopics.length
          ? 'Die Selbsteinschätzung ist ausgefüllt. Der manuelle Review und die Entscheidung über den Umstieg bleiben offen.'
          : 'Offene Punkte sammeln und separat belegen. „Selbst vorbereitet“ bedeutet nicht unabhängig geprüft.'}</p>
    </div>

    <ol className={styles.topics}>
      {switchingTopics.map((topic, index) => <li key={topic.id}>
        <h3>{index + 1}. {topic.title}</h3>
        <p id={`umstieg-${topic.id}-task`}>{topic.task}</p>
        <details className={styles.details}>
          <summary>Was für den Review vorliegen sollte</summary>
          <p>{topic.evidence}</p>
        </details>
        <label className={styles.statusLabel} htmlFor={`umstieg-${topic.id}`}>Ihr Stand: {topic.title}</label>
        <select
          id={`umstieg-${topic.id}`}
          value={state[topic.id]}
          aria-describedby={`umstieg-${topic.id}-task`}
          onChange={event => {
            const value = event.target.value;
            if (isSwitchingStatus(value)) {
              setState(current => ({ ...current, [topic.id]: value }));
              setNotice('');
            }
          }}
        >
          {switchingStatuses.map(status => <option key={status} value={status}>{switchingStatusLabels[status]}</option>)}
        </select>
      </li>)}
    </ol>

    <details className={styles.details}>
      <summary>Grenzen und Betriebsmodell vorab klären</summary>
      <p>Für einfache Inlandsvorgänge in Euro mit manueller Erfassung. Ausland/Reverse Charge, Anzahlungen und Schlussrechnungen, Erstattungen, komplexe Anlagen, Kassenbetriebe, gemeinsame Firmenzugänge und vollständige Regelbesteuerung sind ausgeschlossen oder gesondert zu prüfen. Bei einem ungeklärten Fall zuerst Betreiber und fachliche Prüfstelle einbeziehen.</p>
      <p>Selbstbetrieb, betreute Instanz und SaaS benötigen denselben fachlichen Abgleich. Verfügbarkeit und Leistungen mit dem Betreiber vereinbaren; nicht zugesagte Varianten sind Konzept, kein buchbares Angebot.</p>
      <p>Diese Checkliste ist keine geführte Demo. Ein vollständiger synthetischer Beispielablauf mit versionierten Dateien und Screenshots aus einem abgenommenen Build sowie freiwilliger Empfängerreview bleiben gesonderte Nachweise. Ein Demo-Erfolg ist keine Produktfreigabe.</p>
    </details>

    <div className={styles.review}>
      <h3>Manuellen Review vorbereiten</h3>
      <p>Der Textbogen enthält Ihre sechs Statusangaben, offene Fragen und leere Felder für Stichtag, Betriebsmodell, Nachweise und Prüfergebnis. Erst nach dem Download selbst ergänzen und bei Bedarf ausdrucken. Kein Versand und keine automatische Kontaktaufnahme.</p>
      <div className={styles.actions}>
        <button type="button" className={styles.primaryButton} onClick={downloadReview}>Reviewbogen herunterladen (.txt)</button>
        <button type="button" className={styles.resetButton} onClick={() => { setState(createSwitchingState()); setNotice('Alle sechs Statusangaben wurden auf „Noch offen“ zurückgesetzt. Bereits heruntergeladene Dateien bleiben unverändert.'); }}>Auswahl zurücksetzen</button>
      </div>
      <p role="status" aria-live="polite" className={styles.notice}>{notice}</p>
      <details className={styles.details}>
        <summary>Reviewbogen zum Kopieren anzeigen</summary>
        <label className={styles.statusLabel} htmlFor="umstieg-review-text">Aktueller Reviewbogen – nur lesbar</label>
        <textarea id="umstieg-review-text" className={styles.reviewText} readOnly value={review} rows={14} spellCheck={false} />
      </details>
    </div>
  </div>;
}
