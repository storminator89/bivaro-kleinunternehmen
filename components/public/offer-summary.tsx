import Link from 'next/link';
import { formatOfferPrice, getPublicOffer, type PublicOffer } from '@/lib/public-offer';
import styles from '@/components/public-accounting/pilot-public.module.css';

export function SupportContact({ offer = getPublicOffer() }: { offer?: PublicOffer }) {
  return offer.supportContact
    ? <p>Support: <a className={styles.textLink} href={offer.supportContact.href} rel="noreferrer">{offer.supportContact.label}</a></p>
    : <div><p>Kein Supportkontakt hinterlegt.</p><details className={styles.disclosure}><summary>Kontakt klären</summary><p>Nutzen Sie den unabhängig bestätigten Kontakt Ihres Betreibers. Ohne Ansprechpartner ist hier keine betreute Wiederherstellung verfügbar.</p></details></div>;
}

const modelLabels = { 'self-hosted': 'Selbstbetrieb', 'managed-instance': 'Betreute Einzelinstallation', saas: 'SaaS' };

export function OfferSummary({ offer = getPublicOffer(), compact = false }: { offer?: PublicOffer; compact?: boolean }) {
  if (compact) return <section id="angebot" className={styles.section} aria-labelledby="offer-heading">
    <h2 id="offer-heading">Angebot und Verantwortung</h2>
    <p className="mt-4"><strong>{offer.complete ? 'Freigegebene Angebotsinformationen' : 'Konzept – kein verbindliches Angebot'}</strong>. {offer.price ? `${formatOfferPrice(offer.price)} · ${offer.price.interval} · ${offer.price.taxNote}` : 'Preis und Betriebsmodell noch offen.'} Kein Onlineabschluss.</p>

    <div className={styles.contextLinks}><a href="/help#angebot">Angebot, Kontakt und Quellcode</a><Link href="/help/access">Zugang verloren oder Betriebsstörung</Link></div>
  </section>;
  return <section id="angebot" className={styles.guideSection} aria-labelledby="offer-heading">
    <h2 id="offer-heading">Angebot und Verantwortung</h2>
    <p><strong>{offer.complete ? 'Freigegebene Angebotsinformationen' : 'Konzept – kein verbindliches Angebot'}</strong></p>
    <p>{offer.price ? `${formatOfferPrice(offer.price)} · ${offer.price.interval} · ${offer.price.taxNote}` : 'Preis und Betriebsmodell noch offen.'} Kein Onlineabschluss.</p>
    <details className={styles.disclosure}><summary>Angebotsdetails</summary>
    <p>Konfigurationsstand: <span className="break-all font-mono text-sm">{offer.revision}</span>. Keine Softwareversion. {offer.complete ? 'Die hinterlegten Informationen sind vollständig.' : 'Anbieter, Betriebsmodell oder Bedingungen noch offen.'} Kein Onlineabschluss.</p>
    <dl className={styles.boundaries}>
      <div><dt>Anbieter und Betriebsmodell</dt><dd>{offer.providerName ?? 'Anbieter noch nicht bestätigt'} · {offer.operatingModel ? modelLabels[offer.operatingModel] : 'Betriebsmodell noch offen; keine Variante voreingestellt'}</dd></div>
      <div><dt>Enthalten / nicht enthalten</dt><dd>{offer.included.length ? offer.included.join(' · ') : 'Leistungsumfang noch offen.'}</dd><dd>{offer.excluded.length ? `Nicht enthalten: ${offer.excluded.join(' · ')}` : 'Ausschlüsse noch offen; Produktgrenzen siehe Aufgabenhilfe.'}</dd></div>
      <div><dt>Preis, Steuerdarstellung und Laufzeit</dt><dd>{offer.price ? `${formatOfferPrice(offer.price)} · ${offer.price.interval} · ${offer.price.taxNote}` : 'Preis und Steuerdarstellung noch offen.'}</dd><dd>{offer.term ?? 'Laufzeit und Kündigung noch offen.'}</dd></div>
      <div><dt>Betrieb, Unterstützung und Ausstieg</dt><dd>{offer.responsibilities ?? 'Einrichtung, Updates, Sicherung und Wiederherstellung: Zuständigkeit noch offen.'}</dd><dd>{offer.support ?? 'Supportumfang und Zeiten noch offen.'}</dd><dd>{offer.exit ?? 'Datenübergabe, Fristen und Aufbewahrung noch zu vereinbaren.'}</dd></div>
      <div><dt>Unterlagen und Quellcode</dt><dd>{offer.documents ? <><a className={styles.textLink} href={offer.documents.provider} rel="noreferrer">Anbieterinformationen</a>{' · '}<a className={styles.textLink} href={offer.documents.privacy} rel="noreferrer">Datenschutz</a>{' · '}<a className={styles.textLink} href={offer.documents.terms} rel="noreferrer">Vertragsbedingungen</a></> : 'Anbieter-, Datenschutz- und Vertragsunterlagen noch offen; keine rechtliche Freigabe.'}</dd><dd>Lizenz: AGPL-3.0-only. {offer.source ? <><a className={styles.textLink} href={offer.source.href} rel="noreferrer">Quellcode zum bestätigten Auslieferungsstand</a>{' · '}<a className={styles.textLink} href={offer.source.licenseHref} rel="noreferrer">Lizenztext</a> · Source-Revision: {offer.source.revision}</> : <>Quellcode-Zuordnung zum laufenden Release noch offen. <a className={styles.textLink} href="https://github.com/storminator89/bivaro-kleinunternehmen" rel="noreferrer">Projekt-Repository (keine Laufzeitzuordnung)</a>{' · '}<a className={styles.textLink} href="https://github.com/storminator89/bivaro-kleinunternehmen/blob/main/LICENSE" rel="noreferrer">Lizenz im Projekt-Repository</a></>}</dd></div>
    </dl>
    <SupportContact offer={offer} />
    </details>
    <div className={styles.contextLinks}><a href="/help#umfang">Produktumfang und Grenzen</a><Link href="/help/access">Zugang verloren oder Betriebsstörung</Link></div>
  </section>;
}
