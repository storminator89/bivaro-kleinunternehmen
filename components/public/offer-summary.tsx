import Link from 'next/link';
import { formatOfferPrice, getPublicOffer, type PublicOffer } from '@/lib/public-offer';
import styles from '@/components/public-accounting/pilot-public.module.css';

export function SupportContact({ offer = getPublicOffer() }: { offer?: PublicOffer }) {
  return offer.supportContact
    ? <p>Bestätigter Supportkontakt: <a className={styles.textLink} href={offer.supportContact.href} rel="noreferrer">{offer.supportContact.label}</a>. Die vereinbarte Zuständigkeit und Erreichbarkeit gelten; diese Seite verspricht keine sofortige Antwort.</p>
    : <p>Auf dieser Seite ist derzeit kein öffentlicher Betreiber- oder Supportkontakt hinterlegt. Der Hilfeweg ist noch nicht eingerichtet. Nutzen Sie nur einen bereits bekannten, unabhängig bestätigten Kontakt Ihres Betreibers; ohne Ansprechpartner ist eine betreute Wiederherstellung hier nicht verfügbar.</p>;
}

const modelLabels = { 'self-hosted': 'Selbstbetrieb', 'managed-instance': 'Betreute Einzelinstallation', saas: 'SaaS' };

export function OfferSummary({ offer = getPublicOffer(), compact = false }: { offer?: PublicOffer; compact?: boolean }) {
  if (compact) return <section id="angebot" className={styles.section} aria-labelledby="offer-heading">
    <h2 id="offer-heading">Angebot und Verantwortung</h2>
    <p className="mt-4"><strong>{offer.complete ? 'Freigegebene Angebotsinformationen' : 'Konzept – kein verbindliches Angebot'}</strong>. {offer.price ? `${formatOfferPrice(offer.price)} · ${offer.price.interval} · ${offer.price.taxNote}` : 'Kein bestätigter Preis und keine voreingestellte Betriebsvariante.'} Kein Onlineabschluss.</p>
    <p className={styles.small}>Konfigurationsrevision: <span className="break-all font-mono">{offer.revision}</span>; keine Laufzeitversion.</p>
    <div className={styles.contextLinks}><a href="/help#angebot">Leistung, Kosten, Kontakt und Quellcode prüfen</a><Link href="/help/access">Zugang verloren oder Betriebsstörung</Link></div>
  </section>;
  return <section id="angebot" className={styles.guideSection} aria-labelledby="offer-heading">
    <h2 id="offer-heading">Angebot und Verantwortung</h2>
    <p><strong>{offer.complete ? 'Freigegebene Angebotsinformationen' : 'Konzept – kein verbindliches Angebot'}</strong></p>
    <p>Konfigurationsrevision: <span className="break-all font-mono text-sm">{offer.revision}</span>. Dies ist keine Angabe zur laufenden Softwareversion. {offer.complete ? 'Die hinterlegten Informationen sind vollständig.' : 'Anbieter, Betriebsmodell oder Bedingungen sind noch nicht vollständig bestätigt.'} Kein Onlineabschluss: Diese Seite bestellt nichts, schließt keinen Vertrag und nimmt keinen Pilotzugang verbindlich an.</p>
    <dl className={styles.boundaries}>
      <div><dt>Anbieter und Betriebsmodell</dt><dd>{offer.providerName ?? 'Anbieter noch nicht bestätigt'} · {offer.operatingModel ? modelLabels[offer.operatingModel] : 'Betriebsmodell noch offen; keine Variante voreingestellt'}</dd></div>
      <div><dt>Enthalten / nicht enthalten</dt><dd>{offer.included.length ? offer.included.join(' · ') : 'Verbindlicher Leistungsumfang noch nicht bestätigt.'}</dd><dd>{offer.excluded.length ? `Nicht enthalten: ${offer.excluded.join(' · ')}` : 'Verbindliche Leistungsausschlüsse noch nicht bestätigt. Produktfunktionen und Grenzen stehen in der Aufgabenhilfe.'}</dd></div>
      <div><dt>Preis, Steuerdarstellung und Laufzeit</dt><dd>{offer.price ? `${formatOfferPrice(offer.price)} · ${offer.price.interval} · ${offer.price.taxNote}` : 'Kein bestätigter Preis; keine Aussage zu kostenloser Nutzung oder Steuerdarstellung.'}</dd><dd>{offer.term ?? 'Laufzeit und Kündigung noch nicht bestätigt.'}</dd></div>
      <div><dt>Betrieb, Unterstützung und Ausstieg</dt><dd>{offer.responsibilities ?? 'Zuständigkeit für Einrichtung, Updates, Sicherungen und Wiederherstellung noch zu vereinbaren.'}</dd><dd>{offer.support ?? 'Supportumfang und Erreichbarkeit noch nicht bestätigt.'}</dd><dd>{offer.exit ?? 'Datenübergabe, Fristen und Lösch-/Aufbewahrungsverantwortung noch zu vereinbaren.'}</dd></div>
      <div><dt>Unterlagen und Quellcode</dt><dd>{offer.documents ? <><a className={styles.textLink} href={offer.documents.provider} rel="noreferrer">Anbieterinformationen</a>{' · '}<a className={styles.textLink} href={offer.documents.privacy} rel="noreferrer">Datenschutz</a>{' · '}<a className={styles.textLink} href={offer.documents.terms} rel="noreferrer">Vertragsbedingungen</a></> : 'Modellbezogene Anbieter-, Datenschutz- und Vertragsunterlagen sind noch nicht bestätigt; keine rechtliche Freigabe.'}</dd><dd>Das Repository bezeichnet die Software als AGPL-3.0-only. {offer.source ? <><a className={styles.textLink} href={offer.source.href} rel="noreferrer">Quellcode zum bestätigten Auslieferungsstand</a>{' · '}<a className={styles.textLink} href={offer.source.licenseHref} rel="noreferrer">Lizenztext</a> · Source-Revision: {offer.source.revision}</> : <>Ein zum laufenden Auslieferungsstand bestätigter Source-/Lizenzlink ist noch nicht hinterlegt. <a className={styles.textLink} href="https://github.com/storminator89/bivaro-kleinunternehmen" rel="noreferrer">Projekt-Repository (keine Laufzeitzuordnung)</a>{' · '}<a className={styles.textLink} href="https://github.com/storminator89/bivaro-kleinunternehmen/blob/main/LICENSE" rel="noreferrer">Lizenz im Projekt-Repository</a></>}</dd></div>
    </dl>
    <SupportContact offer={offer} />
    <div className={styles.contextLinks}><a href="/help#umfang">Produktumfang und Grenzen</a><Link href="/help/access">Zugang verloren oder Betriebsstörung</Link></div>
  </section>;
}
