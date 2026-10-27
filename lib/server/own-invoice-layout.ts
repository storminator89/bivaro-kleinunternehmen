import QRCode from 'qrcode';
import type PDFDocument from 'pdfkit';
import { calculateInvoiceAmounts } from '@/lib/invoice-calculation';
import { formatOwnInvoiceDate, OwnInvoiceInputError, type OwnInvoiceSource } from '@/lib/own-invoice-source';
import { normalizeOwnInvoiceImage, type NormalizedInvoiceImage } from '@/lib/server/own-invoice-image';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
export const MAX_OWN_INVOICE_PAGES = 100;
type InvoiceColor = [number, number, number];
type InvoiceFont = { name: string; widthOfTextAtSize: (text: string, size: number) => number };
const rgb = (r: number, g: number, b: number): InvoiceColor => [r * 255, g * 255, b * 255];

/** The application-owned invoice layout, shared unchanged by preview and issue.
 * Input is a bounded invoice source, never caller-supplied drawing commands.
 * Coordinates retain the existing invoice's bottom-left, point-based design.
 */
export async function renderOwnInvoiceLayout(
  doc: InstanceType<typeof PDFDocument>,
  source: OwnInvoiceSource,
  assets: { logo?: NormalizedInvoiceImage },
): Promise<void> {
  const { settings, customerAddress, invoiceNumber, date, dueDate, deliveryDate, notes, items,
    includeQRCode, taxMode, buyerReference, paymentMeansCode, sellerCountry, buyerCountry,
    buyerPostcode, buyerCity, sellerPostcode, sellerCity } = source;
  const selectedCustomer = source.customerId ? { id: source.customerId } : undefined;
  const width = PAGE_WIDTH;
  const height = PAGE_HEIGHT;
  let pageCount = 0;
  const addPage = () => {
    if (pageCount >= MAX_OWN_INVOICE_PAGES) throw new Error('Die Rechnung hat zu viele Seiten.');
    doc.addPage({ size: [width, height], margin: 0 });
    return pageCount++;
  };
  let page = addPage();
  const makeFont = (name: string): InvoiceFont => ({ name,
    widthOfTextAtSize: (value, size) => doc.font(name).fontSize(size).widthOfString(value, { features: [] }),
  });
  const font = makeFont('InvoiceRegular');
  const boldFont = makeFont('InvoiceBold');
  const paintText = (target: number, value: string, options: { x: number; y: number; size: number; font: InvoiceFont; color: InvoiceColor }) => {
    doc.switchToPage(target);
    doc.font(options.font.name).fontSize(options.size).fillColor(options.color)
      .text(value, options.x, height - options.y, { lineBreak: false, baseline: 'alphabetic', features: [] });
  };
  const rect = (target: number, options: { x: number; y: number; width: number; height: number; color: InvoiceColor; borderColor?: InvoiceColor; borderWidth?: number }) => {
    doc.switchToPage(target);
    doc.save().rect(options.x, height - options.y - options.height, options.width, options.height).fillColor(options.color);
    if (options.borderColor) doc.lineWidth(options.borderWidth ?? 0.6).strokeColor(options.borderColor).fillAndStroke();
    else doc.fill();
    doc.restore();
  };
  const line = (target: number, options: { start: { x: number; y: number }; end: { x: number; y: number }; thickness: number; color: InvoiceColor }) => {
    doc.switchToPage(target);
    doc.save().lineWidth(options.thickness).strokeColor(options.color)
      .moveTo(options.start.x, height - options.start.y).lineTo(options.end.x, height - options.end.y).stroke().restore();
  };
  const image = (target: number, value: NormalizedInvoiceImage, options: { x: number; y: number; width: number; height: number }) => {
    doc.switchToPage(target);
    // Only fully decoded, freshly encoded JPEG bytes reach PDFKit's decoder.
    doc.image(value.bytes, options.x, height - options.y - options.height, { width: options.width, height: options.height });
  };
  const formatCurrency = (amount: number) => amount.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
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
  const buyerPostalLine = [buyerPostcode.trim(), buyerCity.trim()].filter(Boolean).join(' ');
  if (buyerCountry !== 'DE' && buyerPostalLine && customerLines.at(-1) !== buyerPostalLine) customerLines.push(buyerPostalLine);
  const sellerPostalLine = [sellerPostcode.trim(), sellerCity.trim()].filter(Boolean).join(' ');
  if (sellerCountry !== 'DE' && sellerPostalLine && companyAddressLines.at(-1) !== sellerPostalLine) companyAddressLines.push(sellerPostalLine);
  if (buyerCountry) customerLines.push(buyerCountry);
  if (companyAddressLines.length > 5 || customerLines.length > 10) {
    throw new OwnInvoiceInputError('Die Anschrift enthält zu viele Zeilen für das unterstützte Rechnungslayout.');
  }
  const amounts = calculateInvoiceAmounts(items);
  const calculatedItems = items.map((item, index) => ({
    ...item,
    lineNet: amounts.lines[index].netAmount,
  }));
  const netTotal = amounts.netAmount;
  const taxTotal = amounts.taxAmount;
  const grossTotal = amounts.grossAmount;

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

  const formatDate = (value?: string) => value ? formatOwnInvoiceDate(value) : '-';
  const formatQuantity = (value: number) => value.toLocaleString('de-DE', { maximumFractionDigits: 12 });
  const formatUnitPrice = (value: number) => value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 12 }) + ' €';
  const formatTaxRate = (value: number) => `${value.toLocaleString('de-DE', { maximumFractionDigits: 12 })}%`;

  const fitNumber = (value: string, maxWidth: number, initialSize: number, selectedFont: InvoiceFont = font,
    errorMessage = 'Ein Zahlenwert ist für die Rechnung zu lang, um ihn vollständig und lesbar darzustellen.') => {
    let size = initialSize;
    while (size > 6 && selectedFont.widthOfTextAtSize(value, size) > maxWidth) size -= 0.25;
    if (selectedFont.widthOfTextAtSize(value, size) > maxWidth) {
      throw new OwnInvoiceInputError(errorMessage);
    }
    return { size, width: selectedFont.widthOfTextAtSize(value, size) };
  };
  const invoiceNumberDisplay = invoiceNumber || 'RE-XXXX';
  const invoiceNumberError = 'Die Rechnungsnummer ist für das unterstützte Layout zu lang. Bitte eine kürzere Nummer verwenden.';
  const invoiceNumberSize = fitNumber(invoiceNumberDisplay, 92, 8.5, boldFont, invoiceNumberError).size;

  const drawTextRight = (
    text: string,
    x: number,
    y: number,
    size: number,
    fontToUse: InvoiceFont = font,
    color: InvoiceColor = textColor,
    targetPage: number = page,
  ) => {
    const textWidth = fontToUse.widthOfTextAtSize(text, size);
    paintText(targetPage, text, { x: x - textWidth, y, size, font: fontToUse, color });
  };

  const drawTextCenter = (
    text: string,
    x: number,
    y: number,
    size: number,
    fontToUse: InvoiceFont = font,
    color: InvoiceColor = textColor,
    targetPage: number = page,
  ) => {
    const textWidth = fontToUse.widthOfTextAtSize(text, size);
    paintText(targetPage, text, { x: x - textWidth / 2, y, size, font: fontToUse, color });
  };

  const truncateText = (text: string, maxWidth: number, size: number, fontToUse: InvoiceFont = font) => {
    if (fontToUse.widthOfTextAtSize(text, size) <= maxWidth) return text;

    const characters = Array.from(text);
    let low = 0;
    let high = characters.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (fontToUse.widthOfTextAtSize(`${characters.slice(0, middle).join('')}...`, size) <= maxWidth) low = middle;
      else high = middle - 1;
    }
    return low > 0 ? `${characters.slice(0, low).join('')}...` : '';
  };

  const splitText = (text: string, maxWidth: number, size: number, fontToUse: InvoiceFont = font): string[] => {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized) return [''];

    const splitLongWord = (word: string) => {
      const characters = Array.from(word);
      const parts: string[] = [];
      let offset = 0;
      while (offset < characters.length) {
        const remaining = characters.length - offset;
        const prefix = (count: number) => characters.slice(offset, offset + count).join('');
        let low = 0;
        let high = 1;
        // Exponential bracketing avoids repeatedly shaping an ever-growing
        // prefix, including long runs of supported zero-width combining marks.
        while (fontToUse.widthOfTextAtSize(prefix(high), size) <= maxWidth) {
          low = high;
          if (high === remaining) break;
          high = Math.min(remaining, high * 2);
        }
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          if (fontToUse.widthOfTextAtSize(prefix(middle), size) <= maxWidth) low = middle;
          else high = middle - 1;
        }
        const count = Math.max(1, low);
        parts.push(prefix(count));
        offset += count;
      }
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

  const footerColumnWidth = (contentWidth - 44) / 3;
  const contactLine = [settings?.email, settings?.telephone].filter(isNonEmptyString).join(' | ');
  const footerLeft = [companyName, ...companyAddressLines, sellerCountry, contactLine]
    .filter(isNonEmptyString)
    .flatMap(value => splitText(value, footerColumnWidth, 7));
  // Eight footer lines fit below the existing content boundary on every page.
  // Essential party data must never become an ellipsis or overlap invoice rows.
  if (footerLeft.length > 8) {
    throw new OwnInvoiceInputError('Die Ausstelleranschrift und Kontaktdaten sind für das unterstützte Rechnungslayout zu lang. Bitte kürzere Angaben verwenden.');
  }

  const drawCard = (
    x: number,
    topY: number,
    cardWidth: number,
    cardHeight: number,
    color: InvoiceColor,
    borderColor: InvoiceColor = hairline,
    targetPage: number = page,
  ) => {
    rect(targetPage, {
      x,
      y: topY - cardHeight,
      width: cardWidth,
      height: cardHeight,
      color,
      borderColor,
      borderWidth: 0.6,
    });
  };

  const logoImage = assets.logo;

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

  let qrCodeImage: NormalizedInvoiceImage | undefined;
  const canRenderQRCode = paymentMeansCode !== '10' && includeQRCode && Boolean(settings?.iban && settings?.companyName);
  if (canRenderQRCode) {
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

      const qrCodeBytes = await QRCode.toBuffer(giroCodeData, {
        errorCorrectionLevel: 'M',
        type: 'png',
        margin: 4,
      });
      qrCodeImage = await normalizeOwnInvoiceImage(qrCodeBytes);
    } catch (error) {
      throw new Error('Der GiroCode konnte nicht erstellt werden.', { cause: error });
    }
  }

  const drawDocumentHeader = (targetPage: number) => {
    const headerHeight = 68;
    const headerBottom = height - headerHeight;

    rect(targetPage, { x: 0, y: headerBottom, width, height: headerHeight, color: brandDark });
    rect(targetPage, { x: 0, y: headerBottom, width, height: 5, color: brandAccent });
    rect(targetPage, { x: 0, y: headerBottom, width: 5, height: headerHeight, color: brandAccent });

    paintText(targetPage, 'RECHNUNG', {
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
      const logoDims = { width: logoImage.width * scale, height: logoImage.height * scale };
      image(targetPage, logoImage, {
        x: logoCardX + (logoCardWidth - logoDims.width) / 2,
        y: logoCardTop - logoCardHeight + (logoCardHeight - logoDims.height) / 2,
        width: logoDims.width,
        height: logoDims.height,
      });
    }
  };

  const drawContinuationHeader = (targetPage: number) => {
    rect(targetPage, { x: 0, y: height - 58, width, height: 58, color: brandDark });
    rect(targetPage, { x: 0, y: height - 58, width, height: 5, color: brandAccent });
    paintText(targetPage, 'RECHNUNG', { x: margin, y: height - 36, size: 14, font: boldFont, color: white });
    paintText(targetPage, 'Fortsetzung', { x: margin, y: height - 50, size: 8, font, color: lightText });
    drawTextRight(invoiceNumberDisplay, width - margin, height - 36,
      fitNumber(invoiceNumberDisplay, contentWidth - 130, 10, boldFont, invoiceNumberError).size, boldFont, white, targetPage);

    return height - 88;
  };

  const drawFooter = (targetPage: number, pageNumber: number, pageCount: number) => {
    const footerFontSize = 7;
    const footerLineHeight = 9;
    const columnWidth = footerColumnWidth;
    // Keep routine invoices pixel-positioned as before. Longer supported
    // addresses grow upward into the reserved footer area, not over page numbers.
    const footerStartY = 74 + Math.max(0, footerLeft.length - 5) * footerLineHeight;
    const footerTop = footerStartY + 18;
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

    line(targetPage, {
      start: { x: margin, y: footerTop },
      end: { x: width - margin, y: footerTop },
      thickness: 0.6,
      color: hairline,
    });
    rect(targetPage, { x: margin, y: footerTop + 3, width: 72, height: 2, color: brandAccent });

    let footerY = footerStartY;
    footerLeft.forEach(line => {
      paintText(targetPage, line, {
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
    page = addPage();
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

    rect(page, {
      x: margin,
      y: topY - 28,
      width: contentWidth,
      height: 28,
      color: brandDark,
    });
    rect(page, { x: margin, y: topY - 28, width: 5, height: 28, color: brandAccent });

    const labelY = topY - 18;
    paintText(page, 'Pos.', { x: colX.pos, y: labelY, size: 8, font: boldFont, color: white });
    paintText(page, 'Beschreibung', { x: colX.desc, y: labelY, size: 8, font: boldFont, color: white });
    drawTextRight('Menge', colX.qty, labelY, 8, boldFont, white);
    paintText(page, 'Einh.', { x: colX.unit, y: labelY, size: 8, font: boldFont, color: white });
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
      paintText(page, truncateText(senderText, contentWidth, 7, font), { x: margin, y: senderY, size: 7, font, color: mutedColor });
      line(page, {
        start: { x: margin, y: senderY - 4 },
        end: { x: margin + Math.min(font.widthOfTextAtSize(senderText, 7), contentWidth), y: senderY - 4 },
        thickness: 0.4,
        color: hairline,
      });
    }

    const cardTop = height - 116;
    const gap = 18;
    const detailsWidth = 214;
    const addressWidth = contentWidth - detailsWidth - gap;
    const detailsX = margin + addressWidth + gap;
    const displayedCustomerLines = (customerLines.length > 0 ? customerLines : ['Empfänger noch nicht angegeben'])
      .flatMap((value, index) => splitText(value, addressWidth - 34, index === 0 ? 11 : 10, index === 0 ? boldFont : font)
        .map(text => ({ text, name: index === 0 })));
    const cardHeight = Math.max(128, 58 + displayedCustomerLines.length * 15);
    // Keep the existing header/table geometry and enough room for the first row.
    if (cardTop - cardHeight - 28 - 20 - 42 - 44 < bottomContentY) {
      throw new OwnInvoiceInputError('Die Empfängeranschrift ist für das unterstützte Rechnungslayout zu lang. Bitte kürzere Angaben verwenden.');
    }

    drawCard(margin, cardTop, addressWidth, cardHeight, surface, hairline);
    rect(page, { x: margin, y: cardTop - cardHeight, width: 5, height: cardHeight, color: brandAccent });
    paintText(page, 'EMPFÄNGER', { x: margin + 17, y: cardTop - 24, size: 7, font: boldFont, color: brandAccent });

    let addressY = cardTop - 46;
    displayedCustomerLines.forEach(line => {
      paintText(page, line.text, {
        x: margin + 17,
        y: addressY,
        size: line.name ? 11 : 10,
        font: line.name ? boldFont : font,
        color: line.name ? textColor : mutedColor,
      });
      addressY -= 15;
    });

    drawCard(detailsX, cardTop, detailsWidth, cardHeight, white, hairline);
    rect(page, { x: detailsX, y: cardTop - 32, width: detailsWidth, height: 32, color: surfaceStrong });
    paintText(page, 'Rechnungsdetails', { x: detailsX + 15, y: cardTop - 21, size: 9, font: boldFont, color: textColor });

    const detailRows: Array<[string, string]> = [
      ['Rechnungs-Nr.', invoiceNumber || 'RE-XXXX'],
      ['Datum', formatDate(date)],
    ];

    if (selectedCustomer?.id) detailRows.push(['Kundennr.', selectedCustomer.id.toString()]);
    if (deliveryDate) detailRows.push(['Leistung', formatDate(deliveryDate)]);
    if (dueDate) detailRows.push(['Fällig', formatDate(dueDate)]);

    let detailY = cardTop - 48;
    detailRows.slice(0, 5).forEach(([label, value]) => {
      paintText(page, label, { x: detailsX + 15, y: detailY, size: 8, font, color: mutedColor });
      const isInvoiceNumber = label === 'Rechnungs-Nr.';
      drawTextRight(isInvoiceNumber ? value : truncateText(value, 92, 8.5, boldFont), detailsX + detailsWidth - 15, detailY,
        isInvoiceNumber ? invoiceNumberSize : 8.5, boldFont, textColor);
      detailY -= 15;
    });

    return cardTop - cardHeight - 28;
  };

  y = drawFirstPageIntro();
  paintText(page, 'Positionen', { x: margin, y, size: 14, font: boldFont, color: textColor });
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
  const quantityMetrics = calculatedItems.map(item => fitNumber(formatQuantity(item.quantity), 60, 9));
  const descriptionWidth = Math.min(colX.qty - colX.desc - 18,
    colX.qty - colX.desc - Math.max(...quantityMetrics.map(value => value.width)) - 10);

  calculatedItems.forEach((item, index) => {
    let remainingLines = splitText(item.description || 'Position', descriptionWidth, 9.5, font);
    let continuation = false;
    while (remainingLines.length > 0) {
      ensureSpace(44, true);
      const availableLines = Math.max(1, Math.floor((y - bottomContentY - 26) / 12));
      const descLines = remainingLines.slice(0, availableLines);
      remainingLines = remainingLines.slice(descLines.length);
      const rowHeight = Math.max(38, descLines.length * 12 + 16);
      const rowTop = y;
      const rowBottom = rowTop - rowHeight;
      const fillColor = index % 2 === 0 ? surface : white;
      rect(page, { x: margin, y: rowBottom, width: contentWidth, height: rowHeight,
        color: fillColor, borderColor: rgb(0.9, 0.93, 0.97), borderWidth: 0.35 });
      rect(page, { x: margin, y: rowBottom, width: 3, height: rowHeight, color: index % 2 === 0 ? brandAccent : hairline });
      const textY = rowTop - 16;
      paintText(page, continuation ? '…' : (index + 1).toString().padStart(2, '0'), { x: colX.pos, y: textY, size: 8.5, font: boldFont, color: brandAccent });
      descLines.forEach((value, lineIndex) => {
        paintText(page, value, { x: colX.desc, y: textY - lineIndex * 12, size: 9.5, font, color: textColor });
      });
      if (!continuation) {
        const unitPriceError = 'Einheit und Einzelpreis sind für die Rechnung zu lang, um sie vollständig und lesbar darzustellen.';
        const unitMinimumWidth = font.widthOfTextAtSize(item.unit, 6);
        const price = fitNumber(formatUnitPrice(item.unitPrice),
          Math.min(60, colX.price - colX.unit - 8 - unitMinimumWidth), 9, font, unitPriceError);
        const tax = fitNumber(formatTaxRate(item.taxRate), 46, 9);
        const lineTotal = fitNumber(formatCurrency(item.lineNet), 52, 9, boldFont);
        drawTextRight(formatQuantity(item.quantity), colX.qty, textY, quantityMetrics[index].size, font, textColor);
        const unitWidth = Math.min(45, colX.price - price.width - colX.unit - 8);
        const unitSize = fitNumber(item.unit, unitWidth, 8.5, font, unitPriceError).size;
        paintText(page, item.unit, { x: colX.unit, y: textY, size: unitSize, font, color: mutedColor });
        drawTextRight(formatUnitPrice(item.unitPrice), colX.price, textY, price.size, font, textColor);
        drawTextRight(formatTaxRate(item.taxRate), colX.tax, textY, tax.size, font, mutedColor);
        drawTextRight(formatCurrency(item.lineNet), colX.total, textY, lineTotal.size, boldFont, textColor);
      }
      y = rowBottom - 4;
      continuation = true;
      if (remainingLines.length > 0) y = drawTableHeader(addContentPage());
    }
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
  paintText(page, 'Zahlung', { x: margin + 16, y: summaryTop - 24, size: 10, font: boldFont, color: textColor });
  paintText(page, dueDate ? `Zahlbar bis ${formatDate(dueDate)}` : 'Zahlbar nach Erhalt der Rechnung', {
    x: margin + 16,
    y: summaryTop - 42,
    size: 9,
    font: boldFont,
    color: brandBlue,
  });

  const qrSize = 72;
  const qrPadding = canRenderQRCode ? 96 : 0;
  const paymentTextWidth = paymentCardWidth - 32 - qrPadding;
  const paymentLines = paymentMeansCode === '10' ? ['Zahlungsart: Barzahlung'] : [
    settings?.bankName ? `Bank: ${settings.bankName}` : undefined,
    settings?.iban ? `IBAN: ${settings.iban}` : undefined,
    settings?.bic ? `BIC: ${settings.bic}` : undefined,
    invoiceNumber ? `Verwendungszweck: ${invoiceNumber}` : undefined,
  ].filter(isNonEmptyString);
  let paymentY = summaryTop - 62;
  paymentLines.slice(0, 4).forEach(line => {
    paintText(page, truncateText(line, paymentTextWidth, 8, font), {
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
      image(page, qrCodeImage, { x: qrX, y: qrY, width: qrSize, height: qrSize });
    } else {
      rect(page, {
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
  rect(page, { x: totalCardX, y: summaryTop - summaryHeight, width: totalCardWidth, height: 46, color: brandAccent });
  paintText(page, 'Zusammenfassung', { x: totalCardX + 16, y: summaryTop - 24, size: 10, font: boldFont, color: white });

  let totalY = summaryTop - 48;
  const totalRows: Array<[string, string]> = [
    ['Netto', formatCurrency(netTotal)],
    [taxTotal > 0 ? 'zzgl. USt.' : 'zzgl. USt. 0%', taxTotal > 0 ? formatCurrency(taxTotal) : '0,00 €'],
  ];

  totalRows.forEach(([label, value]) => {
    paintText(page, label, { x: totalCardX + 16, y: totalY, size: 8.5, font, color: lightText });
    drawTextRight(value, totalCardX + totalCardWidth - 16, totalY, 8.5, font, white);
    totalY -= 17;
  });

  paintText(page, 'Gesamtbetrag', { x: totalCardX + 16, y: summaryTop - summaryHeight + 27, size: 8.5, font: boldFont, color: white });
  drawTextRight(formatCurrency(grossTotal), totalCardX + totalCardWidth - 16, summaryTop - summaryHeight + 24,
    fitNumber(formatCurrency(grossTotal), totalCardWidth - 32 - boldFont.widthOfTextAtSize('Gesamtbetrag', 8.5) - 8, 14, boldFont).size,
    boldFont, white);

  y = summaryTop - summaryHeight - 16;

  const noteLines: string[] = [];
  if (notes.trim()) {
    notes.split('\n').forEach(line => {
      noteLines.push(...splitText(line, contentWidth - 36, 9, font));
    });
  }
  if (taxMode === 'small-business') {
    if (noteLines.length > 0) noteLines.push('');
    noteLines.push(...splitText('Hinweis: Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.', contentWidth - 36, 9, font));
  }

  if (taxMode === 'standard') {
    for (const reason of new Set(items.filter(item => item.taxCategory === 'E').map(item => item.exemptionReason?.trim()).filter(Boolean))) {
      noteLines.push(...splitText(`Steuerbefreiung: ${reason}`, contentWidth - 36, 9, font));
    }
  }
  if (buyerReference.trim()) noteLines.push(...splitText(`Käuferreferenz: ${buyerReference.trim()}`, contentWidth - 36, 9, font));

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
      rect(page, { x: margin, y: y - 30, width: contentWidth, height: 30, color: surface });
      paintText(page, title, { x: margin + 16, y: y - 20, size: 9.5, font: boldFont, color: textColor });

      let lineY = y - 45;
      pageLines.forEach(line => {
        if (line) {
          paintText(page, line, { x: margin + 16, y: lineY, size: 9, font, color: mutedColor });
        }
        lineY -= 12;
      });

      y = y - cardHeight - 14;
      remainingLines = remainingLines.slice(pageLines.length);
    }
  };

  if (noteLines.length > 0) {
    // Short payment/tax notes need no separate heading band. Reserve their
    // actual height so a single required tax sentence cannot orphan a page.
    if (noteLines.length <= 3) {
      const cardHeight = 12 + noteLines.length * 12;
      ensureSpace(cardHeight);
      drawCard(margin, y, contentWidth, cardHeight, surface, hairline);
      noteLines.forEach((value, index) => {
        if (value) paintText(page, value, { x: margin + 16, y: y - 15 - index * 12, size: 9, font, color: mutedColor });
      });
      y -= cardHeight + 14;
    } else {
      drawTextBlockCard('Hinweise', noteLines);
    }
  }

  if (y - 30 >= bottomContentY) {
    paintText(page, 'Vielen Dank für Ihr Vertrauen.', { x: margin, y, size: 10, font: boldFont, color: brandBlue });
  }

  const pages = Array.from({ length: pageCount }, (_, index) => index);

  pages.forEach((pdfPage, index) => {
    drawFooter(pdfPage, index + 1, pageCount);
  });

}
