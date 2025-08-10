"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useSession } from "next-auth/react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, PieChart, FileText, BarChart3, CheckCircle, Shield, Zap, Star } from "lucide-react";

export default function Home() {
  const { data: session, status } = useSession();

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Hero Section */}
      <div className="py-16 md:py-24">
        <div className="flex flex-col lg:flex-row items-center gap-12">
          <div className="lg:w-1/2 text-center lg:text-left">
            <div className="inline-flex items-center gap-2 px-3 py-1 text-sm font-medium rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 mb-6">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
              Buchhaltung neu gedacht
            </div>
            <h1 className="text-4xl md:text-5xl font-bold mb-6 tracking-tight text-blue-600 dark:text-blue-400">
              Smarte Finanzen <br />für Kleinunternehmer
            </h1>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto lg:mx-0 mb-8">
              Fokussieren Sie sich auf Ihr Kerngeschäft, während wir Ihre Buchhaltung vereinfachen.
              <span className="block mt-2 font-medium text-blue-600 dark:text-blue-400">Einfacher. Schneller. Moderner.</span>
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
              {status === "authenticated" ? (
                <Link href="/dashboard">
                  <Button size="lg" className="px-8 bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 transition-all duration-300 hover:scale-105">
                    <span>Zum Dashboard</span>
                    <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
                  </Button>
                </Link>
              ) : (
                <>
                  <Link href="/register">
                    <Button size="lg" className="px-8 bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 transition-all duration-300 hover:scale-105">
                      <span>Jetzt registrieren</span>
                      <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
                    </Button>
                  </Link>
                  <Link href="/login">
                    <Button size="lg" variant="outline" className="transition-all duration-300 hover:scale-105 border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-900/20">
                      Anmelden
                    </Button>
                  </Link>
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-center lg:justify-start gap-3 mt-8">
              <span className="inline-flex items-center gap-1 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 px-3 py-1 rounded-full">
                <CheckCircle className="h-3 w-3" />
                DSGVO-konform
              </span>
              <span className="inline-flex items-center gap-1 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 px-3 py-1 rounded-full">
                <CheckCircle className="h-3 w-3" />
                Lokale Datenspeicherung
              </span>
              <span className="inline-flex items-center gap-1 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 px-3 py-1 rounded-full">
                <CheckCircle className="h-3 w-3" />
                Finanzamt-tauglich
              </span>
            </div>
          </div>
          <div className="lg:w-1/2">
            <div className="rounded-xl border bg-card text-card-foreground shadow-sm p-2">
              <Image 
                src="/screenshot/dashboard.png" 
                width={600} 
                height={400} 
                alt="Dashboard Vorschau" 
                className="rounded-lg border"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="py-16 md:py-24">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 text-sm font-medium rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 mb-4">
            Funktionen
          </div>
          <h2 className="text-3xl md:text-4xl font-bold mb-4 text-blue-600 dark:text-blue-400">Alles was Sie brauchen</h2>
          <p className="text-lg text-muted-foreground max-w-3xl mx-auto">
            Unsere Lösung bietet alles, was Kleinunternehmer für eine einfache und gesetzeskonforme Buchhaltung benötigen.
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
          <Card>
            <CardHeader>
              <div className="w-12 h-12 mb-4 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
                <BarChart3 className="h-6 w-6" />
              </div>
              <CardTitle className="text-blue-600 dark:text-blue-400">Einfache Erfassung</CardTitle>
              <CardDescription>
                Schnelle und unkomplizierte Erfassung aller Geschäftsvorgänge
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                Mit unserer benutzerfreundlichen Oberfläche können Sie alle geschäftlichen 
                Transaktionen mit wenigen Klicks erfassen und nach Kategorien organisieren.
              </p>
              <ul className="mt-4 space-y-2">
                <li className="flex items-start text-muted-foreground">
                  <CheckCircle className="h-4 w-4 text-blue-500 mt-0.5 mr-2 flex-shrink-0" />
                  <span>Intelligente Kategorisierung von Ausgaben</span>
                </li>
                <li className="flex items-start text-muted-foreground">
                  <CheckCircle className="h-4 w-4 text-blue-500 mt-0.5 mr-2 flex-shrink-0" />
                  <span>Automatische Steuerrelevanz-Erkennung</span>
                </li>
                <li className="flex items-start text-muted-foreground">
                  <CheckCircle className="h-4 w-4 text-blue-500 mt-0.5 mr-2 flex-shrink-0" />
                  <span>Drag & Drop Belege hochladen und verknüpfen</span>
                </li>
              </ul>
            </CardContent>
            <CardFooter>
              <Link href="/dashboard?tab=expenses" className="w-full">
                <Button className="w-full bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 transition-all duration-300 hover:scale-[1.02]">
                  <span>Ausgaben erfassen</span>
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
                </Button>
              </Link>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <div className="w-12 h-12 mb-4 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
                <FileText className="h-6 w-6" />
              </div>
              <CardTitle className="text-blue-600 dark:text-blue-400">ZUGFeRD-Integration</CardTitle>
              <CardDescription>
                Automatische Rechnungsverarbeitung mit KI-Technologie
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                Laden Sie Ihre ZUGFeRD-kompatiblen Rechnungen hoch und lassen Sie die
                Daten automatisch extrahieren und in Ihre Buchhaltung integrieren.
              </p>
              <ul className="mt-4 space-y-2">
                <li className="flex items-start text-muted-foreground">
                  <CheckCircle className="h-4 w-4 text-blue-500 mt-0.5 mr-2 flex-shrink-0" />
                  <span>KI-gestützte Datenextraktion aus PDF-Rechnungen</span>
                </li>
                <li className="flex items-start text-muted-foreground">
                  <CheckCircle className="h-4 w-4 text-blue-500 mt-0.5 mr-2 flex-shrink-0" />
                  <span>Automatische Kategorisierung und MwSt-Berechnung</span>
                </li>
                <li className="flex items-start text-muted-foreground">
                  <CheckCircle className="h-4 w-4 text-blue-500 mt-0.5 mr-2 flex-shrink-0" />
                  <span>Digitale Archivierung und schneller Zugriff</span>
                </li>
              </ul>
            </CardContent>
            <CardFooter>
              <Link href="/dashboard?tab=invoices" className="w-full">
                <Button variant="outline" className="w-full transition-all duration-300 hover:scale-[1.02] border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-900/20">
                  <span>Rechnungen verwalten</span>
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
                </Button>
              </Link>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <div className="w-12 h-12 mb-4 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
                <PieChart className="h-6 w-6" />
              </div>
              <CardTitle className="text-blue-600 dark:text-blue-400">EÜR-Übersicht</CardTitle>
              <CardDescription>
                Live-Übersicht für all Ihre steuerlichen Pflichten
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                Mit unserem EÜR-Assistenten können Sie jederzeit eine Übersicht Ihrer
                steuerlich relevanten Einnahmen und Ausgaben generieren und exportieren.
              </p>
              <ul className="mt-4 space-y-2">
                <li className="flex items-start text-muted-foreground">
                  <CheckCircle className="h-4 w-4 text-blue-500 mt-0.5 mr-2 flex-shrink-0" />
                  <span>Live EÜR-Vorschau mit Fortschrittsanzeige</span>
                </li>
                <li className="flex items-start text-muted-foreground">
                  <CheckCircle className="h-4 w-4 text-blue-500 mt-0.5 mr-2 flex-shrink-0" />
                  <span>Export als PDF, CSV oder direkt für ELSTER</span>
                </li>
                <li className="flex items-start text-muted-foreground">
                  <CheckCircle className="h-4 w-4 text-blue-500 mt-0.5 mr-2 flex-shrink-0" />
                  <span>Steuerberaterfreundliche Aufbereitung mit Belegen</span>
                </li>
              </ul>
            </CardContent>
            <CardFooter>
              <Link href="/dashboard?tab=eur" className="w-full">
                <Button variant="outline" className="w-full transition-all duration-300 hover:scale-[1.02] border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-900/20">
                  <span>Zur EÜR-Übersicht</span>
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
                </Button>
              </Link>
            </CardFooter>
          </Card>
        </div>
      </div>

      {/* Testimonials Section */}
      <div className="py-16 md:py-24">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 text-sm font-medium rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 mb-4">
            Erfahrungen
          </div>
          <h2 className="text-3xl md:text-4xl font-bold mb-4 text-blue-600 dark:text-blue-400">Was unsere Nutzer sagen</h2>
          <p className="text-lg text-muted-foreground max-w-3xl mx-auto">
            Kleinunternehmer vertrauen auf unsere Lösung für ihre Buchhaltung
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center mb-4">
                <div className="text-yellow-500 flex">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-current" />
                  ))}
                </div>
              </div>
              <p className="text-muted-foreground mb-6">
                "Als Freelancer habe ich endlich eine unkomplizierte Lösung für meine Buchhaltung gefunden. Die automatische Verarbeitung von Rechnungen spart mir <span className="font-medium text-blue-600 dark:text-blue-400">Stunden an Arbeit</span> jeden Monat!"
              </p>
              <div className="flex items-center">
                <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-blue-50 font-bold text-sm">
                  MK
                </div>
                <div className="ml-3">
                  <p className="font-semibold">Michael K.</p>
                  <p className="text-sm text-muted-foreground">Web-Designer, Hamburg</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center mb-4">
                <div className="text-yellow-500 flex">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-current" />
                  ))}
                </div>
              </div>
              <p className="text-muted-foreground mb-6">
                "Die EÜR-Funktion ist ein Lebensretter! Mein Steuerberater war <span className="font-medium text-blue-600 dark:text-blue-400">beeindruckt von der übersichtlichen Aufbereitung</span> meiner Unterlagen."
              </p>
              <div className="flex items-center">
                <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-blue-50 font-bold text-sm">
                  SB
                </div>
                <div className="ml-3">
                  <p className="font-semibold">Sarah B.</p>
                  <p className="text-sm text-muted-foreground">Online-Shop Betreiberin, München</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center mb-4">
                <div className="text-yellow-500 flex">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-current" />
                  ))}
                </div>
              </div>
              <p className="text-muted-foreground mb-6">
                "Dieses Tool hat meine Buchhaltung revolutioniert. Die <span className="font-medium text-blue-600 dark:text-blue-400">ZUGFeRD-Integration spart enorm viel Zeit</span> und funktioniert perfekt!"
              </p>
              <div className="flex items-center">
                <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-blue-50 font-bold text-sm">
                  TM
                </div>
                <div className="ml-3">
                  <p className="font-semibold">Thomas M.</p>
                  <p className="text-sm text-muted-foreground">IT-Berater, Berlin</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Stats Section */}
      <div className="py-16 md:py-24">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
          <Card>
            <CardContent className="flex flex-col items-center text-center p-6">
              <div className="w-12 h-12 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 mb-4">
                <Shield className="h-6 w-6" />
              </div>
              <h3 className="text-2xl font-bold text-blue-600 dark:text-blue-400 mb-2">Sicher</h3>
              <p className="text-muted-foreground">
                Lokale Datenspeicherung für höchste Datensicherheit und Kontrolle
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col items-center text-center p-6">
              <div className="w-12 h-12 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 mb-4">
                <Zap className="h-6 w-6" />
              </div>
              <h3 className="text-2xl font-bold text-blue-600 dark:text-blue-400 mb-2">Schnell</h3>
              <p className="text-muted-foreground">
                Automatisierte Prozesse sparen wertvolle Zeit in Ihrem Geschäftsalltag
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col items-center text-center p-6">
              <div className="w-12 h-12 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 mb-4">
                <CheckCircle className="h-6 w-6" />
              </div>
              <h3 className="text-2xl font-bold text-blue-600 dark:text-blue-400 mb-2">Konform</h3>
              <p className="text-muted-foreground">
                Entspricht allen gesetzlichen Anforderungen für Ihre Steuerberichte
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* CTA Section */}
      <div className="py-16 md:py-24">
        <Card className="max-w-4xl mx-auto">
          <CardContent className="p-8 md:p-12 text-center">
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-blue-600 dark:text-blue-400">Bereit für eine einfachere Buchhaltung?</h2>
            <p className="text-lg text-muted-foreground max-w-3xl mx-auto mb-8">
              Starten Sie noch heute und erleben Sie, wie einfach Buchhaltung sein kann.
              Keine versteckten Kosten, keine komplizierten Einrichtungen.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              {status === "authenticated" ? (
                <Link href="/dashboard">
                  <Button size="lg" className="px-8 bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 transition-all duration-300 hover:scale-105">
                    <span>Zum Dashboard</span>
                    <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
                  </Button>
                </Link>
              ) : (
                <>
                  <Link href="/register">
                    <Button size="lg" className="px-8 bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 transition-all duration-300 hover:scale-105">
                      <span>Jetzt kostenlos registrieren</span>
                      <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
                    </Button>
                  </Link>
                  <Link href="/login">
                    <Button size="lg" variant="outline" className="transition-all duration-300 hover:scale-105 border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-900/20">
                      Anmelden
                    </Button>
                  </Link>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
