"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PDFDocument, StandardFonts, rgb, PDFFont } from 'pdf-lib';
import { Eye, EyeOff, FileText, Loader2, RefreshCw } from "lucide-react";

interface CreateQuoteModalProps {
    isOpen: boolean;
    onClose: () => void;
    onQuoteCreated?: () => void;
}

interface QuoteItem {
    description: string;
    quantity: number;
    unitPrice: number;
    unit: string;
    taxRate: number;
}

interface Settings {
    companyName?: string;
    companyAddress?: string;
    taxNumber?: string;
    iban?: string;
    bic?: string;
    bankName?: string;
    footerText?: string;
    logoUrl?: string;
    email?: string;
    telephone?: string;
}

interface Customer {
    id: number | string;
    name: string;
    address?: string;
    zipCode?: string;
    city?: string;
    email?: string;
}

export function CreateQuoteModal({ isOpen, onClose, onQuoteCreated }: CreateQuoteModalProps) {
    const [customerAddress, setCustomerAddress] = useState("");
    const [quoteNumber, setQuoteNumber] = useState("");
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [validUntil, setValidUntil] = useState("");
    const [notes, setNotes] = useState("");
    const [items, setItems] = useState<QuoteItem[]>([{ description: "", quantity: 1, unitPrice: 0, unit: "Stück", taxRate: 0 }]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [settings, setSettings] = useState<Settings | null>(null);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

    // Preview states
    const [showPreview, setShowPreview] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
    const previewTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (isOpen) {
            const today = new Date();
            const in30Days = new Date(today);
            in30Days.setDate(today.getDate() + 30);
            setValidUntil(in30Days.toISOString().split('T')[0]);
            setDate(today.toISOString().split('T')[0]);

            fetch("/api/settings")
                .then(res => res.json())
                .then(data => setSettings(data))
                .catch(err => console.error("Failed to load settings", err));

            fetch("/api/customers")
                .then(res => res.json())
                .then(data => setCustomers(Array.isArray(data) ? data : []))
                .catch(err => console.error("Failed to load customers", err));

            fetch("/api/quotes/next-number")
                .then(res => res.json())
                .then(data => {
                    if (data.nextQuoteNumber) setQuoteNumber(data.nextQuoteNumber);
                })
                .catch(err => console.error("Failed to load next quote number", err));
        }
    }, [isOpen]);

    // Reset on close
    useEffect(() => {
        if (!isOpen) {
            setCustomerAddress("");
            setQuoteNumber("");
            setNotes("");
            setItems([{ description: "", quantity: 1, unitPrice: 0, unit: "Stück", taxRate: 0 }]);
            setSelectedCustomer(null);
            setShowPreview(false);
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            setPreviewUrl(null);
        }
    }, [isOpen, previewUrl]);

    const handleCustomerSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const customerId = e.target.value;
        if (!customerId) return;
        const customer = customers.find(c => c.id.toString() === customerId);
        if (customer) {
            setSelectedCustomer(customer);
            let addressBlock = customer.name;
            if (customer.address) addressBlock += `\n${customer.address}`;
            const cityLine = `${customer.zipCode || ''} ${customer.city || ''}`.trim();
            if (cityLine) addressBlock += `\n${cityLine}`;
            setCustomerAddress(addressBlock);
        }
    };

    const addItem = () => setItems([...items, { description: "", quantity: 1, unitPrice: 0, unit: "Stück", taxRate: 0 }]);

    const updateItem = (index: number, field: keyof QuoteItem, value: string | number) => {
        const newItems = [...items];
        if (field === 'quantity' || field === 'unitPrice' || field === 'taxRate') {
            newItems[index] = { ...newItems[index], [field]: Number(value) };
        } else {
            newItems[index] = { ...newItems[index], [field]: value };
        }
        setItems(newItems);
    };

    const removeItem = (index: number) => setItems(items.filter((_, i) => i !== index));

    const duplicateItem = (index: number) => {
        const newItems = [...items];
        newItems.splice(index + 1, 0, { ...items[index] });
        setItems(newItems);
    };

    const formatCurrency = useCallback((amount: number) =>
        amount.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €',
        []);

    const generatePDFBytes = useCallback(async (): Promise<Uint8Array> => {
        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage();
        const { width, height } = page.getSize();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

        const accentColor = rgb(0.2, 0.2, 0.2);
        const primaryColor = rgb(0, 0, 0);
        const secondaryColor = rgb(0.4, 0.4, 0.4);
        const lightBg = rgb(0.96, 0.96, 0.96);
        // Distinct green accent for the ANGEBOT header to visually differentiate from invoices
        const quoteAccent = rgb(0.1, 0.45, 0.2);

        const drawTextRight = (text: string, x: number, y: number, size: number, fontToUse: PDFFont = font, color = rgb(0, 0, 0)) => {
            const textWidth = fontToUse.widthOfTextAtSize(text, size);
            page.drawText(text, { x: x - textWidth, y, size, font: fontToUse, color });
        };

        const drawTextCenter = (text: string, x: number, y: number, size: number, fontToUse: PDFFont = font, color = rgb(0, 0, 0)) => {
            const textWidth = fontToUse.widthOfTextAtSize(text, size);
            page.drawText(text, { x: x - textWidth / 2, y, size, font: fontToUse, color });
        };

        let y = height - 50;
        const margin = 50;

        // Top Accent Bar – green for quotes
        page.drawRectangle({ x: 0, y: height - 8, width, height: 8, color: quoteAccent });

        // Logo
        if (settings?.logoUrl) {
            try {
                const logoBytes = await fetch(settings.logoUrl).then(res => res.arrayBuffer());
                const logoExt = settings.logoUrl.split('.').pop()?.toLowerCase();
                let logoImage;
                if (logoExt === 'png') logoImage = await pdfDoc.embedPng(logoBytes);
                else if (logoExt === 'jpg' || logoExt === 'jpeg') logoImage = await pdfDoc.embedJpg(logoBytes);
                if (logoImage) {
                    const scale = Math.min(180 / logoImage.width, 80 / logoImage.height);
                    const logoDims = logoImage.scale(scale);
                    page.drawImage(logoImage, { x: width - margin - logoDims.width, y: height - margin - logoDims.height + 10, ...logoDims });
                }
            } catch { /* ignore logo errors */ }
        }

        // Sender line
        const senderLineY = height - 125;
        if (settings?.companyName) {
            let senderText = settings.companyName;
            if (settings?.companyAddress) {
                const parts = settings.companyAddress.split('\n');
                senderText += ` • ${parts[0]}`;
                if (parts[1]) senderText += ` • ${parts.slice(1).join(' ')}`;
            }
            page.drawText(senderText, { x: margin, y: senderLineY, size: 7, font, color: secondaryColor });
            const w = font.widthOfTextAtSize(senderText, 7);
            page.drawLine({ start: { x: margin, y: senderLineY - 2 }, end: { x: margin + w, y: senderLineY - 2 }, thickness: 0.5, color: secondaryColor });
        }

        // Address field
        let addressY = senderLineY - 15;
        customerAddress.split('\n').forEach(line => {
            page.drawText(line, { x: margin, y: addressY, size: 11, font, color: primaryColor });
            addressY -= 15;
        });

        // Info box (right side) – ANGEBOT header
        let infoY = senderLineY - 20;
        const infoX = width - margin - 200;
        const infoBoxHeight = 120;
        const infoBoxWidth = 210;
        const infoBoxBottom = infoY - 105;

        page.drawRectangle({ x: infoX - 10, y: infoBoxBottom, width: infoBoxWidth, height: infoBoxHeight, color: rgb(0.97, 0.99, 0.97) });
        page.drawRectangle({ x: infoX - 10, y: infoBoxBottom, width: 3, height: infoBoxHeight, color: quoteAccent });

        page.drawText('ANGEBOT', { x: infoX, y: infoY, size: 16, font: boldFont, color: quoteAccent });
        infoY -= 25;

        const infoGap = 16;
        const drawInfoRow = (label: string, value: string) => {
            page.drawText(label, { x: infoX, y: infoY, size: 9, font, color: secondaryColor });
            drawTextRight(value, width - margin - 10, infoY, 9, boldFont, primaryColor);
            infoY -= infoGap;
        };

        drawInfoRow('Angebots-Nr.:', quoteNumber || 'AN-XXXX');
        drawInfoRow('Datum:', date ? new Date(date).toLocaleDateString('de-DE') : '-');
        if (selectedCustomer?.id) drawInfoRow('Kundennummer:', selectedCustomer.id.toString());
        if (validUntil) drawInfoRow('Gültig bis:', new Date(validUntil).toLocaleDateString('de-DE'));

        // Items table
        y = height - 300;
        const colX = {
            pos: margin,
            desc: margin + 30,
            qty: width - margin - 260,
            unit: width - margin - 230,
            price: width - margin - 130,
            tax: width - margin - 70,
            total: width - margin
        };

        page.drawRectangle({ x: margin, y: y - 5, width: width - 2 * margin, height: 20, color: lightBg });
        page.drawText('Pos.', { x: colX.pos + 5, y, size: 9, font: boldFont, color: accentColor });
        page.drawText('Beschreibung', { x: colX.desc, y, size: 9, font: boldFont, color: accentColor });
        drawTextRight('Menge', colX.qty, y, 9, boldFont, accentColor);
        page.drawText('Einh.', { x: colX.unit, y, size: 9, font: boldFont, color: accentColor });
        drawTextRight('Preis', colX.price, y, 9, boldFont, accentColor);
        drawTextRight('MwSt', colX.tax, y, 9, boldFont, accentColor);
        drawTextRight('Gesamt', colX.total - 5, y, 9, boldFont, accentColor);
        y -= 25;

        let netTotal = 0;
        let taxTotal = 0;

        items.forEach((item, index) => {
            const lineNet = item.quantity * item.unitPrice;
            const lineTax = lineNet * (item.taxRate / 100);
            netTotal += lineNet;
            taxTotal += lineTax;

            const maxDescWidth = colX.qty - colX.desc - 10;
            const words = (item.description || 'Position').split(' ');
            const descLines: string[] = [];
            let currentLine = words[0] || '';
            for (let i = 1; i < words.length; i++) {
                const testLine = currentLine + " " + words[i];
                if (font.widthOfTextAtSize(testLine, 10) < maxDescWidth) {
                    currentLine = testLine;
                } else {
                    descLines.push(currentLine);
                    currentLine = words[i];
                }
            }
            descLines.push(currentLine);

            const lineHeight = 12;
            const itemHeight = Math.max(20, descLines.length * lineHeight + 8);

            if (index % 2 === 0) {
                page.drawRectangle({ x: margin, y: y - itemHeight + 12, width: width - 2 * margin, height: itemHeight, color: rgb(0.98, 0.99, 0.98) });
            }

            page.drawText((index + 1).toString(), { x: colX.pos + 5, y, size: 10, font, color: secondaryColor });
            descLines.forEach((line, i) => page.drawText(line, { x: colX.desc, y: y - (i * lineHeight), size: 10, font, color: primaryColor }));
            drawTextRight(item.quantity.toString(), colX.qty, y, 10, font, primaryColor);
            page.drawText(item.unit, { x: colX.unit, y, size: 10, font, color: primaryColor });
            drawTextRight(formatCurrency(item.unitPrice), colX.price, y, 10, font, primaryColor);
            drawTextRight(`${item.taxRate}%`, colX.tax, y, 10, font, primaryColor);
            drawTextRight(formatCurrency(lineNet), colX.total - 5, y, 10, font, primaryColor);

            const separatorY = y - ((descLines.length - 1) * lineHeight) - 8;
            page.drawLine({ start: { x: margin, y: separatorY }, end: { x: width - margin, y: separatorY }, thickness: 0.5, color: rgb(0.92, 0.92, 0.92) });
            y = separatorY - 12;
        });

        y -= 10;

        // Totals
        const totalX = width - margin;
        const labelX = totalX - 90;
        const grossTotal = netTotal + taxTotal;

        page.drawLine({ start: { x: labelX - 40, y: y + 5 }, end: { x: totalX, y: y + 5 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
        y -= 15;
        drawTextRight('Netto:', labelX, y, 10, font);
        drawTextRight(formatCurrency(netTotal), totalX, y, 10, font);
        y -= 15;

        if (taxTotal > 0) {
            drawTextRight('zzgl. USt.:', labelX, y, 10, font);
            drawTextRight(formatCurrency(taxTotal), totalX, y, 10, font);
        } else {
            drawTextRight('zzgl. USt. 0%:', labelX, y, 10, font);
            drawTextRight('0,00 €', totalX, y, 10, font);
        }
        y -= 20;

        const totalLabel = 'Angebotssumme:';
        const totalLabelWidth = boldFont.widthOfTextAtSize(totalLabel, 12);
        const totalLineStart = labelX - totalLabelWidth;
        page.drawLine({ start: { x: totalLineStart, y: y + 12 }, end: { x: totalX, y: y + 12 }, thickness: 1, color: quoteAccent });
        drawTextRight(totalLabel, labelX, y, 12, boldFont);
        drawTextRight(formatCurrency(grossTotal), totalX, y, 12, boldFont);
        y -= 4;
        page.drawLine({ start: { x: totalLineStart, y: y }, end: { x: totalX, y: y }, thickness: 0.5, color: quoteAccent });
        page.drawLine({ start: { x: totalLineStart, y: y - 2 }, end: { x: totalX, y: y - 2 }, thickness: 0.5, color: quoteAccent });

        y -= 30;

        // Notes
        if (notes) {
            page.drawText('Anmerkungen:', { x: margin, y, size: 10, font: boldFont });
            y -= 15;
            notes.split('\n').forEach(line => { page.drawText(line, { x: margin, y, size: 10, font }); y -= 12; });
            y -= 10;
        }

        // Legal note for Kleinunternehmer
        if (taxTotal === 0) {
            page.drawText('Hinweis: Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.', { x: margin, y, size: 10, font });
            y -= 15;
        }

        // Validity note
        if (validUntil) {
            page.drawText(`Dieses Angebot ist gültig bis zum ${new Date(validUntil).toLocaleDateString('de-DE')}.`, { x: margin, y, size: 10, font });
            y -= 12;
        }
        page.drawText('Bitte bestätigen Sie dieses Angebot schriftlich.', { x: margin, y, size: 10, font, color: secondaryColor });

        // Footer
        const footerY = 60;
        page.drawLine({ start: { x: margin, y: footerY + 15 }, end: { x: width - margin, y: footerY + 15 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });

        let footerLeft = "";
        if (settings?.companyName) footerLeft += settings.companyName + "\n";
        if (settings?.companyAddress) footerLeft += settings.companyAddress;

        let footerCenter = "";
        if (settings?.bankName) footerCenter += settings.bankName + "\n";
        if (settings?.iban) footerCenter += "IBAN: " + settings.iban + "\n";
        if (settings?.bic) footerCenter += "BIC: " + settings.bic;

        let footerRight = "";
        if (settings?.taxNumber) footerRight += "Steuernummer:\n" + settings.taxNumber + "\n";
        if (settings?.footerText) footerRight += "\n" + settings.footerText;

        const footerFontSize = 8;
        const footerLineHeight = 10;

        let fy = footerY;
        footerLeft.split('\n').forEach(line => { page.drawText(line, { x: margin, y: fy, size: footerFontSize, font, color: rgb(0.4, 0.4, 0.4) }); fy -= footerLineHeight; });
        fy = footerY;
        footerCenter.split('\n').forEach(line => { drawTextCenter(line, width / 2, fy, footerFontSize, font, rgb(0.4, 0.4, 0.4)); fy -= footerLineHeight; });
        fy = footerY;
        footerRight.split('\n').forEach(line => { drawTextRight(line, width - margin, fy, footerFontSize, font, rgb(0.4, 0.4, 0.4)); fy -= footerLineHeight; });

        // Page number
        const pageCount = pdfDoc.getPageCount();
        pdfDoc.getPages().forEach((p, i) => {
            const { width: pw } = p.getSize();
            const text = `Seite ${i + 1} von ${pageCount}`;
            p.drawText(text, { x: (pw - font.widthOfTextAtSize(text, 8)) / 2, y: 15, size: 8, font, color: secondaryColor });
        });

        return await pdfDoc.save();
    }, [customerAddress, quoteNumber, date, validUntil, notes, items, settings, selectedCustomer, formatCurrency]);

    // Live preview
    const generatePreview = useCallback(async () => {
        if (!showPreview) return;
        setIsGeneratingPreview(true);
        try {
            const pdfBytes = await generatePDFBytes();
            const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            setPreviewUrl(URL.createObjectURL(blob));
        } catch (error) {
            console.error("Error generating preview:", error);
        } finally {
            setIsGeneratingPreview(false);
        }
    }, [showPreview, generatePDFBytes, previewUrl]);

    useEffect(() => {
        if (!showPreview) return;
        if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
        previewTimeoutRef.current = setTimeout(generatePreview, 500);
        return () => { if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current); };
    }, [showPreview, customerAddress, quoteNumber, date, validUntil, notes, items, settings, selectedCustomer, generatePreview]);

    useEffect(() => {
        if (showPreview && !previewUrl) generatePreview();
    }, [showPreview, previewUrl, generatePreview]);

    const handleGenerateAndSave = async () => {
        setIsGenerating(true);
        try {
            const pdfBytes = await generatePDFBytes();
            const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
            const fileName = `Angebot_${quoteNumber}.pdf`;

            // Convert to base64 for API
            const reader = new FileReader();
            const base64Promise = new Promise<string>((resolve) => {
                reader.onload = () => resolve((reader.result as string).split(',')[1]);
                reader.readAsDataURL(blob);
            });
            const pdfBase64 = await base64Promise;

            // Calculate total
            let netTotal = 0;
            let taxTotal = 0;
            items.forEach(item => {
                const lineNet = item.quantity * item.unitPrice;
                netTotal += lineNet;
                taxTotal += lineNet * (item.taxRate / 100);
            });
            const totalAmount = netTotal + taxTotal;

            const parsedData = {
                quoteNumber,
                items,
                notes,
                customerAddress,
                date,
                validUntil,
                totalAmount,
                createdBy: 'bivaro',
            };

            const res = await fetch('/api/quotes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fileName,
                    quoteNumber,
                    quoteDate: date,
                    validUntil,
                    totalAmount,
                    customerId: selectedCustomer?.id,
                    parsedData,
                    pdfBytes: pdfBase64,
                }),
            });

            if (!res.ok) {
                const err = await res.json();
                alert('Fehler beim Speichern des Angebots: ' + (err.error || 'Unbekannter Fehler'));
                return;
            }

            // Also trigger download
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            if (onQuoteCreated) onQuoteCreated();
            onClose();
        } catch (error) {
            console.error("Error generating quote PDF:", error);
            alert("Fehler beim Erstellen des Angebots.");
        } finally {
            setIsGenerating(false);
        }
    };

    const netTotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className={`max-h-[90vh] overflow-hidden ${showPreview ? 'sm:max-w-[1400px]' : 'sm:max-w-[800px]'}`}>
                <DialogHeader className="pb-2">
                    <div className="flex items-center justify-between">
                        <div>
                            <DialogTitle>Angebot erstellen</DialogTitle>
                            <DialogDescription>
                                Erstellen Sie ein professionelles PDF-Angebot.
                            </DialogDescription>
                        </div>
                        <Button
                            variant={showPreview ? "default" : "outline"}
                            size="sm"
                            onClick={() => setShowPreview(!showPreview)}
                            className="gap-2"
                        >
                            {showPreview ? (
                                <><EyeOff className="h-4 w-4" /> Vorschau ausblenden</>
                            ) : (
                                <><Eye className="h-4 w-4" /> Live-Vorschau</>
                            )}
                        </Button>
                    </div>
                </DialogHeader>

                <div className={`grid gap-6 ${showPreview ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    {/* Form */}
                    <div className="overflow-y-auto max-h-[calc(90vh-180px)] pr-2 space-y-6 py-4">
                        {/* Header row */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="quote-number">Angebotsnummer</Label>
                                <Input
                                    id="quote-number"
                                    value={quoteNumber}
                                    onChange={(e) => setQuoteNumber(e.target.value)}
                                    placeholder="AN-2026-01"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="quote-date">Angebotsdatum</Label>
                                <Input id="quote-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="valid-until">Gültig bis</Label>
                                <Input id="valid-until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Customer */}
                            <div className="space-y-2">
                                <Label htmlFor="customer">Empfänger (Name & Anschrift)</Label>
                                <select
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                                    placeholder={"Musterfirma GmbH\nMusterstraße 1\n12345 Musterstadt"}
                                    className="min-h-[100px]"
                                />
                            </div>

                            {/* Notes */}
                            <div className="space-y-2">
                                <Label htmlFor="notes">Anmerkungen (Optional)</Label>
                                <Textarea
                                    id="notes"
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    placeholder="Vielen Dank für Ihre Anfrage! Dieses Angebot ist freibleibend."
                                    className="min-h-[100px]"
                                />
                            </div>
                        </div>

                        {/* Items Table */}
                        <div className="space-y-2">
                            <Label>Positionen</Label>
                            <div className="border rounded-md overflow-hidden">
                                <div className="grid grid-cols-[1fr_70px_90px_100px_70px_90px] gap-2 bg-muted p-2 text-sm font-medium items-center">
                                    <div className="pl-2">Beschreibung</div>
                                    <div className="text-center">Menge</div>
                                    <div className="text-center">Einheit</div>
                                    <div className="text-center">Einzelpreis</div>
                                    <div className="text-center">Steuer</div>
                                    <div></div>
                                </div>
                                <div className="divide-y">
                                    {items.map((item, index) => (
                                        <div key={index} className="grid grid-cols-[1fr_70px_90px_100px_70px_90px] gap-2 p-2 items-start">
                                            <Input
                                                value={item.description}
                                                onChange={(e) => updateItem(index, 'description', e.target.value)}
                                                placeholder="Leistung / Produkt"
                                            />
                                            <Input
                                                type="number"
                                                value={item.quantity}
                                                onChange={(e) => updateItem(index, 'quantity', e.target.value)}
                                                className="text-right"
                                            />
                                            <select
                                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                                value={item.unit}
                                                onChange={(e) => updateItem(index, 'unit', e.target.value)}
                                            >
                                                <option value="Stück">Stück</option>
                                                <option value="Stunde">Stunde</option>
                                                <option value="Tag">Tag</option>
                                                <option value="Pauschal">Pauschal</option>
                                            </select>
                                            <Input
                                                type="number"
                                                value={item.unitPrice}
                                                onChange={(e) => updateItem(index, 'unitPrice', e.target.value)}
                                                className="text-right"
                                            />
                                            <div className="relative">
                                                <Input
                                                    type="number"
                                                    value={item.taxRate}
                                                    onChange={(e) => updateItem(index, 'taxRate', e.target.value)}
                                                    className="text-right pr-6"
                                                />
                                                <span className="absolute right-2 top-2.5 text-sm text-muted-foreground">%</span>
                                            </div>
                                            <div className="flex gap-1">
                                                <Button variant="ghost" size="icon" onClick={() => duplicateItem(index)} title="Duplizieren" className="text-muted-foreground hover:text-foreground">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                    </svg>
                                                </Button>
                                                <Button variant="ghost" size="icon" onClick={() => removeItem(index)} disabled={items.length === 1} className="text-destructive hover:text-destructive">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                    </svg>
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <Button type="button" variant="outline" size="sm" onClick={addItem}>
                                    + Position hinzufügen
                                </Button>
                                <div className="text-right font-bold">
                                    Gesamt: {netTotal.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Preview */}
                    {showPreview && (
                        <div className="border-l pl-4 flex flex-col h-[calc(90vh-180px)]">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <FileText className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-sm font-medium">Angebots-Vorschau</span>
                                </div>
                                <Button variant="ghost" size="sm" onClick={generatePreview} disabled={isGeneratingPreview} className="h-7 text-xs gap-1">
                                    {isGeneratingPreview ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                                    Aktualisieren
                                </Button>
                            </div>
                            <div className="flex-1 rounded-lg border bg-muted/30 overflow-hidden relative">
                                {isGeneratingPreview && !previewUrl && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
                                        <div className="flex flex-col items-center gap-2">
                                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                                            <span className="text-sm text-muted-foreground">Vorschau wird generiert...</span>
                                        </div>
                                    </div>
                                )}
                                {previewUrl ? (
                                    <iframe src={previewUrl} className="w-full h-full border-0" title="Angebotsvorschau" />
                                ) : !isGeneratingPreview && (
                                    <div className="flex items-center justify-center h-full">
                                        <div className="text-center text-muted-foreground">
                                            <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
                                            <p className="text-sm">Füllen Sie das Formular aus,</p>
                                            <p className="text-sm">um die Vorschau zu sehen.</p>
                                        </div>
                                    </div>
                                )}
                                {isGeneratingPreview && previewUrl && (
                                    <div className="absolute top-2 right-2 bg-background/90 rounded-md px-2 py-1 text-xs text-muted-foreground flex items-center gap-1">
                                        <Loader2 className="h-3 w-3 animate-spin" /> Aktualisiere...
                                    </div>
                                )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-2">
                                Die Vorschau aktualisiert sich automatisch bei Änderungen.
                            </p>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Abbrechen</Button>
                    <Button
                        onClick={handleGenerateAndSave}
                        disabled={isGenerating || !customerAddress || !quoteNumber}
                    >
                        {isGenerating ? "Erstelle Angebot..." : "Angebot erstellen & speichern"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
