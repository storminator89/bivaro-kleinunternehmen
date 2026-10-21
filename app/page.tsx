import type { Metadata } from 'next';
import { OfferSummary } from '@/components/public/offer-summary';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { PilotAccess } from '@/components/public-accounting/pilot-access';
import { pilotGuides } from '@/components/public-accounting/pilot-guides';
import styles from '@/components/public-accounting/pilot-public.module.css';

export const metadata: Metadata = {
  title: 'Bivaro – vom Auftrag zur geordneten Unterlage',
  description: 'Rechnungen, Zahlungen und Belege für einfache Inlandsfälle in Euro. Lernen Sie den Arbeitsablauf und seine Grenzen kennen.',
};

// Native help-fragment links avoid Next 16 reusing a cached initial hash.
export default function Home() {
  return <div className={styles.page}>
    <section className={styles.hero} aria-labelledby="home-heading">
      <div className={styles.heroIntro}>
        <div><p className={styles.intro}>Für allein arbeitende Dienstleister und kleine Betriebe</p><h1 id="home-heading">Ihre Rechnung ist erst der Anfang.</h1></div>
        <div className={styles.heroCopy}>
          <p>Rechnung schreiben, den Geldeingang festhalten, Belege zuordnen. Bivaro bringt diese Aufgaben in einen gemeinsamen Arbeitsbereich – bis zur geordneten Übergabe Ihrer Unterlagen.</p>
          <div className={styles.actions}><Button asChild size="lg"><a href="/help#erste-rechnung">Den ersten Ablauf kennenlernen</a></Button><Button asChild size="lg" variant="outline"><a href="#produkteinblick">Oberfläche ansehen</a></Button></div>
          <p className={styles.small}>Für einfache Inlandsfälle in Euro mit manueller Erfassung. Steuerstatus und Eignung Ihres Geschäftsfalls müssen vorab geklärt sein.</p>
        </div>
      </div>
      <figure id="produkteinblick" className={styles.productFrame}>
        <div className={styles.productBar}><strong>Ein Blick in Bivaro</strong><span>Rechnungen, Einnahmen und Ausgaben zusammen prüfen</span></div>
        <Image src="/screenshot/dashboard.png" width={1910} height={1626} alt="Produktansicht des Bivaro-Dashboards mit Finanzübersicht und Einnahmen-Ausgaben-Auswertung" priority sizes="(max-width: 768px) calc(100vw - 2rem), calc(100vw - 5rem)" />
        <figcaption>Produkt-Screenshot zur Orientierung, keine interaktive Demo und keine Live-Daten Ihres Betriebs.</figcaption>
      </figure>
    </section>
    <section className={styles.section} aria-labelledby="workflow-title">
      <div className={styles.sectionIntro}><h2 id="workflow-title">Ein Vorgang. Vier klare Aufgaben.</h2><p>Die Aufgabenhilfe führt Sie vom ersten Dokument bis zur Übergabe. Ohne Konto lesbar; die verlinkten Arbeitsbereiche benötigen einen Zugang.</p></div>
      <ol className={styles.taskList}>{pilotGuides.map((guide, index) => <li key={guide.id}><span className={styles.stepNumber} aria-hidden="true">{index + 1}</span><div><h3><a href={`/help#${guide.id}`}>{guide.title}</a></h3><p>{guide.summary}</p></div><a className={styles.textLink} href={`/help#${guide.id}`}>Anleitung<span className="sr-only">: {guide.title}</span></a></li>)}</ol>
    </section>
    <section className={styles.scope} aria-labelledby="scope-title">
      <div><h2 id="scope-title">Klar im Ablauf. Ehrlich bei den Grenzen.</h2><p>Bivaro unterstützt Rechnungen, Kunden, manuelle Einnahmen und Ausgaben sowie CSV- und Belegexporte. Es ersetzt keine Steuerberatung und ist kein Versprechen vollständiger Finanzbuchhaltung.</p><a className={styles.textLink} href="/help#umfang">Umfang und Grenzen nachlesen</a></div>
      <div className={styles.scopeNotes}><p><strong>Sie behalten die Prüfung.</strong> Kein automatischer Bankabgleich, keine automatische Ausgabenbuchung aus eingehenden E-Rechnungen.</p><p><strong>Unterlagen statt Einreichung.</strong> Keine ELSTER-Übermittlung und kein zugesicherter DATEV-Import. Sonderfälle müssen gesondert geklärt werden.</p></div>
    </section>
    <section className={styles.section} aria-labelledby="access-title"><div className={styles.sectionIntro}><h2 id="access-title">Erst den passenden Rahmen klären.</h2><p>Selfhosting, betreute Einzelinstallation oder SaaS: Entscheidend sind die bestätigten Angaben zur konkreten Installation. Diese Seite bietet keinen Checkout und verspricht keinen sofort nutzbaren neuen Firmenzugang.</p></div><PilotAccess /><p className={styles.small}>Vor echtem Einsatz müssen Betrieb, Preis, Unterstützung und Datenübergabe mit dem verantwortlichen Betreiber vereinbart sein. <a href="/help#zugang">Was vor dem Start zu klären ist</a></p></section>
    <OfferSummary compact />
  </div>;
}
