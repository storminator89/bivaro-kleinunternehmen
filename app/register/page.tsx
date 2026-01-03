"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, Loader2 } from "lucide-react";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [isFirstUser, setIsFirstUser] = useState(false);
  const [registrationAllowed, setRegistrationAllowed] = useState(true);

  useEffect(() => {
    async function checkRegistrationStatus() {
      try {
        const res = await fetch("/api/auth/registration-status");
        if (res.ok) {
          const data = await res.json();
          setIsFirstUser(data.isFirstUser);
          setRegistrationAllowed(data.allowRegistration);
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

    if (password.length < 6) {
      return setError("Passwort muss mindestens 6 Zeichen lang sein");
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
      <div className="flex min-h-screen items-center justify-center p-4">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!registrationAllowed && !isFirstUser) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-2xl">Registrierung deaktiviert</CardTitle>
            <CardDescription>
              Die Registrierung neuer Benutzer ist derzeit nicht möglich.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Bitte wenden Sie sich an den Administrator, wenn Sie Zugang benötigen.
            </p>
          </CardContent>
          <CardFooter>
            <Link href="/login" className="text-blue-600 hover:underline text-sm">
              Zurück zur Anmeldung
            </Link>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl flex items-center gap-2">
            {isFirstUser && <Shield className="h-6 w-6 text-primary" />}
            {isFirstUser ? "Admin-Konto erstellen" : "Registrieren"}
          </CardTitle>
          <CardDescription>
            {isFirstUser
              ? "Erstellen Sie das erste Administrator-Konto für diese Instanz"
              : "Erstellen Sie ein neues Konto"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 rounded-md bg-red-50 text-red-500 text-sm">
                {error}
              </div>
            )}
            {isFirstUser && (
              <div className="p-3 rounded-md bg-blue-50 text-blue-700 text-sm">
                Dieses Konto wird automatisch Administrator-Rechte erhalten.
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                type="text"
                placeholder="Ihr Name"
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
                placeholder="E-Mail Adresse"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Passwort</Label>
              <Input
                id="password"
                type="password"
                placeholder="Passwort (min. 6 Zeichen)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Passwort bestätigen</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Passwort wiederholen"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Wird verarbeitet..." : (isFirstUser ? "Admin-Konto erstellen" : "Registrieren")}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex flex-col space-y-2">
          <div className="text-sm text-center">
            Sie haben bereits ein Konto?{" "}
            <Link href="/login" className="text-blue-600 hover:underline">
              Anmelden
            </Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}