/**
 * Credit Note PDF Generator
 * 
 * Generates professional credit note PDFs with company branding,
 * customer data, and original invoice reference.
 */

import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';
import { prisma } from '@/lib/prisma';
import path from 'path';
import fs from 'fs/promises';

interface CreditNoteData {
    creditNoteNumber: string;
    date: Date;
    originalInvoiceNumber: string | null;
    originalInvoiceDate: Date | null;
    cancellationReason: string | null;
    totalAmount: number;
    customerName: string | null;
    customerAddress: string | null;
    items: Array<{
        description: string;
        quantity: number;
        unitPrice: number;
        unit: string;
        taxRate: number;
    }>;
}

interface Settings {
    companyName?: string | null;
    companyAddress?: string | null;
    email?: string | null;
    telephone?: string | null;
    taxNumber?: string | null;
    bankName?: string | null;
    iban?: string | null;
    bic?: string | null;
    footerText?: string | null;
    logoUrl?: string | null;
}

const formatCurrency = (amount: number): string => {
    return Math.abs(amount).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
};

export async function generateCreditNotePDF(
    data: CreditNoteData,
    settings: Settings
): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage();
    const { width, height } = page.getSize();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Design Constants - Credit notes use a distinct red accent
    const accentColor = rgb(0.7, 0.1, 0.1); // Dark red for credit notes
    const primaryColor = rgb(0, 0, 0);
    const secondaryColor = rgb(0.4, 0.4, 0.4);
    const lightBg = rgb(0.96, 0.96, 0.96);
    const creditColor = rgb(0.8, 0.1, 0.1); // Red for negative amounts

    // Helper functions
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

    // --- TOP ACCENT BAR (Red for credit note) ---
    page.drawRectangle({
        x: 0,
        y: height - 8,
        width: width,
        height: 8,
        color: accentColor,
    });

    // --- LOGO ---
    if (settings?.logoUrl) {
        try {
            // Try to load logo from file system
            const logoPath = settings.logoUrl.startsWith('/')
                ? path.join(process.cwd(), 'public', settings.logoUrl)
                : path.join(process.cwd(), 'data', 'uploads', path.basename(settings.logoUrl));

            const logoBytes = await fs.readFile(logoPath);
            const logoExt = settings.logoUrl.split('.').pop()?.toLowerCase();
            let logoImage;

            if (logoExt === 'png') {
                logoImage = await pdfDoc.embedPng(logoBytes);
            } else if (logoExt === 'jpg' || logoExt === 'jpeg') {
                logoImage = await pdfDoc.embedJpg(logoBytes);
            }

            if (logoImage) {
                const maxWidth = 180;
                const maxHeight = 80;
                const scale = Math.min(maxWidth / logoImage.width, maxHeight / logoImage.height);
                const logoDims = logoImage.scale(scale);

                page.drawImage(logoImage, {
                    x: width - margin - logoDims.width,
                    y: height - margin - logoDims.height + 10,
                    width: logoDims.width,
                    height: logoDims.height,
                });
            }
        } catch (error) {
            console.error("Failed to embed logo:", error);
        }
    }

    // --- SENDER LINE ---
    const senderLineY = height - 125;
    if (settings?.companyName) {
        let senderText = settings.companyName;
        if (settings?.companyAddress) {
            const addressLines = settings.companyAddress.split('\n');
            const street = addressLines[0];
            const city = addressLines.length > 1 ? addressLines[1].split(' ').slice(1).join(' ') : '';
            senderText += ` • ${street}`;
            if (city) senderText += ` • ${city}`;
        }

        page.drawText(senderText, { x: margin, y: senderLineY, size: 7, font, color: secondaryColor });

        const senderWidth = font.widthOfTextAtSize(senderText, 7);
        page.drawLine({
            start: { x: margin, y: senderLineY - 2 },
            end: { x: margin + senderWidth, y: senderLineY - 2 },
            thickness: 0.5,
            color: secondaryColor,
        });
    }

    // --- CUSTOMER ADDRESS ---
    let addressY = senderLineY - 15;
    if (data.customerName || data.customerAddress) {
        const addressText = [data.customerName, data.customerAddress].filter(Boolean).join('\n');
        const addressLines = addressText.split('\n');
        addressLines.forEach(line => {
            page.drawText(line, { x: margin, y: addressY, size: 11, font, color: primaryColor });
            addressY -= 15;
        });
    }

    // --- CREDIT NOTE INFO BOX ---
    let infoY = senderLineY - 20;
    const infoX = width - margin - 200;
    const infoBoxHeight = 160;
    const infoBoxWidth = 210;
    const infoBoxBottom = infoY - 145;

    page.drawRectangle({
        x: infoX - 10,
        y: infoBoxBottom,
        width: infoBoxWidth,
        height: infoBoxHeight,
        color: rgb(0.98, 0.96, 0.96), // Slightly reddish tint
    });

    page.drawRectangle({
        x: infoX - 10,
        y: infoBoxBottom,
        width: 3,
        height: infoBoxHeight,
        color: accentColor,
    });

    // Title: GUTSCHRIFT
    page.drawText('GUTSCHRIFT', { x: infoX, y: infoY, size: 16, font: boldFont, color: accentColor });
    infoY -= 25;

    const infoGap = 16;
    const drawInfoRow = (label: string, value: string) => {
        page.drawText(label, { x: infoX, y: infoY, size: 9, font, color: secondaryColor });
        drawTextRight(value, width - margin - 10, infoY, 9, boldFont, primaryColor);
        infoY -= infoGap;
    };

    drawInfoRow('Gutschrift-Nr.:', data.creditNoteNumber);
    drawInfoRow('Datum:', data.date.toLocaleDateString('de-DE'));

    if (data.originalInvoiceNumber) {
        infoY -= 5;
        drawInfoRow('Zu Rechnung:', data.originalInvoiceNumber);
        if (data.originalInvoiceDate) {
            drawInfoRow('Rechnungsdatum:', data.originalInvoiceDate.toLocaleDateString('de-DE'));
        }
    }

    // --- TABLE ---
    y = height - 320;

    const colX = {
        pos: margin,
        desc: margin + 30,
        qty: width - margin - 280,
        unit: width - margin - 250,
        price: width - margin - 180,
        total_orig: width - margin - 100,
        credit: width - margin
    };

    // Table header
    page.drawRectangle({
        x: margin,
        y: y - 5,
        width: width - 2 * margin,
        height: 20,
        color: lightBg,
    });

    page.drawText('Pos.', { x: colX.pos + 5, y, size: 9, font: boldFont, color: accentColor });
    page.drawText('Beschreibung', { x: colX.desc, y, size: 9, font: boldFont, color: accentColor });
    drawTextRight('Menge', colX.qty, y, 9, boldFont, accentColor);
    page.drawText('Einh.', { x: colX.unit, y, size: 9, font: boldFont, color: accentColor });
    drawTextRight('Preis', colX.price, y, 9, boldFont, accentColor);
    drawTextRight('Betrag', colX.total_orig, y, 9, boldFont, accentColor);
    drawTextRight('Gutschrift', colX.credit - 5, y, 9, boldFont, accentColor);

    y -= 25;

    let netTotal = 0;
    let taxTotal = 0;

    data.items.forEach((item, index) => {
        const lineNet = item.quantity * item.unitPrice;
        const lineTax = lineNet * (item.taxRate / 100);

        netTotal += lineNet;
        taxTotal += lineTax;

        if (index % 2 === 0) {
            page.drawRectangle({
                x: margin,
                y: y - 8,
                width: width - 2 * margin,
                height: 20,
                color: rgb(0.98, 0.98, 0.98),
            });
        }

        page.drawText((index + 1).toString(), { x: colX.pos + 5, y, size: 10, font, color: secondaryColor });
        page.drawText(item.description || 'Position', { x: colX.desc, y, size: 10, font, color: primaryColor });
        drawTextRight(item.quantity.toString(), colX.qty, y, 10, font, primaryColor);
        page.drawText(item.unit || 'Stück', { x: colX.unit, y, size: 10, font, color: primaryColor });
        drawTextRight(formatCurrency(item.unitPrice), colX.price, y, 10, font, primaryColor);

        // Original amount (positive)
        drawTextRight(formatCurrency(lineNet), colX.total_orig, y, 10, font, primaryColor);

        // Credit amounts shown in red with minus to indicate credit value
        drawTextRight('-' + formatCurrency(lineNet), colX.credit - 5, y, 10, font, creditColor);

        y -= 20;
    });

    y -= 10;

    // --- TOTALS ---
    const totalX = width - margin;
    const origTotalX = colX.total_orig; // Use the same X as in the table
    // Move label further left to avoid overlap with original total column
    const labelX = origTotalX - 80;
    const grossTotal = netTotal + taxTotal;

    page.drawLine({
        start: { x: labelX, y: y + 5 },
        end: { x: totalX, y: y + 5 },
        thickness: 0.5,
        color: rgb(0.8, 0.8, 0.8),
    });

    y -= 15;

    drawTextRight('Netto:', labelX, y, 10, font);
    // Original Netto
    drawTextRight(formatCurrency(netTotal), origTotalX, y, 10, font, primaryColor);
    // Credit Netto
    drawTextRight('-' + formatCurrency(netTotal), totalX, y, 10, font, creditColor);
    y -= 15;

    if (taxTotal > 0) {
        drawTextRight('zzgl. USt.:', labelX, y, 10, font);
        // Original Tax
        drawTextRight(formatCurrency(taxTotal), origTotalX, y, 10, font, primaryColor);
        // Credit Tax
        drawTextRight('-' + formatCurrency(taxTotal), totalX, y, 10, font, creditColor);
    } else {
        drawTextRight('zzgl. USt. 0%:', labelX, y, 10, font);
        drawTextRight('0,00 €', origTotalX, y, 10, font, primaryColor);
        drawTextRight('0,00 €', totalX, y, 10, font, creditColor);
    }
    y -= 20;

    // Total line
    const totalLabel = 'Gesamtbetrag:';
    const totalLabelWidth = boldFont.widthOfTextAtSize(totalLabel, 12);
    // Align total line start with label start
    const totalLineStart = labelX - totalLabelWidth;

    page.drawLine({
        start: { x: totalLineStart, y: y + 12 },
        end: { x: totalX, y: y + 12 },
        thickness: 1,
        color: accentColor,
    });

    drawTextRight(totalLabel, labelX, y, 12, boldFont, accentColor);
    // Original Gross
    drawTextRight(formatCurrency(grossTotal), origTotalX, y, 12, boldFont, accentColor);
    // Credit Gross
    drawTextRight('-' + formatCurrency(grossTotal), totalX, y, 12, boldFont, creditColor);

    y -= 4;
    page.drawLine({
        start: { x: totalLineStart, y: y },
        end: { x: totalX, y: y },
        thickness: 0.5,
        color: accentColor,
    });
    page.drawLine({
        start: { x: totalLineStart, y: y - 2 },
        end: { x: totalX, y: y - 2 },
        thickness: 0.5,
        color: accentColor,
    });

    y -= 40;

    // --- CANCELLATION REASON ---
    if (data.cancellationReason) {
        page.drawText('Stornierungsgrund:', { x: margin, y, size: 10, font: boldFont });
        y -= 15;
        const reasonLines = data.cancellationReason.split('\n');
        reasonLines.forEach(line => {
            page.drawText(line, { x: margin, y, size: 10, font });
            y -= 12;
        });
        y -= 10;
    }

    // --- LEGAL NOTICE ---
    y -= 10;
    page.drawText('Diese Gutschrift korrigiert die oben genannte Rechnung.', { x: margin, y, size: 10, font });
    y -= 15;

    if (taxTotal === 0) {
        page.drawText('Hinweis: Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.', { x: margin, y, size: 10, font });
        y -= 15;
    }

    page.drawText('Der Gutschriftbetrag wird Ihnen gutgeschrieben bzw. erstattet.', { x: margin, y, size: 10, font });

    // --- FOOTER ---
    const footerY = 60;
    page.drawLine({
        start: { x: margin, y: footerY + 15 },
        end: { x: width - margin, y: footerY + 15 },
        thickness: 0.5,
        color: rgb(0.7, 0.7, 0.7),
    });

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

    // Page number
    const pageText = 'Seite 1 von 1';
    const pageTextWidth = font.widthOfTextAtSize(pageText, 8);
    page.drawText(pageText, {
        x: (width - pageTextWidth) / 2,
        y: 15,
        size: 8,
        font,
        color: secondaryColor
    });

    return await pdfDoc.save();
}
