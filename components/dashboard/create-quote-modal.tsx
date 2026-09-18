"use client";

import { useCallback, useState } from "react";
import { QuoteEditor } from "@/components/dashboard/editors/quote-editor";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface CreateQuoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onQuoteCreated?: () => void;
}

export function CreateQuoteModal({ isOpen, onClose, onQuoteCreated }: CreateQuoteModalProps) {
  const [showPreview, setShowPreview] = useState(false);
  const closeEditor = useCallback(() => {
    setShowPreview(false);
    onClose();
  }, [onClose]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeEditor()}>
      <DialogContent
        className={cn(
          "max-h-[94vh] overflow-hidden p-6",
          showPreview ? "sm:max-w-[min(94vw,1400px)]" : "sm:max-w-[min(94vw,900px)]",
        )}
      >
        <DialogTitle className="sr-only">Angebot erstellen</DialogTitle>
        <DialogDescription className="sr-only">
          Empfänger, Positionen und Gültigkeit für ein neues Angebot erfassen.
        </DialogDescription>
        <QuoteEditor
          variant="dialog"
          onCancel={closeEditor}
          onQuoteCreated={onQuoteCreated}
          onPreviewVisibilityChange={setShowPreview}
        />
      </DialogContent>
    </Dialog>
  );
}
