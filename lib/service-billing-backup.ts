import { calculateInvoiceAmounts } from '@/lib/invoice-calculation';
import { hashJson } from '@/lib/backup-manifest';
import { getServiceBillingPeriod, hasServiceBillingDraftMarker, isUnrenderedServiceBillingDraft, readServiceBillingDraftSeed, readServiceBillingPlanInput } from '@/lib/service-billing';

type RecordValue = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const PLAN_FIELDS = new Set(['id', 'stableKey', 'userId', 'customerId', 'name', 'cadence', 'anchorDate', 'nextPeriod', 'status', 'revision', 'taxMode', 'items', 'createdAt', 'updatedAt']);
// Full snapshots export Invoice scalars only. Runtime relation projections must
// never become source evidence that scalar restore would silently discard.
const NO_FILE_INVOICE_FIELDS = new Set(['id', 'userId', 'customerId', 'type', 'fileName', 'storedFileName', 'uploadedAt', 'invoiceDate', 'dueDate', 'invoiceNumber', 'parsedData', 'totalAmount', 'status', 'issuanceState', 'paidAt', 'validUntil', 'quoteFollowUpOn', 'quoteResponseNote', 'originalInvoiceId', 'cancellationReason', 'convertedFromQuoteId']);
const PERIOD_FIELDS = new Set(['id', 'userId', 'planId', 'periodIndex', 'periodStart', 'periodEnd', 'action', 'invoiceId', 'createdAt']);
function record(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: Objekt erforderlich`);
  return value as RecordValue;
}
function rows(data: RecordValue, key: string): RecordValue[] {
  const value = data[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${key}: Array erforderlich`);
  return value.map((item, index) => record(item, `${key}[${index}]`));
}
function identity(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error(`${label}: stabile UUID erforderlich`);
  return value;
}
function instant(value: unknown, label: string): void {
  if (!(value instanceof Date) && typeof value !== 'string') throw new Error(`${label}: Zeitpunkt erforderlich`);
  if (!Number.isFinite(new Date(value).getTime())) throw new Error(`${label}: ungültiger Zeitpunkt`);
}
function closed(row: RecordValue, allowed: Set<string>, label: string): void {
  if (Object.keys(row).some(key => !allowed.has(key))) throw new Error(`${label}: unbekannte Felder dürfen nicht stillschweigend verloren gehen`);
}
function integer(value: unknown, label: string, minimum = 0, maximum = 119987): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${label}: ungültige Ganzzahl`);
  return value;
}

/** Calendar schedule and replay receipts are business data, never operational cache. */
export function validateServiceBillingBackup(data: RecordValue, sourceUserId: string | undefined, supported: boolean): void {
  const plans = rows(data, 'serviceBillingPlans');
  const periods = rows(data, 'serviceBillingPeriods');
  if (!supported && (plans.length || periods.length)) throw new Error('Älteres Backupformat darf keine wiederkehrenden Servicepläne oder Periodenidentitäten enthalten');
  const planById = new Map<string, RecordValue>();
  const stableKeys = new Set<string>();
  const customerIds = new Set(rows(data, 'customers').map(row => row.id));
  const invoiceById = new Map(rows(data, 'invoices').map(row => [row.id, row]));
  const linkedIds = (records: RecordValue[], field: string) => new Set(records.filter(row => row[field] != null).map(row => Number(row[field])));
  const incomeInvoiceIds = linkedIds(rows(data, 'incomes'), 'invoiceId');
  const paymentInvoiceIds = linkedIds(rows(data, 'paymentJournalEvents'), 'invoiceId');
  const creditNoteOriginalIds = linkedIds([...invoiceById.values()], 'originalInvoiceId');
  const convertedQuoteIds = linkedIds([...invoiceById.values()], 'convertedFromQuoteId');
  const reminderInvoiceIds = linkedIds(rows(data, 'reminders'), 'invoiceId');
  const billingNoteInvoiceIds = linkedIds(rows(data, 'billingNotes'), 'invoiceId');
  for (const [index, plan] of plans.entries()) {
    const label = `serviceBillingPlans[${index}]`;
    closed(plan, PLAN_FIELDS, label);
    const id = identity(plan.id, `${label}.id`);
    const key = identity(plan.stableKey, `${label}.stableKey`);
    if (planById.has(id) || stableKeys.has(key)) throw new Error(`${label}: doppelte Planidentität`);
    if (plan.userId !== undefined && plan.userId !== sourceUserId) throw new Error(`${label}: fremder Quellmandant`);
    const input = readServiceBillingPlanInput(plan);
    // Readers may canonicalize form input; persisted evidence must already be canonical.
    for (const key of ['name', 'customerId', 'cadence', 'anchorDate', 'taxMode', 'items'] as const) {
      if (hashJson(input[key]) !== hashJson(plan[key])) throw new Error(`${label}.${key}: nicht kanonische Plandaten`);
    }
    if (!customerIds.has(plan.customerId)) throw new Error(`${label}.customerId: unbekannter Kunde`);
    integer(plan.nextPeriod, `${label}.nextPeriod`, 0, 119988);
    integer(plan.revision, `${label}.revision`, 1, 2147483647);
    if (!['ACTIVE', 'PAUSED'].includes(String(plan.status))) throw new Error(`${label}.status: ungültiger Planstatus`);
    instant(plan.createdAt, `${label}.createdAt`); instant(plan.updatedAt, `${label}.updatedAt`);
    planById.set(id, plan); stableKeys.add(key);
  }
  const periodIds = new Set<string>();
  const periodKeys = new Set<string>();
  const receiptByInvoice = new Map<number, { plan: RecordValue; period: RecordValue }>();
  const countsByPlan = new Map<string, number>();
  for (const [index, period] of periods.entries()) {
    const label = `serviceBillingPeriods[${index}]`;
    closed(period, PERIOD_FIELDS, label);
    const id = identity(period.id, `${label}.id`);
    if (periodIds.has(id)) throw new Error(`${label}: doppelte Perioden-ID`);
    periodIds.add(id);
    if (period.userId !== undefined && period.userId !== sourceUserId) throw new Error(`${label}: fremder Quellmandant`);
    const plan = planById.get(String(period.planId));
    if (!plan) throw new Error(`${label}.planId: unbekannter Serviceplan`);
    const periodIndex = integer(period.periodIndex, `${label}.periodIndex`);
    if (periodIndex >= Number(plan.nextPeriod)) throw new Error(`${label}: Periode liegt hinter dem bestätigten Planfortschritt`);
    const key = `${plan.stableKey}:${periodIndex}`;
    if (periodKeys.has(key)) throw new Error(`${label}: doppelte stabile Periodenidentität`);
    periodKeys.add(key);
    const schedule = getServiceBillingPeriod(String(plan.anchorDate), plan.cadence as 'MONTHLY' | 'QUARTERLY' | 'YEARLY', periodIndex);
    if (schedule.periodStart !== period.periodStart || schedule.periodEnd !== period.periodEnd) throw new Error(`${label}: Periode weicht vom unveränderlichen Kalenderanker ab`);
    if (!['GENERATED', 'SKIPPED'].includes(String(period.action))) throw new Error(`${label}.action: ungültige Periodenentscheidung`);
    if (!Object.hasOwn(period, 'invoiceId')) throw new Error(`${label}.invoiceId: ausdrücklicher nullable Rechnungsbezug erforderlich`);
    if (period.action === 'SKIPPED' && period.invoiceId != null) throw new Error(`${label}: übersprungene Periode darf keine Rechnung enthalten`);
    if (period.invoiceId != null) {
      const invoiceId = integer(period.invoiceId, `${label}.invoiceId`, 1, Number.MAX_SAFE_INTEGER);
      const invoice = invoiceById.get(invoiceId);
      if (!invoice || invoice.type !== 'INVOICE' || receiptByInvoice.has(invoiceId)) throw new Error(`${label}.invoiceId: eindeutiger Rechnungsbezug fehlt`);
      if (invoice.userId !== undefined && invoice.userId !== sourceUserId) throw new Error(`${label}.invoiceId: fremder Quellmandant`);
      if (invoice.storedFileName === '' && !isUnrenderedServiceBillingDraft(invoice)) throw new Error(`${label}.invoiceId: nicht gerenderter Serviceentwurf benötigt unveränderte gültige Entwurfsmerkmale`);
      receiptByInvoice.set(invoiceId, { plan, period });
    }
    instant(period.createdAt, `${label}.createdAt`);
    countsByPlan.set(String(plan.id), (countsByPlan.get(String(plan.id)) ?? 0) + 1);
  }
  for (const plan of plans) {
    if ((countsByPlan.get(String(plan.id)) ?? 0) !== plan.nextPeriod) throw new Error('Serviceplan enthält eine Lücke in seinen bestätigten Periodenidentitäten');
  }
  for (const invoice of invoiceById.values()) {
    if (!hasServiceBillingDraftMarker(invoice.parsedData)) continue;
    closed(invoice, NO_FILE_INVOICE_FIELDS, 'Nicht gerenderter Serviceentwurf');
    if (!isUnrenderedServiceBillingDraft(invoice)) throw new Error('Unvollständiger oder ausgestellter Serviceentwurf enthält widersprüchliche Entwurfsmerkmale');
    if (invoice.paidAt != null || incomeInvoiceIds.has(invoice.id) || paymentInvoiceIds.has(invoice.id)) throw new Error('Nicht gerenderter Serviceentwurf darf keine Zahlung, Einnahme oder Zahlungszeitpunkt enthalten');
    if (creditNoteOriginalIds.has(Number(invoice.id)) || convertedQuoteIds.has(Number(invoice.id)) || reminderInvoiceIds.has(Number(invoice.id)) || billingNoteInvoiceIds.has(Number(invoice.id))) throw new Error('Nicht gerenderter Serviceentwurf darf keine Gutschrift, Angebotsumwandlung, Mahnung oder beanspruchte Leistungsnotiz enthalten');
    const receipt = receiptByInvoice.get(Number(invoice.id));
    const parsed = record(invoice.parsedData, 'Serviceentwurf.parsedData');
    const marker = record(parsed._serviceBillingDraft, 'Serviceentwurf._serviceBillingDraft');
    const seed = readServiceBillingDraftSeed(parsed)!;
    closed(marker, new Set(['version', 'planStableKey', 'periodIndex', 'periodStart', 'periodEnd', 'taxMode', 'items', 'customerAddress', 'notes']), 'Serviceentwurf._serviceBillingDraft');
    const amounts = calculateInvoiceAmounts(seed.items);
    const lineItems = seed.items.map((item, index) => ({ ...item, positionNumber: String(index + 1), amount: amounts.lines[index].netAmount }));
    if (hashJson(marker.items) !== hashJson(seed.items) || parsed.currency !== 'EUR' || parsed.documentType !== 'INVOICE'
      || parsed.netAmount !== amounts.netAmount || parsed.taxAmount !== amounts.taxAmount || parsed.grossAmount !== amounts.grossAmount
      || parsed.totalAmount !== amounts.grossAmount || invoice.totalAmount !== amounts.grossAmount || hashJson(parsed.lineItems) !== hashJson(lineItems)) {
      throw new Error('Serviceentwurf enthält widersprüchliche native Positionen, Steuer- oder Geldbeträge');
    }
    if (!receipt || marker.planStableKey !== receipt.plan.stableKey || marker.periodIndex !== receipt.period.periodIndex
      || marker.periodStart !== receipt.period.periodStart || marker.periodEnd !== receipt.period.periodEnd) {
      throw new Error('Nicht gerenderter Serviceentwurf benötigt seine passende stabile Periodenidentität');
    }
  }
}

/** Compare only source-preserved evidence; database IDs and private file names are remapped. */
export function sameServiceBillingInvoice(target: RecordValue, source: RecordValue, customerId: number | null): boolean {
  const fields = ['type', 'invoiceNumber', 'status', 'totalAmount', 'parsedData', 'cancellationReason', 'quoteFollowUpOn', 'quoteResponseNote', 'fileName'];
  const sameIssuance = target.issuanceState === source.issuanceState || (source.issuanceState === 'UNISSUED' && target.issuanceState === 'UNKNOWN' && typeof source.storedFileName === 'string' && source.storedFileName.length > 0 && typeof target.storedFileName === 'string' && target.storedFileName.length > 0 && !hasServiceBillingDraftMarker(source.parsedData));
  if (!sameIssuance || target.customerId !== customerId || fields.some(field => hashJson(target[field] ?? null) !== hashJson(source[field] ?? null))) return false;
  for (const field of ['uploadedAt', 'invoiceDate', 'dueDate', 'paidAt', 'validUntil']) {
    const time = (value: unknown) => value == null ? null : new Date(value as string | Date).toISOString();
    if (time(target[field]) !== time(source[field])) return false;
  }
  return isUnrenderedServiceBillingDraft(target) === isUnrenderedServiceBillingDraft(source);
}
