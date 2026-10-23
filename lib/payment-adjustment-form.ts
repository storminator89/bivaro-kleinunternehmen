import { parseBusinessDate } from '@/lib/business-date';
import type { EffectivePayment, RootCapabilities, PaymentLedgerV3 } from '@/lib/payment-journal/allocation-contract';
import { paymentAmountInput, paymentInputCents, readPaymentEvents, readPaymentLedger, readPaymentSummary, readEffectivePayments, readRootCapabilities, readOriginAssignments, readPaymentAllocationHistory, type PaymentAllocationHistoryEvent, type PaymentHistoryEvent, type PaymentLedger, type PaymentSummary } from '@/lib/full-payment-form';

export type PaymentAdjustmentKind = 'PAYMENT_CORRECTION' | 'CUSTOMER_REFUND';
export type PaymentAdjustmentEvent = {
  id: number; originalPaymentId: number; kind: PaymentAdjustmentKind; amountCents: string; currency: 'EUR';
  actionDate: string; accountingEffectiveOn: string; reason: string; reference: string; idempotencyKey: string;
  cancellationInvoiceId: number | null; fiscalMappingStatus: 'UNREVIEWED';
  invoiceId?: number; contractVersion?: 2 | 3; allocationBindingId?: number | null; allocationRevision?: number | null; allocationChangeId?: number | null; allocationBasisSnapshot?: Record<string, unknown> | null;
};
export type AdjustmentCapacity = { originalPaymentId: number; correctableCents: string; refundableCents: string };
export type PaymentAdjustmentPreflight = {
  ledger: PaymentLedger; ledgerVersion: string; summary: PaymentSummary; events: PaymentHistoryEvent[];
  adjustments: PaymentAdjustmentEvent[]; adjustmentCapacities: AdjustmentCapacity[];
  eligibleCancellationBasis: { invoiceId: number; invoiceNumber: string | null } | null;
  canRecordAdjustment: boolean; adjustmentReviewReason: string | null;
  effectivePayments?: EffectivePayment[]; rootCapabilities?: RootCapabilities[]; originEvents?: PaymentHistoryEvent[]; originAssignments?: EffectivePayment[]; allocationHistory?: PaymentAllocationHistoryEvent[];
};
export type PaymentAdjustmentDraft = {
  kind: PaymentAdjustmentKind; originalPaymentId: number; amount: string; amountCents: string; currency: 'EUR';
  actionDate: string; reason: string; reference: string; idempotencyKey: string; expectedLedgerVersion: string;
  cancellationInvoiceId?: number; declarationNeverReceived?: true; expectedAllocationRevision?: number; fingerprint: string;
};
export type PendingAdjustment = { idempotencyKey: string; expectedLedgerVersion: string; fingerprintHash: string };
const reviewMessage = 'Korrektur und Erstattung sind nicht sicher freigegeben. Bitte Zahlungsjournal und Belege prüfen; es wurde nichts gebucht.';
const confirmationMessage = 'Keine verlässliche Speicherbestätigung erhalten. Bitte nur unverändert wiederholen oder das Journal prüfen; keine neue Korrektur oder Erstattung erfassen.';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(reviewMessage);
  return value as Record<string, unknown>;
}
function positiveId(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }
function cents(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,15})$/u.test(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(reviewMessage);
  return value;
}
function text(value: unknown, max: number): value is string { return typeof value === 'string' && !!value.trim() && value.length <= max && !/[\u0000-\u001f]/u.test(value); }
function version(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value); }
function date(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/u.test(value)) return false;
  try { return parseBusinessDate(value.slice(0, 10)).toISOString() === value; } catch { return false; }
}
function instant(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
export function readPaymentAdjustmentEvent(value: unknown): PaymentAdjustmentEvent {
  const data = record(value);
  if (!positiveId(data.id) || !positiveId(data.originalPaymentId) || !['PAYMENT_CORRECTION', 'CUSTOMER_REFUND'].includes(data.kind as string)
    || cents(data.amountCents) === '0' || data.currency !== 'EUR' || !date(data.actionDate) || !instant(data.accountingEffectiveOn)
    || !text(data.reason, 1000) || !text(data.reference, 255) || !text(data.idempotencyKey, 128)
    || data.fiscalMappingStatus !== 'UNREVIEWED' || (data.cancellationInvoiceId !== null && !positiveId(data.cancellationInvoiceId))
    || (data.kind === 'PAYMENT_CORRECTION' && data.cancellationInvoiceId !== null)
    || (data.kind === 'CUSTOMER_REFUND' && (!positiveId(data.cancellationInvoiceId) || data.accountingEffectiveOn !== data.actionDate))) throw new Error(reviewMessage);
  if (data.contractVersion === 3) {
    const proof = record(data.allocationBasisSnapshot);
    if (!positiveId(data.invoiceId) || !positiveId(data.allocationBindingId) || !Number.isSafeInteger(data.allocationRevision) || Number(data.allocationRevision) < 0
      || (data.allocationRevision === 0 ? data.allocationChangeId !== null || proof.allocationChangeStableKey !== null : !positiveId(data.allocationChangeId) || !text(proof.allocationChangeStableKey, 64))
      || proof.contractVersion !== 1 || !text(proof.bindingStableKey, 64) || !text(proof.rowStableKey, 64) || !text(proof.originalPaymentKey, 128)
      || proof.allocationRevision !== data.allocationRevision || !text(proof.originInvoiceNumber, 255) || !text(proof.currentInvoiceNumber, 255)
      || cents(proof.amountCents) === '0' || proof.currency !== 'EUR' || !version(proof.originCommercialHash) || !version(proof.currentCommercialHash)) throw new Error(reviewMessage);
  } else if (data.contractVersion !== undefined && data.contractVersion !== 2) throw new Error(reviewMessage);
  else if (data.allocationBindingId != null || data.allocationRevision != null || data.allocationChangeId != null || data.allocationBasisSnapshot != null) throw new Error(reviewMessage);
  return data as PaymentAdjustmentEvent;
}
/** All capabilities come from the checked server journal, never an invoice badge. */
export function readPaymentAdjustmentPreflight(value: unknown, invoiceId: number): PaymentAdjustmentPreflight {
  const data = record(value);
  if (data.currency !== 'EUR' || data.reviewRequired || data.legacyAdoptionRequired || !version(data.ledgerVersion)
    || !Array.isArray(data.adjustments) || !Array.isArray(data.adjustmentCapacities)
    || typeof data.canRecordAdjustment !== 'boolean' || (data.adjustmentReviewReason !== null && typeof data.adjustmentReviewReason !== 'string')) throw new Error(reviewMessage);
  const ledger = readPaymentLedger(data.ledger);
  if (ledger.version === 3) return readAllocationAdjustmentPreflight(data, invoiceId, ledger);
  const summary = readPaymentSummary(data.summary, ledger), events = readPaymentEvents(data);
  const originalEvents = new Map(events.map(event => [event.id, event]));
  if (originalEvents.size !== events.length || events.some(event => event.invoiceId !== invoiceId)
    || events.reduce((sum, event) => sum + BigInt(event.amountCents), BigInt(0)).toString() !== ledger.originalReceivedCents) throw new Error(reviewMessage);
  const adjustments = data.adjustments.map(readPaymentAdjustmentEvent);
  const ids = new Set<number>(), keys = new Set<string>();
  let corrected = BigInt(0), refunded = BigInt(0);
  const usage = new Map<number, bigint>();
  for (const adjustment of adjustments) {
    const original = originalEvents.get(adjustment.originalPaymentId);
    if (!original || ids.has(adjustment.id) || keys.has(adjustment.idempotencyKey)) throw new Error(reviewMessage);
    if (adjustment.kind === 'PAYMENT_CORRECTION' && adjustment.accountingEffectiveOn !== original.paidAt) throw new Error(reviewMessage);
    ids.add(adjustment.id); keys.add(adjustment.idempotencyKey);
    const used = (usage.get(original.id) ?? BigInt(0)) + BigInt(adjustment.amountCents);
    if (used > BigInt(original.amountCents)) throw new Error(reviewMessage);
    usage.set(original.id, used);
    if (adjustment.kind === 'PAYMENT_CORRECTION') corrected += BigInt(adjustment.amountCents); else refunded += BigInt(adjustment.amountCents);
  }
  if (corrected.toString() !== ledger.correctedCents || refunded.toString() !== ledger.refundedCents) throw new Error(reviewMessage);
  const capacityIds = new Set<number>();
  const adjustmentCapacities = data.adjustmentCapacities.map(value => {
    const capacity = record(value), original = originalEvents.get(capacity.originalPaymentId as number);
    const correctableCents = cents(capacity.correctableCents), refundableCents = cents(capacity.refundableCents);
    if (!original || capacityIds.has(original.id) || BigInt(correctableCents) > BigInt(original.amountCents) - (usage.get(original.id) ?? BigInt(0))
      || BigInt(refundableCents) > BigInt(original.amountCents) - (usage.get(original.id) ?? BigInt(0))
      || (data.canRecordAdjustment && (correctableCents !== '0' || refundableCents !== '0') && (!['MANUAL', 'LEGACY_STATUS'].includes(original.source) || original.dateCertainty !== 'ACTUAL'))) throw new Error(reviewMessage);
    capacityIds.add(original.id);
    return { originalPaymentId: original.id, correctableCents, refundableCents };
  });
  let eligibleCancellationBasis: PaymentAdjustmentPreflight['eligibleCancellationBasis'] = null;
  if (data.eligibleCancellationBasis !== null) {
    const basis = record(data.eligibleCancellationBasis);
    if (!positiveId(basis.invoiceId) || basis.invoiceId === invoiceId || (basis.invoiceNumber !== null && !text(basis.invoiceNumber, 255))) throw new Error(reviewMessage);
    eligibleCancellationBasis = { invoiceId: basis.invoiceId, invoiceNumber: basis.invoiceNumber as string | null };
  }
  return { ledger, ledgerVersion: data.ledgerVersion, summary, events, adjustments, adjustmentCapacities, eligibleCancellationBasis,
    canRecordAdjustment: data.canRecordAdjustment, adjustmentReviewReason: data.adjustmentReviewReason as string | null };
}
export function validatePaymentAdjustmentFields(kind: PaymentAdjustmentKind, actionDate: string, reason: string, reference: string, acknowledged: boolean): string | null {
  try { parseBusinessDate(actionDate); } catch { return kind === 'CUSTOMER_REFUND' ? 'Bitte das tatsächliche Auszahlungsdatum angeben.' : 'Bitte das Datum der Korrektur angeben.'; }
  if (!text(reason, 1000)) return 'Bitte einen nachvollziehbaren Grund mit 1 bis 1000 Zeichen angeben.';
  if (!text(reference, 255)) return kind === 'CUSTOMER_REFUND' ? 'Bitte den tatsächlichen Auszahlungsnachweis mit 1 bis 255 Zeichen angeben.' : 'Bitte einen prüfbaren Korrekturbezug mit 1 bis 255 Zeichen angeben.';
  if (!acknowledged) return kind === 'CUSTOMER_REFUND' ? 'Bitte bestätigen, dass das Geld bereits tatsächlich ausgezahlt wurde.' : 'Bitte bestätigen, dass dieser Betrag nie eingegangen ist. Wirklich erhaltenes Geld mit falscher Rechnung wird neu zugeordnet; nur eine tatsächliche Auszahlung ist eine Erstattung.';
  return null;
}
export function paymentAdjustmentAttempt(previous: PaymentAdjustmentDraft | null, input: {
  kind: PaymentAdjustmentKind; originalPaymentId: number; amount: string; actionDate: string; reason: string; reference: string; expectedLedgerVersion: string; cancellationInvoiceId?: number; expectedAllocationRevision?: number;
}, uuid: () => string): PaymentAdjustmentDraft {
  const amountCents = paymentInputCents(input.amount), amount = paymentAmountInput(amountCents);
  if (!positiveId(input.originalPaymentId) || !version(input.expectedLedgerVersion)
    || (input.expectedAllocationRevision !== undefined && (!Number.isSafeInteger(input.expectedAllocationRevision) || input.expectedAllocationRevision < 0))
    || (input.kind === 'CUSTOMER_REFUND' && !positiveId(input.cancellationInvoiceId))) throw new Error(reviewMessage);
  const normalized = { kind: input.kind, originalPaymentId: input.originalPaymentId, amount, currency: 'EUR' as const, actionDate: input.actionDate,
    reason: input.reason.trim(), reference: input.reference.trim(), expectedLedgerVersion: input.expectedLedgerVersion,
    ...(input.expectedAllocationRevision !== undefined ? { expectedAllocationRevision: input.expectedAllocationRevision } : {}),
    ...(input.kind === 'CUSTOMER_REFUND' ? { cancellationInvoiceId: input.cancellationInvoiceId } : { declarationNeverReceived: true as const }) };
  const fingerprint = JSON.stringify(normalized);
  return { ...normalized, amountCents, fingerprint, idempotencyKey: previous?.fingerprint === fingerprint ? previous.idempotencyKey : uuid() };
}
export function paymentAdjustmentPayload(draft: PaymentAdjustmentDraft) {
  const { amountCents: _amountCents, fingerprint: _fingerprint, currency: _currency, ...payload } = draft;
  return payload;
}
export function readConfirmedPaymentAdjustment(value: unknown, draft: PaymentAdjustmentDraft, originalPaidAt?: string | null): PaymentAdjustmentEvent {
  try {
    const data = record(value), adjustment = readPaymentAdjustmentEvent(data.adjustment);
    const ledger = readPaymentLedger(data.ledger);
    readPaymentSummary(data.summary, ledger);
    if (!version(data.ledgerVersion) || adjustment.originalPaymentId !== draft.originalPaymentId || adjustment.kind !== draft.kind
      || adjustment.amountCents !== draft.amountCents || adjustment.idempotencyKey !== draft.idempotencyKey
      || adjustment.actionDate !== `${draft.actionDate}T00:00:00.000Z` || adjustment.reason !== draft.reason || adjustment.reference !== draft.reference
      || (draft.kind === 'PAYMENT_CORRECTION' && originalPaidAt !== undefined && adjustment.accountingEffectiveOn !== originalPaidAt)
      || adjustment.cancellationInvoiceId !== (draft.cancellationInvoiceId ?? null)
      || (draft.expectedAllocationRevision !== undefined ? adjustment.contractVersion !== 3 || adjustment.allocationRevision !== draft.expectedAllocationRevision : adjustment.contractVersion === 3)) throw new Error();
    return adjustment;
  } catch { throw new Error(confirmationMessage); }
}
export async function adjustmentFingerprintHash(fingerprint: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint));
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('');
}
export function adjustmentPendingStorageKey(tenantId: string, invoiceId: number): string { return `bivaro:payment-adjustment-pending:${encodeURIComponent(tenantId)}:${invoiceId}`; }
export function readPendingAdjustment(value: string | null): PendingAdjustment | null {
  if (!value) return null;
  try {
    const data = record(JSON.parse(value));
    if (typeof data.idempotencyKey !== 'string' || !/^[\da-f-]{36}$/iu.test(data.idempotencyKey) || !version(data.expectedLedgerVersion) || !version(data.fingerprintHash)) return null;
    return { idempotencyKey: data.idempotencyKey, expectedLedgerVersion: data.expectedLedgerVersion, fingerprintHash: data.fingerprintHash };
  } catch { return null; }
}
export function persistPendingAdjustment(storage: Pick<Storage, 'setItem' | 'getItem'>, key: string, pending: PendingAdjustment): void {
  const serialized = JSON.stringify(pending);
  try {
    storage.setItem(key, serialized);
    if (storage.getItem(key) !== serialized) throw new Error();
  } catch { throw new Error('Keine Anfrage gesendet: Die anonyme Anfragekennung konnte nicht sicher im Browser gespeichert werden. Eingaben bleiben erhalten. Browser-Speicher zulassen, Journal neu laden und erst danach sicher erneut versuchen.'); }
}
export function adjustmentFailure(value: unknown): string {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (data.code === 'IDEMPOTENCY_CONFLICT') return 'Die Anfragekennung gehört zu anderen Daten. Bitte Journal prüfen; keine neue Korrektur oder Erstattung erfassen.';
  if (data.code === 'PAYMENT_STATE_CHANGED' || data.code === 'PAYMENT_LEDGER_CHANGED') return 'Das Zahlungsjournal wurde geändert. Ihre Eingaben bleiben erhalten. Bitte den aktuellen Stand laden und vor einer neuen Bestätigung bewusst prüfen.';
  return typeof data.error === 'string' && data.error ? data.error : confirmationMessage;
}

