/* Hallmark · genre: modern-minimal · macrostructure: Workbench · theme: Bivaro Ledger
 * tone: utilitarian · anchor hue: evergreen · enrichment: none
 * pre-emit critique: P5 H5 E4 S5 R5 V4 · contrast: pass (40–41)
 * honest: pass (46) · chrome: pass (47) · tokens: pass (48) · mobile: pass (34, 49–57)
 */
"use client";
import { ServiceArticlePicker } from "@/components/dashboard/service-article-picker";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PDFDocument, StandardFonts, rgb, PDFFont } from 'pdf-lib';
import { ArrowLeft, Copy, Eye, EyeOff, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { DocumentTaxProfileFields } from "@/components/dashboard/document-tax-profile-fields";
import { type DocumentFiscalSettings, type DocumentTaxMode, type DocumentTaxSelection, type DocumentTaxCase, resolveDocumentTaxState, isSupportedDocumentTaxCase } from "@/lib/document-tax-profile";
import { cn } from "@/lib/utils";
import styles from "@/components/dashboard/sales-workspace.module.css";

interface QuoteEditorProps {
    onCancel: () => void;
    onQuoteCreated?: () => void;
    variant?: "page" | "dialog";
    onPreviewVisibilityChange?: (isVisible: boolean) => void;
}

export interface QuoteItem {
    description: string;
    quantity: number;
    unitPrice: number;
    unit: string;
    taxRate: number;
}

interface Settings extends DocumentFiscalSettings {
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

export function QuoteEditor({
    onCancel,
    onQuoteCreated,
    variant = "page",
    onPreviewVisibilityChange,
}: QuoteEditorProps) {
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

    const [taxSelection, setTaxSelection] = useState<DocumentTaxSelection | null>(null);
    const [taxAcknowledged, setTaxAcknowledged] = useState(false);
    const [taxCase, setTaxCase] = useState<DocumentTaxCase>('domestic');
    const taxState = resolveDocumentTaxState(settings, date, taxSelection, taxAcknowledged);
    const taxMode = taxState.mode;
    const taxReady = taxState.ready && isSupportedDocumentTaxCase(taxCase, false, false);

    const handleTaxModeChange = (mode: DocumentTaxMode | '') => {
        setTaxSelection({ mode, source: 'manual' });
        setTaxAcknowledged(false);
        if (mode === 'small-business') setItems(current => current.map(item => ({ ...item, taxRate: 0 })));
        else if (mode === 'standard' && (taxMode === 'small-business' || !taxSelection)) {
            setItems(current => current.map(item => item.taxRate === 0 ? { ...item, taxRate: 19 } : item));
        }
    };

    useEffect(() => {
        if (taxState.source !== 'profile') return;
        setItems(current => current.map(item => taxMode === 'small-business'
            ? { ...item, taxRate: 0 }
            : item.taxRate === 0 ? { ...item, taxRate: 19 } : item));
    }, [taxMode, taxState.source]);

    // Preview states
    const [showPreview, setShowPreview] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
    const previewTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const previewUrlRef = useRef<string | null>(null);
    const previewGenerationRef = useRef(0);

    useEffect(() => {
        const today = new Date();
        const in30Days = new Date(today);
        in30Days.setDate(today.getDate() + 30);
        setValidUntil(in30Days.toISOString().split('T')[0]);
        setDate(today.toISOString().split('T')[0]);

        let active = true;
        fetch("/api/settings", { cache: "no-store" })
            .then(res => { if (!res.ok) throw new Error("Firmenprofil konnte nicht geladen werden"); return res.json(); })
            .then(data => { if (active) setSettings(data); })
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
        return () => { active = false; };
    }, []);

    useEffect(() => {
        onPreviewVisibilityChange?.(showPreview);
    }, [onPreviewVisibilityChange, showPreview]);

    useEffect(() => () => {
        previewGenerationRef.current += 1;
        if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    }, []);

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

    const addItem = () => setItems([...items, { description: "", quantity: 1, unitPrice: 0, unit: "Stück", taxRate: taxMode === 'standard' ? 19 : 0 }]);

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
        if (!taxReady) throw new Error("Bitte zuerst Steuerbehandlung und unterstützten Steuerfall bestätigen.");
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
            const descLines: string[] = [];
            // Preserve the explicit line breaks supported by the description editor.
            for (const paragraph of (item.description || 'Position').split(/\r?\n/)) {
                const words = paragraph.split(' ');
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
            }

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
        if (taxMode === 'small-business') {
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
    }, [customerAddress, quoteNumber, date, validUntil, notes, items, settings, selectedCustomer, formatCurrency, taxMode, taxReady]);

    // Live preview
    const generatePreview = useCallback(async () => {
        if (!showPreview || !taxReady) return;
        const generationId = ++previewGenerationRef.current;
        setIsGeneratingPreview(true);
        try {
            const pdfBytes = await generatePDFBytes();
            if (previewGenerationRef.current !== generationId) return;
            const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
            if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
            const nextPreviewUrl = URL.createObjectURL(blob);
            previewUrlRef.current = nextPreviewUrl;
            setPreviewUrl(nextPreviewUrl);
        } catch (error) {
            console.error("Error generating preview:", error);
        } finally {
            if (previewGenerationRef.current === generationId) setIsGeneratingPreview(false);
        }
    }, [showPreview, generatePDFBytes, taxReady]);

    useEffect(() => {
        if (!showPreview) return;
        if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
        previewTimeoutRef.current = setTimeout(generatePreview, 500);
        return () => { if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current); };
    }, [showPreview, customerAddress, quoteNumber, date, validUntil, notes, items, settings, selectedCustomer, generatePreview]);

    useEffect(() => {
        if (showPreview && taxReady) return;
        previewGenerationRef.current += 1;
        if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
        setPreviewUrl(null);
        setIsGeneratingPreview(false);
    }, [showPreview, taxReady]);

    const handleGenerateAndSave = async () => {
        if (!taxReady) return;
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
                taxMode,
                taxCase,
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
            onCancel();
        } catch (error) {
            console.error("Error generating quote PDF:", error);
            alert("Fehler beim Erstellen des Angebots.");
        } finally {
            setIsGenerating(false);
        }
    };

    // Mirror the existing PDF/save arithmetic so the displayed and saved quote agree.
    const netTotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const taxTotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice * (item.taxRate / 100), 0);
    const displayAmount = (amount: number) => Number.isFinite(amount) ? formatCurrency(amount) : '–';

    return (
        <section aria-labelledby="quote-editor-title" className={cn(styles.editor, variant === "dialog" && styles.dialogEditor)}>
            <header className={styles.editorHeader}>
                <div className="flex min-w-0 items-center gap-2">
                    <Button variant="ghost" size="icon" aria-label="Zurück zu Angeboten" className="shrink-0 text-muted-foreground" onClick={onCancel}>
                        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    {variant === "page" ? <h1 id="quote-editor-title">Neues Angebot</h1> : <h2 id="quote-editor-title">Angebot erstellen</h2>}
                </div>
                <Button variant="outline" onClick={() => setShowPreview(!showPreview)} aria-pressed={showPreview} className="gap-2">
                    {showPreview ? <><EyeOff className="h-4 w-4" aria-hidden="true" />Vorschau ausblenden</> : <><Eye className="h-4 w-4" aria-hidden="true" />Live-Vorschau</>}
                </Button>
            </header>
            <div className={styles.editorGrid}>
                <div className={styles.editorMain}>
                    <DocumentTaxProfileFields id="quote" settings={settings} issueDate={date} selection={taxSelection} acknowledged={taxAcknowledged} onAcknowledged={setTaxAcknowledged} onModeChange={handleTaxModeChange} taxCase={taxCase} onTaxCaseChange={setTaxCase} />
                    <section className={styles.section} aria-labelledby="quote-recipient-title">
                        <div className={styles.sectionHeading}><div><h2 id="quote-recipient-title">Empfänger</h2></div></div>
                        <div className="space-y-3">
                            <Label htmlFor="quote-customer-select">Gespeicherter Kunde</Label>
                            <select id="quote-customer-select" className={styles.select} onChange={handleCustomerSelect} defaultValue="" aria-label="Gespeicherten Kunden auswählen">
                                <option value="" disabled>Kunden auswählen...</option>
                                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                            <Label htmlFor="customer">Empfänger (Name & Anschrift)</Label>
                            <Textarea id="customer" value={customerAddress} onChange={e => setCustomerAddress(e.target.value)} placeholder={"Musterfirma GmbH\nMusterstraße 1\n12345 Musterstadt"} className="min-h-28" />
                        </div>
                    </section>
                    <section className={styles.section} aria-labelledby="quote-document-title">
                        <div className={styles.sectionHeading}><h2 id="quote-document-title">Angebotsdaten</h2></div>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2 sm:col-span-2"><Label htmlFor="quote-number">Angebotsnummer</Label><Input id="quote-number" value={quoteNumber} onChange={e => setQuoteNumber(e.target.value)} placeholder="AN-2026-01" /></div>
                            <div className="space-y-2"><Label htmlFor="quote-date">Angebotsdatum</Label><Input id="quote-date" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
                            <div className="space-y-2"><Label htmlFor="valid-until">Gültig bis</Label><Input id="valid-until" type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} /></div>
                        </div>
                    </section>
                    <section className={styles.section} aria-labelledby="quote-items-title">
                        <div className={styles.sectionHeading}><h2 id="quote-items-title">Positionen · netto</h2><span>{items.length} {items.length === 1 ? "Position" : "Positionen"}</span></div>
                        <ServiceArticlePicker onSelect={article => setItems(current => {
                            const next = { description: article.description, quantity: 1, unitPrice: article.unitPrice, unit: article.unit, taxRate: taxMode === 'standard' ? 19 : 0 };
                            return current.length === 1 && !current[0].description.trim() && current[0].unitPrice === 0 ? [next] : [...current, next];
                        })} />
                        <div className={styles.lines}>
                            {items.map((item, index) => <fieldset key={index} className={styles.line}>
                                <legend className="sr-only">Position {index + 1}</legend>
                                <div className={styles.lineTop}><strong>Position {index + 1}</strong><div className="flex gap-1"><Button variant="ghost" size="icon" onClick={() => duplicateItem(index)} aria-label={`Position ${index + 1} duplizieren`}><Copy className="h-4 w-4" aria-hidden="true" /></Button><Button variant="ghost" size="icon" onClick={() => removeItem(index)} disabled={items.length === 1} aria-label={`Position ${index + 1} entfernen`} className="text-destructive"><Trash2 className="h-4 w-4" aria-hidden="true" /></Button></div></div>
                                <div className="space-y-2"><Label htmlFor={`quote-item-${index}-description`}>Beschreibung</Label><Textarea id={`quote-item-${index}-description`} value={item.description} onChange={e => updateItem(index, 'description', e.target.value)} placeholder="Leistung / Produkt" className="min-h-20" /></div>
                                <div className={styles.lineFields}>
                                    <div className="space-y-2"><Label htmlFor={`quote-item-${index}-quantity`}>Menge</Label><Input id={`quote-item-${index}-quantity`} type="number" min="0" step="0.01" value={item.quantity} onChange={e => updateItem(index, 'quantity', e.target.value)} className="text-right tabular-nums" /></div>
                                    <div className="space-y-2"><Label htmlFor={`quote-item-${index}-unit`}>Einheit</Label><select id={`quote-item-${index}-unit`} className={styles.select} value={item.unit} onChange={e => updateItem(index, 'unit', e.target.value)}>{!['Stück', 'Stunde', 'Tag', 'Pauschal'].includes(item.unit) && <option value={item.unit}>{item.unit}</option>}<option value="Stück">Stück</option><option value="Stunde">Stunde</option><option value="Tag">Tag</option><option value="Pauschal">Pauschal</option></select></div>
                                    <div className="space-y-2"><Label htmlFor={`quote-item-${index}-unit-price`}>Einzelpreis</Label><Input id={`quote-item-${index}-unit-price`} type="number" min="0" step="0.01" value={item.unitPrice} onChange={e => updateItem(index, 'unitPrice', e.target.value)} className="text-right tabular-nums" /></div>
                                    <div className="space-y-2"><Label htmlFor={`quote-item-${index}-tax`}>Steuer (%)</Label><Input id={`quote-item-${index}-tax`} type="number" min="0" step="1" disabled={!taxMode || taxMode === 'small-business'} value={item.taxRate} onChange={e => updateItem(index, 'taxRate', e.target.value)} className="text-right tabular-nums" /></div>
                                </div>
                                <div className={styles.lineAmount}><span>Positionsbetrag · Netto</span><strong>{displayAmount(item.quantity * item.unitPrice)}</strong></div>
                            </fieldset>)}
                        </div>
                        <Button type="button" variant="outline" onClick={addItem} className="mt-4 gap-2"><Plus className="h-4 w-4" aria-hidden="true" />Position hinzufügen</Button>
                    </section>
                    <section className={styles.section} aria-labelledby="quote-notes-title"><div className={styles.sectionHeading}><h2 id="quote-notes-title">Hinweise und Konditionen</h2></div><Label htmlFor="notes">Anmerkungen (Optional)</Label><Textarea id="notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Vielen Dank für Ihre Anfrage! Dieses Angebot ist freibleibend." className="mt-2 min-h-28" /></section>
                </div>
                <aside className={styles.editorRail} aria-label="Angebotsübersicht">
                    <section className={styles.totalPanel} aria-labelledby="quote-total-title">
                        <div className={styles.totalHero}><h2 id="quote-total-title">Angebotssumme</h2><div aria-live="polite">{displayAmount(netTotal + taxTotal)}</div><p>{items.length} {items.length === 1 ? "Position" : "Positionen"} · EUR</p></div>
                        <div className={styles.totalBody}>
                            <dl className={styles.totals}><div><dt>Nettobetrag</dt><dd>{displayAmount(netTotal)}</dd></div><div><dt>Umsatzsteuer</dt><dd>{displayAmount(taxTotal)}</dd></div></dl>
                            {validUntil && <p className={styles.railNote}>Gültig bis {new Date(`${validUntil}T12:00:00`).toLocaleDateString('de-DE')}</p>}
                            {!taxReady && <p id="quote-tax-blocker" className={styles.railNote}><a href="#quote-tax-heading" className="underline underline-offset-4">Steuerbehandlung bestätigen</a>.</p>}
                            <Button className="w-full" onClick={handleGenerateAndSave} aria-describedby={!taxReady ? "quote-tax-blocker" : undefined} disabled={!taxReady || isGenerating || !customerAddress || !quoteNumber} aria-busy={isGenerating} aria-label={isGenerating ? "Erstelle Angebot..." : "Angebot erstellen & speichern"}>{isGenerating && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}{isGenerating ? "Erstelle Angebot..." : <><span className="sm:hidden">Angebot erstellen</span><span className="hidden sm:inline">Angebot erstellen & speichern</span></>}</Button>
                            <Button variant="ghost" className="w-full" onClick={onCancel}>Abbrechen</Button>
                        </div>
                    </section>
                    {showPreview && <section className={styles.preview} aria-label="Angebots-Vorschau"><div className={styles.sectionHeading}><h2>PDF-Vorschau</h2><Button variant="ghost" onClick={generatePreview} disabled={isGeneratingPreview || !taxReady} aria-label="Vorschau aktualisieren">{isGeneratingPreview ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}</Button></div><div className={styles.previewFrame}>{previewUrl ? <iframe src={previewUrl} title="Angebotsvorschau" /> : <div role="status">{isGeneratingPreview ? "Vorschau wird generiert..." : !taxReady ? "Bitte zuerst Steuerbehandlung und Steuerfall bestätigen." : "Füllen Sie das Formular aus, um die Vorschau zu sehen."}</div>}</div></section>}
                </aside>
            </div>
        </section>
    );
}
