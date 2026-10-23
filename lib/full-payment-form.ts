import type { EffectivePayment, RootCapabilities, PaymentLedgerV3 } from '@/lib/payment-journal/allocation-contract';
import type { PaymentSummary as LedgerPaymentSummary } from '@/lib/payment-journal/contract';
import { parseBusinessDate } from '@/lib/business-date';
import { parseMoneyEUR } from '@/lib/money';

export type PaymentSummary = Pick<LedgerPaymentSummary, 'totalCents' | 'paidCents' | 'openCents' | 'paid' | 'paymentState'>;
export type PaymentDraft = { amount: string; amountCents: string; expectedPaidCents: string; expectedLedgerVersion?: string; paidAt: string; reference: string; idempotencyKey: string; fingerprint: string };
export type PaymentHistoryEvent = { id: number; invoiceId: number; amountCents: string; currency: 'EUR'; paidAt: string | null; source: string; dateCertainty: string; reference: string | null; idempotencyKey: string };
export type ConfirmedPayment = { amountCents: string; currency: 'EUR'; paidAt: string; reference: string; id: number; summary: PaymentSummary; currentAssignment?: EffectivePayment };
export type PaymentLedgerV2 = { version: 2; documentState?: string; originalReceivedCents: string; correctedCents: string; validReceivedCents: string; refundedCents: string; netRetainedCents: string; collectibleOpenCents: string; refundDueCents: string };
export type PaymentLedger = PaymentLedgerV2 | PaymentLedgerV3;
export type PaymentPreflight = { amount: string; amountCents: string; summary: PaymentSummary; events: PaymentHistoryEvent[]; canRecordPayment: boolean; ledger?: PaymentLedger; ledgerVersion?: string; effectivePayments?: EffectivePayment[]; rootCapabilities?: RootCapabilities[]; originEvents?: PaymentHistoryEvent[]; originAssignments?: EffectivePayment[] };
const reviewMessage = 'Der Rechnungsbetrag oder die Zahlungsdaten sind nicht eindeutig. Bitte Rechnungsdaten und Zahlungsnachweise prüfen. Es wurde keine Zahlung gebucht.';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(reviewMessage);
  return value as Record<string, unknown>;
}
function cents(value: unknown, positive = false): bigint {
  if (typeof value !== 'string' || !(positive ? /^[1-9]\d{0,15}$/u : /^(?:0|[1-9]\d{0,15})$/u).test(value)) throw new Error(reviewMessage);
  const result = BigInt(value);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(reviewMessage);
  return result;
}
export function paymentAmountInput(amountCents: string): string {
  const value = cents(amountCents);
  return `${value / BigInt(100)}.${(value % BigInt(100)).toString().padStart(2, '0')}`;
}
export function readPaymentLedger(value: unknown): PaymentLedger {
  const data = record(value);
  if (data.version === 3) return readPaymentLedgerV3(data);
  if (data.version !== 2 || (data.documentState !== undefined && !['DRAFT','SENT','PAID','CANCELLED'].includes(String(data.documentState)))) throw new Error(reviewMessage);
  const original = cents(data.originalReceivedCents), corrected = cents(data.correctedCents), valid = cents(data.validReceivedCents);
  const refunded = cents(data.refundedCents), retained = cents(data.netRetainedCents), open = cents(data.collectibleOpenCents), due = cents(data.refundDueCents);
  if (corrected + valid !== original || refunded + retained !== valid || due > retained) throw new Error(reviewMessage);
  if (data.documentState === 'CANCELLED' ? open !== BigInt(0) || due !== retained : data.documentState !== undefined && (due !== BigInt(0) || refunded !== BigInt(0))) throw new Error(reviewMessage);
  return { version: 2, ...(data.documentState === undefined ? {} : { documentState: String(data.documentState) }), originalReceivedCents: original.toString(), correctedCents: corrected.toString(), validReceivedCents: valid.toString(), refundedCents: refunded.toString(), netRetainedCents: retained.toString(), collectibleOpenCents: open.toString(), refundDueCents: due.toString() };
}
export function readPaymentSummary(value: unknown, ledger?: PaymentLedger): PaymentSummary {
  const data = record(value);
  const total = cents(data.totalCents, true), paid = cents(data.paidCents), open = cents(data.openCents);
  const paymentState = paid === total ? 'PAID' : paid > BigInt(0) ? 'PARTIAL' : 'OPEN';
  if (paid > total || (ledger ? paid.toString() !== (ledger.version === 3 ? ledger.allocation.validAllocatedCents : ledger.validReceivedCents) || open.toString() !== ledger.collectibleOpenCents || paid + open > total : paid + open !== total)
    || (ledger?.documentState !== undefined && ledger.documentState !== 'CANCELLED' && paid + open !== total)
    || (ledger?.documentState === 'PAID' && paid !== total) || (ledger?.documentState === 'SENT' && paid === total) || (ledger?.documentState === 'DRAFT' && paid !== BigInt(0))
    || data.paid !== (paid === total) || data.paymentState !== paymentState) throw new Error(reviewMessage);
  return { totalCents: total.toString(), paidCents: paid.toString(), openCents: open.toString(), paid: data.paid as boolean, paymentState };
}
export function readPaymentEvents(value: unknown): PaymentHistoryEvent[] {
  const data = record(value);
  if (!Array.isArray(data.events)) throw new Error(reviewMessage);
  return data.events.map(value => {
    const event = record(value);
    cents(event.amountCents, true);
    if (typeof event.id !== 'number' || !Number.isSafeInteger(event.id) || event.id <= 0
      || typeof event.invoiceId !== 'number' || !Number.isSafeInteger(event.invoiceId) || event.invoiceId <= 0 || event.currency !== 'EUR' || typeof event.source !== 'string'
      || typeof event.dateCertainty !== 'string' || typeof event.idempotencyKey !== 'string'
      || (event.reference !== null && typeof event.reference !== 'string')
      || (event.paidAt !== null && (typeof event.paidAt !== 'string' || !Number.isFinite(Date.parse(event.paidAt))))) throw new Error(reviewMessage);
    return event as PaymentHistoryEvent;
  });
}
/** Only server-derived exact cents determine the editable amount and balance. */
export function readPaymentPreflight(value: unknown): PaymentPreflight {
  const data = record(value);
  if (data.legacyAdoptionRequired) throw new Error('Historische Zahlungsdaten müssen gesondert geprüft werden; hier wird keine weitere Zahlung gebucht.');
  if (data.reviewRequired) throw new Error(reviewMessage);
  if (data.currency !== 'EUR') throw new Error('Nur eindeutig geprüfte EUR-Rechnungen werden unterstützt. Bitte Rechnungswährung prüfen.');
  const ledger = data.ledger === undefined ? undefined : readPaymentLedger(data.ledger);
  const summary = readPaymentSummary(data.summary, ledger);
  const events = readPaymentEvents(data);
  const effectivePayments = ledger?.version === 3 ? readEffectivePayments(data.effectivePayments) : undefined;
  const originAssignments = ledger?.version === 3 ? readOriginAssignments(data.originAssignments, events) : undefined;
  const rootCapabilities = ledger?.version === 3 ? readRootCapabilities(data.rootCapabilities, effectivePayments!) : undefined;
  if (ledger?.version === 3 && data.paymentContractVersion !== 3) throw new Error(reviewMessage);
  if (events.reduce((sum, event) => sum + cents(event.amountCents, true), BigInt(0)).toString() !== (ledger ? ledger.version === 3 ? ledger.originCash.originalReceivedCents : ledger.originalReceivedCents : summary.paidCents)) throw new Error(reviewMessage);
  if (ledger?.version === 3 && effectivePayments!.reduce((sum, root) => sum + BigInt(root.validReceivedCents), BigInt(0)).toString() !== ledger.allocation.validAllocatedCents) throw new Error(reviewMessage);
  if (ledger && (typeof data.ledgerVersion !== 'string' || !/^[a-f0-9]{64}$/u.test(data.ledgerVersion))) throw new Error(reviewMessage);
  return { amount: paymentAmountInput(summary.openCents), amountCents: summary.openCents, summary, events, canRecordPayment: data.canRecordPayment === true && !summary.paid && summary.openCents !== '0', ...(ledger ? { ledger, ledgerVersion: data.ledgerVersion as string } : {}), ...(effectivePayments ? { effectivePayments, rootCapabilities, originEvents: events, originAssignments } : {}) };
}
export function validatePaymentFields(paidAt: string, reference: string): string | null {
  try { parseBusinessDate(paidAt); } catch { return 'Bitte das tatsächliche Zahlungsdatum vollständig angeben.'; }
  if (!reference.trim() || reference.length > 255 || /[\u0000-\u001f]/u.test(reference)) return 'Bitte eine Zahlungsreferenz mit 1 bis 255 Zeichen angeben.';
  return null;
}
/** Accept common German decimal input, but never round sub-cent values. */
export function paymentInputCents(amount: string): string {
  if (!/^\d+(?:[.,]\d{1,2})?$/u.test(amount.trim())) throw new Error('Bitte einen positiven, centgenauen EUR-Betrag eingeben (z. B. 40,00).');
  const value = parseMoneyEUR(amount.trim().replace(',', '.'));
  if (value <= BigInt(0) || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Bitte einen positiven, sicher buchbaren EUR-Betrag eingeben.');
  return value.toString();
}
/** Ledger baseline distinguishes later intentionally identical allocations. */
export function paymentAttempt(previous: PaymentDraft | null, invoiceId: number, amount: string, paidAt: string, reference: string, uuid: () => string, expectedPaidCents = '0', expectedLedgerVersion?: string): PaymentDraft {
  cents(expectedPaidCents);
  const amountCents = paymentInputCents(amount);
  const normalizedAmount = paymentAmountInput(amountCents);
  const fingerprint = JSON.stringify([invoiceId, normalizedAmount, 'EUR', paidAt, reference.trim(), expectedPaidCents, expectedLedgerVersion ?? null]);
  return { amount: normalizedAmount, amountCents, expectedPaidCents, ...(expectedLedgerVersion ? { expectedLedgerVersion } : {}), paidAt, reference, fingerprint, idempotencyKey: previous?.fingerprint === fingerprint ? previous.idempotencyKey : uuid() };
}
export function readConfirmedPayment(value: unknown, draft: PaymentDraft, invoiceId: number, amountCents = draft.amountCents): ConfirmedPayment {
  const data = record(value), event = record(data.event);
  const ledger = data.ledger === undefined ? undefined : readPaymentLedger(data.ledger);
  const summary = readPaymentSummary(data.summary, ledger);
  const currentAssignment = ledger?.version === 3 ? readOriginAssignments(data.originAssignments, readPaymentEvents(data)).find(root => root.originalPaymentId === event.id) : undefined;
  if (ledger?.version === 3 && (!currentAssignment || data.paymentContractVersion !== 3)) throw new Error(reviewMessage);
  if (validatePaymentFields(draft.paidAt, draft.reference) !== null
    || typeof event.id !== 'number' || !Number.isSafeInteger(event.id) || event.id <= 0 || event.invoiceId !== invoiceId
    || event.amountCents !== amountCents || event.currency !== 'EUR' || event.dateCertainty !== 'ACTUAL'
    || event.source !== 'MANUAL' || event.idempotencyKey !== draft.idempotencyKey || event.reference !== draft.reference.trim()
    || event.paidAt !== `${draft.paidAt}T00:00:00.000Z` || (!currentAssignment && BigInt(summary.paidCents) < cents(draft.expectedPaidCents) + cents(amountCents, true))) {
    throw new Error('Die Speicherbestätigung ist unvollständig. Bitte unverändert erneut versuchen oder den Zahlungsnachweis prüfen; nicht als neue Zahlung erfassen.');
  }
  return { id: event.id, amountCents, currency: 'EUR', paidAt: event.paidAt as string, reference: event.reference as string, summary, ...(currentAssignment ? { currentAssignment } : {}) };
}
/** Existing/latest events are NOT success evidence; only the known pending key is. */
export function recoverConfirmedPayment(value: unknown, invoiceId: number, pendingKey?: string | null, pendingDraft?: PaymentDraft | null): ConfirmedPayment | null {
  if (!pendingKey) return null;
  const events = readPaymentEvents(value);
  const event = events.find(event => event.idempotencyKey === pendingKey);
  if (!event || event.source !== 'MANUAL' || event.dateCertainty !== 'ACTUAL' || !event.paidAt || !event.reference) return null;
  const draft = pendingDraft ?? paymentAttempt(null, invoiceId, paymentAmountInput(event.amountCents), event.paidAt.slice(0, 10), event.reference, () => pendingKey);
  return readConfirmedPayment({ ...record(value), event }, draft, invoiceId);
}
/** Persistent storage contains opaque identity only, never bank references or amounts. */
export function paymentPendingStorageKey(tenantId: string, invoiceId: number): string {
  return `bivaro:payment-pending:${encodeURIComponent(tenantId)}:${invoiceId}`;
}
export async function paymentIdentityStorageKey(tenantId: string, invoiceId: number, fingerprint: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint));
  const digest = Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('');
  return `bivaro:payment-attempt:${encodeURIComponent(tenantId)}:${invoiceId}:${digest}`;
}
export function paymentFailure(value: unknown): string {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (data.code === 'IDEMPOTENCY_CONFLICT') return 'Diese Anfragekennung gehört zu anderen Zahlungsdaten. Bitte Zahlungsnachweis prüfen; keine zweite Zahlung erfassen.';
  if (data.code === 'PAYMENT_STATE_CHANGED') return 'Der Zahlungssaldo hat sich zwischenzeitlich geändert. Ihre Eingaben bleiben erhalten. Bitte den aktualisierten Restbetrag prüfen und erst danach bewusst erneut bestätigen.';
  if (data.code === 'PAYMENT_EXCEEDS_OPEN') return 'Der Betrag übersteigt den offenen Restbetrag. Es wurde nichts gebucht. Bitte Betrag und aktuellen Saldo prüfen.';
  if (data.code === 'PAYMENT_ALREADY_EXISTS') return 'Es besteht bereits ein Zahlungsnachweis. Bitte den vorhandenen Zahlungseingang prüfen.';
  if (data.code === 'FULL_PAYMENT_REQUIRED') return 'Bitte den aktuellen offenen Rechnungsbetrag und die Zahlungsnachweise neu laden.';
  return typeof data.error === 'string' && data.error ? data.error : 'Die Zahlung wurde nicht bestätigt. Bitte unverändert erneut versuchen; Ihre Eingaben bleiben erhalten.';
}
export function displayPaymentAmount(cents: string): string {
  const amount = BigInt(cents);
  const whole = (amount / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/gu, '.');
  return `${whole},${(amount % BigInt(100)).toString().padStart(2, '0')} €`;
}

