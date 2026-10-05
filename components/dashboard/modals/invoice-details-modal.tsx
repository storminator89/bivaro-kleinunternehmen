"use client";

import React from 'react';
import { Download, Eye, FileCode2, List, X } from 'lucide-react';
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
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

function DetailItem({
  label,
  children,
  emphasis = false,
}: {
  label: string;
  children: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-sm font-medium leading-5 text-foreground">{label}</dt>
      <dd
        className={
          emphasis
            ? "mt-1.5 break-words text-xl font-semibold leading-7 tabular-nums text-foreground"
            : "mt-1.5 break-words text-base leading-6 text-muted-foreground"
        }
      >
        {children}
      </dd>
    </div>
  );
}

export function InvoiceDetailsModal({ isOpen, onClose, invoice }: InvoiceDetailsModalProps) {
  if (!invoice) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[min(90dvh,52rem)] flex-col gap-0 overflow-hidden rounded-2xl border border-border bg-card p-0 shadow-xl sm:max-w-3xl"
      >
        <DialogHeader className="relative border-b px-6 pb-5 pt-6 pr-16 text-left sm:px-8 sm:pb-6 sm:pt-8">
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Dialog schließen"
              className="absolute right-3 top-3 text-muted-foreground hover:text-foreground sm:right-4 sm:top-4"
            >
              <X aria-hidden="true" />
            </Button>
          </DialogClose>
          <DialogTitle className="text-2xl font-semibold leading-tight tracking-[-0.02em]">
            Rechnungsdetails
          </DialogTitle>
          <DialogDescription className="max-w-prose text-base leading-6">
            Rechnung {invoice.invoiceNumber || invoice.id}{invoice.customer?.name ? ` · ${invoice.customer.name}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 min-w-0 flex-1 space-y-6 overflow-x-clip overflow-y-auto px-6 py-6 sm:px-8 sm:py-7">
          <section className="invoice-detail-summary" aria-label="Rechnungsbetrag und Zahlungsstatus">
            <div><p className="text-xs text-muted-foreground">Rechnungsbetrag</p><p className="invoice-detail-amount">{invoice.totalAmount != null ? new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(invoice.totalAmount) : 'Nicht verfügbar'}</p></div>
            <StatusBadge status={invoice.status} />
          </section>
          <dl className="invoice-detail-dates grid min-w-0 grid-cols-2 gap-4">
            <DetailItem label="Rechnungsdatum">{invoice.invoiceDate ? new Date(invoice.invoiceDate).toLocaleDateString('de-DE') : 'Nicht verfügbar'}</DetailItem>
            <DetailItem label="Fälligkeitsdatum">{invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString('de-DE') : 'Nicht verfügbar'}</DetailItem>
          </dl>
          <dl className="grid min-w-0 gap-6 border-t border-border pt-6 sm:grid-cols-2">
            <DetailItem label="Dateiname">
              <span className="[overflow-wrap:anywhere]">{invoice.fileName}</span>
            </DetailItem>
            <DetailItem label="Hochgeladen am">
              {new Date(invoice.uploadedAt).toLocaleDateString('de-DE', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </DetailItem>
          </dl>
        </div>
        <DialogFooter className="!flex-col gap-3 border-t border-border bg-secondary/40 px-6 pb-6 pt-4 sm:px-8 sm:pb-8">
          <div className="grid w-full min-w-0 grid-cols-1 gap-2 min-[420px]:grid-cols-2">
            <Button
              type="button"
              className="w-full"
              disabled={invoice.hasPdfFile === false}
              onClick={() => {
                window.open(`/api/invoices/download?id=${invoice.id}`, '_blank');
              }}
            >
              <Eye aria-hidden="true" />
              PDF öffnen
            </Button>
            {invoice.hasEInvoiceXml && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  window.open(`/api/invoices/viewer?id=${invoice.id}`, '_blank');
                }}
              >
                <List aria-hidden="true" />
                Vorschau
              </Button>
            )}
            {invoice.hasEInvoiceXml && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  window.open(`/api/invoices/download?id=${invoice.id}&format=xml&download=true`, '_blank');
                }}
              >
                <FileCode2 aria-hidden="true" />
                XML
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={invoice.hasPdfFile === false}
              onClick={() => {
                window.open(`/api/invoices/download?id=${invoice.id}&download=true`, '_blank');
              }}
            >
              <Download aria-hidden="true" />
              Download
            </Button>
          </div>
          <Button type="button" variant="ghost" className="w-full" onClick={onClose}>
            Schließen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
