"use client";

import { useRef, useState } from "react";
import { cancellationSubmissionGate } from "@/lib/cancellation-submission";
import { cancellationReasonInput, MAX_CANCELLATION_REASON_LENGTH } from "@/lib/invoice-cancellation-input";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Invoice } from "@/types/dashboard";
import { AlertTriangle, FileX, Loader2 } from "lucide-react";

interface CreditNoteModalProps {
    isOpen: boolean;
    onClose: () => void;
    invoice: Invoice | null;
    onSuccess?: () => void;
}

export function CancellationProgress() {
    return <p role="status" aria-live="polite" className="text-sm text-muted-foreground">Die bestätigte Stornierung wird verarbeitet. Bitte warten; dieser Dialog bleibt bis zur Antwort geöffnet. Schließen würde den Auftrag nicht zurücknehmen.</p>;
}

export function CreditNoteModal({ isOpen, onClose, invoice, onSuccess }: CreditNoteModalProps) {
    const [cancellationReason, setCancellationReason] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [reasonError, setReasonError] = useState<string | null>(null);
    const reasonInput = useRef<HTMLTextAreaElement>(null);
    const submission = useRef(cancellationSubmissionGate());

    const handleSubmit = async () => {
        if (!invoice || isSubmitting) return;
        const reason = cancellationReasonInput(cancellationReason);
        if (!reason.ok) {
            setReasonError(reason.error);
            reasonInput.current?.focus();
            return;
        }
        if (!submission.current.begin()) return;
        setReasonError(null);

        setIsSubmitting(true);
        setError(null);

        try {
            const response = await fetch("/api/invoices/cancel", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    invoiceId: invoice.id,
                    cancellationReason: reason.value,
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                if (typeof data.fieldErrors?.cancellationReason === 'string') {
                    setReasonError(data.fieldErrors.cancellationReason);
                    reasonInput.current?.focus();
                    return;
                }
                setError(data.error || "Fehler beim Stornieren der Rechnung");
                return;
            }

            // Success
            setCancellationReason("");
            onClose();
            onSuccess?.();
        } catch {
            setError("Die Antwort auf den Stornoauftrag ist unklar. Bitte die Rechnungshistorie prüfen, bevor Sie es erneut versuchen. Der Auftrag wurde durch diesen Fehler nicht zurückgenommen.");
        } finally {
            submission.current.finish();
            setIsSubmitting(false);
        }
    };

    const handleClose = () => {
        submission.current.dismiss(() => {
            setCancellationReason("");
            setReasonError(null);
            setError(null);
            onClose();
        });
    };

    if (!invoice) return null;

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('de-DE', {
            style: 'currency',
            currency: 'EUR'
        }).format(amount);
    };

    return (
        <Dialog open={isOpen} onOpenChange={open => { if (!open) handleClose(); }}>
            <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg bg-card border rounded-xl shadow-lg"
                showCloseButton={!isSubmitting}
                aria-busy={isSubmitting}
                onEscapeKeyDown={event => submission.current.preventDismiss(event)}
                onPointerDownOutside={event => submission.current.preventDismiss(event)}
                onInteractOutside={event => submission.current.preventDismiss(event)}
            >
                <DialogHeader className="border-b pb-4">
                    <DialogTitle className="text-xl font-semibold flex items-center gap-2 text-red-600 dark:text-red-400">
                        <FileX className="h-5 w-5" />
                        Rechnung stornieren
                    </DialogTitle>
                    <DialogDescription>
                        Erstellen Sie eine Gutschrift zur Stornierung dieser Rechnung.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {/* Warning */}
                    <div className="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                        <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                        <div className="text-sm text-amber-800 dark:text-amber-200">
                            <p className="font-medium">Achtung: Diese Aktion kann nicht rückgängig gemacht werden.</p>
                            <p className="mt-1">Die Originalrechnung wird auf "Storniert" gesetzt und eine Gutschrift wird automatisch erstellt.</p>
                        </div>
                    </div>

                    {/* Invoice Details */}
                    <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
                        <div>
                            <Label className="text-xs text-muted-foreground">Rechnungsnummer</Label>
                            <p className="font-medium">{invoice.invoiceNumber || "Nicht verfügbar"}</p>
                        </div>
                        <div>
                            <Label className="text-xs text-muted-foreground">Betrag</Label>
                            <p className="font-medium">
                                {invoice.totalAmount ? formatCurrency(invoice.totalAmount) : "Nicht verfügbar"}
                            </p>
                        </div>
                        <div>
                            <Label className="text-xs text-muted-foreground">Rechnungsdatum</Label>
                            <p className="font-medium">
                                {invoice.invoiceDate
                                    ? new Date(invoice.invoiceDate).toLocaleDateString('de-DE')
                                    : "Nicht verfügbar"}
                            </p>
                        </div>
                        <div>
                            <Label className="text-xs text-muted-foreground">Status</Label>
                            <p className="font-medium">{invoice.status}</p>
                        </div>
                    </div>

                    {/* Cancellation Reason */}
                    <div className="space-y-2">
                        <Label htmlFor="cancellation-reason">Stornierungsgrund (erforderlich)</Label>
                        <Textarea
                            ref={reasonInput}
                            id="cancellation-reason"
                            required
                            disabled={isSubmitting}
                            aria-required="true"
                            aria-invalid={Boolean(reasonError)}
                            aria-describedby={reasonError ? 'cancellation-reason-help cancellation-reason-error' : 'cancellation-reason-help'}
                            maxLength={MAX_CANCELLATION_REASON_LENGTH}
                            placeholder="Geben Sie den Grund für die Stornierung an..."
                            value={cancellationReason}
                            onChange={(e) => { setCancellationReason(e.target.value); setReasonError(null); }}
                            rows={3}
                            className="resize-none"
                        />
                    </div>

                    <p id="cancellation-reason-help" className="text-sm text-muted-foreground">Der Grund wird mit Original, Gutschrift und Änderungseintrag gespeichert. Ein Storno belegt keine Rückzahlung.</p>
                    {reasonError && <p id="cancellation-reason-error" role="alert" className="text-sm text-destructive">{reasonError}</p>}

                    {isSubmitting && <CancellationProgress />}

                    {/* Error Message */}
                    {error && (
                        <div role="alert" className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                        </div>
                    )}
                </div>

                <DialogFooter className="border-t pt-4 gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={handleClose}
                        disabled={isSubmitting}
                    >
                        Abbrechen
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        onClick={handleSubmit}
                        disabled={isSubmitting}
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Wird storniert...
                            </>
                        ) : (
                            <>
                                <FileX className="h-4 w-4 mr-2" />
                                Rechnung stornieren
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