function aggregate(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,23})$/u.test(value)) throw new Error(reviewMessage);
  return BigInt(value);
}
export function readPaymentLedgerV3(value: unknown): PaymentLedgerV3 {
  const data = record(value), origin = record(data.originCash), allocation = record(data.allocation);
  if (data.version !== 3 || !['DRAFT', 'SENT', 'PAID', 'CANCELLED'].includes(String(data.documentState))) throw new Error(reviewMessage);
  const axis = (values: Record<string, unknown>, keys: string[]) => {
    const [original, corrected, valid, refunded, retained] = keys.map(key => aggregate(values[key]));
    if (corrected + valid !== original || refunded + retained !== valid) throw new Error(reviewMessage);
    return [original, corrected, valid, refunded, retained];
  };
  axis(origin, ['originalReceivedCents', 'correctedCents', 'validReceivedCents', 'refundedCents', 'netRetainedCents']);
  const [, , , refunded, retained] = axis(allocation, ['originalAllocatedCents', 'correctedAllocatedCents', 'validAllocatedCents', 'refundedAllocatedCents', 'retainedAllocatedCents']);
  const open = aggregate(data.collectibleOpenCents), due = aggregate(data.refundDueCents);
  if (data.documentState === 'CANCELLED' ? open !== BigInt(0) || due !== retained : due !== BigInt(0) || refunded !== BigInt(0)) throw new Error(reviewMessage);
  return data as PaymentLedgerV3;
}
export function readEffectivePayments(value: unknown): EffectivePayment[] {
  if (!Array.isArray(value) || value.length > 10_000) throw new Error(reviewMessage);
  const seen = new Set<number>();
  return value.map(item => {
    const root = record(item);
    const id = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
    const amount = cents(root.amountCents, true), valid = cents(root.validReceivedCents), refunded = cents(root.refundedCents), retained = cents(root.retainedCents);
    if (!id(root.originalPaymentId) || !id(root.originInvoiceId) || !id(root.allocatedInvoiceId) || seen.has(root.originalPaymentId as number)
      || valid > amount || refunded + retained !== valid || typeof root.dateCertainty !== 'string' || typeof root.source !== 'string'
      || (root.paidAt !== null && (typeof root.paidAt !== 'string' || !Number.isFinite(Date.parse(root.paidAt))))
      || !['BANK_CSV', 'MANUAL', 'LEGACY'].includes(String(root.provenance))) throw new Error(reviewMessage);
    if (root.provenance === 'BANK_CSV' ? typeof root.bindingStableKey !== 'string' || !Number.isSafeInteger(root.allocationRevision) || Number(root.allocationRevision) < 0
      || (root.allocationRevision === 0 ? root.allocationChangeStableKey !== null : typeof root.allocationChangeStableKey !== 'string')
      : root.bindingStableKey !== null || root.allocationRevision !== null || root.allocationChangeStableKey !== null) throw new Error(reviewMessage);
    seen.add(root.originalPaymentId as number);
    return root as EffectivePayment;
  });
}
export function readRootCapabilities(value: unknown, effectivePayments: EffectivePayment[]): RootCapabilities[] {
  if (!Array.isArray(value) || value.length !== effectivePayments.length) throw new Error(reviewMessage);
  const seen = new Set<number>();
  return value.map(item => {
    const capability = record(item), root = effectivePayments.find(root => root.originalPaymentId === capability.originalPaymentId);
    if (!root || seen.has(root.originalPaymentId) || cents(capability.correctableCents) > BigInt(root.retainedCents) || cents(capability.refundableCents) > BigInt(root.retainedCents)) throw new Error(reviewMessage);
    for (const [flag, reason] of [['canCorrect', 'correctionReviewReason'], ['canRefund', 'refundReviewReason'], ['canReallocate', 'reallocationReviewReason']] as const) {
      if (typeof capability[flag] !== 'boolean' || (capability[flag] ? capability[reason] !== null : typeof capability[reason] !== 'string')) throw new Error(reviewMessage);
    }
    if ((!capability.canCorrect && capability.correctableCents !== '0') || (!capability.canRefund && capability.refundableCents !== '0')
      || (capability.canReallocate && root.provenance !== 'BANK_CSV')) throw new Error(reviewMessage);
    seen.add(root.originalPaymentId);
    return capability as RootCapabilities;
  });
}

