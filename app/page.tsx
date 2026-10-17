"use client";

import { Button } from "@/components/ui/button";
import { useSession } from "next-auth/react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import styles from "@/components/public-accounting/public-accounting.module.css";

const workflow = [
  {
    title: "Erfassen",
    description:
      "Geschäftsvorgänge dort aufnehmen, wo sie entstehen: als Einnahme, Ausgabe, Beleg oder E-Rechnung.",
    details: [
      ["E-Rechnungen", "ZUGFeRD, Factur-X und XRechnung"],
      ["Belege", "PDF, JPG und PNG"],
      ["Buchungen", "Einnahmen und Ausgaben"],
    ],
    href: "/dashboard?tab=expenses",
    linkLabel: "Ausgabe erfassen",
  },
  {
    title: "Ordnen",
    description:
      "Kunden, Kategorien und Zahlungsstatus verbinden die einzelnen Vorgänge zu einer nachvollziehbaren Buchhaltung.",
    details: [
      ["Stammdaten", "Kunden zentral verwalten"],
      ["Zuordnung", "EÜR-Kategorien und Steuerrelevanz"],
      ["Status", "Entwurf, gesendet, bezahlt oder storniert"],
    ],
    href: "/dashboard?tab=invoices",
    linkLabel: "Rechnungen ordnen",
  },
  {
    title: "Prüfen und exportieren",
    description:
      "Offene Forderungen, Einnahmen und Ausgaben prüfen und die benötigten Unterlagen strukturiert ausgeben.",
    details: [
      ["Überblick", "Kennzahlen und Jahresvergleich"],
      ["Auswertung", "EÜR und GWG-Verzeichnis"],
      ["Ausgabe", "CSV- und Belegexporte"],
    ],
    href: "/dashboard?tab=eur",
    linkLabel: "EÜR prüfen",
  },
] as const;

export default function Home() {
  const { status } = useSession();
  const isAuthenticated = status === "authenticated";

  return (
    <div className={styles.marketing}>
      <section className={styles.hero} aria-labelledby="home-heading">
        <div className={styles.heroIntro}>
          <h1 id="home-heading">Mehr Überblick. Weniger Buchhaltungsalltag.</h1>
          <div className={styles.heroCopy}>
            <p>Rechnungen schreiben, Belege zuordnen und Ergebnisse verstehen. Bivaro verbindet Ihre täglichen Aufgaben in einem gemeinsamen Arbeitsbereich.</p>
            <div className={styles.actions}>
              <Button asChild size="lg"><Link href={isAuthenticated ? "/dashboard" : "/register"}>{isAuthenticated ? "Dashboard öffnen" : "Konto anlegen"}<ArrowRight aria-hidden="true" /></Link></Button>
              {!isAuthenticated && <Button asChild size="lg" variant="outline"><Link href="/login">Anmelden</Link></Button>}
            </div>
            <p className="!text-sm">Für Kleinunternehmen und Selbstständige · Rechnungen, Belege und EÜR an einem Ort.</p>
          </div>
        </div>
        <figure className={styles.productFrame}>
          <div className={styles.productBar}><strong>Ihr Arbeitsbereich in Bivaro</strong><span>Von der Buchung bis zum Jahresvergleich</span></div>
          <Image src="/screenshot/dashboard.png" width={1910} height={1626} alt="Bivaro-Dashboard mit Finanzübersicht, Einnahmen, Ausgaben und EÜR-Auswertung" priority sizes="(max-width: 768px) calc(100vw - 2rem), calc(100vw - 5rem)" />
          <figcaption>Einblick in die echte Bivaro-Oberfläche.</figcaption>
        </figure>
      </section>
      <section className={styles.tour} aria-labelledby="workflow-title">
        <h2 id="workflow-title">Ein klarer Weg durch Ihre Buchhaltung.</h2>
        {workflow.map(step => <article key={step.title} className={styles.tourRow}>
          <div><h3>{step.title}</h3><p>{step.description}</p><Link href={step.href}>{step.linkLabel}<ArrowRight className="size-4" aria-hidden="true" /></Link></div>
          <dl>{step.details.map(([term, description]) => <div key={term}><dt>{term}</dt><dd>{description}</dd></div>)}</dl>
        </article>)}
      </section>
      <section className={styles.closing} aria-labelledby="closing-title">
        <div><h2 id="closing-title">Der nächste Vorgang wartet schon.</h2><p>Starten Sie mit dem Beleg, der gerade auf Ihrem Schreibtisch liegt.</p></div>
        <Button asChild size="lg"><Link href={isAuthenticated ? "/dashboard" : "/login"}>{isAuthenticated ? "Zum Dashboard" : "Bei Bivaro anmelden"}<ArrowRight aria-hidden="true" /></Link></Button>
      </section>
    </div>
  );
}
