/** Explanatory, synthetic fixtures only. Never send these IDs to product APIs. */
export const pilotDemo = {
  version: '1',
  sourceRef: '68287de1256fa058eb221f59ee1b101f25170781',
  worksheetHref: '/demo/bivaro-pilot-v1.txt',
  invoiceId: 'SYN-DEMO-RE-001',
  paymentId: 'SYN-DEMO-ZA-001',
  receiptId: 'SYN-DEMO-BE-001',
  correctionId: 'SYN-DEMO-KO-001',
  invoiceCents: 30_000,
  recordedPaymentCents: 10_000,
  neverReceivedCents: 2_000,
  expenseCents: 4_000,
  invoiceDate: '2026-10-01',
  paymentDate: '2026-10-02',
  expenseDate: '2026-10-03',
  correctionDate: '2026-10-04',
  periodFrom: '2026-10-01',
  periodTo: '2026-10-31',
} as const;

export const pilotDemoLimits = 'Nur synthetische Erläuterung, keine echte Rechnung, kein Import und kein geprüfter Produktexport. Kein Konto, keine Buchung und kein Versand durch diesen Textablauf. Ein Demo-Erfolg ist keine Produkt-, Umstiegs- oder Steuerfreigabe.';

export function pilotDemoBalances() {
  const validReceivedCents = pilotDemo.recordedPaymentCents - pilotDemo.neverReceivedCents;
  return {
    initiallyOpenCents: pilotDemo.invoiceCents - pilotDemo.recordedPaymentCents,
    validReceivedCents,
    correctedOpenCents: pilotDemo.invoiceCents - validReceivedCents,
  };
}

export function formatPilotDemoAmount(cents: number): string {
  return `${(cents / 100).toFixed(2).replace('.', ',')} EUR`;
}

const amount = formatPilotDemoAmount;
const balances = pilotDemoBalances();

export const pilotDemoSteps = [
  {
    id: 'demo-rechnung', title: 'Rechnung prüfen',
    story: `Unser erfundener Musterbetrieb stellt ${pilotDemo.invoiceId} über ${amount(pilotDemo.invoiceCents)} für eine einfache Inlandsleistung aus. Für dieses Beispiel wird ein bereits geklärtes Kleinunternehmerprofil angenommen.`,
    action: 'Im Produkt: Firmendaten und Kunde vorbereiten, Rechnung erstellen. Positionen, Leistungsdatum und Steuerprofil vor der Ausgabe prüfen.',
    result: `Beispielstand: ${amount(pilotDemo.invoiceCents)} offen. Eine Rechnung ist noch kein Geldeingang.`,
    caution: 'Die Annahme im Beispiel prüft weder Ihre Berechtigung noch die fachliche Richtigkeit einer echten Rechnung.',
    guideHref: '#erste-rechnung', guideLabel: 'Anleitung zur Rechnung',
  },
  {
    id: 'demo-teilzahlung', title: 'Teilzahlung erfassen',
    story: `Als Teilzahlung werden zunächst ${amount(pilotDemo.recordedPaymentCents)} am 02.10.2026 erfasst (${pilotDemo.paymentId}). Den absichtlichen Erfassungsfehler entdecken wir in Schritt 4.`,
    action: 'Im Produkt: Rechnung → Zahlung erfassen. Betrag, tatsächliches Zahlungsdatum und Referenz am Nachweis prüfen; erst dann verbindlich bestätigen.',
    result: `Vorläufiger Beispielstand: ${amount(balances.initiallyOpenCents)} offen. Die Zahlung erzeugt die zugehörige Einnahme; nicht nochmals manuell erfassen.`,
    caution: 'Kein Bankabgleich. Bei unklarer Speicherung zuerst den Zahlungsverlauf prüfen oder dieselbe Anfrage unverändert wiederholen.',
    guideHref: '#zahlung', guideLabel: 'Anleitung zur Zahlung',
  },
  {
    id: 'demo-beleg', title: 'Ausgabe mit Beleg verbinden',
    story: `Der Musterbetrieb bezahlt am 03.10.2026 Büromaterial für ${amount(pilotDemo.expenseCents)}. Das getrennte Ausgabenbeispiel trägt ${pilotDemo.receiptId}; es mindert nicht den offenen Rechnungsbetrag.`,
    action: 'Im Produkt: Ausgabe mit Beschreibung, Zahlungsdatum und Betrag erfassen, Kategorie und Steuerzuordnung prüfen, Beleg hochladen und Originalzuordnung prüfen.',
    result: `Beispielstand: ${amount(pilotDemo.expenseCents)} Ausgabe mit Belegbezug. Ein Upload allein bucht keine Ausgabe.`,
    caution: 'Unten steht nur ein erklärender Textbeleg, kein hochladbares Rechnungsoriginal und kein Produkt-Screenshot.',
    guideHref: '#belege', guideLabel: 'Anleitung zu Ausgaben und Belegen',
  },
  {
    id: 'demo-korrektur', title: 'Fehler nachvollziehbar korrigieren',
    story: `Der Abgleich am 04.10.2026 zeigt: Von den erfassten ${amount(pilotDemo.recordedPaymentCents)} sind ${amount(pilotDemo.neverReceivedCents)} nie eingegangen. Es geht nicht um Geld auf einer anderen Rechnung und nicht um eine Rückzahlung.`,
    action: `Im Produkt: Rechnung → Zahlung erfassen → Korrektur / Erstattung dokumentieren → Korrektur. Ursprünglichen Zahlungsnachweis wählen; ${amount(pilotDemo.neverReceivedCents)}, Entdeckungsdatum, Grund und prüfbaren Bezug angeben und „nie eingegangen“ bestätigen.`,
    result: `Beispielstand: ${amount(balances.validReceivedCents)} gültig eingegangen, ${amount(balances.correctedOpenCents)} noch offen. Originalzahlung und separate Korrektur ${pilotDemo.correctionId} bleiben nachvollziehbar.`,
    caution: 'Original nicht überschreiben. Korrektur wirkt am ursprünglichen Zahlungstag; Entdeckungsdatum bleibt getrennt. Erstattung bedeutet tatsächlich bereits zurückgezahltes Geld, benötigt einen geprüften vollständigen Stornobezug und löst nie eine Überweisung aus. Steuerliche Zuordnung bleibt prüfpflichtig; betroffene EÜR-/Steuerausgaben können gesperrt sein.',
    guideHref: '#umfang', guideLabel: 'Grenzen vor dem echten Fall prüfen',
  },
  {
    id: 'demo-uebergabe', title: 'Unterlagen geprüft übergeben',
    story: 'Für Oktober 2026 werden Rechnung, ursprüngliche Zahlung, separate Korrektur, Ausgabe und Originalbezug gemeinsam abgeglichen. Es wird hier kein Übergabepaket erzeugt.',
    action: 'Im Produkt: Unterlagen übergeben → Zeitraum wählen → Vorschau und Warnungen prüfen → ZIP herunterladen. Paket selbst prüfen und mit der Kanzlei abstimmen; kein automatischer Versand.',
    result: `Kontrollwerte dieses Falls: ${amount(pilotDemo.invoiceCents)} Rechnungsbetrag, ${amount(balances.validReceivedCents)} gültiger Eingang, ${amount(balances.correctedOpenCents)} offen und ${amount(pilotDemo.expenseCents)} separate Ausgabe. Diese Werte nicht zu einer Einnahmensumme addieren.`,
    caution: 'Bivaro-Format 2 enthält payments.csv und adjustments.csv; Korrekturen bleiben UNREVIEWED. Kein zugesicherter DATEV-Import, ELSTER-Versand oder vollständiger GoBD-Prüfexport. Fehlende Originale und Warnungen zuerst klären.',
    guideHref: '#export', guideLabel: 'Anleitung zur Übergabe',
  },
] as const;