export function readOriginAssignments(value: unknown, events: PaymentHistoryEvent[]): EffectivePayment[] {
  const assignments = readEffectivePayments(value);
  if (assignments.length !== events.length) throw new Error(reviewMessage);
  for (const event of events) {
    const assigned = assignments.find(root => root.originalPaymentId === event.id);
    if (!assigned || assigned.originInvoiceId !== event.invoiceId || assigned.amountCents !== event.amountCents
      || assigned.paidAt !== event.paidAt || assigned.source !== event.source || assigned.dateCertainty !== event.dateCertainty) throw new Error(reviewMessage);
  }
  return assignments;
}
export type PaymentAllocationHistoryEvent = {
  id: number; stableKey: string; bindingStableKey: string; originalPaymentKey: string; revision: number;
  fromInvoiceId: number; toInvoiceId: number; fromInvoiceNumber: string; toInvoiceNumber: string;
  amountCents: string; currency: 'EUR'; actionDate: string; reason: string; recordedAt: string;
};
export function readPaymentAllocationHistory(value: unknown): PaymentAllocationHistoryEvent[] {
  if (!Array.isArray(value) || value.length > 10_000) throw new Error(reviewMessage);
  const ids = new Set<number>(), keys = new Set<string>();
  return value.map(item => {
    const data = record(item), basis = record(data.basisSnapshot);
    const id = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
    const text = (value: unknown, max: number) => typeof value === 'string' && !!value.trim() && value.length <= max && !/[\u0000-\u001f]/u.test(value);
    if (!id(data.id) || !id(data.revision) || !id(data.fromInvoiceId) || !id(data.toInvoiceId) || data.fromInvoiceId === data.toInvoiceId
      || !text(data.stableKey, 64) || keys.has(data.stableKey as string) || ids.has(data.id as number)
      || !text(basis.bindingStableKey, 64) || !text(basis.originalPaymentKey, 128) || !text(basis.fromInvoiceNumber, 255) || !text(basis.toInvoiceNumber, 255)
      || cents(data.amountCents, true).toString() !== basis.amountCents || data.currency !== 'EUR' || basis.cashNeutralReviewed !== true
      || !text(data.reason, 1000) || data.reason !== basis.reason || data.revision !== Number(basis.expectedAllocationRevision) + 1
      || typeof data.actionDate !== 'string' || !/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/u.test(data.actionDate) || data.actionDate.slice(0, 10) !== basis.actionDate
      || typeof data.recordedAt !== 'string' || !Number.isFinite(Date.parse(data.recordedAt))) throw new Error(reviewMessage);
    ids.add(data.id as number); keys.add(data.stableKey as string);
    return { id: data.id as number, stableKey: data.stableKey as string, bindingStableKey: basis.bindingStableKey as string, originalPaymentKey: basis.originalPaymentKey as string,
      revision: data.revision as number, fromInvoiceId: data.fromInvoiceId as number, toInvoiceId: data.toInvoiceId as number,
      fromInvoiceNumber: basis.fromInvoiceNumber as string, toInvoiceNumber: basis.toInvoiceNumber as string, amountCents: data.amountCents as string, currency: 'EUR',
      actionDate: data.actionDate, reason: data.reason as string, recordedAt: data.recordedAt };
  });
}
