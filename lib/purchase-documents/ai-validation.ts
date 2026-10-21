import { AI_RECEIPT_MAX_LINES, AI_RECEIPT_MAX_JOBS, type AiReceiptResult, type AiExtractionState, type AiDraftProvenance } from './ai-contract';
import { PurchaseDocumentError } from './errors';
import { parseMoneyEUR, formatMoneyEUR } from '@/lib/money';
import type { PurchaseReviewDraft } from './types';
import { EMPTY_REVIEW_DRAFT } from './review-draft';
import { canonicalPhotoJson } from './manual-photo-contract';

function invalid(): never { throw new PurchaseDocumentError('KI-Antwort ist kein unterstützter strukturierter Vorschlag.', 422, 'AI_INVALID_RESULT'); }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) return invalid();
  return value.trim() || null;
}
function decimal(value: unknown, precision = 2): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 25 || !new RegExp(`^\\d{1,12}(?:\\.\\d{1,${precision}})?$`).test(value)) return invalid();
  if (precision === 2) return formatMoneyEUR(parseMoneyEUR(value, { mode: 'strict' }));
  return value.replace(/^0+(?=\d)/, '');
}
/** Strict schema: no markdown, hidden fields, commands, links, tools or numeric money coercion. */
export function validateAiReceiptResult(content: string): AiReceiptResult {
  if (Buffer.byteLength(content, 'utf8') > 32_768) return invalid();
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { return invalid(); }
  return validateAiReceiptObject(parsed);
}
export function validateAiReceiptObject(value: unknown): AiReceiptResult {
  const raw = object(value, ['supplierName','invoiceNumber','invoiceDate','currency','documentType','grossAmount','netAmount','taxAmount','lineItems','lineItemsComplete']);
  const supplierName = text(raw.supplierName, 1000), invoiceNumber = text(raw.invoiceNumber, 255);
  const invoiceDate = text(raw.invoiceDate, 10), currency = text(raw.currency, 3);
  if (invoiceDate && (!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate) || invoiceDate < '1900-01-01' || !Number.isFinite(new Date(invoiceDate).getTime()) || new Date(invoiceDate).toISOString().slice(0, 10) !== invoiceDate)) return invalid();
  if (currency && (!/^[A-Z]{3}$/.test(currency) || !Intl.supportedValuesOf('currency').includes(currency))) return invalid();
  if (!['INVOICE','CREDIT_NOTE','UNKNOWN'].includes(String(raw.documentType))) return invalid();
  if (!Array.isArray(raw.lineItems) || raw.lineItems.length > AI_RECEIPT_MAX_LINES) return invalid();
  if (raw.lineItemsComplete !== null && typeof raw.lineItemsComplete !== 'boolean') return invalid();
  const grossAmount = decimal(raw.grossAmount), netAmount = decimal(raw.netAmount), taxAmount = decimal(raw.taxAmount);
  const lineItems = raw.lineItems.map(value => {
    const line = object(value, ['description','quantity','unitPrice','amount','taxRate']);
    const taxRate = decimal(line.taxRate, 4);
    if (taxRate !== null && Number(taxRate) > 100) return invalid();
    return { description: text(line.description, 500), quantity: decimal(line.quantity, 6), unitPrice: decimal(line.unitPrice, 6), amount: decimal(line.amount), taxRate };
  });
  const warnings: AiReceiptResult['warnings'] = [{ code: 'AI_UNREVIEWED', message: 'KI-Vorschläge können falsch sein. Original vollständig prüfen; keine Zahlungs- oder Steuerbestätigung.' }];
  if (raw.lineItemsComplete !== true) warnings.push({ code: 'LINES_INCOMPLETE', message: 'Positionen sind unvollständig oder ihre Vollständigkeit ist unklar (KI-Limit: 30 Positionen). Original vollständig prüfen.' });
  if (!supplierName || !invoiceNumber || !invoiceDate || !grossAmount || !currency) warnings.push({ code: 'MISSING_VALUES', message: 'Angaben fehlen oder waren nicht lesbar; es wurden keine Ersatzwerte erfunden.' });
  if (currency !== 'EUR' || raw.documentType !== 'INVOICE') warnings.push({ code: 'UNSUPPORTED_DOCUMENT', message: 'Kein bestätigter gewöhnlicher EUR-Rechnungsbeleg. Betragsübernahme ist gesperrt.' });
  if (grossAmount && parseMoneyEUR(grossAmount, { mode: 'strict' }) <= BigInt(0)) warnings.push({ code: 'UNSUPPORTED_AMOUNT', message: 'Bruttobetrag muss positiv sein.' });
  if (!netAmount || !taxAmount) warnings.push({ code: 'TOTALS_UNCHECKED', message: 'Netto-/Steueraufteilung fehlt; Summenkonsistenz ist nicht geprüft.' });
  if (grossAmount && netAmount && taxAmount && parseMoneyEUR(netAmount, { mode: 'strict' }) + parseMoneyEUR(taxAmount, { mode: 'strict' }) !== parseMoneyEUR(grossAmount, { mode: 'strict' })) warnings.push({ code: 'INCONSISTENT_TOTALS', message: 'Netto plus Steuer stimmt nicht exakt mit Brutto überein. Keine automatische Betragsübernahme.' });
  return { schemaVersion: 1, provenance: 'AI_UNREVIEWED', supplierName, invoiceNumber, invoiceDate, currency, documentType: raw.documentType as AiReceiptResult['documentType'], grossAmount, netAmount, taxAmount, lineItems, lineItemsComplete: raw.lineItemsComplete as boolean | null, warnings };
}
export function aiDraftSuggestions(result: AiReceiptResult): PurchaseReviewDraft {
  const blocked = result.warnings.some(warning => ['UNSUPPORTED_DOCUMENT','UNSUPPORTED_AMOUNT','INCONSISTENT_TOTALS'].includes(warning.code));
  return { ...EMPTY_REVIEW_DRAFT, supplierName: result.supplierName ?? '', invoiceNumber: result.invoiceNumber ?? '', invoiceDate: result.invoiceDate ?? '', amount: blocked ? '' : result.grossAmount ?? '' };
}
/** Stored evidence is closed and bounded too, including restore input. */
export function validateAiExtractionState(value: unknown, originalSha256: string): AiExtractionState {
  const state = object(value, ['version','jobs']);
  if (state.version !== 1 || !Array.isArray(state.jobs) || state.jobs.length > AI_RECEIPT_MAX_JOBS) return invalid();
  const ids = new Set<string>();
  for (const item of state.jobs) {
    const job = object(item, ['id','configVersion','configRevision','status','sourceSha256','sourceRevision','createdAt','deadlineAt','finishedAt','errorCode','result','draftApplied']);
    if (typeof job.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(job.id) || ids.has(job.id) || typeof job.configRevision !== 'string' || !/^[0-9a-f-]{36}$/.test(job.configRevision) || job.sourceSha256 !== originalSha256 || typeof job.configVersion !== 'number' || !Number.isSafeInteger(job.configVersion) || job.configVersion < 1 || typeof job.sourceRevision !== 'number' || !Number.isSafeInteger(job.sourceRevision) || job.sourceRevision < 0 || !['queued','running','completed','failed','unknown'].includes(String(job.status)) || typeof job.draftApplied !== 'boolean') return invalid();
    ids.add(job.id);
    for (const key of ['createdAt','deadlineAt','finishedAt']) if (job[key] !== null && (typeof job[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(job[key] as string) || !Number.isFinite(new Date(job[key] as string).getTime()))) return invalid();
    if (job.createdAt === null || job.deadlineAt === null || (job.errorCode !== null && (typeof job.errorCode !== 'string' || !/^[A-Z_]{1,64}$/.test(job.errorCode)))) return invalid();
    if (job.result !== null) {
      const evidence = object(job.result, ['schemaVersion','provenance','supplierName','invoiceNumber','invoiceDate','currency','documentType','grossAmount','netAmount','taxAmount','lineItems','lineItemsComplete','warnings']);
      if (evidence.schemaVersion !== 1 || evidence.provenance !== 'AI_UNREVIEWED') return invalid();
      const input = Object.fromEntries(Object.entries(evidence).filter(([key]) => !['schemaVersion','provenance','warnings'].includes(key)));
      const validated = validateAiReceiptObject(input);
      if (canonicalPhotoJson(evidence) !== canonicalPhotoJson(validated)) return invalid();
    }
    if (job.draftApplied && job.status !== 'completed') return invalid();
    if ((job.status === 'completed') !== (job.result !== null) || (['queued','running'].includes(String(job.status)) ? job.finishedAt !== null : job.finishedAt === null)) return invalid();
  }
  return value as AiExtractionState;
}
export function validateAiDraftProvenance(value: unknown, state: AiExtractionState | null, hash: string): AiDraftProvenance {
  const input = object(value, ['version','provenance','jobId','configVersion','configRevision','originalSha256','appliedAt','fields']);
  if (input.version !== 1 || !['AI_UNREVIEWED','AI_USER_EDITED'].includes(String(input.provenance)) || input.originalSha256 !== hash || typeof input.jobId !== 'string' || !state?.jobs.some(job => job.id === input.jobId && job.configVersion === input.configVersion && job.configRevision === input.configRevision && job.status === 'completed' && job.draftApplied) || typeof input.appliedAt !== 'string' || !Number.isFinite(new Date(input.appliedAt).getTime()) || !Array.isArray(input.fields) || input.fields.length > 4 || new Set(input.fields).size !== input.fields.length || input.fields.some(field => !['supplierName','invoiceNumber','invoiceDate','amount'].includes(String(field)))) return invalid();
  return value as AiDraftProvenance;
}
