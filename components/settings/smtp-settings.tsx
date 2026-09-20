"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, KeyRound, Loader2, Mail, RotateCcw, Save, Server } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type SmtpResponse = {
  source: "database" | "environment" | "none";
  host: string;
  port: number;
  secure: boolean;
  from: string;
  user: string;
  passwordConfigured: boolean;
  configured: boolean;
};

type SmtpForm = {
  host: string;
  port: string;
  secure: boolean;
  from: string;
  user: string;
  password: string;
};

type Feedback = { type: "success" | "error"; text: string } | null;

const emptyForm: SmtpForm = {
  host: "",
  port: "587",
  secure: false,
  from: "",
  user: "",
  password: "",
};

function sourceLabel(source: SmtpResponse["source"]): string {
  if (source === "database") return "Gespeicherte Konfiguration";
  if (source === "environment") return "Serverkonfiguration";
  return "Nicht konfiguriert";
}

export function SmtpSettings() {
  const [form, setForm] = useState<SmtpForm>(emptyForm);
  const [current, setCurrent] = useState<SmtpResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const loadSettings = useCallback(async (clearFeedback = true) => {
    setLoading(true);
    if (clearFeedback) setFeedback(null);
    try {
      const response = await fetch("/api/settings/smtp", { cache: "no-store" });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || "Die SMTP-Konfiguration konnte nicht geladen werden.");
      }
      const config = data as SmtpResponse;
      setCurrent(config);
      setForm({
        host: config.host || "",
        port: String(config.port || 587),
        secure: Boolean(config.secure),
        from: config.from || "",
        user: config.user || "",
        // The API deliberately never sends a password back to the browser.
        password: "",
      });
    } catch (error) {
      setFeedback({ type: "error", text: error instanceof Error ? error.message : "Die SMTP-Konfiguration konnte nicht geladen werden." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const updateField = <K extends keyof SmtpForm>(field: K, value: SmtpForm[K]) => {
    setForm(previous => ({ ...previous, [field]: value }));
    setFeedback(null);
  };

  const saveSettings = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const payload: Record<string, string | number | boolean> = {
        host: form.host.trim(),
        port: Number(form.port),
        secure: form.secure,
        from: form.from.trim(),
        user: form.user.trim(),
      };
      // An empty password means retain the currently stored secret. It is
      // therefore omitted entirely from the request.
      if (form.password !== "") payload.password = form.password;

      const response = await fetch("/api/settings/smtp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || "Die SMTP-Konfiguration konnte nicht gespeichert werden.");
      }
      setFeedback({ type: "success", text: "SMTP-Konfiguration gespeichert." });
      setForm(previous => ({ ...previous, password: "" }));
      await loadSettings(false);
    } catch (error) {
      setFeedback({ type: "error", text: error instanceof Error ? error.message : "Die SMTP-Konfiguration konnte nicht gespeichert werden." });
    } finally {
      setSaving(false);
    }
  };

  const removeStoredSettings = async () => {
    setRemoving(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/settings/smtp", { method: "DELETE" });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || "Die gespeicherte SMTP-Konfiguration konnte nicht entfernt werden.");
      }
      setFeedback({ type: "success", text: "Gespeicherte SMTP-Konfiguration entfernt. Falls vorhanden, wird wieder die Serverkonfiguration verwendet." });
      await loadSettings(false);
    } catch (error) {
      setFeedback({ type: "error", text: error instanceof Error ? error.message : "Die gespeicherte SMTP-Konfiguration konnte nicht entfernt werden." });
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Card id="smtp-versand" className="mt-6 scroll-mt-24">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          <CardTitle>SMTP-Versand</CardTitle>
        </div>
        <CardDescription>
          Konfigurieren Sie den Mailserver für Rechnungen, Angebote und Mahnungen.
          Diese Konfiguration gilt für alle Konten. Passwörter werden nie angezeigt.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin" />
            SMTP-Konfiguration wird geladen...
          </div>
        ) : (
          <>
            <div className="mb-5 flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm">
              {current?.configured ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertCircle className="h-4 w-4 text-amber-600" />}
              <span className="font-medium">{current?.configured ? "SMTP ist konfiguriert" : "SMTP ist nicht vollständig konfiguriert"}</span>
              <span className="text-muted-foreground">Quelle: {sourceLabel(current?.source || "none")}</span>
              {current?.passwordConfigured && <span className="text-muted-foreground">· Passwort gespeichert</span>}
            </div>

            {feedback && (
              <Alert variant={feedback.type === "error" ? "destructive" : "default"} className="mb-5">
                {feedback.type === "error" ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                <AlertTitle>{feedback.type === "error" ? "Fehler" : "Gespeichert"}</AlertTitle>
                <AlertDescription>
                  {feedback.text}
                  {current === null && feedback.type === "error" && (
                    <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void loadSettings()}>
                      Erneut versuchen
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}

            <form onSubmit={saveSettings} className="space-y-5">
              <fieldset disabled={saving || removing} className="space-y-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_9rem]">
                <div className="space-y-2">
                  <Label htmlFor="smtp-host">SMTP-Host</Label>
                  <Input id="smtp-host" value={form.host} onChange={event => updateField("host", event.target.value)} placeholder="smtp.example.de" autoComplete="off" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="smtp-port">Port</Label>
                  <Input id="smtp-port" value={form.port} onChange={event => updateField("port", event.target.value)} type="number" min="1" max="65535" inputMode="numeric" required />
                </div>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                <div className="space-y-1">
                  <Label htmlFor="smtp-secure">TLS-Modus</Label>
                  <p className="text-sm text-muted-foreground">
                    {form.secure ? "Direktes TLS (implizit), typischerweise Port 465." : "STARTTLS erforderlich, typischerweise Port 587."}
                  </p>
                </div>
                <Switch id="smtp-secure" checked={form.secure} onCheckedChange={checked => updateField("secure", checked)} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="smtp-from">Absenderadresse</Label>
                <Input id="smtp-from" value={form.from} onChange={event => updateField("from", event.target.value)} type="text" placeholder="Bivaro <rechnung@example.de>" autoComplete="email" required />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="smtp-user">Benutzername <span className="font-normal text-muted-foreground">(optional)</span></Label>
                  <Input id="smtp-user" value={form.user} onChange={event => updateField("user", event.target.value)} placeholder="leer = keine Authentifizierung" autoComplete="username" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="smtp-password">Passwort <span className="font-normal text-muted-foreground">(leer = behalten)</span></Label>
                  <Input id="smtp-password" value={form.password} onChange={event => updateField("password", event.target.value)} type="password" placeholder={current?.passwordConfigured ? "Gespeichertes Passwort bleibt erhalten" : "SMTP-Passwort"} autoComplete="new-password" />
                </div>
              </div>

              <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center">
                <Button type="submit" disabled={saving || removing}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  {saving ? "Speichern..." : "SMTP speichern"}
                </Button>
                {current?.source === "database" && (
                  <Button type="button" variant="outline" onClick={removeStoredSettings} disabled={saving || removing}>
                    {removing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                    {removing ? "Wird entfernt..." : "Gespeicherte Konfiguration entfernen"}
                  </Button>
                )}
              </div>
              </fieldset>
            </form>

            <div className="mt-5 flex items-start gap-2 text-xs text-muted-foreground">
              {current?.source === "environment" ? <Server className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              <p>
                {current?.source === "environment"
                  ? "Die aktuelle Konfiguration kommt vom Server. Beim Speichern wird eine Datenbank-Konfiguration angelegt."
                  : "Die Datenbank-Konfiguration überschreibt die Serverkonfiguration. Entfernen stellt den Serverwert wieder her."}
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
