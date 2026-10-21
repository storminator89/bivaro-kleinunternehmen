import type { Metadata } from 'next';
import { OfferSummary } from '@/components/public/offer-summary';
import Image from 'next/image';
import { ArrowUpRight } from 'lucide-react';
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
        <div><h1 id="home-heading">Rechnungen. Belege. Überblick.</h1></div>
        <div className={styles.heroCopy}>
          <p>Für kleine Dienstleistungsbetriebe.</p>
          <div className={styles.actions}><Button asChild size="lg"><a href="/help#erste-rechnung">Erste Rechnung</a></Button><Button asChild size="lg" variant="outline"><a href="#produkteinblick">Oberfläche ansehen</a></Button></div>

        </div>
      </div>
      <figure id="produkteinblick" className={styles.productFrame}>
        <div className={styles.productBar}><strong>Dashboard</strong></div>
        <Image src="/screenshot/dashboard.png" width={1910} height={1626} alt="Produktansicht des Bivaro-Dashboards mit Finanzübersicht und Einnahmen-Ausgaben-Auswertung" priority sizes="(max-width: 768px) calc(100vw - 2rem), calc(100vw - 5rem)" />
        <figcaption>Beispielansicht mit Demodaten.</figcaption>
      </figure>
    </section>
    <section className={styles.section} aria-labelledby="workflow-title">
      <div className={styles.sectionIntro}><h2 id="workflow-title">In vier Schritten</h2></div>
      <ol className={styles.taskList}>{pilotGuides.map((guide, index) => <li key={guide.id}><span className={styles.stepNumber} aria-hidden="true">{index + 1}</span><div><h3><a href={`/help#${guide.id}`}>{guide.title}<ArrowUpRight className="size-4 shrink-0" aria-hidden="true" /></a></h3></div></li>)}</ol>
    </section>
    <section className={styles.scope} aria-labelledby="scope-title">
      <div><h2 id="scope-title">Umfang</h2><p>Rechnungen, Kunden, Einnahmen, Ausgaben und Belege.</p></div><a className={styles.textLink} href="/help#umfang">Funktionen und Grenzen</a>
    </section>
    <section className={styles.section} aria-labelledby="access-title"><h2 id="access-title" className="sr-only">Zugang</h2><PilotAccess /></section>
    <OfferSummary compact />
  </div>;
}
