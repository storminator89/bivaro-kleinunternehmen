"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Copy,
  Check,
  Key,
  Shield,
  Zap,
  Code2,
  FileJson,
  Users,
  Receipt,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  Clock,
  ChevronRight,
  ExternalLink,
  Upload,
  RefreshCw,
  Bell,
  Settings,
  Globe
} from "lucide-react";
import Link from "next/link";

export default function ApiDocsPage() {
  const [_language] = useState<"de" | "en">("de");

  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const copyCode = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(id);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const CodeBlock = ({ code, id }: { code: string; id: string }) => (
    <div className="relative group">
      <pre className="bg-zinc-950 text-zinc-100 p-4 rounded-lg overflow-x-auto text-sm font-mono">
        <code>{code}</code>
      </pre>
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity bg-zinc-800 hover:bg-zinc-700"
        onClick={() => copyCode(code, id)}
      >
        {copiedCode === id ? (
          <Check className="h-4 w-4 text-green-400" />
        ) : (
          <Copy className="h-4 w-4 text-zinc-400" />
        )}
      </Button>
    </div>
  );

  const endpoints = [
    {
      name: "Kunden",
      icon: Users,
      path: "/api/v1/customers",
      methods: ["GET", "POST", "PUT", "DELETE"],
      description: "Verwaltung von Kundendaten",
      examples: {
        get: `curl -X GET "https://ihre-domain.de/api/v1/customers?page=1&limit=10" \\
  -H "Authorization: Bearer biv_sk_IhrApiKey"`,
        post: `curl -X POST "https://ihre-domain.de/api/v1/customers" \\
  -H "Authorization: Bearer biv_sk_IhrApiKey" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Musterfirma GmbH",
    "email": "info@musterfirma.de",
    "city": "Berlin"
  }'`,
        response: `{
  "success": true,
  "data": {
    "id": 1,
    "name": "Musterfirma GmbH",
    "email": "info@musterfirma.de",
    "city": "Berlin",
    "createdAt": "2025-11-27T20:00:00.000Z"
  },
  "timestamp": "2025-11-27T20:00:00.000Z"
}`
      }
    },
    {
      name: "Ausgaben",
      icon: TrendingDown,
      path: "/api/v1/expenses",
      methods: ["GET", "POST", "PUT", "DELETE"],
      description: "Erfassung und Verwaltung von Ausgaben",
      examples: {
        get: `curl -X GET "https://ihre-domain.de/api/v1/expenses?category=Büro&startDate=2025-01-01" \\
  -H "Authorization: Bearer biv_sk_IhrApiKey"`,
        post: `curl -X POST "https://ihre-domain.de/api/v1/expenses" \\
  -H "Authorization: Bearer biv_sk_IhrApiKey" \\
  -H "Content-Type: application/json" \\
  -d '{
    "description": "Büromaterial",
    "amount": 59.99,
    "category": "Büro",
    "taxRelevant": true
  }'`,
        response: `{
  "success": true,
  "data": {
    "id": 42,
    "description": "Büromaterial",
    "amount": 59.99,
    "category": "Büro",
    "taxRelevant": true,
    "date": "2025-11-27T20:00:00.000Z"
  },
  "timestamp": "2025-11-27T20:00:00.000Z"
}`
      }
    },
    {
      name: "Einnahmen",
      icon: TrendingUp,
      path: "/api/v1/incomes",
      methods: ["GET", "POST", "PUT", "DELETE"],
      description: "Erfassung und Verwaltung von Einnahmen",
      examples: {
        get: `curl -X GET "https://ihre-domain.de/api/v1/incomes?customerId=5" \\
  -H "Authorization: Bearer biv_sk_IhrApiKey"`,
        post: `curl -X POST "https://ihre-domain.de/api/v1/incomes" \\
  -H "Authorization: Bearer biv_sk_IhrApiKey" \\
  -H "Content-Type: application/json" \\
  -d '{
    "description": "Beratungsleistung",
    "amount": 1500.00,
    "customerId": 5
  }'`,
        response: `{
  "success": true,
  "data": {
    "id": 15,
    "description": "Beratungsleistung",
    "amount": 1500.00,
    "customerId": 5,
    "customer": {
      "id": 5,
      "name": "Musterfirma GmbH"
    },
    "date": "2025-11-27T20:00:00.000Z"
  },
  "timestamp": "2025-11-27T20:00:00.000Z"
}`
      }
    },
    {
      name: "Rechnungen",
      icon: Receipt,
      path: "/api/v1/invoices",
      methods: ["GET", "PUT", "DELETE"],
      description: "Verwaltung von Rechnungen und deren Status",
      examples: {
        get: `curl -X GET "https://ihre-domain.de/api/v1/invoices?status=SENT" \\
  -H "Authorization: Bearer biv_sk_IhrApiKey"`,
        post: `curl -X PUT "https://ihre-domain.de/api/v1/invoices?id=10" \\
  -H "Authorization: Bearer biv_sk_IhrApiKey" \\
  -H "Content-Type: application/json" \\
  -d '{
    "status": "PAID",
    "paidAt": "2025-11-27T12:00:00.000Z"
  }'`,
        response: `{
  "success": true,
  "data": {
    "id": 10,
    "invoiceNumber": "RE-2025-0042",
    "status": "PAID",
    "totalAmount": 1785.00,
    "paidAt": "2025-11-27T12:00:00.000Z"
  },
  "timestamp": "2025-11-27T20:00:00.000Z"
}`
      }
    },
    {
      name: "Rechnungs-Upload",
      icon: Upload,
      path: "/api/v1/invoices/upload",
      methods: ["POST"],
      description: "ZUGFeRD/Factur-X-PDFs oder XRechnung-/UBL-XMLs hochladen",
      examples: {
        get: `# Rechnungs-PDF hochladen
curl -X POST "https://ihre-domain.de/api/v1/invoices/upload" \\
  -H "Authorization: Bearer biv_sk_IhrApiKey" \\
  -F "file=@rechnung.pdf"`,
        post: `# XML-E-Rechnung hochladen
curl -X POST "https://ihre-domain.de/api/v1/invoices/upload" \\
  -H "Authorization: Bearer biv_sk_IhrApiKey" \\
  -F "file=@/pfad/zur/rechnung.xml"`,
        response: `{
  "success": true,
  "data": {
    "id": 25,
    "fileName": "rechnung.pdf",
    "invoiceNumber": "RE-2025-0042",
    "invoiceDate": "2025-11-27T00:00:00.000Z",
    "dueDate": "2025-12-11T00:00:00.000Z",
    "totalAmount": 1785.00,
    "status": "DRAFT",
    "customerName": "Musterfirma GmbH",
    "eInvoiceFormat": "CII",
    "hasEInvoiceXml": true,
    "hasPdfFile": true
  },
  "timestamp": "2025-11-27T20:00:00.000Z"
}`
      }
    },
    {
      name: "Wiederkehrende Ausgaben",
      icon: RefreshCw,
      path: "/api/v1/recurring-expenses",
      methods: ["GET", "POST", "PUT", "DELETE"],
      description: "Automatische wiederkehrende Ausgaben verwalten",
      examples: {
        get: `curl -X GET "https://ihre-domain.de/api/v1/recurring-expenses?isActive=true" \\
  -H "Authorization: Bearer biv_sk_IhrApiKey"`,
        post: `curl -X POST "https://ihre-domain.de/api/v1/recurring-expenses" \\
  -H "Authorization: Bearer biv_sk_IhrApiKey" \\
  -H "Content-Type: application/json" \\
  -d '{
    "description": "Serverkosten",
    "amount": 29.99,
    "interval": "MONTHLY",
    "dayOfMonth": 1,
    "category": "IT"
  }'`,
        response: `{
  "success": true,
  "data": {
    "id": 5,
    "description": "Serverkosten",
    "amount": 29.99,
    "interval": "MONTHLY",
    "dayOfMonth": 1,
    "nextExecution": "2025-12-01T00:00:00.000Z",
    "isActive": true
  },
  "timestamp": "2025-11-27T20:00:00.000Z"
}`
      }
    },
    {
      name: "Mahnungen",
      icon: Bell,
      path: "/api/v1/reminders",
      methods: ["GET", "POST", "DELETE"],
      description: "Überfällige Rechnungen und Mahnungen verwalten",
      examples: {
        get: `curl -X GET "https://ihre-domain.de/api/v1/reminders" \\
  -H "Authorization: Bearer biv_sk_IhrApiKey"`,
        post: `curl -X POST "https://ihre-domain.de/api/v1/reminders" \\
  -H "Authorization: Bearer biv_sk_IhrApiKey" \\
  -H "Content-Type: application/json" \\
  -d '{
    "invoiceId": 10,
    "fee": 5.00,
    "dueDays": 14
  }'`,
        response: `{
  "success": true,
  "data": {
    "id": 3,
    "invoiceId": 10,
    "reminderLevel": 1,
    "reminderLevelLabel": "Payment Reminder",
    "fee": 5.00,
    "dueDate": "2025-12-11T00:00:00.000Z",
    "sentAt": "2025-11-27T20:00:00.000Z"
  },
  "timestamp": "2025-11-27T20:00:00.000Z"
}`
      }
    },
    {
      name: "Kassenbuch",
      icon: Receipt,
      path: "/api/v1/cashbook",
      methods: ["GET", "POST", "PUT", "DELETE"],
      description: "Kassenbücher und Kassenbuch-Transaktionen verwalten",
      examples: {
        get: `curl -X GET "https://ihre-domain.de/api/v1/cashbook?cashBookId=1&startDate=2025-01-01" \\
  -H "Authorization: Bearer biv_sk_IhrApiKey"`,
        post: `curl -X POST "https://ihre-domain.de/api/v1/cashbook" \\
  -H "Authorization: Bearer biv_sk_IhrApiKey" \\
  -H "Content-Type: application/json" \\
  -d '{
    "cashBookId": 1,
    "type": "EINNAHME",
    "description": "Barverkauf",
    "amount": 150.00,
    "category": "Verkauf"
  }'`,
        response: `{
  "success": true,
  "data": {
    "cashBooks": [{ "id": 1, "name": "Hauptkasse", "initialBalance": 0 }],
    "transactions": [
      {
        "id": 1,
        "date": "2025-11-27T14:00:00.000Z",
        "type": "EINNAHME",
        "description": "Barverkauf",
        "amount": 150.00,
        "runningBalance": 150.00
      }
    ]
  },
  "meta": { "page": 1, "total": 1 },
  "timestamp": "2025-11-27T20:00:00.000Z"
}`
      }
    },
    {
      name: "GoBD-Dokumentation",
      icon: FileJson,
      path: "/api/v1/documentation",
      methods: ["GET", "POST", "PUT", "DELETE"],
      description: "GoBD-Verfahrensdokumentationen verwalten",
      examples: {
        get: `curl -X GET "https://ihre-domain.de/api/v1/documentation" \\
  -H "Authorization: Bearer biv_sk_IhrApiKey"`,
        post: `curl -X POST "https://ihre-domain.de/api/v1/documentation" \\
  -H "Authorization: Bearer biv_sk_IhrApiKey" \\
  -H "Content-Type: application/json" \\
  -d '{
    "version": "1.0",
    "title": "Verfahrensdokumentation",
    "content": "{\"sections\": [...]}"
  }'`,
        response: `{
  "success": true,
  "data": {
    "id": 1,
    "version": "1.0",
    "title": "Verfahrensdokumentation",
    "createdAt": "2025-11-27T20:00:00.000Z",
    "updatedAt": "2025-11-27T20:00:00.000Z"
  },
  "timestamp": "2025-11-27T20:00:00.000Z"
}`
      }
    },
    {
      name: "Einstellungen",
      icon: Settings,
      path: "/api/v1/settings",
      methods: ["GET"],
      description: "Firmeneinstellungen abrufen (nur lesen)",
      examples: {
        get: `curl -X GET "https://ihre-domain.de/api/v1/settings" \\
  -H "Authorization: Bearer biv_sk_IhrApiKey"`,
        post: `# Hinweis: Einstellungen können aus Sicherheitsgründen 
# nur über das Web-Interface geändert werden.
# PUT und DELETE sind nicht verfügbar.`,
        response: `{
  "success": true,
  "data": {
    "companyName": "Musterfirma GmbH",
    "companyAddress": "Musterstraße 1\\n12345 Berlin",
    "email": "info@musterfirma.de",
    "telephone": "+49 30 12345678",
    "taxNumber": "DE123456789",
    "bankName": "Musterbank",
    "iban": "****6789",
    "bic": "MUSTDEFF"
  },
  "timestamp": "2025-11-27T20:00:00.000Z"
}`
      }
    }
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Back Link */}
        <Link
          href="/settings/api-keys"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Zurück zu API-Schlüssel
        </Link>

        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Code2 className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">API-Dokumentation</h1>
              <p className="text-muted-foreground">
                REST API v1 für die Integration externer Systeme
              </p>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <Badge variant="outline" className="gap-1">
              <Zap className="h-3 w-3" />
              REST API
            </Badge>
            <Badge variant="outline" className="gap-1">
              <FileJson className="h-3 w-3" />
              JSON
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Shield className="h-3 w-3" />
              API-Key Auth
            </Badge>
          </div>
        </header>

        {/* Quick Start */}
        <Card className="mb-8 border-primary/20 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              Schnellstart
            </CardTitle>
            <CardDescription>
              In 3 Schritten zur ersten API-Anfrage
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-3 gap-4">
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">
                  1
                </div>
                <div>
                  <p className="font-medium">API-Key erstellen</p>
                  <p className="text-sm text-muted-foreground">
                    Erstellen Sie einen API-Key unter{" "}
                    <Link href="/settings/api-keys" className="text-primary hover:underline">
                      Einstellungen → API-Keys
                    </Link>
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">
                  2
                </div>
                <div>
                  <p className="font-medium">Key sicher speichern</p>
                  <p className="text-sm text-muted-foreground">
                    Der vollständige Key wird nur einmal angezeigt
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">
                  3
                </div>
                <div>
                  <p className="font-medium">API aufrufen</p>
                  <p className="text-sm text-muted-foreground">
                    Key im Header mitsenden
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Authentication */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              Authentifizierung
            </CardTitle>
            <CardDescription>
              Alle API-Anfragen müssen authentifiziert werden
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Sie können den API-Key auf zwei Arten übermitteln:
            </p>

            <div className="space-y-4">
              <div>
                <h4 className="font-medium mb-2">Option 1: Authorization Header (empfohlen)</h4>
                <CodeBlock
                  code='Authorization: Bearer biv_sk_IhrApiKey...'
                  id="auth1"
                />
              </div>

              <div>
                <h4 className="font-medium mb-2">Option 2: X-API-Key Header</h4>
                <CodeBlock
                  code='X-API-Key: biv_sk_IhrApiKey...'
                  id="auth2"
                />
              </div>
            </div>

            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mt-4">
              <div className="flex gap-3">
                <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-yellow-800 dark:text-yellow-200">Sicherheitshinweis</p>
                  <p className="text-yellow-700 dark:text-yellow-300 mt-1">
                    Teilen Sie Ihren API-Key niemals öffentlich. Speichern Sie ihn sicher als Umgebungsvariable.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Rate Limiting */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Rate Limiting
            </CardTitle>
            <CardDescription>
              Schutz vor Überlastung der API
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-medium mb-2">Limits</h4>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <ChevronRight className="h-4 w-4" />
                    <strong>100 Anfragen</strong> pro Minute pro API-Key
                  </li>
                  <li className="flex items-center gap-2">
                    <ChevronRight className="h-4 w-4" />
                    Max. <strong>100 Ergebnisse</strong> pro Seite
                  </li>
                </ul>
              </div>
              <div>
                <h4 className="font-medium mb-2">Response Headers</h4>
                <CodeBlock
                  code={`X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1732738800`}
                  id="ratelimit"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* CORS Configuration */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              CORS (Cross-Origin Resource Sharing)
            </CardTitle>
            <CardDescription>
              Konfiguration für browserbasierte API-Zugriffe
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Wenn Sie die API von einer Browser-Anwendung (z.B. React, Vue, JavaScript) aufrufen möchten,
              müssen Sie die Domain Ihrer Anwendung als erlaubte Origin konfigurieren.
            </p>

            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <div className="flex gap-3">
                <Shield className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-blue-800 dark:text-blue-200">Origins konfigurieren</p>
                  <p className="text-blue-700 dark:text-blue-300 mt-1">
                    Fügen Sie Ihre erlaubten Origins unter{" "}
                    <Link href="/settings/api-keys" className="underline hover:no-underline">
                      Einstellungen → API-Keys → CORS-Einstellungen
                    </Link>
                    {" "}hinzu.
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h4 className="font-medium mb-2">Standard-Origins (immer erlaubt)</h4>
              <div className="flex flex-wrap gap-2">
                <code className="bg-muted px-2 py-1 rounded text-sm">http://localhost:3000</code>
                <code className="bg-muted px-2 py-1 rounded text-sm">https://localhost:3000</code>
              </div>
            </div>

            <div>
              <h4 className="font-medium mb-2">Beispiel: JavaScript Fetch</h4>
              <CodeBlock
                code={`// CORS funktioniert automatisch, wenn die Origin konfiguriert ist
const response = await fetch('https://ihre-domain.de/api/v1/customers', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer biv_sk_IhrApiKey',
    'Content-Type': 'application/json'
  },
  credentials: 'include' // Optional: für Cookies
});

const data = await response.json();`}
                id="cors-fetch"
              />
            </div>

            <div>
              <h4 className="font-medium mb-2">CORS Response Headers</h4>
              <CodeBlock
                code={`Access-Control-Allow-Origin: https://ihre-app.de
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, X-API-Key
Access-Control-Allow-Credentials: true
Access-Control-Max-Age: 86400`}
                id="cors-headers"
              />
            </div>

            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mt-4">
              <div className="flex gap-3">
                <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-amber-800 dark:text-amber-200">Server-zu-Server Aufrufe</p>
                  <p className="text-amber-700 dark:text-amber-300 mt-1">
                    Bei Server-zu-Server Aufrufen (z.B. von Node.js, Python, PHP) ist CORS nicht relevant.
                    CORS gilt nur für Anfragen aus dem Browser.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Response Format */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileJson className="h-5 w-5" />
              Response-Format
            </CardTitle>
            <CardDescription>
              Einheitliches JSON-Format für alle Antworten
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="success">
              <TabsList>
                <TabsTrigger value="success">Erfolg</TabsTrigger>
                <TabsTrigger value="error">Fehler</TabsTrigger>
                <TabsTrigger value="pagination">Pagination</TabsTrigger>
              </TabsList>

              <TabsContent value="success" className="mt-4">
                <CodeBlock
                  code={`{
  "success": true,
  "data": { ... },
  "timestamp": "2025-11-27T20:00:00.000Z"
}`}
                  id="success"
                />
              </TabsContent>

              <TabsContent value="error" className="mt-4">
                <CodeBlock
                  code={`{
  "error": {
    "message": "Customer not found",
    "code": "NOT_FOUND",
    "timestamp": "2025-11-27T20:00:00.000Z"
  }
}`}
                  id="error"
                />
              </TabsContent>

              <TabsContent value="pagination" className="mt-4">
                <CodeBlock
                  code={`{
  "success": true,
  "data": [ ... ],
  "meta": {
    "page": 1,
    "pageSize": 50,
    "total": 127,
    "hasMore": true
  },
  "timestamp": "2025-11-27T20:00:00.000Z"
}`}
                  id="pagination"
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* HTTP Status Codes */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>HTTP Status Codes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">200</Badge>
                  <span className="text-sm">Erfolgreiche Anfrage</span>
                </div>
                <div className="flex items-center gap-3">
                  <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">201</Badge>
                  <span className="text-sm">Ressource erstellt</span>
                </div>
                <div className="flex items-center gap-3">
                  <Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">400</Badge>
                  <span className="text-sm">Ungültige Anfrage</span>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">401</Badge>
                  <span className="text-sm">Nicht authentifiziert</span>
                </div>
                <div className="flex items-center gap-3">
                  <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">404</Badge>
                  <span className="text-sm">Ressource nicht gefunden</span>
                </div>
                <div className="flex items-center gap-3">
                  <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">429</Badge>
                  <span className="text-sm">Rate Limit überschritten</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Endpoints */}
        <h2 className="text-2xl font-bold mb-4">Endpunkte</h2>

        <div className="space-y-6">
          {endpoints.map((endpoint) => (
            <Card key={endpoint.path} id={endpoint.name.toLowerCase()}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <endpoint.icon className="h-5 w-5" />
                  {endpoint.name}
                </CardTitle>
                <CardDescription className="flex items-center gap-2">
                  <code className="text-sm bg-muted px-2 py-0.5 rounded">{endpoint.path}</code>
                  <span>—</span>
                  <span>{endpoint.description}</span>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2 mb-4">
                  {endpoint.methods.map((method) => (
                    <Badge
                      key={method}
                      variant="outline"
                      className={
                        method === "GET" ? "border-green-500 text-green-600" :
                          method === "POST" ? "border-blue-500 text-blue-600" :
                            method === "PUT" ? "border-yellow-500 text-yellow-600" :
                              "border-red-500 text-red-600"
                      }
                    >
                      {method}
                    </Badge>
                  ))}
                </div>

                <Tabs defaultValue="request">
                  <TabsList>
                    <TabsTrigger value="request">Anfrage</TabsTrigger>
                    <TabsTrigger value="create">Erstellen</TabsTrigger>
                    <TabsTrigger value="response">Antwort</TabsTrigger>
                  </TabsList>

                  <TabsContent value="request" className="mt-4">
                    <p className="text-sm text-muted-foreground mb-2">GET-Anfrage mit Filtern:</p>
                    <CodeBlock code={endpoint.examples.get} id={`${endpoint.name}-get`} />
                  </TabsContent>

                  <TabsContent value="create" className="mt-4">
                    <p className="text-sm text-muted-foreground mb-2">
                      {endpoint.methods.includes("POST") ? "POST" : "PUT"}-Anfrage:
                    </p>
                    <CodeBlock code={endpoint.examples.post} id={`${endpoint.name}-post`} />
                  </TabsContent>

                  <TabsContent value="response" className="mt-4">
                    <p className="text-sm text-muted-foreground mb-2">Beispiel-Antwort:</p>
                    <CodeBlock code={endpoint.examples.response} id={`${endpoint.name}-response`} />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Query Parameters */}
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Allgemeine Query-Parameter</CardTitle>
            <CardDescription>
              Diese Parameter können bei GET-Anfragen verwendet werden
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 pr-4">Parameter</th>
                    <th className="text-left py-2 pr-4">Typ</th>
                    <th className="text-left py-2 pr-4">Default</th>
                    <th className="text-left py-2">Beschreibung</th>
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  <tr className="border-b">
                    <td className="py-2 pr-4"><code>page</code></td>
                    <td className="py-2 pr-4">integer</td>
                    <td className="py-2 pr-4">1</td>
                    <td className="py-2">Seitennummer für Pagination</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 pr-4"><code>limit</code></td>
                    <td className="py-2 pr-4">integer</td>
                    <td className="py-2 pr-4">50</td>
                    <td className="py-2">Ergebnisse pro Seite (max. 100)</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 pr-4"><code>search</code></td>
                    <td className="py-2 pr-4">string</td>
                    <td className="py-2 pr-4">—</td>
                    <td className="py-2">Volltextsuche</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 pr-4"><code>startDate</code></td>
                    <td className="py-2 pr-4">date</td>
                    <td className="py-2 pr-4">—</td>
                    <td className="py-2">Filter: Ab Datum (YYYY-MM-DD)</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4"><code>endDate</code></td>
                    <td className="py-2 pr-4">date</td>
                    <td className="py-2 pr-4">—</td>
                    <td className="py-2">Filter: Bis Datum (YYYY-MM-DD)</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* OpenAPI */}
        <Card className="mt-8 border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex gap-4">
                <FileJson className="h-6 w-6 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                <div>
                  <p className="font-medium text-blue-900 dark:text-blue-100">OpenAPI 3.0 Spezifikation</p>
                  <p className="text-sm text-blue-800 dark:text-blue-200 mt-1">
                    Vollständige API-Dokumentation im OpenAPI-Format für Swagger UI oder andere Tools.
                  </p>
                </div>
              </div>
              <Button variant="outline" asChild>
                <a href="/api/v1/docs" target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  JSON öffnen
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="mt-12 pt-8 border-t text-center text-sm text-muted-foreground">
          <p>
            Fragen zur API? Erstellen Sie einen API-Key unter{" "}
            <Link href="/settings/api-keys" className="text-primary hover:underline">
              Einstellungen → API-Keys
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
