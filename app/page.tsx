import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";

export default function Home() {
  return (
    <div className="container py-16 px-4 mx-auto">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold mb-4">Willkommen zur Kleinunternehmer-Buchhaltung</h1>
        <p className="text-xl text-gray-600 max-w-3xl mx-auto">
          Eine einfache, aber effektive Lösung für die Buchhaltung von Kleinunternehmern.
          Behalten Sie den Überblick über Ihre Einnahmen und Ausgaben und bereiten Sie Ihre EÜR vor.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Einfache Erfassung</CardTitle>
            <CardDescription>
              Erfassen Sie Ihre Einnahmen und Ausgaben mit wenigen Klicks
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600">
              Mit unserer benutzerfreundlichen Oberfläche können Sie schnell und unkompliziert
              alle geschäftlichen Transaktionen erfassen und kategorisieren.
            </p>
          </CardContent>
          <CardFooter>
            <Link href="/dashboard?tab=expenses" className="w-full">
              <Button className="w-full">Ausgaben erfassen</Button>
            </Link>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>ZUGFeRD-Integration</CardTitle>
            <CardDescription>
              Automatische Verarbeitung von ZUGFeRD-kompatiblen Rechnungen
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600">
              Laden Sie Ihre ZUGFeRD-kompatiblen Rechnungen hoch und lassen Sie die
              Daten automatisch extrahieren und in Ihre Buchhaltung integrieren.
            </p>
          </CardContent>
          <CardFooter>
            <Link href="/dashboard?tab=invoices" className="w-full">
              <Button className="w-full" variant="outline">Rechnungen verwalten</Button>
            </Link>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>EÜR-Übersicht</CardTitle>
            <CardDescription>
              Erstellen Sie Ihre Einnahmen-Überschuss-Rechnung für das Finanzamt
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600">
              Mit unserem EÜR-Assistenten können Sie jederzeit eine Übersicht Ihrer
              steuerlich relevanten Einnahmen und Ausgaben generieren.
            </p>
          </CardContent>
          <CardFooter>
            <Link href="/dashboard?tab=eur" className="w-full">
              <Button className="w-full" variant="outline">Zur EÜR-Übersicht</Button>
            </Link>
          </CardFooter>
        </Card>
      </div>

      <div className="text-center mt-16">
        <Link href="/dashboard">
          <Button size="lg">Zum Dashboard</Button>
        </Link>
      </div>
    </div>
  );
}
