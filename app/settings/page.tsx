"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Loader2, Save, Upload, X, Shield, Download, UploadCloud, Database, AlertTriangle, Key, ChevronRight, History, FileText } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import Link from "next/link";

type RestorePreview = {
  kind: 'json' | 'full';
  fileName: string;
  fileSize: number;
  backup?: unknown;
  file?: File;
  preview: {
    version: string;
    type: string;
    exportedAt?: string;
    fileCount?: number;
    totalRecords: number;
    warnings: string[];
    counts: {
      customers: number;
      expenses: number;
      incomes: number;
      invoices: number;
      templates: number;
      recurringExpenses: number;
      reminders: number;
      cashBooks: number;
      cashTransactions: number;
      documentations: number;
      apiKeys: number;
    };
  };
};

export default function SettingsPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savingAppSettings, setSavingAppSettings] = useState(false);
  const [allowRegistration, setAllowRegistration] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [fullBackupLoading, setFullBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [backupMessage, setBackupMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [overwriteMode, setOverwriteMode] = useState(false);
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null);
  const fullFileInputRef = useRef<HTMLInputElement>(null);
  const [formData, setFormData] = useState({
    companyName: "",
    companyAddress: "",
    email: "",
    telephone: "",
    taxNumber: "",
    bankName: "",
    iban: "",
    bic: "",
    footerText: "",
    logoUrl: "",
  });

  useEffect(() => {
    async function fetchSettings() {
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const data = await res.json();
          setFormData({
            companyName: data.companyName || "",
            companyAddress: data.companyAddress || "",
            email: data.email || "",
            telephone: data.telephone || "",
            taxNumber: data.taxNumber || "",
            bankName: data.bankName || "",
            iban: data.iban || "",
            bic: data.bic || "",
            footerText: data.footerText || "",
            logoUrl: data.logoUrl || "",
          });
        }
      } catch (error) {
        console.error("Failed to fetch settings", error);
      } finally {
        setLoading(false);
      }
    }
    fetchSettings();
  }, []);

  useEffect(() => {
    async function fetchAppSettings() {
      if (!isAdmin) return;
      try {
        const res = await fetch("/api/app-settings");
        if (res.ok) {
          const data = await res.json();
          setAllowRegistration(data.allowRegistration ?? false);
        }
      } catch (error) {
        console.error("Failed to fetch app settings", error);
      }
    }
    fetchAppSettings();
  }, [isAdmin]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        // Optional: Show success toast
        alert("Einstellungen gespeichert!");
      } else {
        alert("Fehler beim Speichern.");
      }
    } catch (error) {
      console.error("Failed to save settings", error);
      alert("Fehler beim Speichern.");
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setUploading(true);

      const formData = new FormData();
      formData.append('file', file);

      try {
        const res = await fetch('/api/settings/upload-logo', {
          method: 'POST',
          body: formData,
        });

        if (res.ok) {
          const data = await res.json();
          setFormData((prev) => ({ ...prev, logoUrl: data.url }));
        } else {
          alert("Fehler beim Hochladen des Logos.");
        }
      } catch (error) {
        console.error("Error uploading logo:", error);
        alert("Fehler beim Hochladen des Logos.");
      } finally {
        setUploading(false);
      }
    }
  };

  const removeLogo = () => {
    setFormData((prev) => ({ ...prev, logoUrl: "" }));
  };

  const handleAllowRegistrationChange = async (checked: boolean) => {
    setSavingAppSettings(true);
    try {
      const res = await fetch("/api/app-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowRegistration: checked }),
      });
      if (res.ok) {
        setAllowRegistration(checked);
      } else {
        alert("Fehler beim Speichern der Einstellung.");
      }
    } catch (error) {
      console.error("Failed to save app settings", error);
      alert("Fehler beim Speichern der Einstellung.");
    } finally {
      setSavingAppSettings(false);
    }
  };

  const handleBackupDownload = async () => {
    setBackupLoading(true);
    setBackupMessage(null);
    try {
      const res = await fetch("/api/backup");
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bivaro-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        setBackupMessage({ type: 'success', text: 'Backup erfolgreich heruntergeladen!' });
      } else {
        setBackupMessage({ type: 'error', text: 'Backup fehlgeschlagen.' });
      }
    } catch (error) {
      console.error("Backup error:", error);
      setBackupMessage({ type: 'error', text: 'Backup fehlgeschlagen.' });
    } finally {
      setBackupLoading(false);
    }
  };

  const handleFullBackupDownload = async () => {
    setFullBackupLoading(true);
    setBackupMessage(null);
    try {
      const res = await fetch("/api/backup/full");
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bivaro-full-backup-${new Date().toISOString().split('T')[0]}.zip`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        setBackupMessage({ type: 'success', text: 'Vollständiges Backup (inkl. Dateien) erfolgreich heruntergeladen!' });
      } else {
        setBackupMessage({ type: 'error', text: 'Vollständiges Backup fehlgeschlagen.' });
      }
    } catch (error) {
      console.error("Full backup error:", error);
      setBackupMessage({ type: 'error', text: 'Vollständiges Backup fehlgeschlagen.' });
    } finally {
      setFullBackupLoading(false);
    }
  };

  const handleRestoreUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setRestoreLoading(true);
    setBackupMessage(null);
    setRestorePreview(null);

    try {
      const text = await file.text();
      const backup = JSON.parse(text);
      const res = await fetch("/api/backup/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(backup),
      });

      const data = await res.json();
      if (res.ok) {
        setRestorePreview({
          kind: 'json',
          fileName: file.name,
          fileSize: file.size,
          backup,
          preview: data.preview,
        });
      } else {
        setBackupMessage({ type: 'error', text: data.error || 'Backup-Vorschau fehlgeschlagen.' });
      }
    } catch (error) {
      console.error("Restore error:", error);
      setBackupMessage({ type: 'error', text: 'Ungültige Backup-Datei.' });
    } finally {
      setRestoreLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleFullRestoreUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setRestoreLoading(true);
    setBackupMessage(null);
    setRestorePreview(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch("/api/backup/full/preview", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (res.ok) {
        setRestorePreview({
          kind: 'full',
          fileName: file.name,
          fileSize: file.size,
          file,
          preview: data.preview,
        });
      } else {
        setBackupMessage({ type: 'error', text: data.error || 'Backup-Vorschau fehlgeschlagen.' });
      }
    } catch (error) {
      console.error("Full restore error:", error);
      setBackupMessage({ type: 'error', text: 'Ungültige Backup-Datei.' });
    } finally {
      setRestoreLoading(false);
      if (fullFileInputRef.current) {
        fullFileInputRef.current.value = '';
      }
    }
  };

  const confirmDestructiveRestore = () => {
    if (!overwriteMode) return true;

    return window.confirm(
      '⚠️ WARNUNG: Alle bestehenden Daten werden GELÖSCHT und durch das Backup ersetzt!\n\n' +
      'Prüfen Sie die Backup-Vorschau sorgfältig, bevor Sie fortfahren.\n\n' +
      'Sind Sie SICHER, dass Sie fortfahren möchten?'
    );
  };

  const executeRestore = async () => {
    if (!restorePreview) return;
    if (!confirmDestructiveRestore()) return;

    setRestoreLoading(true);
    setBackupMessage(null);

    try {
      if (restorePreview.kind === 'json') {
        const backup = restorePreview.backup as Record<string, unknown>;
        const payload = overwriteMode ? { ...backup, confirmOverwrite: true } : backup;
        const res = await fetch("/api/backup/restore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) {
          setBackupMessage({ type: 'error', text: data.error || 'Wiederherstellung fehlgeschlagen.' });
          return;
        }
        const { results } = data;
        const modeText = results.overwriteMode ? ' (Daten wurden überschrieben)' : '';
        setBackupMessage({
          type: 'success',
          text: `Wiederherstellung erfolgreich${modeText}! Importiert: ${results.customers.imported} Kunden, ${results.expenses.imported} Ausgaben, ${results.incomes.imported} Einnahmen, ${results.invoices.imported} Rechnungen.`
        });
      } else if (restorePreview.file) {
        const formData = new FormData();
        formData.append('file', restorePreview.file);
        const url = overwriteMode
          ? "/api/backup/full/restore?confirmOverwrite=true"
          : "/api/backup/full/restore";
        const res = await fetch(url, {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) {
          setBackupMessage({ type: 'error', text: data.error || 'Wiederherstellung fehlgeschlagen.' });
          return;
        }
        const { results } = data;
        const modeText = results.overwriteMode ? ' (Daten wurden überschrieben)' : '';
        setBackupMessage({
          type: 'success',
          text: `Vollständige Wiederherstellung erfolgreich${modeText}! Importiert: ${results.customers.imported} Kunden, ${results.expenses.imported} Ausgaben, ${results.incomes.imported} Einnahmen, ${results.invoices.imported} Rechnungen, ${results.files.imported} Dateien.`
        });
      }

      setOverwriteMode(false);
      setRestorePreview(null);
    } catch (error) {
      console.error("Restore execution error:", error);
      setBackupMessage({ type: 'error', text: 'Wiederherstellung fehlgeschlagen.' });
    } finally {
      setRestoreLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Einstellungen</h1>
        <p className="text-muted-foreground">
          Verwalten Sie Ihre Firmendaten und Rechnungseinstellungen.
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Rechnungsdaten</CardTitle>
            <CardDescription>
              Diese Informationen erscheinen auf Ihren generierten Rechnungen.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="companyName">Firmenname</Label>
                <Input
                  id="companyName"
                  name="companyName"
                  value={formData.companyName}
                  onChange={handleChange}
                  placeholder="Musterfirma GmbH"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="taxNumber">Steuernummer / USt-ID</Label>
                <Input
                  id="taxNumber"
                  name="taxNumber"
                  value={formData.taxNumber}
                  onChange={handleChange}
                  placeholder="DE123456789"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="companyAddress">Anschrift</Label>
              <Textarea
                id="companyAddress"
                name="companyAddress"
                value={formData.companyAddress}
                onChange={handleChange}
                placeholder="Musterstraße 1&#10;12345 Musterstadt"
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">E-Mail Adresse</Label>
              <Input
                id="email"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="info@musterfirma.de"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="telephone">Telefonnummer</Label>
              <Input
                id="telephone"
                name="telephone"
                type="tel"
                value={formData.telephone}
                onChange={handleChange}
                placeholder="+49 30 12345678"
              />
            </div>

            <div className="space-y-2">
              <Label>Bankverbindung</Label>
              <div className="grid grid-cols-1 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="bankName" className="text-xs text-muted-foreground">Bankname</Label>
                  <Input
                    id="bankName"
                    name="bankName"
                    value={formData.bankName}
                    onChange={handleChange}
                    placeholder="Musterbank"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="iban" className="text-xs text-muted-foreground">IBAN</Label>
                    <Input
                      id="iban"
                      name="iban"
                      value={formData.iban}
                      onChange={handleChange}
                      placeholder="DE00 0000 0000 0000 0000 00"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bic" className="text-xs text-muted-foreground">BIC</Label>
                    <Input
                      id="bic"
                      name="bic"
                      value={formData.bic}
                      onChange={handleChange}
                      placeholder="XXXXXXXX"
                    />
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Diese Daten werden für den QR-Code und die Fußzeile verwendet.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="footerText">Fußzeile (Optional)</Label>
              <Input
                id="footerText"
                name="footerText"
                value={formData.footerText}
                onChange={handleChange}
                placeholder="Geschäftsführer: Max Mustermann | Amtsgericht Musterstadt HRB 12345"
              />
            </div>

            <div className="space-y-2">
              <Label>Firmenlogo (Optional)</Label>
              <div className="flex items-start gap-4">
                {formData.logoUrl ? (
                  <div className="relative border rounded-md p-2 bg-muted/10">
                    <Image
                      src={formData.logoUrl}
                      alt="Logo"
                      width={128}
                      height={128}
                      className="max-h-32 w-auto object-contain rounded border"
                      unoptimized // Logo URL is local API, might need unoptimized or proper loader
                    />
                    <button
                      type="button"
                      onClick={removeLogo}
                      className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 shadow-sm hover:bg-destructive/90"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-center w-full max-w-xs h-24 border-2 border-dashed rounded-md border-muted-foreground/25 bg-muted/5">
                    <span className="text-xs text-muted-foreground">Kein Logo ausgewählt</span>
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  <Input
                    id="logo-upload"
                    type="file"
                    accept="image/png, image/jpeg"
                    onChange={handleLogoUpload}
                    className="hidden"
                    disabled={uploading}
                  />
                  <Label
                    htmlFor="logo-upload"
                    className={`flex items-center justify-center px-4 py-2 border rounded-md cursor-pointer hover:bg-muted transition-colors ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {uploading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="mr-2 h-4 w-4" />
                    )}
                    {uploading ? "Wird hochgeladen..." : "Logo hochladen"}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Empfohlen: PNG oder JPG, max. 2MB.
                  </p>
                </div>
              </div>
            </div>

            <div className="pt-4">
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Speichern...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Speichern
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>

      {isAdmin && (
        <Card className="mt-6">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              <CardTitle>Admin-Einstellungen</CardTitle>
            </div>
            <CardDescription>
              Diese Einstellungen sind nur für Administratoren sichtbar.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="allow-registration">Benutzerregistrierung erlauben</Label>
                <p className="text-sm text-muted-foreground">
                  Wenn aktiviert, können sich neue Benutzer registrieren.
                </p>
              </div>
              <Switch
                id="allow-registration"
                checked={allowRegistration}
                onCheckedChange={handleAllowRegistrationChange}
                disabled={savingAppSettings}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Backup & Restore */}
      <Card className="mt-6">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            <CardTitle>Datensicherung</CardTitle>
          </div>
          <CardDescription>
            Sichern Sie Ihre Daten oder stellen Sie ein Backup wieder her.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {backupMessage && (
            <Alert variant={backupMessage.type === 'error' ? 'destructive' : 'default'}>
              {backupMessage.type === 'error' ? (
                <AlertTriangle className="h-4 w-4" />
              ) : (
                <Database className="h-4 w-4" />
              )}
              <AlertTitle>{backupMessage.type === 'error' ? 'Fehler' : 'Erfolg'}</AlertTitle>
              <AlertDescription>{backupMessage.text}</AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Backup erstellen */}
            <div className="space-y-3">
              <h4 className="font-medium">Backup erstellen (JSON)</h4>
              <p className="text-sm text-muted-foreground">
                Laden Sie alle Ihre Daten als JSON-Datei herunter.
              </p>
              <Button
                onClick={handleBackupDownload}
                disabled={backupLoading}
                className="w-full"
              >
                {backupLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Backup wird erstellt...
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    Backup herunterladen
                  </>
                )}
              </Button>
            </div>

            {/* Vollständiges Backup */}
            <div className="space-y-3">
              <h4 className="font-medium">Vollständiges Backup (ZIP)</h4>
              <p className="text-sm text-muted-foreground">
                Inkl. Rechnungs-PDFs, Belege und Logo.
              </p>
              <Button
                onClick={handleFullBackupDownload}
                disabled={fullBackupLoading}
                className="w-full"
              >
                {fullBackupLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ZIP wird erstellt...
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    Vollständiges Backup (ZIP)
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Wiederherstellungs-Bereich */}
          <div className="border-t pt-6 mt-6">
            <h4 className="font-medium mb-4">Backup wiederherstellen</h4>

            {/* Überschreib-Modus Option - gilt für alle Restore-Optionen */}
            <div className={`mb-4 p-4 rounded-lg border-2 ${overwriteMode ? 'bg-destructive/10 border-destructive' : 'bg-muted/30 border-muted'}`}>
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="overwrite-mode"
                  checked={overwriteMode}
                  onChange={(e) => setOverwriteMode(e.target.checked)}
                  className="h-5 w-5 mt-0.5 rounded border-gray-300 cursor-pointer"
                />
                <div className="flex-1">
                  <label htmlFor="overwrite-mode" className="font-medium cursor-pointer select-none flex items-center gap-2">
                    Bestehende Daten überschreiben
                    {overwriteMode && <AlertTriangle className="h-4 w-4 text-destructive" />}
                  </label>
                  <p className="text-sm text-muted-foreground mt-1">
                    {overwriteMode
                      ? '⚠️ Alle bestehenden Daten werden vor dem Import gelöscht!'
                      : 'Standardmäßig werden bereits vorhandene Einträge übersprungen (Merge-Modus).'}
                  </p>
                </div>
              </div>
            </div>

            {/* Restore Buttons */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleRestoreUpload}
                  className="hidden"
                  id="restore-file"
                />
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={restoreLoading}
                  variant={overwriteMode ? "destructive" : "outline"}
                  className="w-full"
                >
                  {restoreLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Wird wiederhergestellt...
                    </>
                  ) : (
                    <>
                      <UploadCloud className="mr-2 h-4 w-4" />
                      JSON-Backup {overwriteMode ? 'überschreiben' : 'importieren'}
                    </>
                  )}
                </Button>
                <p className="text-xs text-muted-foreground mt-1 text-center">.json Datei</p>
              </div>

              <div>
                <input
                  ref={fullFileInputRef}
                  type="file"
                  accept=".zip"
                  onChange={handleFullRestoreUpload}
                  className="hidden"
                  id="full-restore-file"
                />
                <Button
                  onClick={() => fullFileInputRef.current?.click()}
                  disabled={restoreLoading}
                  variant={overwriteMode ? "destructive" : "outline"}
                  className="w-full"
                >
                  {restoreLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Wird wiederhergestellt...
                    </>
                  ) : (
                    <>
                      <UploadCloud className="mr-2 h-4 w-4" />
                      ZIP-Backup {overwriteMode ? 'überschreiben' : 'importieren'}
                    </>
                  )}
                </Button>
                <p className="text-xs text-muted-foreground mt-1 text-center">.zip Datei (inkl. Dateien)</p>
              </div>
            </div>

            {restorePreview && (
              <Alert className="mt-4">
                <Database className="h-4 w-4" />
                <AlertTitle>Backup-Vorschau bereit</AlertTitle>
                <AlertDescription>
                  <div className="mt-2 space-y-3">
                    <div className="text-sm">
                      <div><strong>Datei:</strong> {restorePreview.fileName} ({Math.max(1, Math.round(restorePreview.fileSize / 1024))} KB)</div>
                      <div><strong>Version:</strong> {restorePreview.preview.version}</div>
                      {restorePreview.preview.exportedAt && (
                        <div><strong>Exportiert am:</strong> {new Date(restorePreview.preview.exportedAt).toLocaleString('de-DE')}</div>
                      )}
                      <div><strong>Datensätze:</strong> {restorePreview.preview.totalRecords}</div>
                      {restorePreview.preview.fileCount !== undefined && (
                        <div><strong>Dateien im ZIP:</strong> {restorePreview.preview.fileCount}</div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                      <span>Kunden: {restorePreview.preview.counts.customers}</span>
                      <span>Ausgaben: {restorePreview.preview.counts.expenses}</span>
                      <span>Einnahmen: {restorePreview.preview.counts.incomes}</span>
                      <span>Rechnungen: {restorePreview.preview.counts.invoices}</span>
                      <span>Vorlagen: {restorePreview.preview.counts.templates}</span>
                      <span>Kassen: {restorePreview.preview.counts.cashBooks}</span>
                      <span>Kassenbuchungen: {restorePreview.preview.counts.cashTransactions}</span>
                      <span>Dokumentationen: {restorePreview.preview.counts.documentations}</span>
                    </div>

                    {restorePreview.preview.warnings.length > 0 && (
                      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                        {restorePreview.preview.warnings.map((warning) => (
                          <div key={warning}>• {warning}</div>
                        ))}
                      </div>
                    )}

                    <div className="flex flex-col sm:flex-row gap-2">
                      <Button
                        onClick={executeRestore}
                        disabled={restoreLoading}
                        variant={overwriteMode ? "destructive" : "default"}
                      >
                        {restoreLoading ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Import läuft...
                          </>
                        ) : (
                          overwriteMode ? 'Geprüftes Backup überschreiben' : 'Geprüftes Backup importieren'
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setRestorePreview(null)}
                        disabled={restoreLoading}
                      >
                        Auswahl verwerfen
                      </Button>
                    </div>
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </div>

          <div className="border-t pt-4">
            <p className="text-xs text-muted-foreground">
              <strong>Hinweis:</strong> Aktivieren Sie "Bestehende Daten überschreiben" für ein komplettes Restore.
              Das vollständige Backup kann bei vielen Dateien größer werden.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* API Keys */}
      <Card className="mt-6">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            <CardTitle>API-Zugang</CardTitle>
          </div>
          <CardDescription>
            Verwalten Sie API-Schlüssel für den Zugriff externer Systeme auf Ihre Daten.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">
                Erstellen Sie API-Keys, um die REST-API von externen Anwendungen aus zu nutzen.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Endpoints: /api/v1/customers, /api/v1/expenses, /api/v1/incomes, /api/v1/invoices
              </p>
            </div>
            <Link href="/settings/api-keys">
              <Button variant="outline">
                API-Keys verwalten
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Audit Log */}
      <Card className="mt-6">
        <CardHeader>
          <div className="flex items-center gap-2">
            <History className="h-5 w-5" />
            <CardTitle>Audit-Log</CardTitle>
          </div>
          <CardDescription>
            Protokoll aller Änderungen und Aktivitäten für Compliance und Sicherheit.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">
                Sehen Sie wer was wann geändert hat – vollständige Nachverfolgbarkeit aller Aktionen.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Kunden, Rechnungen, Ausgaben, Einnahmen, Einstellungen und mehr
              </p>
            </div>
            <Link href="/settings/audit-logs">
              <Button variant="outline">
                Audit-Log anzeigen
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* GoBD Verfahrensdokumentation */}
      <Card className="mt-6">
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            <CardTitle>GoBD Verfahrensdokumentation</CardTitle>
          </div>
          <CardDescription>
            Dokumentation des Buchführungsverfahrens gemäß GoBD-Anforderungen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">
                Erstellen und verwalten Sie Ihre Verfahrensdokumentation mit automatisch generierter Systembeschreibung.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Inkl. PDF-Export und Versionsverlauf
              </p>
            </div>
            <Link href="/settings/documentation">
              <Button variant="outline">
                Dokumentation öffnen
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
