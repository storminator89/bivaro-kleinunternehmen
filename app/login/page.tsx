"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import styles from "@/components/public-accounting/public-accounting.module.css";
import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { toast } from "@/components/ui/toaster";
import { getAccessHelpHref } from "@/lib/access-help";
import { getSafeLoginCallbackUrl } from "@/lib/login-callback";

export default function LoginPage() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (searchParams.get("registered") === "true") {
      toast.success("Registrierung erfolgreich. Sie können sich jetzt anmelden.");
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const callbackUrl = getSafeLoginCallbackUrl(searchParams.get("callbackUrl"));
      const result = await signIn("credentials", {
        redirect: false,
        callbackUrl,
        email,
        password,
      });

      if (!result?.ok || result.error) {
        setError("Ungültige Anmeldedaten");
        setLoading(false);
        return;
      }

      // A protected page may have been prefetched while anonymous. A fresh
      // document request uses the new session cookie instead of a cached RSC
      // login redirect; the destination has already been restricted to origin.
      window.location.replace(callbackUrl);
    } catch {
      setError("Ein Fehler ist aufgetreten");
      setLoading(false);
    }
  };

  return (
    <div className={styles.authLayout}>
      <Card className={styles.authCard}>
        <CardHeader className="space-y-4 pb-5">
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.03em]">Anmelden</h1>
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
            <div className="space-y-2">
              <Label htmlFor="email">E-Mail</Label>
              <Input
                id="email"
                type="email"
                placeholder="name@firma.de"
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={!!error || undefined}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Passwort</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Ihr Passwort"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => setCapsLock(e.getModifierState && e.getModifierState("CapsLock"))}
                  onKeyUp={(e) => setCapsLock(e.getModifierState && e.getModifierState("CapsLock"))}
                  aria-invalid={!!error || undefined}
                  required
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
              {capsLock && (
                <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                  <AlertCircle className="h-3 w-3" /> Feststelltaste ist aktiv
                </p>
              )}
            </div>
            <Button type="submit" className="min-h-12 w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Wird angemeldet…
                </>
              ) : (
                "Anmelden"
              )}
            </Button>
          </form>
          <Link href={getAccessHelpHref(searchParams.get("callbackUrl"))} className="mt-3 flex min-h-11 items-center justify-center rounded-md text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">Probleme beim Anmelden?</Link>
        </CardContent>
        <CardFooter className="border-t border-border/80 pt-5">
          <div className="w-full text-center text-sm text-muted-foreground">

            <Link href="/register" className="font-medium text-foreground hover:underline">
              Registrieren
            </Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
