"use client";

import { Button } from "@/components/ui/button";
import { useSession } from "next-auth/react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

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
    <div className="overflow-x-clip">
      <div className="mx-auto w-full max-w-[90rem] px-4 sm:px-6 lg:px-8">
        <section className="border-b border-border pb-20 pt-14 sm:pb-24 sm:pt-16 lg:pb-28 lg:pt-20">
          <div className="mb-8 flex flex-col gap-2 border-y border-border py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>Buchhaltung für Kleinunternehmen</span>
            <span className="font-mono text-xs">Rechnungen · Belege · EÜR</span>
          </div>

          <h1 className="min-w-0 max-w-[13ch] [overflow-wrap:anywhere] font-marketing text-[clamp(3.25rem,9vw,8.5rem)] font-medium leading-[0.88] tracking-[-0.045em] text-foreground">
            Rechnungen und Belege im Griff.
          </h1>

          <div className="mt-10 grid min-w-0 gap-10 lg:mt-14 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:items-start">
            <div className="min-w-0">
              <p className="max-w-lg text-lg leading-8 text-muted-foreground sm:text-xl">
                Bivaro führt Belege, Rechnungen, Kunden und Auswertungen in einem klaren Arbeitsablauf zusammen.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                {isAuthenticated ? (
                  <Button asChild size="lg" className="min-h-11 px-6">
                    <Link href="/dashboard">
                      Dashboard öffnen
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </Button>
                ) : (
                  <>
                    <Button asChild size="lg" className="min-h-11 px-6">
                      <Link href="/register">
                        Konto anlegen
                        <ArrowRight aria-hidden="true" />
                      </Link>
                    </Button>
                    <Button asChild size="lg" variant="outline" className="min-h-11 px-6">
                      <Link href="/login">Anmelden</Link>
                    </Button>
                  </>
                )}
              </div>

              <p className="mt-6 text-sm leading-6 text-muted-foreground">
                Für selbstständige Arbeit mit direktem Zugriff auf die eigenen Geschäftsdaten.
              </p>
            </div>

            <figure className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
              <Image
                src="/screenshot/dashboard.png"
                width={1910}
                height={1626}
                alt="Bivaro-Dashboard mit Finanzübersicht, Einnahmen, Ausgaben und EÜR-Auswertung"
                priority
                sizes="(max-width: 1023px) calc(100vw - 2rem), (max-width: 1439px) 62vw, 880px"
                className="h-auto w-full lg:max-h-[32rem] lg:object-cover lg:object-top"
              />
              <figcaption className="flex flex-col gap-1 border-t border-border px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <span>Die echte Bivaro-Finanzübersicht</span>
                <span>Ergebnisse statt Beispielmetriken</span>
              </figcaption>
            </figure>
          </div>
        </section>

        <section className="py-16 sm:py-20 lg:py-24" aria-labelledby="workflow-title">
          <div className="grid gap-8 pb-12 sm:pb-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-end">
            <h2
              id="workflow-title"
              className="min-w-0 max-w-[12ch] [overflow-wrap:anywhere] font-marketing text-4xl font-medium leading-[0.98] tracking-[-0.03em] text-foreground sm:text-5xl lg:text-6xl"
            >
              Vom Eingang bis zur Auswertung.
            </h2>
            <p className="max-w-2xl text-lg leading-8 text-muted-foreground lg:justify-self-end">
              Kein loses Nebeneinander von Funktionen. Drei aufeinanderfolgende Schritte halten den Weg durch die Buchhaltung verständlich.
            </p>
          </div>

          <div className="border-b border-border">
            {workflow.map((step, index) => {
              const detailFirst = index === 1;

              return (
                <article
                  key={step.title}
                  className="grid min-w-0 gap-8 border-t border-border py-10 sm:py-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16 lg:py-16"
                >
                  <div className={detailFirst ? "min-w-0 lg:order-2" : "min-w-0"}>
                    <h3 className="mb-6 min-w-0 [overflow-wrap:anywhere] font-marketing text-4xl font-medium leading-none tracking-[-0.025em] text-foreground sm:text-5xl">
                      {step.title}
                    </h3>
                    <p className="max-w-xl text-lg leading-8 text-muted-foreground">
                      {step.description}
                    </p>
                    <Link
                      href={step.href}
                      className="mt-7 inline-flex min-h-11 items-center gap-2 whitespace-nowrap text-sm font-semibold text-primary underline-offset-4 transition-colors hover:text-[var(--color-accent-hover)] hover:underline"
                    >
                      {step.linkLabel}
                      <ArrowRight className="size-4" aria-hidden="true" />
                    </Link>
                  </div>

                  <dl
                    className={
                      detailFirst
                        ? "min-w-0 border-t border-border lg:order-1"
                        : "min-w-0 border-t border-border"
                    }
                  >
                    {step.details.map(([term, description]) => (
                      <div
                        key={term}
                        className="grid min-w-0 gap-1 border-b border-border py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-6 sm:py-5"
                      >
                        <dt className="font-semibold text-foreground">{term}</dt>
                        <dd className="min-w-0 text-muted-foreground sm:text-right">{description}</dd>
                      </div>
                    ))}
                  </dl>
                </article>
              );
            })}
          </div>
        </section>

        <section className="grid gap-8 border-y border-border bg-secondary px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-center lg:px-12 lg:py-20">
          <div>
            <h2 className="min-w-0 max-w-[13ch] [overflow-wrap:anywhere] font-marketing text-4xl font-medium leading-[0.98] tracking-[-0.03em] text-foreground sm:text-5xl lg:text-6xl">
              Ihre Buchhaltung bleibt nachvollziehbar.
            </h2>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
              Originalbelege, strukturierte E-Rechnungsdaten und zugehörige Buchungen bleiben miteinander verbunden und direkt auffindbar.
            </p>
          </div>

          <dl className="border-t border-border">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-border py-4">
              <dt className="text-muted-foreground">E-Rechnungen</dt>
              <dd className="font-medium text-foreground">PDF + XML</dd>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-border py-4">
              <dt className="text-muted-foreground">Belegarchiv</dt>
              <dd className="font-medium text-foreground">Direkt verknüpft</dd>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-border py-4">
              <dt className="text-muted-foreground">Auswertungen</dt>
              <dd className="font-medium text-foreground">Exportierbar</dd>
            </div>
          </dl>
        </section>

        <section className="py-16 sm:py-20 lg:py-24" aria-labelledby="closing-title">
          <div className="grid gap-8 border-b border-border pb-12 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] lg:items-end">
            <div>
              <h2
                id="closing-title"
                className="min-w-0 max-w-[12ch] [overflow-wrap:anywhere] font-marketing text-5xl font-medium leading-[0.92] tracking-[-0.035em] text-foreground sm:text-6xl lg:text-7xl"
              >
                Bereit für den nächsten Beleg?
              </h2>
              <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
                Öffnen Sie Bivaro und beginnen Sie direkt mit dem Vorgang, der jetzt ansteht.
              </p>
            </div>

            <div className="flex flex-col gap-3 lg:items-end">
              {isAuthenticated ? (
                <Button asChild size="lg" className="min-h-11 w-full px-6 sm:w-auto">
                  <Link href="/dashboard">
                    Zum Dashboard
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
              ) : (
                <>
                  <Button asChild size="lg" className="min-h-11 w-full px-6 sm:w-auto">
                    <Link href="/register">
                      Konto anlegen
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </Button>
                  <Link
                    href="/login"
                    className="inline-flex min-h-11 items-center whitespace-nowrap text-sm font-semibold text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
                  >
                    Bereits registriert? Anmelden
                  </Link>
                </>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
