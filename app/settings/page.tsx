"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Save } from "lucide-react";

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    companyName: "",
    companyAddress: "",
    taxNumber: "",
    bankDetails: "",
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
            taxNumber: data.taxNumber || "",
            bankDetails: data.bankDetails || "",
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
              <Label htmlFor="bankDetails">Bankverbindung</Label>
              <Textarea
                id="bankDetails"
                name="bankDetails"
                value={formData.bankDetails}
                onChange={handleChange}
                placeholder="Bankname: Musterbank&#10;IBAN: DE00 0000 0000 0000 0000 00&#10;BIC: XXXXXXXX"
                rows={3}
              />
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
            
            {/* Logo Upload could be added here later, for now just a text input for URL if hosted elsewhere or we implement upload logic */}
             {/* <div className="space-y-2">
              <Label htmlFor="logoUrl">Logo URL (Optional)</Label>
              <Input
                id="logoUrl"
                name="logoUrl"
                value={formData.logoUrl}
                onChange={handleChange}
                placeholder="https://example.com/logo.png"
              />
            </div> */}

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
    </div>
  );
}
