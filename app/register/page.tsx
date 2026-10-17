"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import styles from "@/components/public-accounting/public-accounting.module.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "@/components/ui/card";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { validatePassword, PASSWORD_POLICY_HINT } from "@/lib/password-policy";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [isFirstUser, setIsFirstUser] = useState(false);
  const [registrationAllowed, setRegistrationAllowed] = useState(false);
  const [bootstrapRequired, setBootstrapRequired] = useState(false);
  const [bootstrapConsumed, setBootstrapConsumed] = useState(false);

  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;
  const passwordsMismatch = confirmPassword.length > 0 && password !== confirmPassword;

  const passwordStrength = useMemo(() => {
    let score = 0;
    if (password.length >= 8) score += 1;
    if (password.length >= 10) score += 1;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
    if (/\d/.test(password)) score += 1;
    if (/[^A-Za-z0-9]/.test(password)) score += 1;
    return Math.min(score, 4);
  }, [password]);

  const strengthLabel = ["", "Sehr schwach", "Schwach", "Gut", "Stark"][passwordStrength];

  useEffect(() => {
    async function checkRegistrationStatus() {
      try {
        const res = await fetch("/api/auth/registration-status");
        if (res.ok) {
          const data = await res.json();
          setIsFirstUser(data.isFirstUser);
          setRegistrationAllowed(data.allowRegistration);
          setBootstrapRequired(data.bootstrapRequired === true);
          setBootstrapConsumed(data.bootstrapConsumed === true);
        }
      } catch (error) {
        console.error("Failed to check registration status", error);
      } finally {
        setCheckingStatus(false);
      }
    }
    checkRegistrationStatus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      return setError("Passwörter stimmen nicht überein");
    }

    const validation = validatePassword(password);
    if (!validation.valid) {
      return setError(validation.message ?? "Ungültiges Passwort");
    }

    setLoading(true);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          email,
          password,
          ...(bootstrapRequired ? { setupToken } : {}),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Fehler bei der Registrierung");
      }

      // Redirect to login page on successful registration
      router.push("/login?registered=true");
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "Ein Fehler ist aufgetreten");
    } finally {
      setLoading(false);
    }
  };

  if (checkingStatus) {
    return (
      <div className={styles.authStatus}>
        <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" /><h1 className="sr-only">Registrierung wird vorbereitet</h1>
      </div>
    );
  }

  if (!registrationAllowed) {
    return (
      <div className={styles.authStatus}>
        <Card className="w-full max-w-md">
          <CardHeader>
            <h1 className="text-2xl font-semibold tracking-tight">
              {isFirstUser
                ? bootstrapConsumed
                  ? "Erstregistrierung abgeschlossen"
                  : "Erstregistrierung deaktiviert"
                : "Registrierung deaktiviert"}
            </h1>
            <CardDescription>
              {isFirstUser
                ? bootstrapConsumed
                  ? "Die einmalige Erstregistrierung wurde bereits abgeschlossen."
                  : "Der Server ist noch nicht für die Erstregistrierung eingerichtet."
                : "Die Registrierung neuer Benutzer ist derzeit nicht möglich."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {isFirstUser
                ? bootstrapConsumed
                  ? "Ein weiteres Erstadmin-Konto kann nicht über die öffentliche Registrierung angelegt werden."
                  : "Setzen Sie BIVARO_SETUP_TOKEN in der Server-Konfiguration und starten Sie die App neu."
                : "Bitte wenden Sie sich an den Administrator, wenn Sie Zugang benötigen."}
            </p>
          </CardContent>
          <CardFooter>
            <Link href="/login" className="text-primary hover:underline text-sm">
              Zurück zur Anmeldung
            </Link>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className={styles.authLayout}>
      <div className={styles.authStory}>
        <h2 className="min-w-0 [overflow-wrap:anywhere]">
          Ein klarer Start für Ihre Buchhaltung.
        </h2>
        <p className="mt-6 max-w-sm text-lg leading-8 text-muted-foreground">
          Erstellen Sie Ihr Konto und halten Sie Geschäftsvorgänge, Kunden und Auswertungen an einem Ort zusammen.
        </p>
        <dl><div><dt>Ihr Konto</dt><dd>Persönlicher Zugang zu dieser Bivaro-Instanz.</dd></div><div><dt>Ihre Arbeit</dt><dd>Rechnungen, Belege und Kunden gemeinsam verwalten.</dd></div></dl>
      </div>

      <Card className={styles.authCard}>
        <CardHeader className="space-y-4 pb-5">
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.03em]">
              {isFirstUser ? "Admin-Konto erstellen" : "Konto erstellen"}
            </h1>
            <CardDescription className="mt-2">
              {isFirstUser
                ? "Erstellen Sie das erste Administrator-Konto für diese Instanz."
                : "Erstellen Sie ein neues Konto, um loszulegen."}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}
            {isFirstUser && (
              <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                <Shield className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Dieses Konto erhält automatisch Administrator-Rechte.</span>
              </div>
            )}
            {bootstrapRequired && (
              <div className="space-y-2">
                <Label htmlFor="setupToken">Bootstrap-Nachweis</Label>
                <Input
                  id="setupToken"
                  type="password"
                  placeholder="Server-Setup-Token"
                  autoComplete="off"
                  value={setupToken}
                  onChange={(e) => setSetupToken(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Der Nachweis wird nur einmal akzeptiert und nicht gespeichert.
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                type="text"
                placeholder="Ihr Name"
                autoComplete="name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">E-Mail</Label>
              <Input
                id="email"
                type="email"
                placeholder="name@firma.de"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Passwort</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Sicheres Passwort wählen"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className={styles.passwordButton}
                  aria-label={showPassword ? "Passwort verbergen" : "Passwort anzeigen"}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">{PASSWORD_POLICY_HINT}</p>
              {password.length > 0 && (
                <div className="space-y-1">
                  <div className="flex gap-1" aria-hidden="true">
                    {[1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className={cn(
                          "h-1 flex-1 rounded-full transition-colors",
                          i <= passwordStrength ? "bg-primary" : "bg-muted",
                        )}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Stärke: <span className="font-medium text-foreground">{strengthLabel}</span>
                  </p>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Passwort bestätigen</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirm ? "text" : "password"}
                  placeholder="Passwort wiederholen"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  aria-invalid={passwordsMismatch || undefined}
                  required
                  className="pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  className={styles.passwordButton}
                  aria-label={showConfirm ? "Passwort verbergen" : "Passwort anzeigen"}
                  aria-pressed={showConfirm}
                >
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {passwordsMismatch && (
                <p className="flex items-center gap-1 text-xs text-destructive">
                  <AlertCircle className="h-3 w-3" /> Passwörter stimmen nicht überein
                </p>
              )}
              {passwordsMatch && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <CheckCircle2 className="h-3 w-3" /> Passwörter stimmen überein
                </p>
              )}
            </div>
            <Button type="submit" className="min-h-12 w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Konto wird erstellt…
                </>
              ) : (
                isFirstUser ? "Admin-Konto erstellen" : "Registrieren"
              )}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="border-t border-border/80 pt-5">
          <div className="w-full text-center text-sm text-muted-foreground">
            Sie haben bereits ein Konto?{" "}
            <Link href="/login" className="font-medium text-foreground hover:underline">
              Anmelden
            </Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
