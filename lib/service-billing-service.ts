import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { inTransaction } from '@/lib/db-transaction';
import { createFinancialAuditLog } from '@/lib/audit-log';
import { calculateInvoiceAmounts } from '@/lib/invoice-calculation';
import {
  getServiceBillingPeriod, isUnrenderedServiceBillingDraft, readServiceBillingPlanInput,
  ServiceBillingError, serviceBillingIndex, serviceBillingRecord, serviceBillingRevision,
  serviceBillingToday, type ServiceBillingDraftSeed,
} from '@/lib/service-billing';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const conflict = () => new ServiceBillingError('Der Plan wurde geändert. Bitte neu laden und den Zeitraum erneut prüfen.', 409, 'STALE_SERVICE_PLAN');
function planId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new ServiceBillingError('Ungültige Plan-ID.');
  return value;
}
async function auditPlan(tx: Prisma.TransactionClient, userId: string, id: string, operation: string, values: Record<string, unknown>) {
  await createFinancialAuditLog({ userId, action: operation === 'create' ? 'CREATE' : 'UPDATE', entityType: 'ServiceBillingPlan', entityId: id,
    newValues: values, metadata: { actorId: userId, tenantId: userId, operation: `service-plan.${operation}`, originalReference: id, reason: 'private service draft planning; no issuance or financial booking' },
  }, tx);
}

