/** Public, data-free preparation aid. A self-assessment is never a release gate. */
export const switchingTopics = [
  {
    id: 'company',
    title: 'Firma und Zuständigkeit',
    task: 'Firmendaten und Steuerprofil anhand Ihrer Unterlagen prüfen. Für Einrichtung, Updates, Sicherung, Wiederherstellung und Ausstieg jeweils eine verantwortliche Stelle festlegen.',
    evidence: 'Firmendaten, fachlich geklärtes Steuerprofil und benannte Zuständigkeiten liegen außerhalb dieser Checkliste vor.',
  },
  {
    id: 'numbers',
    title: 'Nummernkreise',
    task: 'Bisherige und künftige Rechnungsnummern mit dem Betreiber abstimmen. Letzte verwendete Nummer und Trennung vom Altsystem dokumentieren; keine echten Nummern für Proben verbrauchen.',
    evidence: 'Nummernplan und letzte verwendete Nummer wurden anhand des Altsystems geprüft.',
  },
  {
    id: 'open-items',
    title: 'Offene Posten',
    task: 'Offene Rechnungen, Teilzahlungen und ungeklärte Zahlungen zum Stichtag abstimmen. Für jeden Altfall festlegen, in welchem System er weitergeführt wird. Keine automatische Übernahme annehmen.',
    evidence: 'Offene-Posten-Liste und Zuständigkeit für Altzahlungen sind abgestimmt.',
  },
  {
    id: 'start-date',
    title: 'Startdatum',
    task: 'Einen Umstiegsstichtag und den letzten Erfassungstag im Altsystem vereinbaren. Zugriff auf Originale, bisherige Exporte und Sicherungen für Rückfragen erhalten.',
    evidence: 'Stichtag, Übergabezeitraum und Zugriff auf Altunterlagen sind dokumentiert.',
  },
  {
    id: 'double-entry',
    title: 'Doppelerfassung vermeiden',
    task: 'Festlegen, wo neue Vorgänge und spätere Zahlungen auf Altrechnungen erfasst werden. Rechnung, Zahlung und Einnahme nicht mehrfach als Erlös zählen; parallele Erfassung bewusst abgrenzen.',
    evidence: 'Erfassungsregeln für neue Vorgänge und Altzahlungen sind gemeinsam geprüft.',
  },
  {
    id: 'control-totals',
    title: 'Kontrollsummen',
    task: 'Für denselben Zeitraum Anzahl der Vorgänge, offene Restbeträge sowie Einnahmen und Ausgaben getrennt mit den Quelldaten abgleichen. Differenzen vor dem Umstieg klären; eine gleiche Summe allein genügt nicht.',
    evidence: 'Vergleichszeitraum, einzelne Kontrollsummen und geklärte Differenzen sind separat nachgewiesen.',
  },
] as const;

export type SwitchingTopicId = typeof switchingTopics[number]['id'];
export const switchingStatuses = ['open', 'prepared', 'review'] as const;
export type SwitchingStatus = typeof switchingStatuses[number];
export type SwitchingState = Record<SwitchingTopicId, SwitchingStatus>;

export const switchingStatusLabels: Record<SwitchingStatus, string> = {
  open: 'Noch offen',
  prepared: 'Selbst vorbereitet',
  review: 'Prüfbedarf',
};

export function isSwitchingStatus(value: unknown): value is SwitchingStatus {
  return typeof value === 'string' && switchingStatuses.some(status => status === value);
}

export function createSwitchingState(): SwitchingState {
  return {
    company: 'open',
    numbers: 'open',
    'open-items': 'open',
    'start-date': 'open',
    'double-entry': 'open',
    'control-totals': 'open',
  };
}

export function summarizeSwitchingState(state: SwitchingState) {
  const counts = { open: 0, prepared: 0, review: 0 };
  for (const { id } of switchingTopics) counts[state[id]] += 1;
  return counts;
}

export const switchingReviewLimits = 'Keine Umstiegs-, Produkt- oder Steuerfreigabe. Kein automatischer Import, kein Testkonto und keine Änderung echter Daten oder Nummernkreise. Diese Vorbereitung ersetzt weder fachliche Prüfung noch Datensicherung.';

export function createSwitchingReview(state: SwitchingState): string {
  const counts = summarizeSwitchingState(state);
  return [
    'BIVARO – MANUELLER UMSTIEGS- UND PILOTREVIEW',
    'Vorlagenversion 1 · persönliche Selbsteinschätzung · kein geprüfter Produktnachweis',
    '',
    switchingReviewLimits,
    'Die Auswahl stammt nur aus dieser geöffneten Checkliste. Keine Übermittlung oder automatische Speicherung durch die Checkliste; manuell und freiwillig weitergeben.',
    '',
    `Selbst vorbereitet: ${counts.prepared} von ${switchingTopics.length} · Noch offen: ${counts.open} · Prüfbedarf: ${counts.review}`,
    'Auch bei sechs vorbereiteten Punkten bleibt der externe Review offen.',
    '',
    ...switchingTopics.flatMap((topic, index) => [
      `${index + 1}. ${topic.title}: ${switchingStatusLabels[state[topic.id]]}`,
      topic.task,
      `Separat benötigter Nachweis: ${topic.evidence}`,
      'Review / offene Frage / verantwortliche Stelle: ____________________',
      '',
    ]),
    'VOR EINEM UMSTIEG MANUELL KLÄREN',
    'Geplanter Stichtag / geprüfter Zeitraum: ____________________',
    'Tatsächlich geprüfte Installation / Build-Version: ____________________',
    'Betriebsmodell: [ ] Selbstbetrieb [ ] betreute Instanz [ ] SaaS [ ] noch offen',
    'Verfügbarkeit, Leistungen und Zuständigkeiten mit dem Betreiber prüfen. Nicht zugesagte Varianten bleiben Konzept, kein buchbares Angebot.',
    'Verantwortlich für Einrichtung / Updates / Sicherung / Wiederherstellung / Ausstieg: ____________________',
    'Fachlicher bzw. Kanzlei-Review, Datum und Ergebnis (nur selbst ergänzen): ____________________',
    'Nicht unterstützte oder ungeklärte Fälle / nächste Schritte: ____________________',
    '',
    'AUSGESCHLOSSEN ODER GESONDERT ZU PRÜFEN',
    'Dieser Plan sagt keine vollständige Unterstützung für Ausland/Reverse Charge, Anzahlungen/Schlussrechnungen, Erstattungen, komplexe Anlagen, Kassenbetriebe, gemeinsame Firmenzugänge oder vollständige Regelbesteuerung zu. Bei einem solchen oder ungeklärten Fall: nicht als freigegeben behandeln, zuerst mit Betreiber und fachlicher Prüfstelle klären.',
    '',
    'OFFENER DEMONACHWEIS',
    'Dies ist keine geführte Produktdemo. Ein vollständiger Beispielablauf mit ausdrücklich synthetischen Belegen, aus einem abgenommenen Build erzeugten und versionierten Dateien/Screenshots sowie freiwilliger Empfängerreview ist gesondert nachzuweisen.',
    'Produkt vs. Konzept und fachliche Eignung müssen an der tatsächlich geprüften Version beurteilt werden; ein Demo-Erfolg ist keine Produktfreigabe.',
    '',
    'Keine personenbezogenen Unterlagen an diese Checkliste senden. Ergänzungen erfolgen nach dem Download außerhalb von Bivaro; Sie entscheiden selbst über Speicherung und Weitergabe.',
    '',
  ].join('\n');
}
