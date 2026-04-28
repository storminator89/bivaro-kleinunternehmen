"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Mail, Paperclip, Send } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";

export type EmailPreviewDocumentType = "invoice" | "quote" | "reminder";

export type EmailPreviewReminderContext = {
  reminderLevel?: number;
  fee?: number;
  dueDays?: number;
  notes?: string | null;
};

type EmailDraft = {
  documentType: EmailPreviewDocumentType;
  id: number;
  from: string;
  replyTo?: string;
  to: string;
  subject: string;
  text: string;
  attachmentFileName: string;
  attachmentUrl: string;
  documentLabel: string;
  emailConfigured: boolean;
  missingConfiguration: string[];
};

type EmailPreviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentType: EmailPreviewDocumentType;
  documentId: number | null;
  reminder?: EmailPreviewReminderContext;
  onSent?: () => void | Promise<void>;
};

const DOCUMENT_LABELS: Record<EmailPreviewDocumentType, string> = {
  invoice: "Rechnung",
  quote: "Angebot",
  reminder: "Mahnung",
};

export function EmailPreviewDialog({
  open,
  onOpenChange,
  documentType,
  documentId,
  reminder,
  onSent,
}: EmailPreviewDialogProps) {
  const [draft, setDraft] = useState<EmailDraft | null>(null);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [iframeError, setIframeError] = useState(false);
  // Blob URL for the PDF – avoids X-Frame-Options and session-cookie issues in iframes
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open || !documentId) return;

    let isActive = true;
    async function loadDraft() {
      setIsLoading(true);
      setError(null);
      setDraft(null);
      setIframeError(false);

      // Revoke previous blob URL to avoid memory leaks
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
        setPdfBlobUrl(null);
      }

      try {
        const response = await fetch("/api/email/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentType, id: documentId, reminder }),
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "E-Mail-Vorschau konnte nicht erstellt werden.");
        }

        if (!isActive) return;
        setDraft(data);
        setTo(data.to || "");
        setCc("");
        setBcc("");
        setSubject(data.subject || "");
        setText(data.text || "");

        // Fetch the PDF as a blob so the iframe can display it without
        // running into X-Frame-Options or session-cookie restrictions
        try {
          const pdfResponse = await fetch(data.attachmentUrl);
          if (pdfResponse.ok) {
            const blob = await pdfResponse.blob();
            if (!isActive) return;
            const url = URL.createObjectURL(blob);
            blobUrlRef.current = url;
            setPdfBlobUrl(url);
          } else {
            if (isActive) setIframeError(true);
          }
        } catch {
          if (isActive) setIframeError(true);
        }
      } catch (loadError) {
        if (!isActive) return;
        setError(loadError instanceof Error ? loadError.message : "E-Mail-Vorschau konnte nicht erstellt werden.");
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    loadDraft();

    return () => {
      isActive = false;
    };
  }, [documentId, documentType, open, reminder]);

  // Clean up blob URL when the dialog closes
  useEffect(() => {
    if (!open && blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
      setPdfBlobUrl(null);
    }
  }, [open]);

  const handleSend = async () => {
    if (!draft || !documentId) return;

    setIsSending(true);
    setError(null);

    try {
      const response = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentType,
          id: documentId,
          reminder,
          to,
          cc,
          bcc,
          subject,
          text,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "E-Mail konnte nicht versendet werden.");
      }

      toast.success("E-Mail wurde versendet.");
      await onSent?.();
      onOpenChange(false);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "E-Mail konnte nicht versendet werden.");
      toast.error("E-Mail konnte nicht versendet werden.");
    } finally {
      setIsSending(false);
    }
  };

  const canSend = Boolean(draft?.emailConfigured && to.trim() && subject.trim() && text.trim() && !isSending);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="!max-w-none !w-screen !h-screen !top-0 !left-0 !translate-x-0 !translate-y-0 !rounded-none p-0 flex flex-col gap-0 overflow-hidden"
      >
        {/* Header */}
        <DialogHeader className="px-6 pt-5 pb-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            {DOCUMENT_LABELS[documentType]} per E-Mail senden
          </DialogTitle>
          <DialogDescription>
            Prüfen und bearbeiten Sie die E-Mail, bevor sie versendet wird. Der PDF-Anhang ist rechts sichtbar.
          </DialogDescription>
        </DialogHeader>

        {/* Body – fills all remaining height, two fixed-height columns */}
        <div className="flex-1 min-h-0 px-6 py-4 overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              E-Mail-Vorschau wird geladen...
            </div>
          ) : error ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Vorschau nicht verfügbar</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : draft ? (
            /* Two-column layout, both columns scroll independently */
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(360px,2fr)_3fr] gap-5 h-full">

              {/* LEFT – form */}
              <div className="overflow-y-auto pr-2 space-y-4">
                {!draft.emailConfigured && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>E-Mail-Server nicht vollständig konfiguriert</AlertTitle>
                    <AlertDescription>
                      Fehlend: {draft.missingConfiguration.join(", ")}. Die Vorschau ist möglich, der Versand erst nach der SMTP-Konfiguration.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Von</Label>
                    <Input value={draft.from || "Nicht konfiguriert"} disabled />
                  </div>
                  <div className="space-y-2">
                    <Label>Anhang</Label>
                    <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm h-10">
                      <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{draft.attachmentFileName}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email-to">An</Label>
                  <Input
                    id="email-to"
                    value={to}
                    onChange={(event) => setTo(event.target.value)}
                    placeholder="kunde@example.de"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="email-cc">CC (optional)</Label>
                    <Input
                      id="email-cc"
                      value={cc}
                      onChange={(event) => setCc(event.target.value)}
                      placeholder="kopie@example.de"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email-bcc">BCC (optional)</Label>
                    <Input
                      id="email-bcc"
                      value={bcc}
                      onChange={(event) => setBcc(event.target.value)}
                      placeholder="blindkopie@example.de"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email-subject">Betreff</Label>
                  <Input
                    id="email-subject"
                    value={subject}
                    onChange={(event) => setSubject(event.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email-text">E-Mail-Text</Label>
                  <Textarea
                    id="email-text"
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    rows={14}
                    className="font-mono text-sm resize-none"
                  />
                </div>
              </div>

              {/* RIGHT – PDF viewer fills the full column height */}
              <div className="flex flex-col h-full overflow-hidden rounded-lg border bg-card">
                <div className="flex items-center justify-between border-b px-4 py-3 shrink-0">
                  <div>
                    <div className="text-sm font-medium">{draft.documentLabel}</div>
                    <div className="text-xs text-muted-foreground">PDF-Anhang</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Alert className="py-1 px-3 text-xs border-0 bg-transparent">
                      <CheckCircle2 className="h-3 w-3" />
                      <AlertDescription className="text-xs">
                        Wird als Anhang versendet
                      </AlertDescription>
                    </Alert>
                    <Button variant="outline" size="sm" asChild>
                      <a href={draft.attachmentUrl} target="_blank" rel="noreferrer">
                        Öffnen
                      </a>
                    </Button>
                  </div>
                </div>
                <iframe
                  key={pdfBlobUrl ?? draft.attachmentUrl}
                  title={`PDF-Vorschau ${draft.documentLabel}`}
                  src={pdfBlobUrl ?? undefined}
                  className={`flex-1 min-h-0 w-full bg-muted${iframeError || !pdfBlobUrl ? " hidden" : ""}`}
                  onError={() => setIframeError(true)}
                />
                {(!pdfBlobUrl || iframeError) && !isLoading && (
                  <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-muted text-muted-foreground text-sm p-8">
                    {iframeError ? (
                      <>
                        <AlertCircle className="h-10 w-10 text-destructive" />
                        <p className="text-center">
                          PDF-Vorschau konnte nicht geladen werden.<br />
                          Klicken Sie auf &quot;Öffnen&quot; um das PDF in einem neuen Tab anzuzeigen.
                        </p>
                      </>
                    ) : (
                      <>
                        <Loader2 className="h-8 w-8 animate-spin" />
                        <p>PDF wird geladen…</p>
                      </>
                    )}
                    <Button variant="outline" asChild>
                      <a href={draft.attachmentUrl} target="_blank" rel="noreferrer">
                        PDF direkt öffnen
                      </a>
                    </Button>
                  </div>
                )}
              </div>

            </div>
          ) : null}
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-4 border-t shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSending}>
            Abbrechen
          </Button>
          <Button onClick={handleSend} disabled={!canSend}>
            {isSending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Wird versendet...
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                E-Mail senden
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
