"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

interface CreateInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CreateInvoiceModal({ isOpen, onClose }: CreateInvoiceModalProps) {
  const [customerName, setCustomerName] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [items, setItems] = useState([{ description: "", amount: "" }]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [settings, setSettings] = useState<any>(null);

  useEffect(() => {
    if (isOpen) {
      fetch("/api/settings")
        .then(res => res.json())
        .then(data => setSettings(data))
        .catch(err => console.error("Failed to load settings", err));
    }
  }, [isOpen]);

  const addItem = () => {
    setItems([...items, { description: "", amount: "" }]);
  };

  const updateItem = (index: number, field: 'description' | 'amount', value: string) => {
    const newItems = [...items];
    newItems[index][field] = value;
    setItems(newItems);
  };

  const removeItem = (index: number) => {
    const newItems = items.filter((_, i) => i !== index);
    setItems(newItems);
  };

  const generatePDF = async () => {
    setIsGenerating(true);
    try {
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage();
      const { width, height } = page.getSize();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      const fontSize = 12;
      let y = height - 50;

      // Company Header (from Settings)
      if (settings?.companyName) {
        page.drawText(settings.companyName, { x: 50, y, size: 18, font: boldFont });
        y -= 20;
      }
      if (settings?.companyAddress) {
        const lines = settings.companyAddress.split('\n');
        lines.forEach((line: string) => {
          page.drawText(line, { x: 50, y, size: 10, font });
          y -= 12;
        });
        y -= 20;
      } else {
        // Fallback spacing if no address
        y -= 40;
      }

      // Invoice Title
      page.drawText('RECHNUNG', { x: 50, y, size: 24, font: boldFont });
      y -= 40;

      // Invoice Details
      page.drawText(`Rechnungsnummer: ${invoiceNumber}`, { x: 50, y, size: fontSize, font });
      y -= 20;
      page.drawText(`Datum: ${new Date(date).toLocaleDateString('de-DE')}`, { x: 50, y, size: fontSize, font });
      y -= 40;

      // Customer
      page.drawText('Empfänger:', { x: 50, y, size: fontSize, font: boldFont });
      y -= 20;
      page.drawText(customerName, { x: 50, y, size: fontSize, font });
      y -= 50;

      // Table Header
      page.drawText('Beschreibung', { x: 50, y, size: fontSize, font: boldFont });
      page.drawText('Betrag', { x: 400, y, size: fontSize, font: boldFont });
      y -= 10;
      page.drawLine({ start: { x: 50, y }, end: { x: 500, y }, thickness: 1, color: rgb(0, 0, 0) });
      y -= 20;

      // Items
      let total = 0;
      items.forEach(item => {
        const amount = parseFloat(item.amount.replace(',', '.')) || 0;
        total += amount;
        
        page.drawText(item.description, { x: 50, y, size: fontSize, font });
        page.drawText(`${amount.toFixed(2).replace('.', ',')} €`, { x: 400, y, size: fontSize, font });
        y -= 20;
      });

      y -= 10;
      page.drawLine({ start: { x: 50, y }, end: { x: 500, y }, thickness: 1, color: rgb(0, 0, 0) });
      y -= 30;

      // Total
      page.drawText('Gesamtbetrag:', { x: 300, y, size: fontSize, font: boldFont });
      page.drawText(`${total.toFixed(2).replace('.', ',')} €`, { x: 400, y, size: fontSize, font: boldFont });
      y -= 50;

      // Footer Note (Kleinunternehmer)
      page.drawText('Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.', { x: 50, y, size: 10, font });
      y -= 20;

      // Footer (Bank details, etc.)
      if (settings?.footerText || settings?.bankDetails || settings?.taxNumber) {
        y = 50; // Fixed position at bottom
        const footerFontSize = 9;
        
        if (settings.footerText) {
          page.drawText(settings.footerText, { x: 50, y, size: footerFontSize, font });
          y -= 12;
        }
        
        let bankText = "";
        if (settings.bankDetails) bankText += settings.bankDetails.replace(/\n/g, ' | ');
        if (settings.taxNumber) bankText += ` | St-Nr: ${settings.taxNumber}`;
        
        if (bankText) {
           page.drawText(bankText, { x: 50, y, size: footerFontSize, font });
        }
      }

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      
      // Open/Download
      const link = document.createElement('a');
      link.href = url;
      link.download = `Rechnung_${invoiceNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      onClose();
    } catch (error) {
      console.error("Error generating PDF:", error);
      alert("Fehler beim Erstellen der PDF.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Rechnung erstellen</DialogTitle>
          <DialogDescription>
            Erstellen Sie eine einfache PDF-Rechnung für Ihre Kunden.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="invoice-number">Rechnungsnummer</Label>
              <Input id="invoice-number" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="RE-2024-001" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="date">Datum</Label>
              <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="customer">Kunde / Empfänger</Label>
            <Input id="customer" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Musterfirma GmbH, Musterstraße 1, 12345 Musterstadt" />
          </div>
          
          <div className="space-y-2">
            <Label>Positionen</Label>
            {items.map((item, index) => (
              <div key={index} className="flex gap-2 items-start">
                <Input 
                  className="flex-1" 
                  value={item.description} 
                  onChange={(e) => updateItem(index, 'description', e.target.value)} 
                  placeholder="Beschreibung" 
                />
                <Input 
                  className="w-24" 
                  type="number" 
                  value={item.amount} 
                  onChange={(e) => updateItem(index, 'amount', e.target.value)} 
                  placeholder="Betrag" 
                />
                <Button variant="ghost" size="icon" onClick={() => removeItem(index)} disabled={items.length === 1}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addItem} className="mt-2">
              + Position hinzufügen
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button onClick={generatePDF} disabled={isGenerating || !customerName || !invoiceNumber}>
            {isGenerating ? "Erstelle PDF..." : "PDF erstellen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
