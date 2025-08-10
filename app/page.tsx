"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useSession } from "next-auth/react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, PieChart, FileText, BarChart3, CheckCircle, Shield, Zap, Star } from "lucide-react";

// Optimierte CSS-Klassen für moderne Animationen und Effekte
const styles = {
  // Moderne Button-Effekte
  modernButton: "transition-all duration-300 ease-out hover:scale-[1.02] active:scale-[0.98]",
  // Moderne Karten mit subtilen Effekten
  modernCard: "transition-all duration-300 ease-out hover:shadow-xl hover:translate-y-[-4px]",
  // Pfeilanimation mit besserer Transition
  modernArrow: "transition-transform duration-200 ease-out group-hover:translate-x-1",
  // Glassmorphism-Effekt
  glassEffect: "backdrop-filter backdrop-blur-lg bg-white/70 dark:bg-gray-800/70",
  // Gradient Text
  gradientText: "bg-clip-text text-transparent bg-gradient-to-r"
};

export default function Home() {
  const { data: session, status } = useSession();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 dark:from-gray-900 dark:via-gray-800 dark:to-indigo-950">
      {/* Dekorative Elemente - Modern Blob Shapes */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-blue-400/10 dark:bg-blue-400/5 blur-[100px] animate-blob"></div>
        <div className="absolute top-[60%] left-[-10%] w-[40%] h-[40%] rounded-full bg-indigo-400/10 dark:bg-indigo-400/5 blur-[100px] animate-blob animation-delay-2000"></div>
        <div className="absolute bottom-[-10%] right-[20%] w-[30%] h-[30%] rounded-full bg-purple-400/10 dark:bg-purple-400/5 blur-[100px] animate-blob animation-delay-4000"></div>
      </div>
      
      {/* Hero Section */}
      <div className="py-24 px-4 mx-auto relative z-10">
        <div className="flex flex-col lg:flex-row items-center gap-16 mb-32">
          <div className="lg:w-1/2 text-center lg:text-left">
            <div className="inline-block p-2 px-4 mb-6 bg-blue-50 dark:bg-blue-950 rounded-full text-blue-700 dark:text-blue-300 font-medium text-sm border border-blue-100 dark:border-blue-800 shadow-sm">
              <span className="flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-blue-600 dark:bg-blue-400 animate-pulse"></span>
                Buchhaltung neu gedacht
              </span>
            </div>
            <h1 className="text-6xl font-bold mb-6 leading-tight tracking-tight from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400 ${styles.gradientText}">
              Smarte Finanzen <br />für Kleinunternehmer
            </h1>
            <p className="text-xl text-gray-600 dark:text-gray-300 max-w-xl mx-auto lg:mx-0 leading-relaxed mb-8">
              Fokussieren Sie sich auf Ihr Kerngeschäft, während wir Ihre Buchhaltung revolutionieren.
              <span className="block mt-2 text-blue-600 dark:text-blue-400 font-medium">Einfacher. Schneller. Moderner.</span>
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start mb-10">
              {status === "authenticated" ? (
                <Link href="/dashboard">
                  <Button size="lg" className={`px-8 py-6 text-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-lg ${styles.modernButton} group relative overflow-hidden`}>
                    <span className="relative z-10">Zum Dashboard</span>
                    <ArrowRight className={`ml-2 h-5 w-5 relative z-10 ${styles.modernArrow}`} />
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-700 to-indigo-700 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  </Button>
                </Link>
              ) : (
                <>
                  <Link href="/register">
                    <Button size="lg" className={`px-8 py-6 text-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-lg ${styles.modernButton} group relative overflow-hidden`}>
                      <span className="relative z-10">Jetzt registrieren</span>
                      <ArrowRight className={`ml-2 h-5 w-5 relative z-10 ${styles.modernArrow}`} />
                      <div className="absolute inset-0 bg-gradient-to-r from-blue-700 to-indigo-700 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                    </Button>
                  </Link>
                  <Link href="/login">
                    <Button size="lg" variant="outline" className={`px-8 py-6 text-lg border-2 hover:bg-blue-50/50 dark:hover:bg-blue-900/20 ${styles.modernButton} relative overflow-hidden group`}>
                      <span className="relative z-10">Anmelden</span>
                      <div className="absolute inset-0 bg-gradient-to-r from-blue-100/40 to-indigo-100/40 dark:from-blue-900/40 dark:to-indigo-900/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                    </Button>
                  </Link>
                </>
              )}
            </div>
            <div className="flex items-center justify-center lg:justify-start gap-3 text-sm">
              <span className="flex items-center gap-1 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-3 py-1 rounded-full">
                <CheckCircle className="h-4 w-4" />
                DSGVO-konform
              </span>
              <span className="flex items-center gap-1 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-3 py-1 rounded-full">
                <CheckCircle className="h-4 w-4" />
                Lokale Datenspeicherung
              </span>
              <span className="flex items-center gap-1 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-3 py-1 rounded-full">
                <CheckCircle className="h-4 w-4" />
                Finanzamt-tauglich
              </span>
            </div>
          </div>
          <div className="lg:w-1/2 relative">
            <div className="relative z-10 p-2 rounded-2xl ${styles.glassEffect} shadow-2xl dark:shadow-blue-900/30 border border-white/50 dark:border-gray-700/50 transform transition-all duration-500 hover:rotate-1 hover:scale-[1.02]">
              <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 to-indigo-500/10 dark:from-blue-500/5 dark:to-indigo-500/5 rounded-2xl"></div>
              <Image 
                src="/screenshot/dashboard.png" 
                width={700} 
                height={500} 
                alt="Dashboard Vorschau" 
                className="rounded-xl border border-gray-100 dark:border-gray-700 shadow-lg"
              />
              
              {/* Floating elements for visual appeal */}
              <div className="absolute -top-6 -right-6 bg-blue-600 text-white p-3 rounded-lg shadow-lg transform rotate-3 animate-float">
                <FileText className="h-6 w-6" />
              </div>
              <div className="absolute -bottom-6 -left-6 bg-indigo-600 text-white p-3 rounded-lg shadow-lg transform -rotate-3 animate-float animation-delay-1000">
                <BarChart3 className="h-6 w-6" />
              </div>
            </div>
            {/* Super subtle gradient glow behind image */}
            <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-r from-blue-500/20 to-indigo-500/20 rounded-2xl blur-[80px] -z-10 transform -translate-x-4 translate-y-4"></div>
          </div>
        </div>

        {/* Features Section - Modern Cards with Hover Effects */}
        <div className="relative z-10 mt-32 mb-32">
          <div className="text-center mb-20">
            <span className="px-4 py-1.5 text-sm font-medium bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 rounded-full mb-4 inline-block">Funktionen</span>
            <h2 className="text-4xl font-bold mb-6 from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400 ${styles.gradientText}">Alles was Sie brauchen</h2>
            <p className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
              Unsere Lösung bietet alles, was Kleinunternehmer für eine einfache und gesetzeskonforme Buchhaltung benötigen.
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            <Card className={`border-0 shadow-xl overflow-hidden ${styles.glassEffect} ${styles.modernCard} relative`}>
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-400 to-blue-600"></div>
              <CardHeader className="pb-2">
                <div className="w-14 h-14 mb-4 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 transform transition-transform group-hover:rotate-6">
                  <BarChart3 className="h-7 w-7" />
                </div>
                <CardTitle className="text-2xl">Einfache Erfassung</CardTitle>
                <CardDescription className="text-base">
                  Schnelle und unkomplizierte Erfassung aller Geschäftsvorgänge
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600 dark:text-gray-300">
                  Mit unserer benutzerfreundlichen Oberfläche können Sie alle geschäftlichen 
                  Transaktionen mit wenigen Klicks erfassen und nach Kategorien organisieren.
                </p>
                <ul className="mt-4 space-y-3">
                  <li className="flex items-center text-gray-600 dark:text-gray-300 bg-blue-50/50 dark:bg-blue-900/20 p-2 rounded-lg">
                    <CheckCircle className="h-5 w-5 text-blue-500 mr-2 flex-shrink-0" />
                    <span>Intelligente Kategorisierung von Ausgaben</span>
                  </li>
                  <li className="flex items-center text-gray-600 dark:text-gray-300 bg-blue-50/50 dark:bg-blue-900/20 p-2 rounded-lg">
                    <CheckCircle className="h-5 w-5 text-blue-500 mr-2 flex-shrink-0" />
                    <span>Automatische Steuerrelevanz-Erkennung</span>
                  </li>
                  <li className="flex items-center text-gray-600 dark:text-gray-300 bg-blue-50/50 dark:bg-blue-900/20 p-2 rounded-lg">
                    <CheckCircle className="h-5 w-5 text-blue-500 mr-2 flex-shrink-0" />
                    <span>Drag & Drop Belege hochladen und verknüpfen</span>
                  </li>
                </ul>
              </CardContent>
              <CardFooter>
                <Link href="/dashboard?tab=expenses" className="w-full">
                  <Button className={`w-full bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 ${styles.modernButton} group`}>
                    <span>Ausgaben erfassen</span>
                    <ArrowRight className={`ml-2 h-4 w-4 ${styles.modernArrow}`} />
                  </Button>
                </Link>
              </CardFooter>
            </Card>

            <Card className={`border-0 shadow-xl overflow-hidden ${styles.glassEffect} ${styles.modernCard} relative`}>
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-400 to-indigo-600"></div>
              <CardHeader className="pb-2">
                <div className="w-14 h-14 mb-4 rounded-2xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 transform transition-transform group-hover:rotate-6">
                  <FileText className="h-7 w-7" />
                </div>
                <CardTitle className="text-2xl">ZUGFeRD-Integration</CardTitle>
                <CardDescription className="text-base">
                  Automatische Rechnungsverarbeitung mit KI-Technologie
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600 dark:text-gray-300">
                  Laden Sie Ihre ZUGFeRD-kompatiblen Rechnungen hoch und lassen Sie die
                  Daten automatisch extrahieren und in Ihre Buchhaltung integrieren.
                </p>
                <ul className="mt-4 space-y-3">
                  <li className="flex items-center text-gray-600 dark:text-gray-300 bg-indigo-50/50 dark:bg-indigo-900/20 p-2 rounded-lg">
                    <CheckCircle className="h-5 w-5 text-indigo-500 mr-2 flex-shrink-0" />
                    <span>KI-gestützte Datenextraktion aus PDF-Rechnungen</span>
                  </li>
                  <li className="flex items-center text-gray-600 dark:text-gray-300 bg-indigo-50/50 dark:bg-indigo-900/20 p-2 rounded-lg">
                    <CheckCircle className="h-5 w-5 text-indigo-500 mr-2 flex-shrink-0" />
                    <span>Automatische Kategorisierung und MwSt-Berechnung</span>
                  </li>
                  <li className="flex items-center text-gray-600 dark:text-gray-300 bg-indigo-50/50 dark:bg-indigo-900/20 p-2 rounded-lg">
                    <CheckCircle className="h-5 w-5 text-indigo-500 mr-2 flex-shrink-0" />
                    <span>Digitale Archivierung und schneller Zugriff</span>
                  </li>
                </ul>
              </CardContent>
              <CardFooter>
                <Link href="/dashboard?tab=invoices" className="w-full">
                  <Button className={`w-full bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 ${styles.modernButton} group`}>
                    <span>Rechnungen verwalten</span>
                    <ArrowRight className={`ml-2 h-4 w-4 ${styles.modernArrow}`} />
                  </Button>
                </Link>
              </CardFooter>
            </Card>

            <Card className={`border-0 shadow-xl overflow-hidden ${styles.glassEffect} ${styles.modernCard} relative`}>
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-400 to-purple-600"></div>
              <CardHeader className="pb-2">
                <div className="w-14 h-14 mb-4 rounded-2xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-purple-600 dark:text-purple-400 transform transition-transform group-hover:rotate-6">
                  <PieChart className="h-7 w-7" />
                </div>
                <CardTitle className="text-2xl">EÜR-Übersicht</CardTitle>
                <CardDescription className="text-base">
                  Live-Übersicht für all Ihre steuerlichen Pflichten
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600 dark:text-gray-300">
                  Mit unserem EÜR-Assistenten können Sie jederzeit eine Übersicht Ihrer
                  steuerlich relevanten Einnahmen und Ausgaben generieren und exportieren.
                </p>
                <ul className="mt-4 space-y-3">
                  <li className="flex items-center text-gray-600 dark:text-gray-300 bg-purple-50/50 dark:bg-purple-900/20 p-2 rounded-lg">
                    <CheckCircle className="h-5 w-5 text-purple-500 mr-2 flex-shrink-0" />
                    <span>Live EÜR-Vorschau mit Fortschrittsanzeige</span>
                  </li>
                  <li className="flex items-center text-gray-600 dark:text-gray-300 bg-purple-50/50 dark:bg-purple-900/20 p-2 rounded-lg">
                    <CheckCircle className="h-5 w-5 text-purple-500 mr-2 flex-shrink-0" />
                    <span>Export als PDF, CSV oder direkt für ELSTER</span>
                  </li>
                  <li className="flex items-center text-gray-600 dark:text-gray-300 bg-purple-50/50 dark:bg-purple-900/20 p-2 rounded-lg">
                    <CheckCircle className="h-5 w-5 text-purple-500 mr-2 flex-shrink-0" />
                    <span>Steuerberaterfreundliche Aufbereitung mit Belegen</span>
                  </li>
                </ul>
              </CardContent>
              <CardFooter>
                <Link href="/dashboard?tab=eur" className="w-full">
                  <Button className={`w-full bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 ${styles.modernButton} group`}>
                    <span>Zur EÜR-Übersicht</span>
                    <ArrowRight className={`ml-2 h-4 w-4 ${styles.modernArrow}`} />
                  </Button>
                </Link>
              </CardFooter>
            </Card>
          </div>
        </div>

        {/* Testimonials Section - Modern Glass Cards */}
        <div className="mt-32 mb-32">
          <div className="text-center mb-20">
            <span className="px-4 py-1.5 text-sm font-medium bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300 rounded-full mb-4 inline-block">Erfahrungen</span>
            <h2 className="text-4xl font-bold mb-6 from-purple-600 to-indigo-600 dark:from-purple-400 dark:to-indigo-400 ${styles.gradientText}">Was unsere Nutzer sagen</h2>
            <p className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
              Kleinunternehmer vertrauen auf unsere Lösung für ihre Buchhaltung
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            <div className="bg-white/70 dark:bg-gray-800/70 backdrop-blur-lg p-8 rounded-2xl shadow-xl border border-white/50 dark:border-gray-700/50 transform transition-all duration-300 hover:translate-y-[-8px]">
              <div className="flex items-center mb-4">
                <div className="text-yellow-400 flex">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="h-5 w-5 fill-current" />
                  ))}
                </div>
              </div>
              <p className="text-gray-600 dark:text-gray-300 mb-6 text-lg">
                "Als Freelancer habe ich endlich eine unkomplizierte Lösung für meine Buchhaltung gefunden. Die automatische Verarbeitung von Rechnungen spart mir <span className="text-blue-600 dark:text-blue-400 font-medium">Stunden an Arbeit</span> jeden Monat!"
              </p>
              <div className="flex items-center">
                <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-bold text-lg shadow-lg">
                  MK
                </div>
                <div className="ml-4">
                  <p className="font-semibold text-lg">Michael K.</p>
                  <p className="text-gray-500 dark:text-gray-400">Web-Designer, Hamburg</p>
                </div>
              </div>
            </div>

            <div className="bg-white/70 dark:bg-gray-800/70 backdrop-blur-lg p-8 rounded-2xl shadow-xl border border-white/50 dark:border-gray-700/50 transform transition-all duration-300 hover:translate-y-[-8px]">
              <div className="flex items-center mb-4">
                <div className="text-yellow-400 flex">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="h-5 w-5 fill-current" />
                  ))}
                </div>
              </div>
              <p className="text-gray-600 dark:text-gray-300 mb-6 text-lg">
                "Die EÜR-Funktion ist ein Lebensretter! Mein Steuerberater war <span className="text-indigo-600 dark:text-indigo-400 font-medium">beeindruckt von der übersichtlichen Aufbereitung</span> meiner Unterlagen."
              </p>
              <div className="flex items-center">
                <div className="w-14 h-14 rounded-full bg-gradient-to-br from-indigo-400 to-indigo-600 flex items-center justify-center text-white font-bold text-lg shadow-lg">
                  SB
                </div>
                <div className="ml-4">
                  <p className="font-semibold text-lg">Sarah B.</p>
                  <p className="text-gray-500 dark:text-gray-400">Online-Shop Betreiberin, München</p>
                </div>
              </div>
            </div>

            <div className="bg-white/70 dark:bg-gray-800/70 backdrop-blur-lg p-8 rounded-2xl shadow-xl border border-white/50 dark:border-gray-700/50 transform transition-all duration-300 hover:translate-y-[-8px]">
              <div className="flex items-center mb-4">
                <div className="text-yellow-400 flex">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="h-5 w-5 fill-current" />
                  ))}
                </div>
              </div>
              <p className="text-gray-600 dark:text-gray-300 mb-6 text-lg">
                "Dieses Tool hat meine Buchhaltung revolutioniert. Die <span className="text-purple-600 dark:text-purple-400 font-medium">ZUGFeRD-Integration spart enorm viel Zeit</span> und funktioniert perfekt!"
              </p>
              <div className="flex items-center">
                <div className="w-14 h-14 rounded-full bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center text-white font-bold text-lg shadow-lg">
                  TM
                </div>
                <div className="ml-4">
                  <p className="font-semibold text-lg">Thomas M.</p>
                  <p className="text-gray-500 dark:text-gray-400">IT-Berater, Berlin</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Stats Section - Modern Glass Cards with Icons */}
        <div className="mt-32 max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 p-8 ${styles.glassEffect} rounded-2xl shadow-xl border border-white/50 dark:border-gray-700/50">
            <div className="text-center p-6 transition-transform duration-300 hover:scale-105">
              <div className="inline-flex items-center justify-center p-3 rounded-xl bg-gradient-to-br from-blue-400 to-blue-600 shadow-lg mb-6">
                <Shield className="h-8 w-8 text-white" />
              </div>
              <div className="text-3xl font-bold text-blue-600 dark:text-blue-400 mb-2">Sicher</div>
              <p className="text-gray-600 dark:text-gray-300">Lokale Datenspeicherung für höchste Datensicherheit und Kontrolle</p>
            </div>
            <div className="text-center p-6 transition-transform duration-300 hover:scale-105">
              <div className="inline-flex items-center justify-center p-3 rounded-xl bg-gradient-to-br from-indigo-400 to-indigo-600 shadow-lg mb-6">
                <Zap className="h-8 w-8 text-white" />
              </div>
              <div className="text-3xl font-bold text-indigo-600 dark:text-indigo-400 mb-2">Schnell</div>
              <p className="text-gray-600 dark:text-gray-300">Automatisierte Prozesse sparen wertvolle Zeit in Ihrem Geschäftsalltag</p>
            </div>
            <div className="text-center p-6 transition-transform duration-300 hover:scale-105">
              <div className="inline-flex items-center justify-center p-3 rounded-xl bg-gradient-to-br from-purple-400 to-purple-600 shadow-lg mb-6">
                <CheckCircle className="h-8 w-8 text-white" />
              </div>
              <div className="text-3xl font-bold text-purple-600 dark:text-purple-400 mb-2">Konform</div>
              <p className="text-gray-600 dark:text-gray-300">Entspricht allen gesetzlichen Anforderungen für Ihre Steuerberichte</p>
            </div>
          </div>
        </div>

        {/* CTA Section - Modern Gradient Card */}
        <div className="mt-32 mb-16">
          <div className="relative overflow-hidden rounded-3xl shadow-2xl">
            <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-indigo-600 opacity-90"></div>
            <div className="absolute inset-0 bg-[url('/globe.svg')] bg-no-repeat bg-right-bottom opacity-10"></div>
            <div className="relative p-12 max-w-4xl mx-auto text-center">
              <h2 className="text-4xl font-bold mb-6 text-white">Bereit für eine einfachere Buchhaltung?</h2>
              <p className="text-xl text-blue-100 max-w-3xl mx-auto mb-10 leading-relaxed">
                Starten Sie noch heute und erleben Sie, wie einfach Buchhaltung sein kann.
                Keine versteckten Kosten, keine komplizierten Einrichtungen.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center mb-6">
                {status === "authenticated" ? (
                  <Link href="/dashboard">
                    <Button size="lg" className={`px-10 py-6 text-lg bg-white text-blue-600 hover:bg-blue-50 shadow-xl ${styles.modernButton}`}>
                      Zum Dashboard
                    </Button>
                  </Link>
                ) : (
                  <>
                    <Link href="/register">
                      <Button size="lg" className={`px-10 py-6 text-lg bg-white text-blue-600 hover:bg-blue-50 shadow-xl ${styles.modernButton}`}>
                        Jetzt kostenlos registrieren
                      </Button>
                    </Link>
                    <Link href="/login">
                      <Button size="lg" variant="outline" className={`px-10 py-6 text-lg border-2 border-white text-white hover:bg-white/10 ${styles.modernButton}`}>
                        Anmelden
                      </Button>
                    </Link>
                  </>
                )}
              </div>
              <div className="mt-10 p-4 bg-white/10 backdrop-blur rounded-xl inline-block">
                <p className="text-blue-100 text-sm flex items-center gap-2 justify-center">
                  <span className="inline-block w-2 h-2 rounded-full bg-green-400"></span>
                  Stand: 6. April 2025 • Alle Funktionen verfügbar
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer - Modern Minimal Design */}
        <footer className="border-t border-gray-200/50 dark:border-gray-700/50 pt-16 pb-12 mt-20">
          <div className="max-w-6xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-10 mb-10">
              <div>
                <h3 className="font-bold text-xl mb-4 text-gray-800 dark:text-gray-200">Bivaro</h3>
                <p className="text-gray-600 dark:text-gray-400 mb-6">Eine moderne Buchhaltungslösung, speziell entwickelt für Kleinunternehmer in Deutschland.</p>
                <div className="flex items-center gap-4">
                  <a href="#" className="text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                    <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path fillRule="evenodd" d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z" clipRule="evenodd" />
                    </svg>
                  </a>
                  <a href="#" className="text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                    <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M8.29 20.251c7.547 0 11.675-6.253 11.675-11.675 0-.178 0-.355-.012-.53A8.348 8.348 0 0022 5.92a8.19 8.19 0 01-2.357.646 4.118 4.118 0 001.804-2.27 8.224 8.224 0 01-2.605.996 4.107 4.107 0 00-6.993 3.743 11.65 11.65 0 01-8.457-4.287 4.106 4.106 0 001.27 5.477A4.072 4.072 0 012.8 9.713v.052a4.105 4.105 0 003.292 4.022 4.095 4.095 0 01-1.853.07 4.108 4.108 0 003.834 2.85A8.233 8.233 0 012 18.407a11.616 11.616 0 006.29 1.84" />
                    </svg>
                  </a>
                  <a href="#" className="text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                    <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                    </svg>
                  </a>
                </div>
              </div>
              <div>
                <h3 className="font-semibold mb-4 text-gray-800 dark:text-gray-200">Funktionen</h3>
                <ul className="space-y-2">
                  <li><Link href="/dashboard?tab=expenses" className="text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Ausgabenerfassung</Link></li>
                  <li><Link href="/dashboard?tab=incomes" className="text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Einnahmenübersicht</Link></li>
                  <li><Link href="/dashboard?tab=invoices" className="text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Rechnungsmanagement</Link></li>
                  <li><Link href="/dashboard?tab=eur" className="text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">EÜR-Generator</Link></li>
                </ul>
              </div>
              <div>
                <h3 className="font-semibold mb-4 text-gray-800 dark:text-gray-200">Rechtliches</h3>
                <ul className="space-y-2">
                  <li><Link href="#" className="text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Datenschutz</Link></li>
                  <li><Link href="#" className="text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">AGB</Link></li>
                  <li><Link href="#" className="text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Impressum</Link></li>
                  <li><Link href="#" className="text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Kontakt</Link></li>
                </ul>
              </div>
              <div>
                <h3 className="font-semibold mb-4 text-gray-800 dark:text-gray-200">Newsletter</h3>
                <p className="text-gray-600 dark:text-gray-400 mb-4">Erhalten Sie Updates zu neuen Funktionen und Steuertipps.</p>
                <div className="flex">
                  <input type="email" placeholder="Ihre E-Mail" className="px-4 py-2 rounded-l-lg border-y border-l border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <button className="px-4 py-2 bg-blue-600 text-white rounded-r-lg hover:bg-blue-700 transition-colors">
                    <ArrowRight className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>
            <div className="pt-8 border-t border-gray-200/50 dark:border-gray-700/50 text-center text-gray-500 dark:text-gray-400 text-sm">
              <p className="mb-2">© 2025 Bivaro • Eine moderne Lösung für Kleinunternehmer • Alle Rechte vorbehalten</p>
              <p>Designed mit ♥ in Deutschland</p>
            </div>
          </div>
        </footer>
      </div>

      {/* Add keyframe animation CSS */}
      <style jsx global>{`
        @keyframes float {
          0% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(-10px) rotate(2deg); }
          100% { transform: translateY(0px) rotate(0deg); }
        }
        
        @keyframes blob {
          0% { transform: scale(1) translate(0px, 0px); }
          33% { transform: scale(1.1) translate(30px, -50px); }
          66% { transform: scale(0.9) translate(-20px, 20px); }
          100% { transform: scale(1) translate(0px, 0px); }
        }
        
        .animate-float {
          animation: float 6s ease-in-out infinite;
        }
        
        .animate-blob {
          animation: blob 15s infinite alternate;
        }
        
        .animation-delay-2000 {
          animation-delay: 2s;
        }
        
        .animation-delay-4000 {
          animation-delay: 4s;
        }
      `}</style>
    </div>
  );
}