/** Matches the public static worksheet; not a financial document generator. */
export function createPilotDemoWorksheet(): string {
  return [
    'BIVARO – SYNTHETISCHES ERKLÄRBLATT – KEINE ECHTE RECHNUNG',
    `Erklärblatt-Version ${pilotDemo.version} · Quellreferenz ${pilotDemo.sourceRef}`,
    'Die Quellreferenz benennt den fachlichen Ausgangsstand, nicht einen abgenommenen Build.',
    'Kein aus einem abgenommenen Build erzeugtes PDF, Original, Screenshot oder ZIP. Kein Importformat.',
    pilotDemoLimits,
    '',
    'ANNAHMEN',
    'Alle IDs, Beträge, Daten, Betriebe und Vorgänge sind erfunden. Keine echten Namen, Konten oder Nummernkreise.',
    'Einfacher Inlandsfall in EUR; ausgestellte gewöhnliche Kleinunternehmerrechnung, manuelle Zahlung, kein Kassenbuch und keine Steuerfreigabe.',
    `Beispielzeitraum: ${pilotDemo.periodFrom} bis ${pilotDemo.periodTo}`,
    '',
    ...pilotDemoSteps.flatMap((step, index) => [
      `${index + 1}. ${step.title}`, step.story, step.action, step.result, step.caution,
      `Öffentlicher Textschritt: /help#${step.id}`, '',
    ]),
    'SYNTHETISCHER TEXTBELEG – NUR ERLÄUTERUNG',
    `Bezug: ${pilotDemo.receiptId}`,
    'Beschreibung: erfundenes Büromaterial',
    `Beispiel-Zahlungsdatum: ${pilotDemo.expenseDate}`,
    `Beispielbetrag: ${amount(pilotDemo.expenseCents)}`,
    'Kein Rechnungsoriginal, keine Vorlage für echte Rechnungen und keine Aussage zum Vorsteuerabzug.',
    'Zurück zum passenden Schritt: /help#demo-beleg',
    '',
    'PRODUKT, KONZEPT UND OFFENER NACHWEIS',
    'Der Text beschreibt vorhandene Bedienwege am genannten Quellstand; Ihre Installation und Version gesondert prüfen.',
    'Selbstbetrieb, betreute Instanz und SaaS haben denselben fachlichen Ablauf. Verfügbarkeit, Kosten und Zuständigkeit für Einrichtung, Updates, Sicherung, Wiederherstellung und Ausstieg mit dem Betreiber klären. Nicht zugesagte Varianten bleiben Konzept, kein buchbares Angebot.',
    'Ausland/Reverse Charge, Anzahlungen/Schlussrechnungen, Kassenbuch, ungeklärte Altzahlungen und vollständige Regelbesteuerung werden hier nicht demonstriert. Bei solchen oder ungeklärten Fällen stoppen und fachlich prüfen lassen.',
    'Versionierte Produktdateien/Screenshots aus dem tatsächlich abgenommenen Build, Browser-Abnahme und freiwilliger Empfängerreview bleiben gesondert nachzuweisen. Dieses Erklärblatt ersetzt diese Nachweise nicht.',
    'Nächster Schritt ohne Anmeldung: /help#umstieg – sechs Punkte für den manuellen Review vorbereiten.',
    '',
  ].join('\n');
}