function readAllocationAdjustmentPreflight(data: Record<string, unknown>, invoiceId: number, ledger: PaymentLedgerV3): PaymentAdjustmentPreflight {
  if (data.paymentContractVersion !== 3) throw new Error(reviewMessage);
  const summary = readPaymentSummary(data.summary, ledger), events = readPaymentEvents(data);
  const effectivePayments = readEffectivePayments(data.effectivePayments), rootCapabilities = readRootCapabilities(data.rootCapabilities, effectivePayments);
  const originAssignments = readOriginAssignments(data.originAssignments, events), allocationHistory = readPaymentAllocationHistory(data.allocationHistory);
  if (events.some(event => event.invoiceId !== invoiceId) || effectivePayments.some(root => root.allocatedInvoiceId !== invoiceId)) throw new Error(reviewMessage);
  const roots = new Map(events.map(event => [event.id, { amountCents: event.amountCents, paidAt: event.paidAt }]));
  for (const root of effectivePayments) {
    const origin = roots.get(root.originalPaymentId);
    if (origin && (origin.amountCents !== root.amountCents || origin.paidAt !== root.paidAt || root.originInvoiceId !== invoiceId)) throw new Error(reviewMessage);
    roots.set(root.originalPaymentId, { amountCents: root.amountCents, paidAt: root.paidAt });
  }
  if (new Set(events.map(event => event.id)).size !== events.length
    || events.reduce((sum, root) => sum + BigInt(root.amountCents), BigInt(0)).toString() !== ledger.originCash.originalReceivedCents) throw new Error(reviewMessage);
  const adjustments = (data.adjustments as unknown[]).map(readPaymentAdjustmentEvent), ids = new Set<number>(), keys = new Set<string>();
  const usage = new Map<number, { corrected: bigint; refunded: bigint }>();
  for (const adjustment of adjustments) {
    const root = roots.get(adjustment.originalPaymentId), effective = effectivePayments.find(root => root.originalPaymentId === adjustment.originalPaymentId);
    if (!root || ids.has(adjustment.id) || keys.has(adjustment.idempotencyKey)
      || (adjustment.kind === 'PAYMENT_CORRECTION' && adjustment.accountingEffectiveOn !== root.paidAt)) throw new Error(reviewMessage);
    if (adjustment.contractVersion === 3) {
      const proof = adjustment.allocationBasisSnapshot!;
      if (proof.amountCents !== root.amountCents || (effective && (adjustment.invoiceId !== invoiceId || effective.bindingStableKey !== proof.bindingStableKey
        || effective.allocationRevision !== proof.allocationRevision || effective.allocationChangeStableKey !== proof.allocationChangeStableKey))) throw new Error(reviewMessage);
    } else if (effective?.provenance === 'BANK_CSV') throw new Error(reviewMessage);
    ids.add(adjustment.id); keys.add(adjustment.idempotencyKey);
    const used = usage.get(adjustment.originalPaymentId) ?? { corrected: BigInt(0), refunded: BigInt(0) };
    if (adjustment.kind === 'PAYMENT_CORRECTION') used.corrected += BigInt(adjustment.amountCents); else used.refunded += BigInt(adjustment.amountCents);
    if (used.corrected + used.refunded > BigInt(root.amountCents)) throw new Error(reviewMessage);
    usage.set(adjustment.originalPaymentId, used);
  }
  const sum = (ids: number[], field: 'corrected' | 'refunded') => ids.reduce((sum, id) => sum + (usage.get(id)?.[field] ?? BigInt(0)), BigInt(0)).toString();
  if (sum(events.map(root => root.id), 'corrected') !== ledger.originCash.correctedCents || sum(events.map(root => root.id), 'refunded') !== ledger.originCash.refundedCents
    || sum(effectivePayments.map(root => root.originalPaymentId), 'corrected') !== ledger.allocation.correctedAllocatedCents || sum(effectivePayments.map(root => root.originalPaymentId), 'refunded') !== ledger.allocation.refundedAllocatedCents
    || effectivePayments.reduce((sum, root) => sum + BigInt(root.amountCents), BigInt(0)).toString() !== ledger.allocation.originalAllocatedCents) throw new Error(reviewMessage);
  for (const root of effectivePayments) {
    const used = usage.get(root.originalPaymentId);
    if ((BigInt(root.amountCents) - (used?.corrected ?? BigInt(0))).toString() !== root.validReceivedCents
      || (used?.refunded ?? BigInt(0)).toString() !== root.refundedCents) throw new Error(reviewMessage);
  }
  let eligibleCancellationBasis: PaymentAdjustmentPreflight['eligibleCancellationBasis'] = null;
  if (data.eligibleCancellationBasis !== null) {
    const basis = record(data.eligibleCancellationBasis);
    if (!positiveId(basis.invoiceId) || basis.invoiceId === invoiceId || (basis.invoiceNumber !== null && !text(basis.invoiceNumber, 255))) throw new Error(reviewMessage);
    eligibleCancellationBasis = { invoiceId: basis.invoiceId, invoiceNumber: basis.invoiceNumber as string | null };
  }
  const adjustmentCapacities = (data.adjustmentCapacities as unknown[]).map(value => {
    const capacity = record(value), checked = rootCapabilities.find(root => root.originalPaymentId === capacity.originalPaymentId);
    if (!checked || capacity.correctableCents !== checked.correctableCents || capacity.refundableCents !== checked.refundableCents) throw new Error(reviewMessage);
    return { originalPaymentId: checked.originalPaymentId, correctableCents: checked.correctableCents, refundableCents: checked.refundableCents };
  });
  if (adjustmentCapacities.length !== rootCapabilities.length || new Set(adjustmentCapacities.map(root => root.originalPaymentId)).size !== rootCapabilities.length
    || data.canRecordAdjustment !== rootCapabilities.some(root => root.canCorrect || root.canRefund)) throw new Error(reviewMessage);
  return { ledger, ledgerVersion: data.ledgerVersion as string, summary, events, originEvents: events, originAssignments, allocationHistory, effectivePayments, rootCapabilities, adjustments, adjustmentCapacities,
    eligibleCancellationBasis, canRecordAdjustment: data.canRecordAdjustment as boolean, adjustmentReviewReason: data.adjustmentReviewReason as string | null };
}
