import { extractEmbeddedEInvoiceXml, parseEInvoiceXmlWithExactDecimals, getEInvoiceImportRejection } from '@/lib/e-invoice-parser';
import type { ParsedEInvoice, EInvoiceExactDecimals } from '@/lib/e-invoice-parser';
import { parseMoneyEUR, formatMoneyEUR } from '@/lib/money';
import type { PurchaseParsePreview, PurchaseParserWarning } from './types';

export const PURCHASE_PARSER_VERSION = 'purchase-preview-v2-exact-decimals';
export type PurchaseParseResult = {
  parseStatus: 'PARSED' | 'FAILED';
  parseErrorCode: string | null;
  preview: PurchaseParsePreview | null;
  parsed: ParsedEInvoice | null;
};
/** Normalize XML decimal syntax without Number conversion or loss of source digits. */
function sourceDecimal(value: string | null): string | null {
  if (value === null || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return null;
  const unsigned = value.startsWith('+') ? value.slice(1) : value;
  return unsigned.replace(/^(-?)\./, (_match, sign: string) => `${sign}0.`).replace(/\.$/, '');
}
function supportedSourceMoney(value: string | null): bigint | null {
  const source = sourceDecimal(value);
  if (source === null) return null;
  try {
    const cents = parseMoneyEUR(source, { mode: 'strict' });
    if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < -BigInt(Number.MAX_SAFE_INTEGER)) return null;
    // Even safe integer cents can lose a cent when persisted into the legacy Float.
    if (parseMoneyEUR(Number(source), { mode: 'strict' }) !== cents) return null;
    return cents;
  } catch { return null; }
}
export function safeGrossAmount(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  try {
    const cents = parseMoneyEUR(value, { mode: 'strict' });
    return cents <= BigInt(Number.MAX_SAFE_INTEGER) && cents >= -BigInt(Number.MAX_SAFE_INTEGER) ? formatMoneyEUR(cents) : null;
  } catch { return null; }
}
export function buildPurchasePreview(parsed: ParsedEInvoice, exact: EInvoiceExactDecimals): PurchaseParsePreview {
  const parserWarnings: PurchaseParserWarning[] = [{ code: 'NOT_VALIDATED', message: 'Nur Extraktion: keine XSD-/Schematron- oder steuerliche Konformitätsprüfung.' }];
  const rejection = getEInvoiceImportRejection(parsed);
  if (rejection) parserWarnings.push({ code: 'UNSUPPORTED_APPROVAL', message: rejection });
  const grossAmount = sourceDecimal(exact.grossAmount);
  const grossCents = supportedSourceMoney(exact.grossAmount);
  const dueCents = supportedSourceMoney(exact.dueAmount);
  const sourceMoneySupported = grossCents !== null && grossCents > BigInt(0) && dueCents === grossCents
    && [exact.prepaidAmount, exact.roundingAmount, exact.netAmount, exact.taxAmount, exact.lineTotalAmount, exact.chargeTotalAmount, exact.allowanceTotalAmount]
      .every(value => value === null || supportedSourceMoney(value) !== null)
    && [exact.prepaidAmount, exact.roundingAmount].every(value => value === null || supportedSourceMoney(value) === BigInt(0));
  if (!sourceMoneySupported) parserWarnings.push({ code: 'UNSUPPORTED_AMOUNT', message: 'Für die spätere Ausgabenerfassung ist ein positiver, centgenauer und sicher darstellbarer Bruttobetrag erforderlich.' });
  if (!parsed.invoiceDate) parserWarnings.push({ code: 'MISSING_INVOICE_DATE', message: 'Rechnungsdatum fehlt oder ist ungültig; es wurde nicht durch das Uploaddatum ersetzt.' });
  if (!parsed.sellerInfo.name || !parsed.invoiceNumber) parserWarnings.push({ code: 'DUPLICATE_CHECK_INCOMPLETE', message: 'Lieferant oder Rechnungsnummer fehlt; fachliche Dublettenprüfung ist eingeschränkt.' });
  if (parsed.buyerInfo.name) parserWarnings.push({ code: 'BUYER_REVIEW_REQUIRED', message: 'Empfänger und betriebliche Zugehörigkeit sind nicht bestätigt. Abweichungen anhand des Originals prüfen; ein Name allein belegt weder Eigentum noch Belegrichtung.' });
  if (!parsed.buyerInfo.name) parserWarnings.push({ code: 'BUYER_UNKNOWN', message: 'Empfänger fehlt. Die Zugehörigkeit muss anhand des Originals geprüft werden.' });
  return {
    extractionStatus: 'PARSED', validationStatus: 'NOT_VALIDATED',
    format: parsed.format, documentType: parsed.documentType, documentTypeCode: parsed.documentTypeCode,
    currency: parsed.currency, invoiceNumber: parsed.invoiceNumber,
    invoiceDate: parsed.invoiceDate?.toISOString() ?? null, dueDate: parsed.dueDate?.toISOString() ?? null,
    grossAmount, dueAmount: sourceDecimal(exact.dueAmount),
    prepaidAmount: sourceDecimal(exact.prepaidAmount), roundingAmount: sourceDecimal(exact.roundingAmount),
    netAmount: sourceDecimal(exact.netAmount), taxAmount: sourceDecimal(exact.taxAmount),
    sellerInfo: parsed.sellerInfo, buyerInfo: parsed.buyerInfo,
    lineItems: parsed.lineItems.map((line, index) => ({ description: line.description, quantity: sourceDecimal(exact.lineItems[index]?.quantity ?? null), unit: line.unit, unitPrice: sourceDecimal(exact.lineItems[index]?.unitPrice ?? null), amount: sourceDecimal(exact.lineItems[index]?.amount ?? null), taxRate: sourceDecimal(exact.lineItems[index]?.taxRate ?? null) })),
    parserWarnings, approvalSupported: !rejection && sourceMoneySupported,
  };
}
/** No raw XML or exception strings enter the preview; original bytes remain authoritative. */
export async function parsePurchaseBytes(mediaType: string, bytes: Buffer): Promise<PurchaseParseResult> {
  try {
    const xml = mediaType === 'application/pdf'
      ? await extractEmbeddedEInvoiceXml(bytes)
      : new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '').trim();
    if (!xml) return { parseStatus: 'FAILED', parseErrorCode: 'NO_EMBEDDED_XML', preview: null, parsed: null };
    if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) return { parseStatus: 'FAILED', parseErrorCode: 'UNSAFE_XML', preview: null, parsed: null };
    const { parsed, exactDecimals } = await parseEInvoiceXmlWithExactDecimals(xml);
    const preview = buildPurchasePreview(parsed, exactDecimals);
    const parties = [preview.sellerInfo, preview.buyerInfo];
    const decimals = [preview.grossAmount, preview.dueAmount, preview.prepaidAmount, preview.roundingAmount, preview.netAmount, preview.taxAmount];
    const withinLimits = (preview.currency?.length ?? 0) <= 64
      && (preview.documentTypeCode?.length ?? 0) <= 128
      && (preview.invoiceNumber?.length ?? 0) <= 255
      && preview.parserWarnings.length <= 100
      && preview.parserWarnings.every(warning => warning.code.length > 0 && warning.code.length <= 128 && warning.message.length > 0 && warning.message.length <= 2_000)
      && (parsed.sellerInfo.name?.length ?? 0) <= 1_000
      && (parsed.invoiceNumber?.length ?? 0) <= 255
      && parties.every(party => Object.values(party).every(value => typeof value !== 'string' || value.length <= 10_000)
        && party.addressLines.length <= 100 && party.addressLines.every(line => line.length <= 10_000))
      && decimals.every(value => value === null || value.length <= 100)
      && preview.lineItems.length <= 1_000
      && preview.lineItems.every(line => Object.entries(line).every(([key, value]) => value === null || value.length <= (['quantity', 'unitPrice', 'amount', 'taxRate'].includes(key) ? 100 : 10_000)));
    if (!withinLimits) return { parseStatus: 'FAILED', parseErrorCode: 'PREVIEW_LIMIT_EXCEEDED', preview: null, parsed: null };
    return { parseStatus: 'PARSED', parseErrorCode: null, preview, parsed };
  } catch {
    return { parseStatus: 'FAILED', parseErrorCode: 'PARSE_FAILED', preview: null, parsed: null };
  }
}