export async function listServiceBillingPlans(userId: string) {
  const today = serviceBillingToday();
  const plans = await prisma.serviceBillingPlan.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, include: {
    customer: { select: { id: true, name: true, userId: true } },
    periods: { orderBy: { periodIndex: 'desc' }, take: 12, include: { invoice: { select: { id: true, userId: true, status: true, invoiceNumber: true, storedFileName: true, issuanceState: true } } } },
  } });
  return { today, plans: plans.map(plan => {
    if (plan.customer.userId !== userId) throw new ServiceBillingError('Die Kundenzuordnung des Plans muss geprüft werden.', 409);
    const input = readServiceBillingPlanInput(plan);
    const preview = getServiceBillingPeriod(input.anchorDate, input.cadence, plan.nextPeriod);
    return { id: plan.id, stableKey: plan.stableKey, ...input, customer: { id: plan.customer.id, name: plan.customer.name },
      nextPeriod: plan.nextPeriod, status: plan.status, revision: plan.revision, preview,
      due: preview.periodStart <= today, missed: preview.nextDue <= today,
      periods: plan.periods.map(period => {
        if (period.userId !== userId || (period.invoice && period.invoice.userId !== userId)) throw new ServiceBillingError('Die Planhistorie muss geprüft werden.', 409);
        return { periodIndex: period.periodIndex, periodStart: period.periodStart, periodEnd: period.periodEnd, action: period.action, invoiceId: period.invoiceId,
          invoice: period.invoice ? { id: period.invoice.id, status: period.invoice.status, invoiceNumber: period.invoice.invoiceNumber, unrendered: period.invoice.storedFileName === '' && period.invoice.status === 'DRAFT' && period.invoice.issuanceState === 'UNISSUED' && period.invoice.invoiceNumber === null } : null };
      }),
    };
  }) };
}
export async function createServiceBillingPlan(userId: string, input: unknown) {
  const data = readServiceBillingPlanInput(input);
  const requestKey = serviceBillingRecord(input) ? input.requestId : undefined;
  if (requestKey !== undefined && (typeof requestKey !== 'string' || !UUID.test(requestKey))) throw new ServiceBillingError('Ungültige Plan-Anfrage-ID.');
  const stableKey = typeof requestKey === 'string' ? requestKey : randomUUID();
  return inTransaction(async tx => {
    const existing = await tx.serviceBillingPlan.findUnique({ where: { userId_stableKey: { userId, stableKey } } });
    if (existing) {
      if (JSON.stringify(readServiceBillingPlanInput(existing)) !== JSON.stringify(data)) throw new ServiceBillingError('Diese Plan-Anfrage wurde bereits mit anderen Daten gespeichert.', 409);
      return { id: existing.id, idempotent: true };
    }
    if (!await tx.customer.findFirst({ where: { id: data.customerId, userId }, select: { id: true } })) throw new ServiceBillingError('Kunde nicht gefunden.', 404);
    if (await tx.serviceBillingPlan.count({ where: { userId } }) >= 200) throw new ServiceBillingError('Maximal 200 Servicepläne sind möglich. Bitte bestehende Pläne verwenden.', 409);
    const created = await tx.serviceBillingPlan.create({ data: { ...data, items: data.items as Prisma.InputJsonValue, userId, stableKey } });
    await auditPlan(tx, userId, created.id, 'create', { stableKey, revision: 1, status: 'ACTIVE' });
    return { id: created.id, idempotent: false };
  });
}
export async function updateServiceBillingPlan(userId: string, input: unknown) {
  if (!serviceBillingRecord(input)) throw new ServiceBillingError('Ein Planobjekt ist erforderlich.');
  const id = planId(input.id); const revision = serviceBillingRevision(input.revision);
  const allowed = new Set(['id', 'revision', 'name', 'customerId', 'taxMode', 'items', 'status']);
  if (Object.keys(input).some(key => !allowed.has(key))) throw new ServiceBillingError('Startdatum und Intervall bleiben unverändert. Für einen neuen Rhythmus bitte einen neuen Plan anlegen.');
  return inTransaction(async tx => {
    const existing = await tx.serviceBillingPlan.findFirst({ where: { id, userId } });
    if (!existing) throw new ServiceBillingError('Serviceplan nicht gefunden.', 404);
    if (existing.revision !== revision) throw conflict();
    const status = input.status ?? existing.status;
    if (!['ACTIVE', 'PAUSED'].includes(String(status))) throw new ServiceBillingError('Ungültiger Planstatus.');
    const next = readServiceBillingPlanInput({ ...existing, ...input });
    if (!await tx.customer.findFirst({ where: { id: next.customerId, userId }, select: { id: true } })) throw new ServiceBillingError('Kunde nicht gefunden.', 404);
    const saved = await tx.serviceBillingPlan.updateMany({ where: { id, userId, revision }, data: {
      name: next.name, customerId: next.customerId, taxMode: next.taxMode, items: next.items as Prisma.InputJsonValue, status: String(status), revision: { increment: 1 },
    } });
    if (saved.count !== 1) throw conflict();
    await auditPlan(tx, userId, id, 'update', { revision: revision + 1, status });
    return { id, revision: revision + 1 };
  });
}
export async function reviewServiceBillingPeriod(userId: string, input: unknown, today = serviceBillingToday()) {
  if (!serviceBillingRecord(input) || input.confirmed !== true) throw new ServiceBillingError('Bitte diesen einzelnen Zeitraum bewusst bestätigen.');
  const id = planId(input.planId); const revision = serviceBillingRevision(input.revision); const periodIndex = serviceBillingIndex(input.periodIndex);
  if (input.action !== 'GENERATE' && input.action !== 'SKIP') throw new ServiceBillingError('Ungültige Planaktion.');
  const action = input.action;
  return inTransaction(async tx => {
    const plan = await tx.serviceBillingPlan.findFirst({ where: { id, userId }, include: { customer: true } });
    if (!plan) throw new ServiceBillingError('Serviceplan nicht gefunden.', 404);
    if (plan.customer.userId !== userId) throw new ServiceBillingError('Kundenzuordnung muss geprüft werden.', 409);
    const previous = await tx.serviceBillingPeriod.findUnique({ where: { planId_periodIndex: { planId: id, periodIndex } }, include: { invoice: true } });
    if (previous) {
      if (previous.userId !== userId || (previous.invoice && previous.invoice.userId !== userId)) throw new ServiceBillingError('Die Planhistorie muss geprüft werden.', 409);
      if (previous.action !== (action === 'GENERATE' ? 'GENERATED' : 'SKIPPED')) throw new ServiceBillingError('Dieser Zeitraum wurde bereits anders bearbeitet. Die Entscheidung wird nicht überschrieben.', 409);
      return { invoiceId: previous.invoiceId, idempotent: true, unrendered: previous.invoice ? isUnrenderedServiceBillingDraft(previous.invoice) : false, action: previous.action };
    }
    if (plan.revision !== revision || plan.nextPeriod !== periodIndex) throw conflict();
    if (plan.status !== 'ACTIVE') throw new ServiceBillingError('Der Plan ist pausiert. Vor einer Entwurfserstellung bitte bewusst fortsetzen.', 409);
    const data = readServiceBillingPlanInput(plan);
    const period = getServiceBillingPeriod(data.anchorDate, data.cadence, periodIndex);
    if (period.periodStart > today) throw new ServiceBillingError('Der nächste Zeitraum ist noch nicht fällig. Es wurde kein Entwurf angelegt.', 409);
    const customerAddress = [plan.customer.name, plan.customer.address, [plan.customer.zipCode, plan.customer.city].filter(Boolean).join(' ')].filter(Boolean).join('\n');
    if (action === 'GENERATE' && customerAddress.length > 4000) throw new ServiceBillingError('Die Kundenanschrift ist für den Rechnungsentwurf zu lang (maximal 4000 Zeichen). Bitte die Kundendaten zuerst prüfen; es wurde kein Entwurf angelegt.', 409);
    // Never advance the cursor into an unrepresentable calendar state.
    getServiceBillingPeriod(data.anchorDate, data.cadence, periodIndex + 1);
    const claimed = await tx.serviceBillingPlan.updateMany({ where: { id, userId, revision, nextPeriod: periodIndex, status: 'ACTIVE' }, data: { nextPeriod: { increment: 1 }, revision: { increment: 1 } } });
    if (claimed.count !== 1) throw conflict();
    let invoiceId: number | null = null;
    if (action === 'GENERATE') {
      const amounts = calculateInvoiceAmounts(data.items);
      const marker: ServiceBillingDraftSeed = { version: 1, planStableKey: plan.stableKey, periodIndex, periodStart: period.periodStart, periodEnd: period.periodEnd,
        taxMode: data.taxMode, items: data.items, customerAddress, notes: `Leistungszeitraum: ${period.periodStart} bis ${period.periodEnd}` };
      const created = await tx.invoice.create({ data: { userId, customerId: data.customerId, type: 'INVOICE', status: 'DRAFT', issuanceState: 'UNISSUED',
        fileName: `Serviceentwurf · ${data.name} · ${period.periodStart}`, storedFileName: '', invoiceNumber: null, invoiceDate: null, dueDate: null,
        totalAmount: amounts.grossAmount,
        parsedData: { _serviceBillingDraft: marker, currency: 'EUR', documentType: 'INVOICE', netAmount: amounts.netAmount, taxAmount: amounts.taxAmount,
          grossAmount: amounts.grossAmount, totalAmount: amounts.grossAmount, lineItems: data.items.map((item, index) => ({ ...item, positionNumber: String(index + 1), amount: amounts.lines[index].netAmount })) } as unknown as Prisma.InputJsonValue,
      } });
      invoiceId = created.id;
      await createFinancialAuditLog({ userId, action: 'CREATE', entityType: 'Invoice', entityId: invoiceId, entityName: created.fileName,
        newValues: { status: 'DRAFT', issuanceState: 'UNISSUED', invoiceNumber: null },
        metadata: { actorId: userId, tenantId: userId, operation: 'service-plan.generate-draft', originalReference: `${plan.stableKey}:${periodIndex}`, reason: 'one explicitly reviewed service period; editable draft only; no file, number, issuance, email or payment' },
      }, tx);
    }
    await tx.serviceBillingPeriod.create({ data: { userId, planId: id, periodIndex, periodStart: period.periodStart, periodEnd: period.periodEnd,
      action: action === 'GENERATE' ? 'GENERATED' : 'SKIPPED', invoiceId } });
    await auditPlan(tx, userId, id, action === 'GENERATE' ? 'period-draft' : 'period-skip', { periodIndex, invoiceId, revision: revision + 1 });
    return { invoiceId, idempotent: false, unrendered: invoiceId !== null, action: action === 'GENERATE' ? 'GENERATED' : 'SKIPPED' };
  });
}
