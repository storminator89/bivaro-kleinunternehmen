"use client";

import React from 'react';
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Invoice } from "@/types/dashboard";

type InvoiceDetailsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  invoice: Invoice | null;
};

export function InvoiceDetailsModal({ isOpen, onClose, invoice }: InvoiceDetailsModalProps) {
  if (!invoice) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto bg-card border rounded-xl shadow-lg">
        <DialogHeader className="border-b pb-4">
          <DialogTitle className="text-xl font-semibold">Rechnungsdetails</DialogTitle>
          <DialogDescription>
            Detaillierte Informationen zur Rechnung
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-medium">Rechnungsnummer</Label>
              <p className="mt-1 text-sm text-muted-foreground">
                {invoice.invoiceNumber || "Nicht verfügbar"}
              </p>
            </div>
            <div>
              <Label className="text-sm font-medium">Status</Label>
              <p className="mt-1 text-sm text-muted-foreground">
                <StatusBadge status={invoice.status} />
              </p>
            </div>
            <div>
              <Label className="text-sm font-medium">Rechnungsdatum</Label>
              <p className="mt-1 text-sm text-muted-foreground">
                {invoice.invoiceDate 
                  ? new Date(invoice.invoiceDate).toLocaleDateString('de-DE') 
                  : "Nicht verfügbar"}
              </p>
            </div>
            <div>
              <Label className="text-sm font-medium">Fälligkeitsdatum</Label>
              <p className="mt-1 text-sm text-muted-foreground">
                {invoice.dueDate 
                  ? new Date(invoice.dueDate).toLocaleDateString('de-DE') 
                  : "Nicht verfügbar"}
              </p>
            </div>
            <div className="col-span-2">
              <Label className="text-sm font-medium">Betrag</Label>
              <p className="mt-1 text-lg font-semibold">
                {invoice.totalAmount 
                  ? new Intl.NumberFormat('de-DE', {
                      style: 'currency',
                      currency: 'EUR'
                    }).format(invoice.totalAmount)
                  : "Nicht verfügbar"}
              </p>
            </div>
          </div>
          <div>
            <Label className="text-sm font-medium">Dateiname</Label>
            <p className="mt-1 text-sm text-muted-foreground">{invoice.fileName}</p>
          </div>
          <div>
            <Label className="text-sm font-medium">Hochgeladen am</Label>
            <p className="mt-1 text-sm text-muted-foreground">
              {new Date(invoice.uploadedAt).toLocaleDateString('de-DE', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </p>
          </div>
        </div>
        <DialogFooter className="border-t pt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Schließen
          </Button>
          <Button 
            type="button" 
            disabled={invoice.hasPdfFile === false}
            onClick={() => {
              window.open(`/api/invoices/download?id=${invoice.id}`, '_blank');
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            PDF
          </Button>
          {invoice.hasEInvoiceXml && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                window.open(`/api/invoices/viewer?id=${invoice.id}`, '_blank');
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5h16M4 19h16M7 9h10M7 13h10M7 17h6" />
              </svg>
              Vorschau
            </Button>
          )}
          {invoice.hasEInvoiceXml && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                window.open(`/api/invoices/download?id=${invoice.id}&format=xml&download=true`, '_blank');
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h8M8 11h8M8 15h4M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" />
              </svg>
              XML
            </Button>
          )}
          <Button 
            type="button" 
            onClick={() => {
              window.open(`/api/invoices/download?id=${invoice.id}&download=true`, '_blank');
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4-4m0 0l-4 4m4-4V4" />
            </svg>
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
