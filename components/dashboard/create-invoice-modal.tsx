"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PDFDocument, StandardFonts, rgb, type PDFImage, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import QRCode from 'qrcode';
import { generateZugferdXml, validateZugferdData, type ZugferdData } from "@/lib/zugferd-generator";
import { ArrowLeft, Copy, Eye, EyeOff, FileText, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";

interface CreateInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInvoiceCreated?: () => void;
  presentation?: "dialog" | "page";
  fromQuote?: {
    id: number;
    parsedData: {
      items?: Array<{ description: string; quantity: number; unitPrice: number; unit: string; taxRate: number }>;
      notes?: string;
      customerAddress?: string;
    };
    customerId?: number | null;
    invoiceNumber?: string | null; // quote number for reference
  };
}

interface InvoiceItem {
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

interface Template {
  id: string | number;
  name: string;
  data: {
    items?: InvoiceItem[];
    notes?: string;
    includeQRCode?: boolean;
  };
}

type InvoiceOutputMode = 'zugferd-pdf' | 'xml-only';

export function CreateInvoiceModal({
  isOpen,
  onClose,
  onInvoiceCreated,
  fromQuote,
  presentation = "dialog",
}: CreateInvoiceModalProps) {
  const [customerAddress, setCustomerAddress] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<InvoiceItem[]>([{ description: "", quantity: 1, unitPrice: 0, unit: "Stück", taxRate: 0 }]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [includeQRCode, setIncludeQRCode] = useState(false);
  const [invoiceNumberError, setInvoiceNumberError] = useState<string | null>(null);
  const [isCheckingNumber, setIsCheckingNumber] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [isSaveTemplateOpen, setIsSaveTemplateOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [outputMode, setOutputMode] = useState<InvoiceOutputMode>('zugferd-pdf');

  // Preview states
  const [showPreview, setShowPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const previewTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const previewGenerationRef = useRef(0);

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

      fetchTemplates();
    }
  }, [isOpen]);

  // Pre-fill from quote when converting
  useEffect(() => {
    if (isOpen && fromQuote) {
      const pd = fromQuote.parsedData;
      if (pd.items && pd.items.length > 0) setItems(pd.items);
      if (pd.notes) setNotes(pd.notes);
      if (pd.customerAddress) setCustomerAddress(pd.customerAddress);
    }
  }, [isOpen, fromQuote]);

  useEffect(() => {
    if (outputMode === 'xml-only') {
      setIncludeQRCode(false);
    }
  }, [outputMode]);

  const fetchTemplates = async () => {
    try {
      const res = await fetch("/api/invoice-templates");
      if (res.ok) {
        const data = await res.json();
        setTemplates(data);
      }
    } catch (error) {
      console.error("Failed to load templates", error);
    }
  };

  const handleSaveTemplate = async () => {
    if (!newTemplateName.trim()) return;

    const templateData = {
      items,
      notes,
      includeQRCode,
      // We don't save customer specific info or dates usually, but maybe notes and items are the most important
    };

    try {
      const res = await fetch("/api/invoice-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newTemplateName,
          data: templateData,
        }),
      });

