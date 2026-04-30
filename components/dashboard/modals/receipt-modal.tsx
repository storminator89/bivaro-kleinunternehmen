"use client";

import React, { useEffect, useState } from 'react';
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

type ReceiptModalProps = {
  isOpen: boolean;
  onClose: () => void;
  receiptUrl: string | null;
};

export function ReceiptModal({ isOpen, onClose, receiptUrl }: ReceiptModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      setError(false);
    }
  }, [isOpen]);

  if (!receiptUrl) return null;

  const isEInvoiceViewer = receiptUrl.includes('/api/invoices/viewer');

  const handleLoad = () => {
    setLoading(false);
  };

  const handleError = () => {
    setLoading(false);
    setError(true);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto bg-card border rounded-xl shadow-lg">
          <DialogHeader className="border-b pb-4">
          <DialogTitle className="text-xl font-semibold">
            {isEInvoiceViewer ? 'E-Rechnung ansehen' : 'Beleg anzeigen'}
          </DialogTitle>
          <DialogDescription>
            {isEInvoiceViewer ? 'Vereinfachte Darstellung der strukturierten XRechnung' : 'Vorschau des Belegs'}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4">
          {loading && (
            <div className="flex justify-center items-center h-64">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            </div>
          )}
          
          {error ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <div className="text-muted-foreground mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="mb-2">Vorschau konnte nicht geladen werden</p>
                <p className="text-sm">Die Datei kann aufgrund von Sicherheitseinschränkungen nicht direkt angezeigt werden.</p>
              </div>
              <Button 
                onClick={() => {
                  window.open(receiptUrl, '_blank');
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4-4m0 0l-4 4m4-4V4" />
                </svg>
                {isEInvoiceViewer ? 'Vorschau öffnen' : 'Beleg herunterladen'}
              </Button>
            </div>
          ) : (
            <div className="flex justify-center">
              <iframe 
                src={receiptUrl} 
                className={`w-full h-[70vh] ${loading ? 'hidden' : ''}`} 
                title="Beleg Vorschau"
                onLoad={handleLoad}
                onError={handleError}
              />
            </div>
          )}
        </div>
        {!error && (
          <DialogFooter className="border-t pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Schließen
            </Button>
            <Button 
              type="button" 
              onClick={() => {
                window.open(receiptUrl, '_blank');
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4-4m0 0l-4 4m4-4V4" />
              </svg>
              {isEInvoiceViewer ? 'Öffnen' : 'Herunterladen'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
