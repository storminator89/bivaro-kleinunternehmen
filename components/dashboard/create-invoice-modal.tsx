"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFName } from 'pdf-lib';
import QRCode from 'qrcode';
import { generateZugferdXml } from "@/lib/zugferd-generator";

interface CreateInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInvoiceCreated?: () => void;
}

interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

export function CreateInvoiceModal({ isOpen, onClose, onInvoiceCreated }: CreateInvoiceModalProps) {
  const [customerAddress, setCustomerAddress] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<InvoiceItem[]>([{ description: "", quantity: 1, unitPrice: 0 }]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [settings, setSettings] = useState<any>(null);
  const [customers, setCustomers] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [includeQRCode, setIncludeQRCode] = useState(false);
  const [invoiceNumberError, setInvoiceNumberError] = useState<string | null>(null);
  const [isCheckingNumber, setIsCheckingNumber] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // Set default due date to 14 days from now
      const today = new Date();
      const in14Days = new Date(today);
      in14Days.setDate(today.getDate() + 14);
      setDueDate(in14Days.toISOString().split('T')[0]);
      setDeliveryDate(today.toISOString().split('T')[0]);

      fetch("/api/settings")
        .then(res => res.json())
        .then(data => setSettings(data))
        .catch(err => console.error("Failed to load settings", err));

      fetch("/api/customers")
        .then(res => res.json())
        .then(data => setCustomers(Array.isArray(data) ? data : []))
        .catch(err => console.error("Failed to load customers", err));

      fetch("/api/invoices/next-number")
        .then(res => res.json())
        .then(data => {
          if (data.nextInvoiceNumber) {
            setInvoiceNumber(data.nextInvoiceNumber);
          }
        })
        .catch(err => console.error("Failed to load next invoice number", err));
    }
  }, [isOpen]);

  // Check for duplicate invoice number
  useEffect(() => {
    const checkInvoiceNumber = async () => {
      if (!invoiceNumber) {
        setInvoiceNumberError(null);
        return;
      }

      setIsCheckingNumber(true);
      try {
        const res = await fetch(`/api/invoices/check-number?number=${encodeURIComponent(invoiceNumber)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.exists) {
            setInvoiceNumberError("Diese Rechnungsnummer existiert bereits.");
          } else {
            setInvoiceNumberError(null);
          }
        }
      } catch (error) {
        console.error("Error checking invoice number:", error);
      } finally {
        setIsCheckingNumber(false);
      }
    };

    const timeoutId = setTimeout(checkInvoiceNumber, 500); // Debounce
    return () => clearTimeout(timeoutId);
  }, [invoiceNumber]);

  const handleCustomerSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const customerId = e.target.value;
    if (!customerId) return;
    
    const customer = customers.find(c => c.id.toString() === customerId);
    if (customer) {
      setSelectedCustomer(customer);
      let addressBlock = customer.name;
      if (customer.address) addressBlock += `\n${customer.address}`;
      if (customer.zipCode || customer.city) addressBlock += `\n${customer.zipCode || ''} ${customer.city || ''}`.trim();
      setCustomerAddress(addressBlock);
    }
  };

  const addItem = () => {
    setItems([...items, { description: "", quantity: 1, unitPrice: 0 }]);
  };

  const updateItem = (index: number, field: keyof InvoiceItem, value: string | number) => {
    const newItems = [...items];
    if (field === 'quantity' || field === 'unitPrice') {
      newItems[index] = { ...newItems[index], [field]: Number(value) };
    } else {
      newItems[index] = { ...newItems[index], [field]: value };
    }
    setItems(newItems);
  };

  const removeItem = (index: number) => {
    const newItems = items.filter((_, i) => i !== index);
    setItems(newItems);
  };

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  };

  const generatePDF = async () => {
    setIsGenerating(true);
    try {
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage();
      const { width, height } = page.getSize();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      // Helper to draw text aligned right
      const drawTextRight = (text: string, x: number, y: number, size: number, fontToUse: PDFFont = font, color = rgb(0, 0, 0)) => {
        const textWidth = fontToUse.widthOfTextAtSize(text, size);
        page.drawText(text, { x: x - textWidth, y, size, font: fontToUse, color });
      };

      // Helper to draw text centered
      const drawTextCenter = (text: string, x: number, y: number, size: number, fontToUse: PDFFont = font, color = rgb(0, 0, 0)) => {
        const textWidth = fontToUse.widthOfTextAtSize(text, size);
        page.drawText(text, { x: x - textWidth / 2, y, size, font: fontToUse, color });
      };

      let y = height - 50;
      const margin = 50;

      // --- HEADER ---
      // Logo (Right)
      if (settings?.logoUrl) {
        try {
          const logoBytes = await fetch(settings.logoUrl).then(res => res.arrayBuffer());
          const logoExt = settings.logoUrl.split('.').pop()?.toLowerCase();
          let logoImage;
          
          if (logoExt === 'png') {
            logoImage = await pdfDoc.embedPng(logoBytes);
          } else if (logoExt === 'jpg' || logoExt === 'jpeg') {
            logoImage = await pdfDoc.embedJpg(logoBytes);
          }

          if (logoImage) {
            const maxWidth = 150;
            const maxHeight = 60;
            const scale = Math.min(maxWidth / logoImage.width, maxHeight / logoImage.height);
            const logoDims = logoImage.scale(scale);
            
            page.drawImage(logoImage, {
              x: width - margin - logoDims.width,
              y: height - margin - logoDims.height,
              width: logoDims.width,
              height: logoDims.height,
            });
          }
        } catch (error) {
          console.error("Failed to embed logo:", error);
        }
      }

      // Company Info (Left - Small)
      if (settings?.companyName) {
        page.drawText(settings.companyName, { x: margin, y, size: 10, font: boldFont, color: rgb(0.4, 0.4, 0.4) });
        y -= 12;
        if (settings?.companyAddress) {
            const addressLine = settings.companyAddress.replace(/\n/g, ', ');
            page.drawText(addressLine, { x: margin, y, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
        }
      }
      
      y -= 40;

      // --- ADDRESS FIELD ---
      // DIN 5008 Address Field Position (approx)
      let addressY = height - 160;
      const addressLines = customerAddress.split('\n');
      addressLines.forEach(line => {
        page.drawText(line, { x: margin, y: addressY, size: 11, font });
        addressY -= 14;
      });

      // --- INVOICE INFO BLOCK (Right side) ---
      let infoY = height - 160;
      const infoX = width - margin - 150;
      
      page.drawText('RECHNUNG', { x: infoX, y: infoY + 20, size: 16, font: boldFont });
      
      const infoGap = 14;
      page.drawText('Rechnungs-Nr.:', { x: infoX, y: infoY, size: 10, font: boldFont });
      drawTextRight(invoiceNumber, width - margin, infoY, 10, font);
      infoY -= infoGap;

      page.drawText('Datum:', { x: infoX, y: infoY, size: 10, font: boldFont });
      drawTextRight(new Date(date).toLocaleDateString('de-DE'), width - margin, infoY, 10, font);
      infoY -= infoGap;

      if (deliveryDate) {
        page.drawText('Leistungsdatum:', { x: infoX, y: infoY, size: 10, font: boldFont });
        drawTextRight(new Date(deliveryDate).toLocaleDateString('de-DE'), width - margin, infoY, 10, font);
        infoY -= infoGap;
      }

      if (dueDate) {
        page.drawText('Fällig am:', { x: infoX, y: infoY, size: 10, font: boldFont });
        drawTextRight(new Date(dueDate).toLocaleDateString('de-DE'), width - margin, infoY, 10, font);
        infoY -= infoGap;
      }

      // --- TABLE ---
      y = height - 300;
      
      // Table Config
      const colX = {
        pos: margin,
        desc: margin + 40,
        qty: width - margin - 180,
        price: width - margin - 100,
        total: width - margin
      };

      // Header Background
      page.drawRectangle({
        x: margin,
        y: y - 5,
        width: width - 2 * margin,
        height: 20,
        color: rgb(0.95, 0.95, 0.95),
      });

      // Header Text
      page.drawText('Pos.', { x: colX.pos + 5, y, size: 10, font: boldFont });
      page.drawText('Beschreibung', { x: colX.desc, y, size: 10, font: boldFont });
      drawTextRight('Menge', colX.qty, y, 10, boldFont);
      drawTextRight('Einzelpreis', colX.price, y, 10, boldFont);
      drawTextRight('Gesamt', colX.total - 5, y, 10, boldFont);

      y -= 25;

      // Items
      let totalAmount = 0;
      items.forEach((item, index) => {
        const lineTotal = item.quantity * item.unitPrice;
        totalAmount += lineTotal;

        // Check for page break
        if (y < 100) {
            page.addPage();
            y = height - 50;
        }

        page.drawText((index + 1).toString(), { x: colX.pos + 5, y, size: 10, font });
        page.drawText(item.description, { x: colX.desc, y, size: 10, font });
        drawTextRight(item.quantity.toString(), colX.qty, y, 10, font);
        drawTextRight(formatCurrency(item.unitPrice), colX.price, y, 10, font);
        drawTextRight(formatCurrency(lineTotal), colX.total - 5, y, 10, font);

        // Line separator
        page.drawLine({
            start: { x: margin, y: y - 8 },
            end: { x: width - margin, y: y - 8 },
            thickness: 0.5,
            color: rgb(0.9, 0.9, 0.9),
        });

        y -= 20;
      });

      y -= 10;

      // --- TOTALS ---
      const totalX = width - margin - 5;
      const labelX = width - margin - 100;

      drawTextRight('Netto:', labelX, y, 10, font);
      drawTextRight(formatCurrency(totalAmount), totalX, y, 10, font);
      y -= 15;

      drawTextRight('USt. 0%:', labelX, y, 10, font);
      drawTextRight('0,00 €', totalX, y, 10, font);
      y -= 15;

      // Bold Total Line
      page.drawLine({
        start: { x: labelX - 50, y: y + 10 },
        end: { x: totalX, y: y + 10 },
        thickness: 1,
        color: rgb(0, 0, 0),
      });

      drawTextRight('Gesamtbetrag:', labelX, y, 12, boldFont);
      drawTextRight(formatCurrency(totalAmount), totalX, y, 12, boldFont);
      y -= 40;

      // --- NOTES & LEGAL ---
      if (notes) {
        page.drawText('Anmerkungen:', { x: margin, y, size: 10, font: boldFont });
        y -= 15;
        const noteLines = notes.split('\n');
        noteLines.forEach(line => {
            page.drawText(line, { x: margin, y, size: 10, font });
            y -= 12;
        });
        y -= 20;
      }

      page.drawText('Hinweis: Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.', { x: margin, y, size: 10, font });
      y -= 15;
      
      if (dueDate) {
          page.drawText(`Bitte überweisen Sie den Betrag bis zum ${new Date(dueDate).toLocaleDateString('de-DE')}.`, { x: margin, y, size: 10, font });
      }

      // --- FOOTER ---
      const footerY = 40;
      page.drawLine({
        start: { x: margin, y: footerY + 15 },
        end: { x: width - margin, y: footerY + 15 },
        thickness: 0.5,
        color: rgb(0.7, 0.7, 0.7),
      });

      // --- QR CODE (GiroCode) ---
      if (includeQRCode) {
        if (settings?.iban && settings?.companyName) {
          const iban = settings.iban;
          const bic = settings.bic;
          
          if (iban) {
            // EPC069-12 Standard (GiroCode)
            // 1. Service Tag (BCD)
            // 2. Version (002)
            // 3. Encoding (1 = UTF-8)
            // 4. Transfer (SCT)
            // 5. BIC (optional)
            // 6. Empfänger (max 70 Zeichen)
            // 7. IBAN
            // 8. Betrag (EUR12.50)
            // 9. Zweckcode (leer)
            // 10. Referenz (leer, da Verwendungszweck genutzt wird)
            // 11. Verwendungszweck (max 140 Zeichen)
            // 12. Hinweis (leer)

            // Sicherstellen, dass keine Zeilenumbrüche in den Werten stecken
            const cleanName = (settings.companyName || "").replace(/[\r\n]/g, "").trim();
            // WICHTIG: IBAN darf KEINE Leerzeichen enthalten!
            const finalIban = (iban || "").replace(/\s/g, "").toUpperCase(); 
            
            // SEPA-Zeichensatz erzwingen (Umlaute ersetzen, ungültige Zeichen entfernen)
            const toSEPA = (str: string) => {
                const map: { [key: string]: string } = {
                  'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', 'ß': 'ss'
                };
                let cleaned = str.replace(/[äöüÄÖÜß]/g, m => map[m]);
                // Erlaube nur SEPA-Zeichen: a-z, A-Z, 0-9, / - ? : ( ) . , ' + und Leerzeichen
                cleaned = cleaned.replace(/[^a-zA-Z0-9\/\-\?:\(\)\.,'\+ ]/g, '');
                return cleaned.trim();
            };
            
            // Warnung bei ungültiger IBAN-Länge (DE = 22 Stellen)
            if (finalIban.startsWith('DE') && finalIban.length !== 22) {
               alert(`Warnung: Die IBAN "${finalIban}" hat ${finalIban.length} Stellen. Eine deutsche IBAN muss 22 Stellen haben. Der QR-Code wird möglicherweise nicht funktionieren.`);
            }

            // Manuelle Konstruktion des Strings, um sicherzustellen, dass alle Zeilenumbrüche korrekt sind
            // EPC069-12 Standard - Reduziert auf die wesentlichen Felder (1-8) wie gewünscht
            let giroCodeData = "BCD\n";                                 // 1. Service Tag
            giroCodeData += "002\n";                                    // 2. Version
            giroCodeData += "1\n";                                      // 3. Encoding
            giroCodeData += "SCT\n";                                    // 4. Transfer
            giroCodeData += (bic || "").trim() + "\n";                  // 5. BIC
            giroCodeData += toSEPA(cleanName).substring(0, 70) + "\n";  // 6. Empfänger
            giroCodeData += finalIban + "\n";                           // 7. IBAN
            giroCodeData += `EUR${totalAmount.toFixed(2)}\n`;           // 8. Betrag
            giroCodeData += "\n";                                       // 9. Zweckcode (leer)
            giroCodeData += "\n";                                       // 10. Referenz (leer)
            giroCodeData += toSEPA(invoiceNumber || "").substring(0, 140) + "\n"; // 11. Verwendungszweck

            console.log("GiroCode Payload:", JSON.stringify(giroCodeData));

            try {
              const qrCodeDataUrl = await QRCode.toDataURL(giroCodeData, { 
                errorCorrectionLevel: 'M',
                type: 'image/png',
                margin: 4
              });
              const qrCodeImage = await pdfDoc.embedPng(qrCodeDataUrl);
              const qrDim = 80;
              
              // Position QR code in the bottom right area, above footer
              page.drawImage(qrCodeImage, {
                x: width - margin - qrDim,
                y: footerY + 30,
                width: qrDim,
                height: qrDim,
              });
              
              page.drawText('GiroCode scannen & zahlen', {
                x: width - margin - qrDim,
                y: footerY + 25,
                size: 8,
                font,
                color: rgb(0.4, 0.4, 0.4)
              });
            } catch (err) {
              console.error("Error generating QR code:", err);
              alert("Fehler beim Generieren des QR-Codes.");
            }
          } else {
            console.warn("Keine gültige IBAN gefunden für QR-Code");
            alert("Hinweis: Es konnte keine gültige IBAN in den Einstellungen gefunden werden. Der QR-Code wurde nicht erstellt.");
          }
        } else {
          console.warn("Fehlende Bankdaten oder Firmenname für QR-Code");
          alert("Hinweis: Für den QR-Code fehlen Bankverbindung oder Firmenname in den Einstellungen.");
        }
      }

      let footerTextLeft = "";
      if (settings?.companyName) footerTextLeft += settings.companyName + "\n";
      if (settings?.companyAddress) footerTextLeft += settings.companyAddress;

      let footerTextCenter = "";
      if (settings?.bankName) footerTextCenter += settings.bankName + "\n";
      if (settings?.iban) footerTextCenter += "IBAN: " + settings.iban + "\n";
      if (settings?.bic) footerTextCenter += "BIC: " + settings.bic;

      let footerTextRight = "";
      if (settings?.taxNumber) footerTextRight += "Steuernummer:\n" + settings.taxNumber + "\n";
      if (settings?.footerText) footerTextRight += "\n" + settings.footerText;

      const footerFontSize = 8;
      const footerLineHeight = 10;

      // Draw Footer Columns
      let fy = footerY;
      footerTextLeft.split('\n').forEach(line => {
          page.drawText(line, { x: margin, y: fy, size: footerFontSize, font, color: rgb(0.4, 0.4, 0.4) });
          fy -= footerLineHeight;
      });

      fy = footerY;
      footerTextCenter.split('\n').forEach(line => {
          drawTextCenter(line, width / 2, fy, footerFontSize, font, rgb(0.4, 0.4, 0.4));
          fy -= footerLineHeight;
      });

      fy = footerY;
      footerTextRight.split('\n').forEach(line => {
          drawTextRight(line, width - margin, fy, footerFontSize, font, rgb(0.4, 0.4, 0.4));
          fy -= footerLineHeight;
      });

      // Page Numbers
      // page.drawText(`Seite 1 von 1`, { x: width - margin, y: 20, size: 8, font, color: rgb(0.6, 0.6, 0.6) });

      // --- ZUGFeRD XML Integration ---
      try {
        const zugferdData = {
          invoiceNumber,
          date: new Date(date),
          dueDate: dueDate ? new Date(dueDate) : undefined,
          deliveryDate: deliveryDate ? new Date(deliveryDate) : undefined,
          seller: {
            name: settings?.companyName || '',
            address: settings?.companyAddress || '',
            email: settings?.email,
            telephone: settings?.telephone,
            taxNumber: settings?.taxNumber,
            iban: settings?.iban,
            bic: settings?.bic,
          },
          buyer: {
            name: customerAddress.split('\n')[0] || 'Unbekannt',
            address: customerAddress,
            email: selectedCustomer?.email,
            zipCode: selectedCustomer?.zipCode,
            city: selectedCustomer?.city,
          },
          items: items.map(item => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.quantity * item.unitPrice,
          })),
          totalAmount,
          taxAmount: 0, // Kleinunternehmerregelung
          currency: 'EUR',
        };

        const xmlContent = generateZugferdXml(zugferdData);
        const xmlBytes = new TextEncoder().encode(xmlContent);

        await pdfDoc.attach(xmlBytes, 'factur-x.xml', {
          mimeType: 'text/xml',
          description: 'ZUGFeRD Invoice Data',
          creationDate: new Date(),
          modificationDate: new Date(),
          afRelationship: 'Alternative',
        });

        // Add XMP Metadata for PDF/A-3 compliance (ZUGFeRD requirement)
        const xmpMetadata = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
      <fx:DocumentType>INVOICE</fx:DocumentType>
      <fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>
      <fx:Version>1.0</fx:Version>
      <fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>
      <pdfaExtension:schemas>
        <rdf:Bag>
          <rdf:li rdf:parseType="Resource">
            <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
            <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
            <pdfaSchema:prefix>fx</pdfaSchema:prefix>
            <pdfaSchema:property>
              <rdf:Seq>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>DocumentFileName</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>name of the embedded XML invoice file</pdfaProperty:description>
                </rdf:li>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>DocumentType</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>INVOICE</pdfaProperty:description>
                </rdf:li>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>Version</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>The actual version of the ZUGFeRD data</pdfaProperty:description>
                </rdf:li>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>ConformanceLevel</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>The conformance level of the embedded ZUGFeRD data</pdfaProperty:description>
                </rdf:li>
              </rdf:Seq>
            </pdfaSchema:property>
          </rdf:li>
        </rdf:Bag>
      </pdfaExtension:schemas>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

        const metadataStream = pdfDoc.context.flateStream(xmpMetadata);
        const metadataStreamRef = pdfDoc.context.register(metadataStream);
        pdfDoc.catalog.set(PDFName.of('Metadata'), metadataStreamRef);

      } catch (e) {
        console.error("Error attaching ZUGFeRD XML:", e);
      }

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });

      // Automatic Upload
      const formData = new FormData();
      const fileName = `Rechnung_${invoiceNumber}.pdf`;
      const file = new File([blob], fileName, { type: 'application/pdf' });
      formData.append('file', file);

      let uploadSuccess = false;

      try {
          const uploadRes = await fetch('/api/invoices/upload', {
              method: 'POST',
              body: formData
          });

          if (!uploadRes.ok) {
              const err = await uploadRes.json();
              console.error("Auto-upload failed:", err);
              alert("Speichern fehlgeschlagen: " + (err.error || "Unbekannter Fehler"));
          } else {
              if (onInvoiceCreated) {
                  onInvoiceCreated();
              }
              uploadSuccess = true;
          }
      } catch (e) {
          console.error("Auto-upload network error:", e);
          alert("Fehler beim automatischen Speichern der Rechnung.");
      }

      const url = URL.createObjectURL(blob);
      
      // Open/Download
      const link = document.createElement('a');
      link.href = url;
      link.download = `Rechnung_${invoiceNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      if (uploadSuccess) {
        onClose();
      }
    } catch (error) {
      console.error("Error generating PDF:", error);
      alert("Fehler beim Erstellen der PDF.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Rechnung erstellen</DialogTitle>
          <DialogDescription>
            Erstellen Sie eine professionelle PDF-Rechnung.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 py-4">
          {/* Top Row: Invoice Details */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="invoice-number">Rechnungsnummer</Label>
              <Input 
                id="invoice-number" 
                value={invoiceNumber} 
                onChange={(e) => setInvoiceNumber(e.target.value)} 
                placeholder="RE-2024-001" 
                className={invoiceNumberError ? "border-red-500 focus-visible:ring-red-500" : ""}
              />
              {invoiceNumberError && (
                <p className="text-xs text-red-500 font-medium">{invoiceNumberError}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="date">Rechnungsdatum</Label>
              <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="delivery-date">Leistungsdatum</Label>
              <Input id="delivery-date" type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
             {/* Left: Customer */}
            <div className="space-y-2">
              <Label htmlFor="customer">Empfänger (Name & Anschrift)</Label>
              
              {/* Customer Selection Dropdown */}
              <select 
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                onChange={handleCustomerSelect}
                defaultValue=""
              >
                <option value="" disabled>Kunden auswählen...</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>

              <Textarea 
                id="customer" 
                value={customerAddress} 
                onChange={(e) => setCustomerAddress(e.target.value)} 
                placeholder="Musterfirma GmbH&#10;Musterstraße 1&#10;12345 Musterstadt"
                className="min-h-[100px]"
              />
            </div>
            
            {/* Right: Payment Terms */}
            <div className="space-y-2">
              <Label htmlFor="due-date">Fälligkeitsdatum</Label>
              <Input id="due-date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              <Label htmlFor="notes" className="mt-2 block">Anmerkungen (Optional)</Label>
              <Textarea 
                id="notes" 
                value={notes} 
                onChange={(e) => setNotes(e.target.value)} 
                placeholder="Vielen Dank für Ihren Auftrag!"
                className="min-h-[60px]"
              />
              
              <div className="flex items-center space-x-2 mt-4">
                <input
                  type="checkbox"
                  id="includeQRCode"
                  checked={includeQRCode}
                  onChange={(e) => setIncludeQRCode(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <Label htmlFor="includeQRCode" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                  GiroCode (QR-Code) für Banking-Apps hinzufügen
                </Label>
              </div>
            </div>
          </div>
          
          {/* Items Table */}
          <div className="space-y-2">
            <Label>Positionen</Label>
            <div className="border rounded-md overflow-hidden">
                <div className="grid grid-cols-[1fr_80px_100px_auto] gap-2 bg-muted p-2 text-sm font-medium">
                    <div>Beschreibung</div>
                    <div className="text-right">Menge</div>
                    <div className="text-right">Einzelpreis</div>
                    <div className="w-10"></div>
                </div>
                <div className="divide-y">
                    {items.map((item, index) => (
                    <div key={index} className="grid grid-cols-[1fr_80px_100px_auto] gap-2 p-2 items-start">
                        <Input 
                        value={item.description} 
                        onChange={(e) => updateItem(index, 'description', e.target.value)} 
                        placeholder="Leistung / Produkt" 
                        />
                        <Input 
                        type="number" 
                        value={item.quantity} 
                        onChange={(e) => updateItem(index, 'quantity', e.target.value)} 
                        placeholder="1" 
                        className="text-right"
                        />
                        <Input 
                        type="number" 
                        value={item.unitPrice} 
                        onChange={(e) => updateItem(index, 'unitPrice', e.target.value)} 
                        placeholder="0.00" 
                        className="text-right"
                        />
                        <Button variant="ghost" size="icon" onClick={() => removeItem(index)} disabled={items.length === 1} className="text-destructive hover:text-destructive">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        </Button>
                    </div>
                    ))}
                </div>
            </div>
            <div className="flex justify-between items-center mt-2">
                <Button type="button" variant="outline" size="sm" onClick={addItem}>
                + Position hinzufügen
                </Button>
                <div className="text-right font-bold">
                    Gesamt: {items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button onClick={generatePDF} disabled={isGenerating || !customerAddress || !invoiceNumber || !!invoiceNumberError || isCheckingNumber}>
            {isGenerating ? "Erstelle PDF..." : "PDF erstellen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