      if (res.ok) {
        setNewTemplateName("");
        setIsSaveTemplateOpen(false);
        fetchTemplates();
        alert("Vorlage erfolgreich gespeichert.");
      } else {
        alert("Fehler beim Speichern der Vorlage.");
      }
    } catch (error) {
      console.error("Error saving template:", error);
      alert("Fehler beim Speichern der Vorlage.");
    }
  };

  const handleLoadTemplate = (templateId: string) => {
    const template = templates.find(t => t.id.toString() === templateId);
    if (template && template.data) {
      const data = template.data;
      if (data.items) {
        setItems(data.items.map((item: InvoiceItem) => ({
          ...item,
          unit: item.unit || "Stück",
          taxRate: item.taxRate ?? 0
        })));
      }
      if (data.notes !== undefined) setNotes(data.notes);
      if (data.includeQRCode !== undefined) setIncludeQRCode(data.includeQRCode);
      // Add other fields if needed
    }
    setSelectedTemplateId(templateId);
  };

  const handleDeleteTemplate = async (templateId: string) => {
    if (!confirm("Möchten Sie diese Vorlage wirklich löschen?")) return;

    try {
      const res = await fetch(`/api/invoice-templates/${templateId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        fetchTemplates();
        if (selectedTemplateId === templateId) setSelectedTemplateId("");
      } else {
        alert("Fehler beim Löschen der Vorlage.");
      }
    } catch (error) {
      console.error("Error deleting template:", error);
      alert("Fehler beim Löschen der Vorlage.");
    }
  };

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
      if (customer.address) addressBlock += `\n${customer.address} `;
      const cityLine = `${customer.zipCode || ''} ${customer.city || ''} `.trim();
      if (cityLine) addressBlock += `\n${cityLine} `;
      setCustomerAddress(addressBlock);
    }
  };

  const addItem = () => {
    setItems([...items, { description: "", quantity: 1, unitPrice: 0, unit: "Stück", taxRate: 0 }]);
  };

  const updateItem = (index: number, field: keyof InvoiceItem, value: string | number) => {
    const newItems = [...items];
    if (field === 'quantity' || field === 'unitPrice' || field === 'taxRate') {
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

  const duplicateItem = (index: number) => {
    const itemToDuplicate = items[index];
    const newItems = [...items];
    newItems.splice(index + 1, 0, { ...itemToDuplicate });
    setItems(newItems);
  };

  const formatCurrency = useCallback((amount: number) => {
    return amount.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }, []);

  // Core PDF generation function (returns PDF bytes, used by both preview and final generation)
  const generatePDFBytes = useCallback(async (forPreview: boolean = false): Promise<Uint8Array> => {
    const pdfDoc = await PDFDocument.create();
    const pageSize: [number, number] = [595.28, 841.89]; // A4 portrait in PDF points
    let page = pdfDoc.addPage(pageSize);
    const { width, height } = page.getSize();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const margin = 42;
    const contentWidth = width - 2 * margin;
    const bottomContentY = 128;
    const isNonEmptyString = (value: string | null | undefined): value is string => Boolean(value);
    const companyName = settings?.companyName?.trim() || 'Bivaro';
    const companyAddressLines = settings?.companyAddress
      ?.split('\n')
      .map(line => line.trim())
      .filter(isNonEmptyString) ?? [];
    const customerLines = customerAddress
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);
    const calculatedItems = items.map(item => {
      const lineNet = item.quantity * item.unitPrice;
      const lineTax = lineNet * (item.taxRate / 100);

      return {
        ...item,
        lineNet,
        lineTax,
      };
    });
    const netTotal = calculatedItems.reduce((sum, item) => sum + item.lineNet, 0);
    const taxTotal = calculatedItems.reduce((sum, item) => sum + item.lineTax, 0);
    const grossTotal = netTotal + taxTotal;

    const brandDark = rgb(0.035, 0.078, 0.145);
    const brandBlue = rgb(0.05, 0.22, 0.58);
    const brandAccent = rgb(0.0, 0.56, 0.92);
    const textColor = rgb(0.08, 0.1, 0.16);
    const mutedColor = rgb(0.36, 0.42, 0.52);
    const lightText = rgb(0.76, 0.84, 0.94);
    const white = rgb(1, 1, 1);
    const surface = rgb(0.965, 0.975, 0.99);
    const surfaceStrong = rgb(0.93, 0.96, 0.995);
    const hairline = rgb(0.82, 0.87, 0.94);

    const formatDate = (value?: string) => value ? new Date(value).toLocaleDateString('de-DE') : '-';
    const formatQuantity = (value: number) => value.toLocaleString('de-DE', { maximumFractionDigits: 2 });
    const formatTaxRate = (value: number) => `${value.toLocaleString('de-DE', { maximumFractionDigits: 2 })}%`;

    const drawTextRight = (
      text: string,
      x: number,
      y: number,
      size: number,
      fontToUse: PDFFont = font,
      color: RGB = textColor,
      targetPage: PDFPage = page,
    ) => {
      const textWidth = fontToUse.widthOfTextAtSize(text, size);
      targetPage.drawText(text, { x: x - textWidth, y, size, font: fontToUse, color });
    };

    const drawTextCenter = (
      text: string,
      x: number,
      y: number,
      size: number,
      fontToUse: PDFFont = font,
      color: RGB = textColor,
      targetPage: PDFPage = page,
    ) => {
      const textWidth = fontToUse.widthOfTextAtSize(text, size);
      targetPage.drawText(text, { x: x - textWidth / 2, y, size, font: fontToUse, color });
    };

    const truncateText = (text: string, maxWidth: number, size: number, fontToUse: PDFFont = font) => {
      if (fontToUse.widthOfTextAtSize(text, size) <= maxWidth) return text;

      let trimmed = text;
      while (trimmed.length > 0 && fontToUse.widthOfTextAtSize(`${trimmed}...`, size) > maxWidth) {
        trimmed = trimmed.slice(0, -1);
      }

      return trimmed ? `${trimmed}...` : '';
    };

    const splitText = (text: string, maxWidth: number, size: number, fontToUse: PDFFont = font): string[] => {
      const normalized = text.replace(/\s+/g, ' ').trim();
      if (!normalized) return [''];

      const splitLongWord = (word: string) => {
        const parts: string[] = [];
        let part = '';

        Array.from(word).forEach(char => {
          const candidate = part + char;
          if (!part || fontToUse.widthOfTextAtSize(candidate, size) <= maxWidth) {
            part = candidate;
          } else {
            parts.push(part);
            part = char;
          }
        });

        if (part) parts.push(part);
        return parts;
      };

      const lines: string[] = [];
      let currentLine = '';

      normalized.split(' ').forEach(word => {
        const wordParts = fontToUse.widthOfTextAtSize(word, size) > maxWidth ? splitLongWord(word) : [word];

        wordParts.forEach(part => {
          const candidate = currentLine ? `${currentLine} ${part}` : part;
          if (fontToUse.widthOfTextAtSize(candidate, size) <= maxWidth) {
            currentLine = candidate;
          } else {
            if (currentLine) lines.push(currentLine);
            currentLine = part;
          }
        });
      });

      if (currentLine) lines.push(currentLine);
      return lines.length > 0 ? lines : [''];
    };

    const drawCard = (
      x: number,
      topY: number,
      cardWidth: number,
      cardHeight: number,
      color: RGB,
      borderColor: RGB = hairline,
      targetPage: PDFPage = page,
    ) => {
      targetPage.drawRectangle({
        x,
        y: topY - cardHeight,
        width: cardWidth,
        height: cardHeight,
        color,
        borderColor,
        borderWidth: 0.6,
      });
    };

    let logoImage: PDFImage | undefined;
    if (settings?.logoUrl) {
      try {
        const logoResponse = await fetch(settings.logoUrl);
        if (!logoResponse.ok) {
          throw new Error('Logo konnte nicht geladen werden.');
        }

        const logoBytes = await logoResponse.arrayBuffer();
        const logoExt = settings.logoUrl.split('?')[0]?.split('.').pop()?.toLowerCase();

        if (logoExt === 'png') {
          logoImage = await pdfDoc.embedPng(logoBytes);
        } else if (logoExt === 'jpg' || logoExt === 'jpeg') {
          logoImage = await pdfDoc.embedJpg(logoBytes);
        }
      } catch (error) {
        console.error("Failed to embed logo:", error);
      }
    }

    const toSEPA = (value: string) => {
      const map: Record<string, string> = {
        'ä': 'ae',
        'ö': 'oe',
        'ü': 'ue',
        'Ä': 'Ae',
        'Ö': 'Oe',
        'Ü': 'Ue',
        'ß': 'ss',
      };

      return value
        .replace(/[äöüÄÖÜß]/g, match => map[match] ?? match)
        .replace(/[^A-Za-z0-9/?:().,'+ -]/g, '')
        .trim();
    };

    let qrCodeImage: PDFImage | undefined;
    const canRenderQRCode = includeQRCode && Boolean(settings?.iban && settings?.companyName);
    if (canRenderQRCode && !forPreview) {
      try {
        const finalIban = settings?.iban?.replace(/\s/g, '').toUpperCase() ?? '';
        const giroCodeData = [
          'BCD',
          '002',
          '1',
          'SCT',
          settings?.bic?.trim() ?? '',
          toSEPA(settings?.companyName ?? '').substring(0, 70),
          finalIban,
          `EUR${grossTotal.toFixed(2)}`,
          '',
          '',
          toSEPA(invoiceNumber || '').substring(0, 140),
        ].join('\n');

        const qrCodeDataUrl = await QRCode.toDataURL(giroCodeData, {
          errorCorrectionLevel: 'M',
          type: 'image/png',
          margin: 4,
        });
        qrCodeImage = await pdfDoc.embedPng(qrCodeDataUrl);
      } catch (error) {
        console.error("Error generating QR code:", error);
      }
    }

    const drawDocumentHeader = (targetPage: PDFPage) => {
      const headerHeight = 68;
      const headerBottom = height - headerHeight;

      targetPage.drawRectangle({ x: 0, y: headerBottom, width, height: headerHeight, color: brandDark });
      targetPage.drawRectangle({ x: 0, y: headerBottom, width, height: 5, color: brandAccent });
      targetPage.drawRectangle({ x: 0, y: headerBottom, width: 5, height: headerHeight, color: brandAccent });

      targetPage.drawText('RECHNUNG', {
        x: margin,
        y: height - 44,
        size: 22,
        font: boldFont,
        color: white,
      });

      if (logoImage) {
        const logoCardWidth = 112;
        const logoCardHeight = 36;
        const logoCardX = width - margin - logoCardWidth;
        const logoCardTop = height - 16;
        drawCard(logoCardX, logoCardTop, logoCardWidth, logoCardHeight, white, rgb(0.78, 0.86, 0.95), targetPage);

        const scale = Math.min((logoCardWidth - 22) / logoImage.width, (logoCardHeight - 16) / logoImage.height);
        const logoDims = logoImage.scale(scale);
        targetPage.drawImage(logoImage, {
          x: logoCardX + (logoCardWidth - logoDims.width) / 2,
          y: logoCardTop - logoCardHeight + (logoCardHeight - logoDims.height) / 2,
          width: logoDims.width,
          height: logoDims.height,
        });
      }
    };

    const drawContinuationHeader = (targetPage: PDFPage) => {
      targetPage.drawRectangle({ x: 0, y: height - 58, width, height: 58, color: brandDark });
      targetPage.drawRectangle({ x: 0, y: height - 58, width, height: 5, color: brandAccent });
      targetPage.drawText('RECHNUNG', { x: margin, y: height - 36, size: 14, font: boldFont, color: white });
      targetPage.drawText('Fortsetzung', { x: margin, y: height - 50, size: 8, font, color: lightText });
      drawTextRight(invoiceNumber || 'RE-XXXX', width - margin, height - 36, 10, boldFont, white, targetPage);

      return height - 88;
    };

    const drawFooter = (targetPage: PDFPage, pageNumber: number, pageCount: number) => {
      const footerTop = 92;
      const footerStartY = 74;
      const footerFontSize = 7;
      const footerLineHeight = 9;
      const columnWidth = (contentWidth - 44) / 3;
      const contactLine = [settings?.email, settings?.telephone].filter(isNonEmptyString).join(' | ');
      const footerLeft = [companyName, ...companyAddressLines.slice(0, 2), contactLine].filter(isNonEmptyString);
      const footerCenter = [
        settings?.bankName,
        settings?.iban ? `IBAN: ${settings.iban}` : undefined,
        settings?.bic ? `BIC: ${settings.bic}` : undefined,
      ].filter(isNonEmptyString);
      const footerRight = [
        settings?.taxNumber ? 'Steuernummer:' : undefined,
        settings?.taxNumber,
        ...(
          settings?.footerText
            ?.split('\n')
            .map(line => line.trim()) ?? []
        ),
      ].filter(isNonEmptyString);

      targetPage.drawLine({
        start: { x: margin, y: footerTop },
        end: { x: width - margin, y: footerTop },
        thickness: 0.6,
        color: hairline,
      });
      targetPage.drawRectangle({ x: margin, y: footerTop + 3, width: 72, height: 2, color: brandAccent });

      let footerY = footerStartY;
      footerLeft.slice(0, 4).forEach(line => {
        targetPage.drawText(truncateText(line, columnWidth, footerFontSize), {
          x: margin,
          y: footerY,
          size: footerFontSize,
          font,
          color: mutedColor,
        });
        footerY -= footerLineHeight;
      });

      footerY = footerStartY;
      footerCenter.slice(0, 4).forEach(line => {
        drawTextCenter(truncateText(line, columnWidth, footerFontSize), width / 2, footerY, footerFontSize, font, mutedColor, targetPage);
        footerY -= footerLineHeight;
      });

      footerY = footerStartY;
      footerRight.slice(0, 4).forEach(line => {
        drawTextRight(truncateText(line, columnWidth, footerFontSize), width - margin, footerY, footerFontSize, font, mutedColor, targetPage);
        footerY -= footerLineHeight;
      });

      const pageText = `Seite ${pageNumber} von ${pageCount}`;
      drawTextCenter(pageText, width / 2, 24, 8, font, mutedColor, targetPage);
    };

    const addContentPage = () => {
      page = pdfDoc.addPage(pageSize);
      return drawContinuationHeader(page);
    };

    const drawTableHeader = (topY: number) => {
      const colX = {
        pos: margin + 15,
        desc: margin + 48,
        qty: width - margin - 236,
        unit: width - margin - 204,
        price: width - margin - 124,
        tax: width - margin - 70,
        total: width - margin - 10,
      };

      page.drawRectangle({
        x: margin,
        y: topY - 28,
        width: contentWidth,
        height: 28,
        color: brandDark,
      });
      page.drawRectangle({ x: margin, y: topY - 28, width: 5, height: 28, color: brandAccent });

      const labelY = topY - 18;
      page.drawText('Pos.', { x: colX.pos, y: labelY, size: 8, font: boldFont, color: white });
      page.drawText('Beschreibung', { x: colX.desc, y: labelY, size: 8, font: boldFont, color: white });
      drawTextRight('Menge', colX.qty, labelY, 8, boldFont, white);
      page.drawText('Einh.', { x: colX.unit, y: labelY, size: 8, font: boldFont, color: white });
      drawTextRight('Preis', colX.price, labelY, 8, boldFont, white);
      drawTextRight('USt.', colX.tax, labelY, 8, boldFont, white);
      drawTextRight('Netto', colX.total, labelY, 8, boldFont, white);

      return topY - 42;
    };

    let y: number;

    const ensureSpace = (requiredHeight: number, withTableHeader: boolean = false) => {
      if (y - requiredHeight >= bottomContentY) return;

      y = addContentPage();
      if (withTableHeader) {
        y = drawTableHeader(y);
      }
    };

    const drawFirstPageIntro = () => {
      drawDocumentHeader(page);

      const senderText = [companyName, companyAddressLines[0], companyAddressLines.at(-1)]
        .filter(isNonEmptyString)
        .join(' • ');
      if (senderText) {
        const senderY = height - 94;
        page.drawText(truncateText(senderText, contentWidth, 7, font), { x: margin, y: senderY, size: 7, font, color: mutedColor });
        page.drawLine({
          start: { x: margin, y: senderY - 4 },
          end: { x: margin + Math.min(font.widthOfTextAtSize(senderText, 7), contentWidth), y: senderY - 4 },
          thickness: 0.4,
          color: hairline,
        });
      }

      const cardTop = height - 116;
      const cardHeight = 112;
      const gap = 18;
      const detailsWidth = 214;
      const addressWidth = contentWidth - detailsWidth - gap;
      const detailsX = margin + addressWidth + gap;

      drawCard(margin, cardTop, addressWidth, cardHeight, surface, hairline);
      page.drawRectangle({ x: margin, y: cardTop - cardHeight, width: 5, height: cardHeight, color: brandAccent });
      page.drawText('EMPFÄNGER', { x: margin + 17, y: cardTop - 24, size: 7, font: boldFont, color: brandAccent });

      const displayedCustomerLines = (customerLines.length > 0 ? customerLines : ['Empfänger noch nicht angegeben']).slice(0, 6);
      let addressY = cardTop - 46;
      displayedCustomerLines.forEach((line, index) => {
        page.drawText(truncateText(line, addressWidth - 34, index === 0 ? 11 : 10, index === 0 ? boldFont : font), {
          x: margin + 17,
          y: addressY,
          size: index === 0 ? 11 : 10,
          font: index === 0 ? boldFont : font,
          color: index === 0 ? textColor : mutedColor,
        });
        addressY -= 15;
      });

      drawCard(detailsX, cardTop, detailsWidth, cardHeight, white, hairline);
      page.drawRectangle({ x: detailsX, y: cardTop - 32, width: detailsWidth, height: 32, color: surfaceStrong });
      page.drawText('Rechnungsdetails', { x: detailsX + 15, y: cardTop - 21, size: 9, font: boldFont, color: textColor });

      const detailRows: Array<[string, string]> = [
        ['Rechnungs-Nr.', invoiceNumber || 'RE-XXXX'],
        ['Datum', formatDate(date)],
      ];

      if (selectedCustomer?.id) detailRows.push(['Kundennr.', selectedCustomer.id.toString()]);
      if (deliveryDate) detailRows.push(['Leistung', formatDate(deliveryDate)]);
      if (dueDate) detailRows.push(['Fällig', formatDate(dueDate)]);

      let detailY = cardTop - 48;
      detailRows.slice(0, 5).forEach(([label, value]) => {
        page.drawText(label, { x: detailsX + 15, y: detailY, size: 8, font, color: mutedColor });
        drawTextRight(truncateText(value, 92, 8.5, boldFont), detailsX + detailsWidth - 15, detailY, 8.5, boldFont, textColor);
        detailY -= 15;
      });

      return cardTop - cardHeight - 28;
    };

    y = drawFirstPageIntro();
    page.drawText('Positionen', { x: margin, y, size: 14, font: boldFont, color: textColor });
    drawTextRight(`${calculatedItems.length} Position${calculatedItems.length === 1 ? '' : 'en'}`, width - margin, y + 2, 9, font, mutedColor);
    y -= 20;
    y = drawTableHeader(y);

    const colX = {
      pos: margin + 15,
      desc: margin + 48,
      qty: width - margin - 236,
      unit: width - margin - 204,
      price: width - margin - 124,
      tax: width - margin - 70,
      total: width - margin - 10,
    };
    const descriptionWidth = colX.qty - colX.desc - 18;

    calculatedItems.forEach((item, index) => {
      const descLines = splitText(item.description || 'Position', descriptionWidth, 9.5, font);
      const rowHeight = Math.max(38, descLines.length * 12 + 20);

      ensureSpace(rowHeight + 6, true);

      const rowTop = y;
      const rowBottom = rowTop - rowHeight;
      const fillColor = index % 2 === 0 ? surface : white;
      page.drawRectangle({
        x: margin,
        y: rowBottom,
        width: contentWidth,
        height: rowHeight,
        color: fillColor,
        borderColor: rgb(0.9, 0.93, 0.97),
        borderWidth: 0.35,
      });
      page.drawRectangle({ x: margin, y: rowBottom, width: 3, height: rowHeight, color: index % 2 === 0 ? brandAccent : hairline });

      const textY = rowTop - 16;
      page.drawText((index + 1).toString().padStart(2, '0'), { x: colX.pos, y: textY, size: 8.5, font: boldFont, color: brandAccent });

      descLines.forEach((line, lineIndex) => {
        page.drawText(line, { x: colX.desc, y: textY - (lineIndex * 12), size: 9.5, font, color: textColor });
      });

      drawTextRight(formatQuantity(item.quantity), colX.qty, textY, 9, font, textColor);
      page.drawText(truncateText(item.unit, 45, 8.5, font), { x: colX.unit, y: textY, size: 8.5, font, color: mutedColor });
      drawTextRight(formatCurrency(item.unitPrice), colX.price, textY, 9, font, textColor);
      drawTextRight(formatTaxRate(item.taxRate), colX.tax, textY, 9, font, mutedColor);
      drawTextRight(formatCurrency(item.lineNet), colX.total, textY, 9, boldFont, textColor);

      y = rowBottom - 4;
    });

    y -= 10;
    ensureSpace(150);

    const summaryTop = y;
    const summaryHeight = 126;
    const summaryGap = 18;
    const totalCardWidth = 214;
    const paymentCardWidth = contentWidth - totalCardWidth - summaryGap;
    const totalCardX = width - margin - totalCardWidth;

    drawCard(margin, summaryTop, paymentCardWidth, summaryHeight, surfaceStrong, hairline);
    page.drawText('Zahlung', { x: margin + 16, y: summaryTop - 24, size: 10, font: boldFont, color: textColor });
    page.drawText(dueDate ? `Zahlbar bis ${formatDate(dueDate)}` : 'Zahlbar nach Erhalt der Rechnung', {
      x: margin + 16,
      y: summaryTop - 42,
      size: 9,
      font: boldFont,
      color: brandBlue,
    });

    const qrSize = 72;
    const qrPadding = canRenderQRCode ? 96 : 0;
    const paymentTextWidth = paymentCardWidth - 32 - qrPadding;
    const paymentLines = [
      settings?.bankName ? `Bank: ${settings.bankName}` : undefined,
      settings?.iban ? `IBAN: ${settings.iban}` : undefined,
      settings?.bic ? `BIC: ${settings.bic}` : undefined,
      invoiceNumber ? `Verwendungszweck: ${invoiceNumber}` : undefined,
    ].filter(isNonEmptyString);
    let paymentY = summaryTop - 62;
    paymentLines.slice(0, 4).forEach(line => {
      page.drawText(truncateText(line, paymentTextWidth, 8, font), {
        x: margin + 16,
        y: paymentY,
        size: 8,
        font,
        color: mutedColor,
      });
      paymentY -= 12;
    });

    if (canRenderQRCode) {
      const qrX = margin + paymentCardWidth - qrSize - 16;
      const qrY = summaryTop - summaryHeight + 26;

      if (qrCodeImage) {
        page.drawImage(qrCodeImage, { x: qrX, y: qrY, width: qrSize, height: qrSize });
      } else if (forPreview) {
        page.drawRectangle({
          x: qrX,
          y: qrY,
          width: qrSize,
          height: qrSize,
          color: white,
          borderColor: hairline,
          borderWidth: 1,
        });
        drawTextCenter('QR-Code', qrX + qrSize / 2, qrY + 35, 8, boldFont, mutedColor);
      }

      drawTextCenter('GiroCode', qrX + qrSize / 2, qrY - 10, 7, font, mutedColor);
    }

    drawCard(totalCardX, summaryTop, totalCardWidth, summaryHeight, brandDark, brandDark);
    page.drawRectangle({ x: totalCardX, y: summaryTop - summaryHeight, width: totalCardWidth, height: 46, color: brandAccent });
    page.drawText('Zusammenfassung', { x: totalCardX + 16, y: summaryTop - 24, size: 10, font: boldFont, color: white });

    let totalY = summaryTop - 48;
    const totalRows: Array<[string, string]> = [
      ['Netto', formatCurrency(netTotal)],
      [taxTotal > 0 ? 'zzgl. USt.' : 'zzgl. USt. 0%', taxTotal > 0 ? formatCurrency(taxTotal) : '0,00 €'],
    ];

    totalRows.forEach(([label, value]) => {
      page.drawText(label, { x: totalCardX + 16, y: totalY, size: 8.5, font, color: lightText });
      drawTextRight(value, totalCardX + totalCardWidth - 16, totalY, 8.5, font, white);
      totalY -= 17;
    });

    page.drawText('Gesamtbetrag', { x: totalCardX + 16, y: summaryTop - summaryHeight + 27, size: 8.5, font: boldFont, color: white });
    drawTextRight(formatCurrency(grossTotal), totalCardX + totalCardWidth - 16, summaryTop - summaryHeight + 24, 14, boldFont, white);

    y = summaryTop - summaryHeight - 24;

    const noteLines: string[] = [];
    if (notes.trim()) {
      notes.split('\n').forEach(line => {
        noteLines.push(...splitText(line, contentWidth - 36, 9, font));
      });
    }
    if (taxTotal === 0) {
      if (noteLines.length > 0) noteLines.push('');
      noteLines.push(...splitText('Hinweis: Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.', contentWidth - 36, 9, font));
    }

    const drawTextBlockCard = (title: string, lines: string[]) => {
      let remainingLines = [...lines];

      while (remainingLines.length > 0) {
        const minimumCardHeight = 56;
        if (y - bottomContentY < minimumCardHeight) {
          y = addContentPage();
        }

        const availableLineCount = Math.max(1, Math.floor((y - bottomContentY - 44) / 12));
        const pageLines = remainingLines.slice(0, availableLineCount);
        const cardHeight = 40 + pageLines.length * 12;

        drawCard(margin, y, contentWidth, cardHeight, white, hairline);
        page.drawRectangle({ x: margin, y: y - 30, width: contentWidth, height: 30, color: surface });
        page.drawText(title, { x: margin + 16, y: y - 20, size: 9.5, font: boldFont, color: textColor });

        let lineY = y - 45;
        pageLines.forEach(line => {
          if (line) {
            page.drawText(line, { x: margin + 16, y: lineY, size: 9, font, color: mutedColor });
          }
          lineY -= 12;
        });

        y = y - cardHeight - 14;
        remainingLines = remainingLines.slice(pageLines.length);
      }
    };

    if (noteLines.length > 0) {
      drawTextBlockCard('Hinweise', noteLines);
    }

    if (y - 30 >= bottomContentY) {
      page.drawText('Vielen Dank für Ihr Vertrauen.', { x: margin, y, size: 10, font: boldFont, color: brandBlue });
    }

    const pages = pdfDoc.getPages();
    const pageCount = pages.length;
    pages.forEach((pdfPage, index) => {
      drawFooter(pdfPage, index + 1, pageCount);
    });

    return await pdfDoc.save();
  }, [customerAddress, invoiceNumber, date, dueDate, deliveryDate, notes, items, settings, selectedCustomer, includeQRCode, formatCurrency]);

  // Generate preview with debouncing
  const generatePreview = useCallback(async () => {
    if (!showPreview) return;

    const generationId = previewGenerationRef.current + 1;
    previewGenerationRef.current = generationId;
    setIsGeneratingPreview(true);
    try {
      const pdfBytes = await generatePDFBytes(true);
      const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
      const nextUrl = URL.createObjectURL(blob);

      if (previewGenerationRef.current !== generationId) {
        URL.revokeObjectURL(nextUrl);
        return;
      }

      const previousUrl = previewUrlRef.current;
      previewUrlRef.current = nextUrl;
      setPreviewUrl(nextUrl);

      if (previousUrl) {
        window.setTimeout(() => URL.revokeObjectURL(previousUrl), 1000);
      }
    } catch (error) {
      console.error("Error generating preview:", error);
    } finally {
      if (previewGenerationRef.current === generationId) {
        setIsGeneratingPreview(false);
      }
    }
  }, [showPreview, generatePDFBytes]);

  // Debounced preview update
  useEffect(() => {
    if (!showPreview) return;

    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current);
    }

    previewTimeoutRef.current = setTimeout(() => {
      generatePreview();
    }, 500); // 500ms debounce

    return () => {
      if (previewTimeoutRef.current) {
        clearTimeout(previewTimeoutRef.current);
      }
    };
  }, [showPreview, generatePreview]);

  // Cleanup preview URL on unmount
  useEffect(() => {
    return () => {
      if (previewTimeoutRef.current) {
        clearTimeout(previewTimeoutRef.current);
      }
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (showPreview) return;

    previewGenerationRef.current += 1;
    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current);
      previewTimeoutRef.current = null;
    }
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
    setIsGeneratingPreview(false);
  }, [showPreview]);

  const buildZugferdData = (): ZugferdData => {
    let netTotal = 0;
    let taxTotal = 0;
    items.forEach((item) => {
      const lineNet = item.quantity * item.unitPrice;
      const lineTax = lineNet * (item.taxRate / 100);
      netTotal += lineNet;
      taxTotal += lineTax;
    });

    return {
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
        name: customerAddress.split('\n')[0]?.trim() || '',
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
        unit: item.unit,
        taxRate: item.taxRate,
      })),
      netAmount: netTotal,
      taxAmount: taxTotal,
      currency: 'EUR',
    };
  };

  const buildInvoiceFileName = (extension: 'pdf' | 'xml') => {
    const safeNumber = invoiceNumber.replace(/\s+/g, '_').replace(/[^A-Za-z0-9._-]/g, '_');
    return `Rechnung_${safeNumber}.${extension}`;
  };

  const uploadGeneratedInvoice = async (file: File): Promise<boolean> => {
    const formData = new FormData();
    formData.append('file', file);
    if (fromQuote) formData.append('fromQuoteId', String(fromQuote.id));

    let uploadRes: Response;
    try {
      uploadRes = await fetch('/api/invoices/upload', {
        method: 'POST',
        body: formData
      });
    } catch (e) {
      console.error("Auto-upload network error:", e);
      alert("Fehler beim automatischen Speichern der Rechnung.");
      return false;
    }

    if (!uploadRes.ok) {
      const err = await uploadRes.json().catch(() => null);
      console.error("Auto-upload failed:", err);
      alert("Speichern fehlgeschlagen: " + (err?.error || "Unbekannter Fehler"));
      return false;
    }

    if (onInvoiceCreated) {
      onInvoiceCreated();
    }

    return true;
  };

  const downloadGeneratedFile = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const convertToPdfA3 = async (basePdfBytes: Uint8Array, xmlContent: string) => {
    const formData = new FormData();
    formData.append('pdf', new Blob([basePdfBytes as BlobPart], { type: 'application/pdf' }), 'invoice.pdf');
    formData.append('xml', new Blob([xmlContent], { type: 'text/xml' }), 'factur-x.xml');
    formData.append('invoiceNumber', invoiceNumber);

    const response = await fetch('/api/pdfa3', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const message = await response.json()
        .then((data: { error?: string }) => data.error)
        .catch(() => null);
      throw new Error(message ?? 'PDF/A-3-Konvertierung fehlgeschlagen.');
    }

    return new Uint8Array(await response.arrayBuffer());
  };

  const createInvoiceFile = async () => {
    setIsGenerating(true);
    try {
      const zugferdData = buildZugferdData();
      const xmlProfile = outputMode === 'xml-only' ? 'xrechnung' : 'factur-x';
      const validation = validateZugferdData(zugferdData, { profile: xmlProfile });
      if (!validation.isValid) {
        alert([
          'Die E-Rechnung kann noch nicht erstellt werden. Bitte ergänzen Sie:',
          '',
          ...validation.errors.map(issue => `- ${issue.message}`),
        ].join('\n'));
        return;
      }
      if (validation.warnings.length > 0) {
        console.warn('E-Rechnungshinweise:', validation.warnings);
      }

      const xmlContent = generateZugferdXml(zugferdData, { profile: xmlProfile });

      if (outputMode === 'xml-only') {
        const fileName = buildInvoiceFileName('xml');
        const blob = new Blob([xmlContent], { type: 'application/xml' });
        const file = new File([blob], fileName, { type: 'application/xml' });
        const uploadSuccess = await uploadGeneratedInvoice(file);

        downloadGeneratedFile(blob, fileName);
        if (uploadSuccess) {
          onClose();
        }
        return;
      }

      // Generate base PDF bytes and let the server normalize the final file to PDF/A-3.
      const pdfBytes = await generatePDFBytes(false);
      const finalPdfBytes = await convertToPdfA3(pdfBytes, xmlContent);
      const blob = new Blob([finalPdfBytes as BlobPart], { type: 'application/pdf' });
      const fileName = buildInvoiceFileName('pdf');
      const file = new File([blob], fileName, { type: 'application/pdf' });
      const uploadSuccess = await uploadGeneratedInvoice(file);

      downloadGeneratedFile(blob, fileName);
      if (uploadSuccess) {
        onClose();
      }
    } catch (error) {
      console.error("Error generating invoice file:", error);
      const message = error instanceof Error ? error.message : null;
      alert(outputMode === 'xml-only' ? "Fehler beim Erstellen der XML-Datei." : message ?? "Fehler beim Erstellen der PDF.");
    } finally {
      setIsGenerating(false);
    }
  };

  const isPage = presentation === "page";
  const editorContent = (
    <>
        <DialogHeader className="pb-2 text-left">
          {isPage && (
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className="w-fit gap-2 px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Zu den Rechnungen
            </Button>
          )}
          <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-2">
              {isPage ? (
                <h1 className="[overflow-wrap:anywhere] text-2xl font-bold tracking-tight sm:text-3xl">
                  Rechnung erstellen
                </h1>
              ) : (
                <DialogTitle>Rechnung erstellen</DialogTitle>
              )}
              {isPage ? (
                <p className="max-w-[65ch] text-sm text-muted-foreground">
                  Erfassen Sie Empfänger, Leistungsdaten und Positionen. Bivaro prüft die E-Rechnungsdaten vor dem Speichern.
                </p>
              ) : (
                <DialogDescription>
                  Erstellen Sie eine ZUGFeRD-PDF-Rechnung oder eine eigenständige E-Rechnungs-XML.
                </DialogDescription>
              )}
            </div>
            <Button
              type="button"
              variant={showPreview ? "default" : "outline"}
              size="sm"
              onClick={() => setShowPreview(!showPreview)}
              className="w-fit gap-2 whitespace-nowrap"
              aria-pressed={showPreview}
            >
              {showPreview ? (
                <>
                  <EyeOff className="h-4 w-4" />
                  Vorschau ausblenden
                </>
              ) : (
                <>
                  <Eye className="h-4 w-4" />
                  Live-Vorschau
                </>
              )}
            </Button>
          </div>
        </DialogHeader>

        <div className={`grid min-w-0 gap-8 ${showPreview ? (isPage ? 'xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.85fr)]' : 'lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.85fr)]') : 'grid-cols-1'}`}>
          {/* Form Section */}
          <div className={isPage ? "min-w-0 space-y-8 py-4" : "min-w-0 space-y-6 py-4"}>
            {/* Template Section */}
            <section className={isPage ? "space-y-3 border-b border-border pb-8" : "mb-2 rounded-md border bg-muted/30 p-3"} aria-labelledby="invoice-template-title">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Label id="invoice-template-title" className="text-sm font-medium">Vorlage laden oder speichern</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-fit text-xs whitespace-nowrap"
                  onClick={() => setIsSaveTemplateOpen(!isSaveTemplateOpen)}
                  aria-expanded={isSaveTemplateOpen}
                >
                  {isSaveTemplateOpen ? "Eingabe schließen" : "Als Vorlage speichern"}
                </Button>
              </div>

              {isSaveTemplateOpen ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    aria-label="Name der neuen Rechnungsvorlage"
                    placeholder="Name der Vorlage"
                    value={newTemplateName}
                    onChange={(e) => setNewTemplateName(e.target.value)}
                    className="text-sm"
                  />
                  <Button type="button" size="sm" onClick={handleSaveTemplate}>Vorlage speichern</Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <select
                    aria-label="Rechnungsvorlage auswählen"
                    className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-2 outline-transparent focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
                    value={selectedTemplateId}
                    onChange={(e) => handleLoadTemplate(e.target.value)}
                  >
                    <option value="">Vorlage wählen</option>
                    {templates.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  {selectedTemplateId && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDeleteTemplate(selectedTemplateId)}
                      title="Vorlage löschen"
                      aria-label="Ausgewählte Vorlage löschen"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              )}
            </section>

            <section className={isPage ? "space-y-2 border-b border-border pb-8" : "rounded-md border border-primary/20 bg-primary/5 p-3"} aria-labelledby="invoice-output-title">
              <Label id="invoice-output-title" htmlFor="invoice-output-mode" className="text-sm font-medium">Ausgabeformat</Label>
              <select
                id="invoice-output-mode"
                className="mt-2 flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-2 outline-transparent focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
                value={outputMode}
                onChange={(e) => setOutputMode(e.target.value as InvoiceOutputMode)}
              >
                <option value="zugferd-pdf">ZUGFeRD-PDF mit eingebetteter XML</option>
                <option value="xml-only">Nur XRechnung-XML (ohne PDF)</option>
              </select>
              <p className="text-xs text-muted-foreground mt-2">
                {outputMode === 'xml-only'
                  ? 'Erstellt eine eigenständige XRechnung-CII-XML-Datei. Sie wird gespeichert, heruntergeladen und kann danach mit dem E-Rechnungs-Viewer angesehen werden.'
                  : 'Erstellt eine PDF-Rechnung mit eingebetteter strukturierter XML-Datei für ZUGFeRD/Factur-X.'}
              </p>
            </section>

            {/* Top Row: Invoice Details */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="invoice-number">Rechnungsnummer</Label>
                <Input
                  id="invoice-number"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder="RE-2024-001"
                  aria-invalid={Boolean(invoiceNumberError)}
                  aria-describedby={invoiceNumberError ? "invoice-number-error" : undefined}
                  className={invoiceNumberError ? "border-destructive outline-destructive" : ""}
                />
                {invoiceNumberError && (
                  <p id="invoice-number-error" className="min-h-[1lh] text-xs font-medium text-destructive">{invoiceNumberError}</p>
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
                  aria-label="Gespeicherten Kunden auswählen"
                  className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-2 outline-transparent focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
                  onChange={handleCustomerSelect}
                  defaultValue=""
                >
                  <option value="" disabled>Kunden auswählen …</option>
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

                <Label htmlFor="includeQRCode" className="mt-4 flex min-h-11 cursor-pointer items-center gap-1 text-sm font-medium leading-tight has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-70">
                  <span className="grid size-11 shrink-0 place-items-center">
                    <input
                      type="checkbox"
                      id="includeQRCode"
                      checked={includeQRCode}
                      onChange={(e) => setIncludeQRCode(e.target.checked)}
                      disabled={outputMode === 'xml-only'}
                      className="h-5 w-5 rounded border-input accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed"
                    />
                  </span>
                  <span>
                    GiroCode (QR-Code) für Banking-Apps hinzufügen{outputMode === 'xml-only' ? ' (nur PDF)' : ''}
                  </span>
                </Label>
              </div>
            </div>

            {/* Items Table */}
            <div className="space-y-2">
              <Label>Positionen</Label>
              <div className="border rounded-md overflow-hidden">
                <div className="hidden grid-cols-[minmax(0,1fr)_70px_90px_100px_70px_90px] items-center gap-2 bg-muted p-2 text-sm font-medium md:grid">
                  <div className="pl-2">Beschreibung</div>
                  <div className="text-center">Menge</div>
                  <div className="text-center">Einheit</div>
                  <div className="text-center">Einzelpreis</div>
                  <div className="text-center">Steuer</div>
                  <div></div>
                </div>
                <div className="divide-y">
                  {items.map((item, index) => (
                    <div key={index} className="grid min-w-0 grid-cols-2 items-start gap-3 p-4 md:grid-cols-[minmax(0,1fr)_70px_90px_100px_70px_90px] md:gap-2 md:p-2">
                      <div className="col-span-2 min-w-0 md:col-span-1">
                        <Label htmlFor={`invoice-item-description-${index}`} className="mb-1 block md:sr-only">Beschreibung</Label>
                        <Input
                          id={`invoice-item-description-${index}`}
                          value={item.description}
                          onChange={(e) => updateItem(index, 'description', e.target.value)}
                          placeholder="Leistung / Produkt"
                        />
                      </div>
                      <div>
                        <Label htmlFor={`invoice-item-quantity-${index}`} className="mb-1 block md:sr-only">Menge</Label>
                        <Input
                          id={`invoice-item-quantity-${index}`}
                          type="number"
                          value={item.quantity}
                          onChange={(e) => updateItem(index, 'quantity', e.target.value)}
                          placeholder="1"
                          className="text-right tabular-nums"
                        />
                      </div>
                      <div>
                        <Label htmlFor={`invoice-item-unit-${index}`} className="mb-1 block md:sr-only">Einheit</Label>
                        <select
                          id={`invoice-item-unit-${index}`}
                          className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-2 outline-transparent focus-visible:outline-ring"
                          value={item.unit}
                          onChange={(e) => updateItem(index, 'unit', e.target.value)}
                        >
                          <option value="Stück">Stück</option>
                          <option value="Stunde">Stunde</option>
                          <option value="Tag">Tag</option>
                          <option value="Pauschal">Pauschal</option>
                        </select>
                      </div>
                      <div>
                        <Label htmlFor={`invoice-item-price-${index}`} className="mb-1 block md:sr-only">Einzelpreis</Label>
                        <Input
                          id={`invoice-item-price-${index}`}
                          type="number"
                          value={item.unitPrice}
                          onChange={(e) => updateItem(index, 'unitPrice', e.target.value)}
                          placeholder="0,00"
                          className="text-right tabular-nums"
                        />
                      </div>
                      <div className="relative">
                        <Label htmlFor={`invoice-item-tax-${index}`} className="mb-1 block md:sr-only">Steuer</Label>
                        <Input
                          id={`invoice-item-tax-${index}`}
                          type="number"
                          value={item.taxRate}
                          onChange={(e) => updateItem(index, 'taxRate', e.target.value)}
                          placeholder="0"
                          className="pr-7 text-right tabular-nums"
                        />
                        <span className="pointer-events-none absolute right-2 bottom-3 text-sm text-muted-foreground">%</span>
                      </div>
                      <div className="col-span-2 flex justify-end gap-1 md:col-span-1">
                        <Button type="button" variant="ghost" size="icon" onClick={() => duplicateItem(index)} title="Zeile duplizieren" aria-label={`Position ${index + 1} duplizieren`} className="text-muted-foreground hover:text-foreground">
                          <Copy className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" onClick={() => removeItem(index)} disabled={items.length === 1} aria-label={`Position ${index + 1} entfernen`} className="text-destructive hover:text-destructive">
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-3 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Button type="button" variant="outline" size="sm" onClick={addItem}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Position hinzufügen
                </Button>
                <div className="text-left font-bold tabular-nums sm:text-right">
                  Gesamt: {items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                </div>
              </div>
            </div>
          </div>

          {/* Preview Section */}
          {showPreview && (
            <aside className={isPage ? "flex min-h-[36rem] min-w-0 flex-col border-t border-border pt-6 xl:sticky xl:top-24 xl:h-[calc(100dvh-8rem)] xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0" : "flex min-h-[28rem] min-w-0 flex-col border-t border-border pt-4 lg:h-[calc(90vh-180px)] lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0"} aria-label="Rechnungsvorschau">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">PDF-Vorschau</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={generatePreview}
                  disabled={isGeneratingPreview}
                  className="gap-1 whitespace-nowrap text-xs"
                >
                  {isGeneratingPreview ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  Aktualisieren
                </Button>
              </div>

              <div className="flex-1 rounded-lg border bg-muted/30 overflow-hidden relative">
                {isGeneratingPreview && !previewUrl && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                      <span className="text-sm text-muted-foreground">Vorschau wird generiert …</span>
                    </div>
                  </div>
                )}

                {previewUrl ? (
                  <iframe
                    src={previewUrl}
                    className="w-full h-full border-0"
                    title="Rechnungsvorschau"
                  />
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
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Aktualisiere …
                  </div>
                )}
              </div>

              <p className="text-xs text-muted-foreground mt-2">
                Die Vorschau aktualisiert sich automatisch bei Änderungen. {outputMode === 'xml-only' ? 'Bei XML-only dient sie nur als Layoutkontrolle; gespeichert wird ausschließlich die XML-Datei.' : 'Der QR-Code wird erst in der finalen PDF angezeigt.'}
              </p>
            </aside>
          )}
        </div>

        <DialogFooter className={isPage ? "mt-8 border-t border-border pt-4" : undefined}>
          <Button type="button" variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button type="button" onClick={createInvoiceFile} disabled={isGenerating || !customerAddress || !invoiceNumber || !!invoiceNumberError || isCheckingNumber}>
            {isGenerating
              ? (outputMode === 'xml-only' ? "Erstelle XML …" : "Erstelle PDF …")
              : (outputMode === 'xml-only' ? "XML erstellen" : "PDF erstellen")}
          </Button>
        </DialogFooter>
    </>
  );

  if (isPage) {
    return (
      <section className="min-w-0" aria-label="Neue Rechnung">
        {editorContent}
      </section>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`max-h-[90vh] overflow-y-auto ${showPreview ? 'sm:max-w-[1400px]' : 'sm:max-w-[800px]'}`}>
        {editorContent}
      </DialogContent>
    </Dialog>
  );
}
