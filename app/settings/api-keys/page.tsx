"use client";

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { 
  Key, 
  Plus, 
  Trash2, 
  Copy, 
  Check, 
  AlertTriangle,
  Eye,
  EyeOff,
  Shield,
  Clock,
  Activity,
  ArrowLeft,
  BookOpen,
  Globe,
  X,
  Info
} from "lucide-react";
import Link from "next/link";

type ApiKey = {
  id: number;
  name: string;
  keyPrefix: string;
  scopes: string[];
  isActive: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

type NewApiKey = {
  id: number;
  name: string;
  key: string;
  keyPrefix: string;
  scopes: string[];
  expiresAt: string | null;
  createdAt: string;
  warning: string;
};

export default function ApiKeysPage() {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newKeyResult, setNewKeyResult] = useState<NewApiKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [showKey, setShowKey] = useState(false);
  
  // Form states
  const [keyName, setKeyName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>(["read", "write"]);
  const [expiresInDays, setExpiresInDays] = useState<string>("");
  const [isCreating, setIsCreating] = useState(false);

  // CORS states
  const [corsOrigins, setCorsOrigins] = useState<string[]>([]);
  const [defaultOrigins, setDefaultOrigins] = useState<string[]>([]);
  const [newOrigin, setNewOrigin] = useState("");
  const [corsLoading, setCorsLoading] = useState(true);
  const [corsError, setCorsError] = useState<string | null>(null);
  const [addingOrigin, setAddingOrigin] = useState(false);

  const fetchApiKeys = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/api-keys");
      if (res.ok) {
        const data = await res.json();
        setApiKeys(data);
      }
    } catch (error) {
      console.error("Failed to fetch API keys:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchCorsSettings = async () => {
    setCorsLoading(true);
    setCorsError(null);
    try {
      const res = await fetch("/api/cors-settings");
      if (res.ok) {
        const data = await res.json();
        setCorsOrigins(data.origins || []);
        setDefaultOrigins(data.defaultOrigins || []);
      }
    } catch (error) {
      console.error("Failed to fetch CORS settings:", error);
      setCorsError("Fehler beim Laden der CORS-Einstellungen");
    } finally {
      setCorsLoading(false);
    }
  };

  useEffect(() => {
    fetchApiKeys();
    fetchCorsSettings();
  }, []);

  const handleCreateKey = async () => {
    if (!keyName.trim()) return;
    
    setIsCreating(true);
    try {
      const res = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: keyName,
          scopes: selectedScopes,
          expiresInDays: expiresInDays ? parseInt(expiresInDays) : null,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setNewKeyResult(data);
        setIsCreateModalOpen(false);
        fetchApiKeys();
        // Reset form
        setKeyName("");
        setSelectedScopes(["read", "write"]);
        setExpiresInDays("");
      } else {
        const error = await res.json();
        alert(error.error || "Fehler beim Erstellen des API-Keys");
      }
    } catch (error) {
      console.error("Error creating API key:", error);
      alert("Fehler beim Erstellen des API-Keys");
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteKey = async (id: number) => {
    if (!confirm("Sind Sie sicher, dass Sie diesen API-Key widerrufen möchten? Dies kann nicht rückgängig gemacht werden.")) {
      return;
    }

    try {
      const res = await fetch(`/api/api-keys?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        fetchApiKeys();
      } else {
        const error = await res.json();
        alert(error.error || "Fehler beim Löschen des API-Keys");
      }
    } catch (error) {
      console.error("Error deleting API key:", error);
      alert("Fehler beim Löschen des API-Keys");
    }
  };

  const handleToggleActive = async (key: ApiKey) => {
    try {
      const res = await fetch("/api/api-keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: key.id, isActive: !key.isActive }),
      });

      if (res.ok) {
        fetchApiKeys();
      }
    } catch (error) {
      console.error("Error toggling API key:", error);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleScope = (scope: string) => {
    if (selectedScopes.includes(scope)) {
      setSelectedScopes(selectedScopes.filter(s => s !== scope));
    } else {
      setSelectedScopes([...selectedScopes, scope]);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const isExpired = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  };

  // CORS Handlers
  const handleAddOrigin = async () => {
    if (!newOrigin.trim()) return;
    
    setAddingOrigin(true);
    setCorsError(null);
    try {
      const res = await fetch("/api/cors-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin: newOrigin.trim() }),
      });

      const data = await res.json();
      if (res.ok) {
        setCorsOrigins(data.origins);
        setNewOrigin("");
      } else {
        setCorsError(data.error || "Fehler beim Hinzufügen");
      }
    } catch (error) {
      console.error("Error adding origin:", error);
      setCorsError("Fehler beim Hinzufügen der Origin");
    } finally {
      setAddingOrigin(false);
    }
  };

  const handleRemoveOrigin = async (origin: string) => {
    setCorsError(null);
    try {
      const res = await fetch(`/api/cors-settings?origin=${encodeURIComponent(origin)}`, {
        method: "DELETE",
      });

      const data = await res.json();
      if (res.ok) {
        setCorsOrigins(data.origins);
      } else {
        setCorsError(data.error || "Fehler beim Entfernen");
      }
    } catch (error) {
      console.error("Error removing origin:", error);
      setCorsError("Fehler beim Entfernen der Origin");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Back Link */}
        <Link 
          href="/settings" 
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Zurück zu Einstellungen
        </Link>

        <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-2 flex items-center gap-3">
              <Key className="h-8 w-8" />
              API-Schlüssel
            </h1>
            <p className="text-muted-foreground">
              Verwalten Sie API-Schlüssel für den Zugriff auf die REST-API
            </p>
          </div>
          <div className="flex gap-2 mt-4 md:mt-0">
            <Link href="/settings/api-keys/docs">
              <Button variant="outline">
                <BookOpen className="h-4 w-4 mr-2" />
                API-Dokumentation
              </Button>
            </Link>
            <Button onClick={() => setIsCreateModalOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Neuen API-Key erstellen
            </Button>
          </div>
        </header>

        {/* Info Card */}
        <Card className="mb-6 border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20">
          <CardContent className="pt-6">
            <div className="flex gap-4">
              <Shield className="h-6 w-6 text-blue-600 dark:text-blue-400 flex-shrink-0" />
              <div className="space-y-2 text-sm">
                <p className="font-medium text-blue-900 dark:text-blue-100">API-Dokumentation</p>
                <p className="text-blue-800 dark:text-blue-200">
                  Verwenden Sie die API mit dem Header <code className="bg-blue-100 dark:bg-blue-900 px-1.5 py-0.5 rounded">Authorization: Bearer YOUR_API_KEY</code> oder <code className="bg-blue-100 dark:bg-blue-900 px-1.5 py-0.5 rounded">X-API-Key: YOUR_API_KEY</code>
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  <code className="text-xs bg-blue-100 dark:bg-blue-900 px-2 py-1 rounded">GET /api/v1/customers</code>
                  <code className="text-xs bg-blue-100 dark:bg-blue-900 px-2 py-1 rounded">GET /api/v1/expenses</code>
                  <code className="text-xs bg-blue-100 dark:bg-blue-900 px-2 py-1 rounded">GET /api/v1/incomes</code>
                  <code className="text-xs bg-blue-100 dark:bg-blue-900 px-2 py-1 rounded">GET /api/v1/invoices</code>
                </div>
                <div className="mt-3">
                  <Link 
                    href="/settings/api-keys/docs" 
                    className="text-sm text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                  >
                    <BookOpen className="h-3 w-3" />
                    Vollständige API-Dokumentation ansehen →
                  </Link>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* API Keys Table */}
        <Card>
          <CardHeader>
            <CardTitle>Aktive API-Schlüssel</CardTitle>
            <CardDescription>
              {apiKeys.length} von maximal 10 API-Schlüsseln verwendet
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Laden...</div>
            ) : apiKeys.length === 0 ? (
              <div className="text-center py-12">
                <Key className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-medium mb-2">Keine API-Schlüssel</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Erstellen Sie Ihren ersten API-Schlüssel, um die REST-API zu nutzen.
                </p>
                <Button onClick={() => setIsCreateModalOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  API-Key erstellen
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Key</TableHead>
                    <TableHead>Berechtigungen</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Zuletzt verwendet</TableHead>
                    <TableHead>Läuft ab</TableHead>
                    <TableHead className="text-right">Aktionen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {apiKeys.map((key) => (
                    <TableRow key={key.id} className={!key.isActive || isExpired(key.expiresAt) ? "opacity-60" : ""}>
                      <TableCell className="font-medium">{key.name}</TableCell>
                      <TableCell>
                        <code className="text-xs bg-muted px-2 py-1 rounded">{key.keyPrefix}</code>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {key.scopes.map((scope) => (
                            <span 
                              key={scope} 
                              className={`text-xs px-2 py-0.5 rounded-full ${
                                scope === 'delete' 
                                  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                  : scope === 'write'
                                  ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                                  : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              }`}
                            >
                              {scope}
                            </span>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        {isExpired(key.expiresAt) ? (
                          <span className="inline-flex items-center gap-1 text-xs text-red-600">
                            <Clock className="h-3 w-3" />
                            Abgelaufen
                          </span>
                        ) : key.isActive ? (
                          <span className="inline-flex items-center gap-1 text-xs text-green-600">
                            <Activity className="h-3 w-3" />
                            Aktiv
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            Deaktiviert
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(key.lastUsedAt)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {key.expiresAt ? formatDate(key.expiresAt) : "Nie"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => handleToggleActive(key)}
                                >
                                  {key.isActive ? (
                                    <EyeOff className="h-4 w-4" />
                                  ) : (
                                    <Eye className="h-4 w-4" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {key.isActive ? "Deaktivieren" : "Aktivieren"}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>

                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-destructive hover:text-destructive"
                                  onClick={() => handleDeleteKey(key.id)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Widerrufen</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* CORS Settings Card */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              CORS-Einstellungen
            </CardTitle>
            <CardDescription>
              Konfigurieren Sie, von welchen Domains aus auf Ihre API zugegriffen werden darf.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Info Box */}
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-6">
              <div className="flex gap-3">
                <Info className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-amber-800 dark:text-amber-200 mb-1">
                    Was ist CORS?
                  </p>
                  <p className="text-amber-700 dark:text-amber-300">
                    Cross-Origin Resource Sharing (CORS) kontrolliert, welche Websites Ihre API aufrufen dürfen. 
                    Fügen Sie hier die Domains hinzu, von denen aus Ihre externen Anwendungen auf die API zugreifen sollen.
                  </p>
                </div>
              </div>
            </div>

            {corsLoading ? (
              <div className="text-center py-4 text-muted-foreground">Laden...</div>
            ) : (
              <div className="space-y-4">
                {/* Default Origins */}
                <div>
                  <Label className="text-sm text-muted-foreground mb-2 block">
                    Standard-Origins (immer erlaubt)
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {defaultOrigins.map((origin) => (
                      <span
                        key={origin}
                        className="inline-flex items-center gap-1 px-3 py-1 bg-muted text-muted-foreground text-sm rounded-full"
                      >
                        <Globe className="h-3 w-3" />
                        {origin}
                      </span>
                    ))}
                  </div>
                </div>

                {/* User Origins */}
                <div>
                  <Label className="text-sm mb-2 block">
                    Ihre erlaubten Origins ({corsOrigins.length}/20)
                  </Label>
                  
                  {corsOrigins.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-2">
                      Keine zusätzlichen Origins konfiguriert.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2 mb-4">
                      {corsOrigins.map((origin) => (
                        <span
                          key={origin}
                          className="inline-flex items-center gap-1 px-3 py-1 bg-primary/10 text-primary text-sm rounded-full group"
                        >
                          <Globe className="h-3 w-3" />
                          {origin}
                          <button
                            onClick={() => handleRemoveOrigin(origin)}
                            className="ml-1 p-0.5 hover:bg-primary/20 rounded-full transition-colors"
                            title="Entfernen"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Add Origin Form */}
                <div className="flex gap-2">
                  <Input
                    placeholder="https://ihre-app.example.com"
                    value={newOrigin}
                    onChange={(e) => setNewOrigin(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddOrigin()}
                    className="flex-1"
                  />
                  <Button 
                    onClick={handleAddOrigin} 
                    disabled={addingOrigin || !newOrigin.trim()}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    {addingOrigin ? "Füge hinzu..." : "Hinzufügen"}
                  </Button>
                </div>

                {/* Error Message */}
                {corsError && (
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm px-4 py-2 rounded-lg">
                    {corsError}
                  </div>
                )}

                {/* Examples */}
                <div className="text-xs text-muted-foreground space-y-1 pt-2">
                  <p className="font-medium">Beispiele für gültige Origins:</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    <li><code className="bg-muted px-1 rounded">https://meine-app.de</code></li>
                    <li><code className="bg-muted px-1 rounded">https://app.firma.com</code></li>
                    <li><code className="bg-muted px-1 rounded">http://localhost:8080</code> (für Entwicklung)</li>
                  </ul>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Create Modal */}
        <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Neuen API-Schlüssel erstellen</DialogTitle>
              <DialogDescription>
                Erstellen Sie einen neuen API-Schlüssel für den Zugriff auf die REST-API.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="keyName">Name *</Label>
                <Input
                  id="keyName"
                  placeholder="z.B. Integration Buchhaltung"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Ein beschreibender Name, um den Key später identifizieren zu können.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Berechtigungen</Label>
                <div className="flex flex-wrap gap-2">
                  {["read", "write", "delete"].map((scope) => (
                    <Button
                      key={scope}
                      type="button"
                      variant={selectedScopes.includes(scope) ? "default" : "outline"}
                      size="sm"
                      onClick={() => toggleScope(scope)}
                      className={selectedScopes.includes(scope) ? "" : ""}
                    >
                      {scope === "read" && "Lesen"}
                      {scope === "write" && "Schreiben"}
                      {scope === "delete" && "Löschen"}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Wählen Sie die Berechtigungen für diesen API-Key.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="expiresInDays">Gültigkeit (optional)</Label>
                <div className="flex gap-2 items-center">
                  <Input
                    id="expiresInDays"
                    type="number"
                    placeholder="90"
                    value={expiresInDays}
                    onChange={(e) => setExpiresInDays(e.target.value)}
                    className="w-24"
                  />
                  <span className="text-sm text-muted-foreground">Tage</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Leer lassen für unbegrenzte Gültigkeit.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateModalOpen(false)}>
                Abbrechen
              </Button>
              <Button onClick={handleCreateKey} disabled={!keyName.trim() || isCreating}>
                {isCreating ? "Erstelle..." : "API-Key erstellen"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* New Key Result Modal */}
        <Dialog open={!!newKeyResult} onOpenChange={() => setNewKeyResult(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Check className="h-5 w-5 text-green-600" />
                API-Schlüssel erstellt
              </DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4 py-4">
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                <div className="flex gap-3">
                  <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                      Wichtig: Kopieren Sie den Schlüssel jetzt!
                    </p>
                    <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
                      Der vollständige API-Schlüssel wird aus Sicherheitsgründen nur einmal angezeigt.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>API-Schlüssel</Label>
                <div className="flex gap-2">
                  <Input
                    type={showKey ? "text" : "password"}
                    value={newKeyResult?.key || ""}
                    readOnly
                    className="font-mono text-sm"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setShowKey(!showKey)}
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copyToClipboard(newKeyResult?.key || "")}
                  >
                    {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Name:</span>
                  <p className="font-medium">{newKeyResult?.name}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Berechtigungen:</span>
                  <p className="font-medium">{newKeyResult?.scopes.join(", ")}</p>
                </div>
              </div>

              <div className="bg-muted rounded-lg p-3 text-sm space-y-2">
                <p className="font-medium">Beispiel-Verwendung:</p>
                <code className="block text-xs bg-background p-2 rounded overflow-x-auto">
                  curl -H "Authorization: Bearer {newKeyResult?.keyPrefix}..." \<br />
                  &nbsp;&nbsp;https://your-domain.com/api/v1/customers
                </code>
              </div>
            </div>

            <DialogFooter>
              <Button onClick={() => setNewKeyResult(null)}>
                Verstanden
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
