"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
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
  attachmentSha256: string;
  storageScope: string;
  documentLabel: string;
  emailConfigured: boolean;
  missingConfiguration: string[];
  internalCustomerNote: string | null;
};

type OutboxState = "PREPARED" | "PROCESSING" | "ACCEPTED" | "FAILED" | "UNKNOWN" | "CANCELLED";

type OutboxItem = {
  id: string;
  invoiceId?: number | null;
  requestId: string;
  from: string;
  replyTo?: string | null;
  attachmentFileName: string;
  state: OutboxState;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text: string;
  attachmentSha256: string;
  createdAt: string;
  updatedAt: string;
  errorCode?: string | null;
  attempts: { id: string; state: OutboxState; startedAt: string; finishedAt?: string | null; errorCode?: string | null; uncertaintyRecordedAt?: string | null; duplicateRiskAcknowledged?: boolean }[];
};

type OutboxPage = {
  items: OutboxItem[];
  total?: number;
  unresolvedCount?: number;
  hasMore?: boolean;
};

type OutboxMetadata = { total: number; unresolvedCount: number; hasMore: boolean };

type PendingRequest = {
  requestId: string;
  operation: "send" | "retry";
  outboxId?: string;
  from: string;
  replyTo: string | null;
  attachmentSha256: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  text: string;
};

const OUTBOX_LABELS: Record<OutboxState, string> = {
  PREPARED: "Versand vorbereitet",
  CANCELLED: "Versandauftrag beendet",
  PROCESSING: "Versand wird verarbeitet",
  ACCEPTED: "Vom E-Mail-Server angenommen",
  FAILED: "Versand fehlgeschlagen",
  UNKNOWN: "Versandstatus unklar",
};

const OUTBOX_ERRORS: Record<string, string> = {
  AUTH_REJECTED: "SMTP hat die Anmeldung abgelehnt. Bitte SMTP-Einstellungen prüfen.",
  RECIPIENT_REJECTED: "SMTP hat die Empfänger abgelehnt. Bei falscher Adresse eine neue E-Mail vorbereiten.",
  SMTP_REJECTED: "SMTP hat die Übergabe abgelehnt. Es ist keine Annahme bestätigt.",
  CONNECTION_FAILED: "Keine Verbindung zum SMTP-Server. Die E-Mail wurde nicht übergeben.",
  PREPARATION_FAILED: "Versandvorbereitung abgebrochen. Es wurde keine E-Mail übergeben.",
};

function itemHasUnknownRisk(item: OutboxItem) {
  return item.state === "UNKNOWN" || item.attempts.some((attempt) => attempt.state === "UNKNOWN" || attempt.uncertaintyRecordedAt != null);
}

function hasUnresolvedOutboxRisk(item: OutboxItem) {
  return item.state === "PROCESSING" || item.state === "UNKNOWN" || ((item.state === "FAILED" || item.state === "CANCELLED") && itemHasUnknownRisk(item));
}

function outboxMetadata(page: OutboxPage): OutboxMetadata {
  const visibleUnresolved = page.items.filter(hasUnresolvedOutboxRisk).length;
  const total = typeof page.total === "number" && Number.isSafeInteger(page.total) && page.total >= page.items.length ? page.total : page.items.length;
  const unresolvedCount = typeof page.unresolvedCount === "number" && Number.isSafeInteger(page.unresolvedCount) && page.unresolvedCount >= 0 && page.unresolvedCount <= total
    ? Math.max(visibleUnresolved, page.unresolvedCount) : visibleUnresolved;
  return { total, unresolvedCount, hasMore: page.hasMore === true && total > page.items.length };
}

function formatAttemptDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Zeitpunkt unbekannt" : date.toLocaleString("de-DE");
}

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
  const [outboxError, setOutboxError] = useState<string | null>(null);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [historyMetadata, setHistoryMetadata] = useState<OutboxMetadata | null>(null);
  const [historyReady, setHistoryReady] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [acknowledgeUnknown, setAcknowledgeUnknown] = useState(false);
  const [newMessageBaseline, setNewMessageBaseline] = useState<string | null>(null);
  const [newMessageReviewed, setNewMessageReviewed] = useState(false);
  const [pendingRequest, setPendingRequest] = useState<PendingRequest | null>(null);
  const [iframeError, setIframeError] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const toInputRef = useRef<HTMLInputElement>(null);
  const mutationRef = useRef(false);
  const generationRef = useRef(0);
  const pendingRef = useRef<PendingRequest | null>(null);
  const storageKeyRef = useRef<string | null>(null);

  const rememberPending = (value: PendingRequest | null) => {
    // Persist before dispatch: a lost response must never silently create a new attempt.
    if (!storageKeyRef.current) throw new Error("Versand konnte nicht sicher vorbereitet werden. Bitte Vorschau neu öffnen.");
    if (value) sessionStorage.setItem(storageKeyRef.current, JSON.stringify(value));
    else sessionStorage.removeItem(storageKeyRef.current);
    pendingRef.current = value;
    setPendingRequest(value);
  };

  useEffect(() => {
    if (!open || !documentId) return;

    let isActive = true;
    generationRef.current += 1;
    async function loadDraft() {
      setIsLoading(true);
      setIsRefreshing(false);
      setError(null);
      setOutboxError(null);
      setDraft(null);
      setOutbox([]);
      setHistoryMetadata(null);
      setHistoryReady(false);
      setAcknowledgeUnknown(false);
      setNewMessageBaseline(null);
      setNewMessageReviewed(false);
      setPendingRequest(null);
      pendingRef.current = null;
      storageKeyRef.current = null;
      setIframeError(false);
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
      setPdfBlobUrl(null);

      // History is independent of preview/PDF availability, including after a reload.
      const historyResult = documentType === "reminder" ? Promise.resolve(null) : fetch(
        `/api/email/outbox?documentType=${documentType}&id=${documentId}`, { cache: "no-store" },
      ).then(async (response) => {
        const data = await response.json();
        return response.ok && Array.isArray(data.items) ? data as OutboxPage : null;
      }).catch(() => null);

      try {
        const response = await fetch("/api/email/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentType, id: documentId, reminder }),
        });
        const data: EmailDraft & { error?: string } = await response.json();
        if (!response.ok) throw new Error(data.error || "E-Mail-Vorschau konnte nicht erstellt werden.");
        if (!isActive) return;
        setDraft(data);
        let saved: PendingRequest | null = null;
        if (data.storageScope && documentType !== "reminder") {
          storageKeyRef.current = `bivaro:email-outbox:${encodeURIComponent(data.storageScope)}:${documentType}:${documentId}`;
          try {
            const raw = sessionStorage.getItem(storageKeyRef.current);
            if (raw) {
              const parsed = JSON.parse(raw) as Partial<PendingRequest>;
              if (typeof parsed.requestId === "string" && (parsed.operation === "send" || parsed.operation === "retry") &&
                typeof parsed.from === "string" && (parsed.replyTo === null || typeof parsed.replyTo === "string") &&
                [parsed.to, parsed.cc, parsed.bcc, parsed.subject, parsed.text, parsed.attachmentSha256].every((value) => typeof value === "string")) {
                saved = parsed as PendingRequest;
              } else {
                setOutboxError("Der gespeicherte Versandversuch kann nicht sicher übernommen werden. Bitte zuerst den Versandverlauf prüfen.");
              }
            }
          } catch {
            setOutboxError("Der sichere Versandverlauf ist in diesem Browser nicht verfügbar.");
          }
        }
        pendingRef.current = saved;
        setPendingRequest(saved);
        setTo(saved?.to ?? data.to ?? "");
        setCc(saved?.cc ?? "");
        setBcc(saved?.bcc ?? "");
        setSubject(saved?.subject ?? data.subject ?? "");
        setText(saved?.text ?? data.text ?? "");

        if (documentType !== "reminder") {
          try {
            const history = await historyResult;
            if (!history) throw new Error();
            if (!isActive) return;
            const items: OutboxItem[] = history.items;
            setOutbox(items);
            setHistoryMetadata(outboxMetadata(history));
            const current = items.find(hasUnresolvedOutboxRisk) ?? items[0];
            const unrecorded = saved?.operation === "send" && !items.some((item) => item.requestId === saved?.requestId);
            if (current && !unrecorded) {
              setTo(current.to);
              setCc(current.cc ?? "");
              setBcc(current.bcc ?? "");
              setSubject(current.subject);
              setText(current.text);
            }
            setHistoryReady(true);
          } catch {
            if (isActive) setOutboxError("Versandverlauf konnte nicht geladen werden. Bitte Status aktualisieren, bevor Sie senden.");
          }
        }
        try {
          const pdfResponse = await fetch(data.attachmentUrl);
          if (!pdfResponse.ok) throw new Error();
          const blob = await pdfResponse.blob();
          if (!isActive) return;
          const url = URL.createObjectURL(blob);
          blobUrlRef.current = url;
          setPdfBlobUrl(url);
        } catch {
          if (isActive) setIframeError(true);
        }
      } catch (loadError) {
        const history = await historyResult;
        if (!isActive) return;
        if (history) {
          setOutbox(history.items);
          setHistoryMetadata(outboxMetadata(history));
          setHistoryReady(true);
        } else if (documentType !== "reminder") {
          setOutboxError("Versandverlauf konnte nicht geladen werden.");
        }
        setError(loadError instanceof Error ? loadError.message : "E-Mail-Vorschau konnte nicht erstellt werden.");
      } finally {
        if (isActive) setIsLoading(false);
      }
    }
    void loadDraft();
    return () => { isActive = false; generationRef.current += 1; };
  }, [documentId, documentType, open, reminder]);

  useEffect(() => {
    if (!open && blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
      setPdfBlobUrl(null);
    }
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [open]);

  const refreshOutbox = async () => {
    if (!documentId || isRefreshing || mutationRef.current) return;
    setIsRefreshing(true);
    const generation = generationRef.current;
    try {
      const response = await fetch(`/api/email/outbox?documentType=${documentType}&id=${documentId}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.items)) throw new Error();
      if (generation !== generationRef.current) return;
      const items: OutboxItem[] = data.items;
      setOutbox(items);
      setHistoryMetadata(outboxMetadata(data as OutboxPage));
      const current = items.find(hasUnresolvedOutboxRisk) ?? items[0];
      const saved = pendingRef.current;
      const unrecorded = saved?.operation === "send" && !items.some((item) => item.requestId === saved.requestId);
      if (current && !unrecorded && newMessageBaseline === null) {
        setTo(current.to);
        setCc(current.cc ?? "");
        setBcc(current.bcc ?? "");
        setSubject(current.subject);
        setText(current.text);
      }
      setHistoryReady(true);
      setOutboxError(null);
      setError(null);
    } catch {
      if (generation !== generationRef.current) return;
      setHistoryReady(false);
      setOutboxError("Versandverlauf konnte nicht geladen werden. Es wird nichts automatisch erneut gesendet.");
    } finally {
      if (generation === generationRef.current) setIsRefreshing(false);
    }
  };

  const unresolved = outbox.find(hasUnresolvedOutboxRisk);
  const latest = unresolved ?? outbox[0];
  const hasUnresolvedHistory = Boolean(unresolved || historyMetadata?.unresolvedCount);
  const historySummary = historyMetadata?.hasMore
    ? `${outbox.length} von ${historyMetadata.total} Versandaufträgen · ${historyMetadata.unresolvedCount} offen/unklar insgesamt`
    : null;
  const isDetached = latest?.invoiceId === null;
  const pendingItem = pendingRequest ? outbox.find((item) => item.requestId === pendingRequest.requestId || item.id === pendingRequest.outboxId) : undefined;
  const needsRecovery = Boolean(pendingRequest?.operation === "send" && !pendingItem);
  const messageSnapshot = JSON.stringify({ to, cc, bcc, subject, text });
  const isNewMessage = newMessageBaseline !== null;
  const hasUnknownRisk = Boolean(latest && itemHasUnknownRisk(latest));
  const visibleStoredItem = latest && !isNewMessage && !needsRecovery ? latest : null;
  const visibleFrom = visibleStoredItem?.from ?? (!isNewMessage ? pendingRequest?.from : undefined) ?? draft?.from;
  const visibleReplyTo = visibleStoredItem ? visibleStoredItem.replyTo : !isNewMessage && pendingRequest ? pendingRequest.replyTo : draft?.replyTo;
  const fieldsLocked = isSending || Boolean(latest && !isNewMessage) || Boolean(pendingRequest);
  const originalAttachmentChanged = Boolean(latest && latest.attachmentSha256 !== draft?.attachmentSha256);
  const storedAttachmentChanged = Boolean(latest && !isNewMessage && !needsRecovery && originalAttachmentChanged);
  const pendingAttachmentChanged = Boolean(needsRecovery && pendingRequest?.attachmentSha256 !== draft?.attachmentSha256);
  const pendingSenderChanged = Boolean(needsRecovery && pendingRequest && (pendingRequest.from !== draft?.from || pendingRequest.replyTo !== (draft?.replyTo ?? null)));
  const pendingPreviewChanged = pendingAttachmentChanged || pendingSenderChanged;
  const mayPrepareNew = Boolean((latest && (latest.state === "ACCEPTED" || latest.state === "CANCELLED" || latest.state === "FAILED")) ||
    (!latest && needsRecovery && pendingPreviewChanged));
  const reviewedNewMessage = Boolean(isNewMessage && newMessageReviewed && newMessageBaseline !== messageSnapshot);
  const baseCanSend = Boolean(draft?.emailConfigured && !isSending && !isRefreshing &&
    (documentType === "reminder" || (draft.attachmentSha256 && draft.storageScope && historyReady && !outboxError)));
  const canSend = Boolean(baseCanSend && !hasUnresolvedHistory && !pendingPreviewChanged && to.trim() && subject.trim() && text.trim() &&
    ((!latest && (!isNewMessage || reviewedNewMessage)) || (latest?.state === "PREPARED" && !isDetached && !originalAttachmentChanged) || (needsRecovery && latest?.state === "ACCEPTED") || (mayPrepareNew && reviewedNewMessage)));
  const canRetry = Boolean(baseCanSend && !isDetached && !originalAttachmentChanged && latest && (latest.state === "FAILED" || latest.state === "UNKNOWN") && (!hasUnknownRisk || acknowledgeUnknown));

  const handleSend = async (retryItem?: OutboxItem) => {
    if (!draft || !documentId || mutationRef.current || (retryItem ? !canRetry : !canSend)) return;
    mutationRef.current = true;
    const generation = generationRef.current;
    setIsSending(true);
    setError(null);
    try {
      if (documentType === "reminder") {
        const response = await fetch("/api/email/send", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentType, id: documentId, reminder, to, cc, bcc, subject, text }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "E-Mail konnte nicht versendet werden.");
        toast.success("Vom E-Mail-Server angenommen. Zustellung nicht bestätigt.");
        try { await onSent?.(); } catch { /* Keep the confirmed SMTP result. */ }
        onOpenChange(false);
        return;
      }
      const saved = pendingRef.current;
      const request: PendingRequest = retryItem ? (
        saved?.operation === "retry" && saved.outboxId === retryItem.id ? saved : {
          requestId: crypto.randomUUID(), operation: "retry", outboxId: retryItem.id,
          from: retryItem.from, replyTo: retryItem.replyTo ?? null,
          attachmentSha256: retryItem.attachmentSha256, to: retryItem.to, cc: retryItem.cc ?? "", bcc: retryItem.bcc ?? "",
          subject: retryItem.subject, text: retryItem.text,
        }
      ) : latest?.state === "PREPARED" ? {
        requestId: latest.requestId, operation: "send", from: latest.from, replyTo: latest.replyTo ?? null, attachmentSha256: latest.attachmentSha256,
        to: latest.to, cc: latest.cc ?? "", bcc: latest.bcc ?? "", subject: latest.subject, text: latest.text,
      } : saved?.operation === "send" && !pendingItem ? saved : {
        requestId: crypto.randomUUID(), operation: "send", from: draft.from, replyTo: draft.replyTo ?? null, attachmentSha256: draft.attachmentSha256, to, cc, bcc, subject, text,
      };
      rememberPending(request);
      const response = await fetch(retryItem ? `/api/email/outbox/${encodeURIComponent(retryItem.id)}/retry` : "/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(retryItem ? { requestId: request.requestId, acknowledgeUnknown } : {
          documentType, id: documentId, reminder, requestId: request.requestId, attachmentSha256: request.attachmentSha256,
          reviewedFrom: request.from, reviewedReplyTo: request.replyTo,
          to: request.to, cc: request.cc, bcc: request.bcc, subject: request.subject, text: request.text,
        }),
      });
      const data = await response.json();
      if (generation !== generationRef.current) return;
      if (data.outbox) {
        const item: OutboxItem = data.outbox;
        setOutbox((items) => [item, ...items.filter((existing) => existing.id !== item.id)]);
        // Counts describe the last bounded read, not this locally updated list.
        setHistoryMetadata(null);
        rememberPending(null);
        setAcknowledgeUnknown(false);
        setNewMessageBaseline(null);
        setNewMessageReviewed(false);
        if (typeof data.warning === 'string') setError(data.warning);
        if (item.state === "ACCEPTED") {
          toast.success("Vom E-Mail-Server angenommen. Zustellung nicht bestätigt.");
          try { await onSent?.(); } catch { /* The durable send result must not be overwritten by a refresh failure. */ }
        } else if (item.state === "FAILED") {
          setError("Versand fehlgeschlagen. Sie können den gespeicherten Versand erneut versuchen.");
        }
        return;
      }
      if (!response.ok) throw new Error(data.error || "Versand konnte nicht bestätigt werden.");
      throw new Error("Versandstatus konnte nicht bestätigt werden.");
    } catch (sendError) {
      if (generation !== generationRef.current) return;
      setError(sendError instanceof Error ? sendError.message : "Versandstatus konnte nicht bestätigt werden.");
      if (documentType !== "reminder") {
        setOutboxError("Keine sichere Versandbestätigung. Bitte zuerst den Status aktualisieren. Es wird nichts automatisch erneut gesendet.");
        setHistoryReady(false);
      }
    } finally {
      mutationRef.current = false;
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!mutationRef.current) onOpenChange(nextOpen); }}>
      <DialogContent
        className="!max-w-none !w-screen !h-dvh !top-0 !left-0 !translate-x-0 !translate-y-0 !rounded-none p-0 flex flex-col gap-0 overflow-hidden"
      >
        {/* Header */}
        <DialogHeader className="px-4 sm:px-6 pt-5 pb-4 pr-12 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            {DOCUMENT_LABELS[documentType]} per E-Mail senden
          </DialogTitle>
          <DialogDescription>
            Prüfen und bearbeiten Sie die E-Mail, bevor sie versendet wird. Der PDF-Anhang ist rechts sichtbar.
          </DialogDescription>
        </DialogHeader>

        {/* Body – fills all remaining height, two fixed-height columns */}
        <div className="flex-1 min-h-0 px-4 sm:px-6 py-4 overflow-y-auto lg:overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              E-Mail-Vorschau wird geladen...
            </div>
          ) : error && !draft ? (
            <div className="space-y-4">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Vorschau nicht verfügbar</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
              {documentType !== "reminder" && (
                <section aria-label="Versandverlauf" className="rounded-lg border p-3 space-y-3 text-sm">
                  <h3 className="font-medium">Versandverlauf</h3>
                  {historySummary && <p className="text-xs text-muted-foreground">{historySummary}</p>}
                  {outboxError && <p role="alert">{outboxError}</p>}
                  {outbox.map((item) => <div key={item.id} className="break-words">
                    {item.invoiceId === null && <p>Früherer Versand derselben Originalversion</p>}
                    <p className="font-medium">{OUTBOX_LABELS[item.state]}</p>
                    <p>{item.subject} · {formatAttemptDate(item.createdAt)}</p>
                    <p className="break-all">An: {item.to}</p>
                    {item.state === "ACCEPTED" && <p>SMTP-Annahme bestätigt. Nicht als zugestellt oder gelesen bestätigt.</p>}
                  </div>)}
                  <Button variant="outline" onClick={() => void refreshOutbox()} disabled={isRefreshing}>Status aktualisieren</Button>
                </section>
              )}
            </div>
          ) : draft ? (
            /* Two-column layout, both columns scroll independently */
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-5 lg:h-full">

              {/* LEFT – form */}
              <div className="min-w-0 lg:overflow-y-auto lg:pr-2 space-y-4">
                {documentType === "reminder" && error && (
                  <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Versand nicht bestätigt</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>
                )}

                {documentType !== "reminder" && (
                  <section aria-label="Versandverlauf" className="rounded-lg border p-3 space-y-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-medium">Versandverlauf</h3>
                      <Button variant="outline" size="sm" onClick={() => void refreshOutbox()} disabled={isSending || isRefreshing}>
                        {isRefreshing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Status aktualisieren
                      </Button>
                    </div>
                    {historySummary && <p className="text-xs text-muted-foreground">{historySummary}</p>}
                    <div role="status" aria-live="polite" className="space-y-2">
                      {latest ? (
                        <>
                          {isDetached && <p>Früherer Versand derselben Originalversion</p>}
                          <p className="font-medium">{OUTBOX_LABELS[latest.state]}</p>
                          {isDetached && <p>Original wurde wiederhergestellt oder ersetzt. Unklaren früheren Versand zuerst prüfen; kein automatisches Fortsetzen.</p>}
                          <p className="break-all text-muted-foreground">An: {latest.to}</p>
                          {latest.state === "ACCEPTED" && <p>{latest.errorCode === "PARTIAL_RECIPIENTS" ? "SMTP hat nur einen Teil der Empfänger angenommen. Bitte Empfänger prüfen; nicht die gesamte E-Mail erneut senden." : "SMTP-Annahme bestätigt. Nicht als zugestellt oder gelesen bestätigt."}</p>}
                          {latest.state === "PREPARED" && <p>Die E-Mail ist vorbereitet, aber noch nicht übergeben. Fortsetzen verwendet denselben Versandauftrag.</p>}
                          {latest.state === "PROCESSING" && <p>Bitte später den Status aktualisieren. Nicht erneut senden.</p>}
                          {latest.errorCode && OUTBOX_ERRORS[latest.errorCode] && <p>{OUTBOX_ERRORS[latest.errorCode]}</p>}
                          {latest.state === "FAILED" && <p>Erneut versuchen verwendet die gespeicherte E-Mail und denselben PDF-Anhang.</p>}
                          {hasUnknownRisk && <p>Die E-Mail könnte bereits angenommen worden sein. Ein weiterer Versuch kann sie doppelt senden.</p>}
                        </>
                      ) : historyReady ? <p className="text-muted-foreground">Noch kein gespeicherter Versand.</p> : null}
                      {needsRecovery && <p>Ein Versandversuch ist noch nicht bestätigt. Nach der Statusprüfung wird nur dieser Versuch fortgesetzt, kein neuer angelegt.</p>}
                      {pendingPreviewChanged && <p className="text-destructive">Absender oder PDF-Anhang haben sich geändert. Bitte eine neue E-Mail vorbereiten und prüfen, statt den offenen Versandversuch fortzusetzen.</p>}
                    </div>
                    {(outboxError || error) && (
                      <div role="alert" className="space-y-1 text-destructive">
                        {error && <p>{error}</p>}
                        {outboxError && <p>{outboxError}</p>}
                      </div>
                    )}
                    {latest && hasUnknownRisk && (latest.state === "FAILED" || latest.state === "UNKNOWN") && (
                      <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer">
                        <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={acknowledgeUnknown}
                          onChange={(event) => setAcknowledgeUnknown(event.target.checked)} disabled={isSending} />
                        <span>Ich habe den unklaren Status geprüft und akzeptiere, dass ein erneuter Versuch eine doppelte E-Mail senden kann.</span>
                      </label>
                    )}
                    {mayPrepareNew && !hasUnresolvedHistory && !isNewMessage && (
                      <Button variant="outline" className="h-auto min-h-10 whitespace-normal" disabled={isSending || !historyReady || Boolean(outboxError)} onClick={() => {
                        try {
                          rememberPending(null);
                          setNewMessageBaseline(messageSnapshot);
                          setNewMessageReviewed(false);
                          setError(null);
                          requestAnimationFrame(() => toInputRef.current?.focus());
                        } catch { setError("Neue E-Mail konnte nicht sicher vorbereitet werden."); }
                      }}>
                        Neue E-Mail vorbereiten
                      </Button>
                    )}
                    {isNewMessage && (
                      <div className="space-y-2">
                        <p>Ändern Sie Empfänger, Betreff oder Text und prüfen Sie die neue E-Mail vor dem Versand.</p>
                        <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer">
                          <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={newMessageReviewed}
                            onChange={(event) => setNewMessageReviewed(event.target.checked)} disabled={isSending || newMessageBaseline === messageSnapshot} />
                          <span>Ich habe die geänderte E-Mail und den PDF-Anhang erneut geprüft und möchte eine neue E-Mail senden.</span>
                        </label>
                      </div>
                    )}
                    {outbox.length > 0 && (
                      <details>
                        <summary className="cursor-pointer py-2 font-medium">Angezeigte Versandaufträge ({outbox.length})</summary>
                        <ol className="space-y-3 pt-2">
                          {outbox.map((item) => (
                            <li key={item.id} className="border-t pt-2 space-y-1 break-words">
                              {item.invoiceId === null && <p>Früherer Versand derselben Originalversion</p>}
                              <p className="font-medium">{OUTBOX_LABELS[item.state]}</p>
                              <p>{item.subject}</p>
                              <p className="text-muted-foreground break-all">An: {item.to}</p>
                              <p className="text-xs text-muted-foreground">{formatAttemptDate(item.createdAt)}</p>
                              <ol className="pl-4 list-decimal space-y-1 text-xs text-muted-foreground">
                                {item.attempts.map((attempt) => <li key={attempt.id}>{OUTBOX_LABELS[attempt.state]} · {formatAttemptDate(attempt.startedAt)}{attempt.duplicateRiskAcknowledged ? " · Doppelversandrisiko bestätigt" : ""}</li>)}
                              </ol>
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}
                  </section>
                )}

                {!draft.emailConfigured && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>E-Mail-Server nicht vollständig konfiguriert</AlertTitle>
                    <AlertDescription>
                      Fehlend: {draft.missingConfiguration.join(", ")}. Die Vorschau ist möglich, der Versand erst nach der SMTP-Konfiguration.
                      <span className="mt-2 block">
                        <Link href="/settings#smtp-versand" className="font-medium underline underline-offset-2">
                          SMTP-Einstellungen öffnen
                        </Link>{" "}(Änderung nur durch Administratoren)
                      </span>
                    </AlertDescription>
                  </Alert>
                )}

                {draft.internalCustomerNote && (
                  <Alert className="border-amber-200 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/20">
                    <AlertCircle className="h-4 w-4 text-amber-700 dark:text-amber-300" />
                    <AlertTitle>Interner Kundenhinweis</AlertTitle>
                    <AlertDescription>
                      <span className="whitespace-pre-wrap text-amber-900/80 dark:text-amber-200/80">{draft.internalCustomerNote}</span>
                      <span className="mt-2 block text-xs text-muted-foreground">Nur für Ihr Team. Dieser Hinweis wird nicht in den E-Mail-Text oder PDF-Anhang übernommen.</span>
                    </AlertDescription>
                  </Alert>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Von</Label>
                    <Input value={visibleFrom || "Nicht konfiguriert"} disabled />
                    {visibleReplyTo && (
                      <p className="text-xs text-muted-foreground break-all">Antwort an: {visibleReplyTo}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Anhang</Label>
                    <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm h-10">
                      <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{visibleStoredItem?.attachmentFileName ?? draft.attachmentFileName}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email-to">An</Label>
                  <Input
                    readOnly={fieldsLocked}
                    id="email-to"
                    ref={toInputRef}
                    value={to}
                    onChange={(event) => { setTo(event.target.value); setNewMessageReviewed(false); }}
                    placeholder="kunde@example.de"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="email-cc">CC (optional)</Label>
                    <Input
                      readOnly={fieldsLocked}
                      id="email-cc"
                      value={cc}
                      onChange={(event) => { setCc(event.target.value); setNewMessageReviewed(false); }}
                      placeholder="kopie@example.de"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email-bcc">BCC (optional)</Label>
                    <Input
                      readOnly={fieldsLocked}
                      id="email-bcc"
                      value={bcc}
                      onChange={(event) => { setBcc(event.target.value); setNewMessageReviewed(false); }}
                      placeholder="blindkopie@example.de"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email-subject">Betreff</Label>
                  <Input
                    readOnly={fieldsLocked}
                    id="email-subject"
                    value={subject}
                    onChange={(event) => { setSubject(event.target.value); setNewMessageReviewed(false); }}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email-text">E-Mail-Text</Label>
                  <Textarea
                    readOnly={fieldsLocked}
                    id="email-text"
                    value={text}
                    onChange={(event) => { setText(event.target.value); setNewMessageReviewed(false); }}
                    rows={14}
                    className="font-mono text-sm resize-none"
                  />
                </div>
              </div>

              {/* Never present a regenerated PDF as the immutable retry attachment. */}
              {storedAttachmentChanged ? (
                <div className="min-w-0 rounded-lg border p-4 space-y-2 text-sm h-fit">
                  <h3 className="font-medium">Gespeicherter PDF-Anhang</h3>
                  <p>Das Original-PDF wurde seit diesem Versand geändert. Dieser Versandversuch kann mit dem geänderten Anhang nicht wiederholt werden.</p>
                  <p className="text-muted-foreground">Die aktuelle PDF-Vorschau wird deshalb nicht als bisheriger Versandanhang angezeigt. Für eine Wiederholung muss das unveränderte Original verfügbar sein.</p>
                </div>
              ) : <div className="min-w-0 flex flex-col h-[28rem] lg:h-full overflow-hidden rounded-lg border bg-card">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 shrink-0">
                  <div className="min-w-0 break-words">
                    <div className="text-sm font-medium">{draft.documentLabel}</div>
                    <div className="text-xs text-muted-foreground">PDF-Anhang</div>
                  </div>
                  <div className="min-w-0 flex flex-wrap items-center gap-2">
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
              </div>}

            </div>
          ) : null}
        </div>

        {/* Footer */}
        <DialogFooter className="px-4 sm:px-6 py-3 border-t shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSending}>
            Abbrechen
          </Button>
          {latest && !isNewMessage && (latest.state === "FAILED" || latest.state === "UNKNOWN") ? (
            <Button onClick={() => void handleSend(latest)} disabled={!canRetry}>
              {isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              {isSending ? "Wird verarbeitet…" : pendingRequest?.operation === "retry" ? "Versandversuch fortsetzen" : "Erneut versuchen"}
            </Button>
          ) : (
            <Button className="h-auto min-h-11 whitespace-normal" onClick={() => void handleSend()} disabled={!canSend}>
              {isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              {isSending ? "Wird verarbeitet…" : latest?.state === "PREPARED" ? "Vorbereiteten Versand fortsetzen" : needsRecovery ? "Versandversuch fortsetzen" : isNewMessage ? "Neue E-Mail senden" : "E-Mail senden"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
