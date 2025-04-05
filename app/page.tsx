import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, PieChart, FileText, BarChart3, CheckCircle, Shield, Zap } from "lucide-react";

// Optimierte CSS-Klassen mit subtileren Animationen
const styles = {
  // Sanftere Buttons ohne starke Transformationseffekte
  smoothButton: "transition-colors duration-200 ease-out",
  // Subtilere Kartenhover ohne vertikale Bewegung
  smoothHoverCard: "transition-shadow duration-200 ease-out hover:shadow-xl",
  // Pfeilanimation etwas subtiler
  smoothArrow: "transition-transform duration-150 ease-out group-hover:translate-x-0.5"
};

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      {/* Hero Section */}
      <div className="container py-20 px-4 mx-auto relative">
        {/* Decorative elements */}
        <div className="absolute top-20 right-10 md:right-20 lg:right-40 w-20 h-20 bg-blue-500/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-20 left-10 md:left-20 lg:left-40 w-32 h-32 bg-indigo-500/10 rounded-full blur-3xl"></div>
        
        <div className="relative flex flex-col lg:flex-row items-center gap-12 mb-20">
          <div className="lg:w-1/2 text-center lg:text-left">
            <div className="inline-block p-2 px-4 mb-6 bg-blue-50 rounded-full text-blue-700 font-medium text-sm dark:bg-blue-900/30 dark:text-blue-300">
              <span className="flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-blue-600"></span>
                Buchhaltung leicht gemacht
              </span>
            </div>
            <h1 className="text-5xl font-bold mb-6 bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400">
              Steuern und Finanzen <br />für Kleinunternehmer
            </h1>
            <p className="text-xl text-gray-600 dark:text-gray-300 max-w-xl mx-auto lg:mx-0 leading-relaxed mb-8">
              Fokussieren Sie sich auf Ihr Kerngeschäft, während wir Ihre Buchhaltung vereinfachen.
              Automatisieren Sie Ihre Finanzverwaltung und bereiten Sie Ihre Steuererklärung mühelos vor.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start mb-8">
              <Link href="/dashboard">
                <Button size="lg" className={`px-8 py-6 text-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md ${styles.smoothButton} group`}>
                  <span>Zum Dashboard</span>
                  <ArrowRight className={`ml-2 h-5 w-5 ${styles.smoothArrow}`} />
                </Button>
              </Link>
              <Link href="/dashboard?tab=invoices">
                <Button size="lg" variant="outline" className={`px-8 py-6 text-lg border hover:bg-gray-50/50 dark:hover:bg-gray-800/50 ${styles.smoothButton}`}>
                  Rechnungen verwalten
                </Button>
              </Link>
            </div>
            <div className="flex items-center justify-center lg:justify-start gap-2 text-sm text-gray-500 dark:text-gray-400">
              <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                <CheckCircle className="h-4 w-4" />
                Datenschutzkonform
              </span>
              <span className="mx-2">•</span>
              <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                <CheckCircle className="h-4 w-4" />
                Lokale Datenspeicherung
              </span>
              <span className="mx-2">•</span>
              <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                <CheckCircle className="h-4 w-4" />
                Finanzamt-tauglich
              </span>
            </div>
          </div>
          <div className="lg:w-1/2 relative">
            {/* Subtiler Hover-Effekt für das Bild ohne Rotation */}
            <div className="relative z-10 bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-xl dark:shadow-gray-900/30">
              <Image 
                src="/dashboard-preview.png" 
                width={600} 
                height={400} 
                alt="Dashboard Vorschau" 
                className="rounded-lg border border-gray-200 dark:border-gray-700 shadow-md"
              />
            </div>
            <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-r from-blue-500/20 to-indigo-500/20 rounded-2xl blur-3xl -z-10 transform -translate-x-4 translate-y-4"></div>
          </div>
        </div>

        {/* Features Section */}
        <div className="relative z-10 mt-24 mb-24">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">Alles was Sie für Ihre Buchhaltung brauchen</h2>
            <p className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
              Unsere Lösung bietet alles, was Kleinunternehmer für eine einfache und gesetzeskonforme Buchhaltung benötigen.
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            <Card className={`border-0 shadow-lg overflow-hidden bg-white dark:bg-gray-800 ${styles.smoothHoverCard}`}>
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-400 to-blue-600"></div>
              <CardHeader className="pb-2">
                <div className="w-12 h-12 mb-4 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
                  <BarChart3 className="h-6 w-6" />
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
                <ul className="mt-4 space-y-2">
                  <li className="flex items-center text-gray-600 dark:text-gray-300">
                    <CheckCircle className="h-4 w-4 text-green-500 mr-2" />
                    Kategorisierung von Ausgaben
                  </li>
                  <li className="flex items-center text-gray-600 dark:text-gray-300">
                    <CheckCircle className="h-4 w-4 text-green-500 mr-2" />
                    Steuerrelevanz markieren
                  </li>
                  <li className="flex items-center text-gray-600 dark:text-gray-300">
                    <CheckCircle className="h-4 w-4 text-green-500 mr-2" />
                    Belege hochladen und verknüpfen
                  </li>
                </ul>
              </CardContent>
              <CardFooter>
                <Link href="/dashboard?tab=expenses" className="w-full">
                  <Button className={`w-full bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 ${styles.smoothButton} group`}>
                    <span>Ausgaben erfassen</span>
                    <ArrowRight className={`ml-2 h-4 w-4 ${styles.smoothArrow}`} />
                  </Button>
                </Link>
              </CardFooter>
            </Card>

            <Card className={`border-0 shadow-lg overflow-hidden bg-white dark:bg-gray-800 ${styles.smoothHoverCard}`}>
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-400 to-indigo-600"></div>
              <CardHeader className="pb-2">
                <div className="w-12 h-12 mb-4 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                  <FileText className="h-6 w-6" />
                </div>
                <CardTitle className="text-2xl">ZUGFeRD-Integration</CardTitle>
                <CardDescription className="text-base">
                  Automatische Rechnungsverarbeitung mit fortschrittlicher Technologie
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600 dark:text-gray-300">
                  Laden Sie Ihre ZUGFeRD-kompatiblen Rechnungen hoch und lassen Sie die
                  Daten automatisch extrahieren und in Ihre Buchhaltung integrieren.
                </p>
                <ul className="mt-4 space-y-2">
                  <li className="flex items-center text-gray-600 dark:text-gray-300">
                    <CheckCircle className="h-4 w-4 text-green-500 mr-2" />
                    Automatisierte Datenextraktion
                  </li>
                  <li className="flex items-center text-gray-600 dark:text-gray-300">
                    <CheckCircle className="h-4 w-4 text-green-500 mr-2" />
                    Intelligente Kategorisierung
                  </li>
                  <li className="flex items-center text-gray-600 dark:text-gray-300">
                    <CheckCircle className="h-4 w-4 text-green-500 mr-2" />
                    Archivierung und einfacher Zugriff
                  </li>
                </ul>
              </CardContent>
              <CardFooter>
                <Link href="/dashboard?tab=invoices" className="w-full">
                  <Button className={`w-full bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 ${styles.smoothButton} group`}>
                    <span>Rechnungen verwalten</span>
                    <ArrowRight className={`ml-2 h-4 w-4 ${styles.smoothArrow}`} />
                  </Button>
                </Link>
              </CardFooter>
            </Card>

            <Card className={`border-0 shadow-lg overflow-hidden bg-white dark:bg-gray-800 ${styles.smoothHoverCard}`}>
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-400 to-purple-600"></div>
              <CardHeader className="pb-2">
                <div className="w-12 h-12 mb-4 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-purple-600 dark:text-purple-400">
                  <PieChart className="h-6 w-6" />
                </div>
                <CardTitle className="text-2xl">EÜR-Übersicht</CardTitle>
                <CardDescription className="text-base">
                  Stets aktueller Überblick für Ihre steuerlichen Pflichten
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600 dark:text-gray-300">
                  Mit unserem EÜR-Assistenten können Sie jederzeit eine Übersicht Ihrer
                  steuerlich relevanten Einnahmen und Ausgaben generieren und exportieren.
                </p>
                <ul className="mt-4 space-y-2">
                  <li className="flex items-center text-gray-600 dark:text-gray-300">
                    <CheckCircle className="h-4 w-4 text-green-500 mr-2" />
                    Automatische EÜR-Vorbereitung
                  </li>
                  <li className="flex items-center text-gray-600 dark:text-gray-300">
                    <CheckCircle className="h-4 w-4 text-green-500 mr-2" />
                    Export in verschiedene Formate
                  </li>
                  <li className="flex items-center text-gray-600 dark:text-gray-300">
                    <CheckCircle className="h-4 w-4 text-green-500 mr-2" />
                    Steuerberaterfreundliche Aufbereitung
                  </li>
                </ul>
              </CardContent>
              <CardFooter>
                <Link href="/dashboard?tab=eur" className="w-full">
                  <Button className={`w-full bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 ${styles.smoothButton} group`}>
                    <span>Zur EÜR-Übersicht</span>
                    <ArrowRight className={`ml-2 h-4 w-4 ${styles.smoothArrow}`} />
                  </Button>
                </Link>
              </CardFooter>
            </Card>
          </div>
        </div>

        {/* Testimonials Section */}
        <div className="mt-32 mb-24">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Was unsere Nutzer sagen</h2>
            <p className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
              Kleinunternehmer vertrauen auf unsere Lösung für ihre Buchhaltung
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
            <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700">
              <div className="flex items-center mb-4">
                <div className="text-yellow-400 flex">
                  {[...Array(5)].map((_, i) => (
                    <svg key={i} xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  ))}
                </div>
              </div>
              <p className="text-gray-600 dark:text-gray-300 mb-6">
                "Als Freelancer habe ich endlich eine unkomplizierte Lösung für meine Buchhaltung gefunden. Die automatische Verarbeitung von Rechnungen spart mir Stunden an Arbeit!"
              </p>
              <div className="flex items-center">
                <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
                  <span className="text-blue-600 font-bold">MK</span>
                </div>
                <div className="ml-4">
                  <p className="font-semibold">Michael K.</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Web-Designer, Hamburg</p>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700">
              <div className="flex items-center mb-4">
                <div className="text-yellow-400 flex">
                  {[...Array(5)].map((_, i) => (
                    <svg key={i} xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  ))}
                </div>
              </div>
              <p className="text-gray-600 dark:text-gray-300 mb-6">
                "Die EÜR-Funktion ist ein Lebensretter! Mein Steuerberater war beeindruckt von der übersichtlichen Aufbereitung meiner Unterlagen."
              </p>
              <div className="flex items-center">
                <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center">
                  <span className="text-indigo-600 font-bold">SB</span>
                </div>
                <div className="ml-4">
                  <p className="font-semibold">Sarah B.</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Online-Shop Betreiberin, München</p>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700">
              <div className="flex items-center mb-4">
                <div className="text-yellow-400 flex">
                  {[...Array(5)].map((_, i) => (
                    <svg key={i} xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  ))}
                </div>
              </div>
              <p className="text-gray-600 dark:text-gray-300 mb-6">
                "Dieses Tool hat meine Buchhaltung revolutioniert. Die Benutzeroberfläche ist intuitiv und die ZUGFeRD-Integration spart enorm viel Zeit!"
              </p>
              <div className="flex items-center">
                <div className="w-12 h-12 rounded-full bg-purple-100 flex items-center justify-center">
                  <span className="text-purple-600 font-bold">TM</span>
                </div>
                <div className="ml-4">
                  <p className="font-semibold">Thomas M.</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">IT-Berater, Berlin</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Stats Section */}
        <div className="mt-24 max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 p-8 bg-white dark:bg-gray-800 rounded-2xl shadow-lg">
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Shield className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                <div className="text-4xl font-bold text-blue-600 dark:text-blue-400">Sicher</div>
              </div>
              <p className="text-gray-600 dark:text-gray-300">Lokale Datenspeicherung für höchste Sicherheit</p>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Zap className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
                <div className="text-4xl font-bold text-indigo-600 dark:text-indigo-400">Schnell</div>
              </div>
              <p className="text-gray-600 dark:text-gray-300">Automatisierte Prozesse sparen wertvolle Zeit</p>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <CheckCircle className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                <div className="text-4xl font-bold text-purple-600 dark:text-purple-400">Konform</div>
              </div>
              <p className="text-gray-600 dark:text-gray-300">Entspricht allen gesetzlichen Anforderungen</p>
            </div>
          </div>
        </div>

        {/* CTA Section */}
        <div className="mt-24 mb-12">
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-3xl p-10 shadow-xl">
            <div className="max-w-4xl mx-auto text-center">
              <h2 className="text-3xl font-bold mb-6 text-white">Bereit für eine einfachere Buchhaltung?</h2>
              <p className="text-xl text-blue-100 max-w-3xl mx-auto mb-8">
                Starten Sie noch heute und erleben Sie, wie einfach Buchhaltung sein kann.
                Keine versteckten Kosten, keine komplizierten Einrichtungen.
              </p>
              <Link href="/dashboard">
                <Button size="lg" className={`px-10 py-6 text-lg bg-white text-blue-600 hover:bg-blue-50 shadow-lg ${styles.smoothButton}`}>
                  Jetzt kostenlos starten
                </Button>
              </Link>
              <p className="mt-6 text-blue-100 text-sm">Stand: 6. April 2025 • Alle Funktionen verfügbar</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="border-t border-gray-200 dark:border-gray-700 pt-12 pb-8 mt-16 text-center text-gray-500 dark:text-gray-400 text-sm">
          <div className="flex justify-center gap-6 mb-6">
            <Link href="/dashboard" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Dashboard</Link>
            <Link href="/dashboard?tab=expenses" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Ausgaben</Link>
            <Link href="/dashboard?tab=incomes" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Einnahmen</Link>
            <Link href="/dashboard?tab=invoices" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Rechnungen</Link>
            <Link href="/dashboard?tab=eur" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">EÜR</Link>
          </div>
          <p>© 2025 KleinBuch • Eine Lösung für Kleinunternehmer • Alle Rechte vorbehalten</p>
          <p className="mt-2">Datenschutz | Impressum | Nutzungsbedingungen</p>
        </footer>
      </div>
    </div>
  );
}
