import { hasServiceBillingDraftMarker } from '@/lib/service-billing';
import { inTransaction } from '@/lib/db-transaction';
import { createFinancialAuditLog } from '@/lib/audit-log';
import { loadInvoicePaymentState } from '@/lib/payment-journal/allocation-ledger';
import { recordFullPaymentInTransaction } from '@/lib/payment-journal/service';
import { paymentDate, PaymentJournalError } from '@/lib/payment-journal/contract';

export class InvoicePaymentError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function deleteInvoice(userId: string, id: number) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new InvoicePaymentError('Ungültige Rechnungs-ID');
  await inTransaction(async tx => {
    const invoice = await tx.invoice.findFirst({ where: { id, userId, type: 'INVOICE' }, include: { incomes: { include: { cashTransaction: true } }, reminders: { select: { balanceSnapshot: true } } } });
    if (!invoice) throw new InvoicePaymentError('Rechnung nicht gefunden', 404);
    if (invoice.type !== 'INVOICE') {
      throw new InvoicePaymentError('Dieser Beleg kann nicht gelöscht werden', 409);
    }
    // Status alone is not evidence that a document was never issued.  The
    // lifecycle marker is conservative for legacy rows (UNKNOWN) and must be
    // explicitly UNISSUED for a deletion to be possible.
    if (invoice.status !== 'DRAFT' || invoice.issuanceState !== 'UNISSUED') {
      throw new InvoicePaymentError('Ausgestellte oder nicht eindeutig ungeausfertigte Rechnungen können nicht gelöscht werden', 409);
    }
    if (invoice.reminders.some(reminder => reminder.balanceSnapshot != null)) throw new InvoicePaymentError('Die Rechnung hat eine bestätigte Mahn-Restbetragshistorie und kann nicht gelöscht werden.', 409);
    if (invoice.paidAt) throw new InvoicePaymentError('Die Rechnung hat einen Zahlungsnachweis und kann nicht gelöscht werden', 409);
    if (invoice.incomes.length > 0) throw new InvoicePaymentError('Die Rechnung hat bereits eine Einnahme und kann nicht gelöscht werden', 409);
    await tx.invoice.delete({ where: { id, userId } });
    await createFinancialAuditLog({
      userId,
      action: 'DELETE',
      entityType: 'Invoice',
      entityId: id,
      entityName: invoice.invoiceNumber ?? invoice.fileName,
      oldValues: { status: invoice.status, issuanceState: invoice.issuanceState, invoiceNumber: invoice.invoiceNumber },
      metadata: {
        actorId: userId,
        tenantId: userId,
        operation: 'invoice.delete',
        originalReference: invoice.invoiceNumber ?? `invoice:${id}`,
        reason: 'never-issued draft deletion',
      },
    }, tx);
  });
  return { success: true, deleted: true, id };
}

export async function updateInvoiceStatus(
  userId: string,
  id: number,
  status?: string,
  paidAt?: string | null,
  customerId?: number | null,
) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new InvoicePaymentError('Ungültige Rechnungs-ID');
  if (status !== undefined && !['DRAFT', 'SENT', 'PAID'].includes(status)) {
    throw new InvoicePaymentError('Ungültiger Status. Stornierungen benötigen eine Gutschrift.');
  }
  if (paidAt !== undefined && paidAt !== null && !Number.isFinite(new Date(paidAt).getTime())) {
    throw new InvoicePaymentError('Ungültiges Zahlungsdatum');
  }
  const result = await inTransaction(async tx => {
    const old = await tx.invoice.findFirst({
      where: { id, userId },
      include: {
        incomes: { include: { cashTransaction: true } },
        paymentJournalEvents: true,
        billingNotes: { select: { id: true } },
      },
    });
    if (!old) throw new InvoicePaymentError('Rechnung nicht gefunden', 404);
    if (hasServiceBillingDraftMarker(old.parsedData)) throw new InvoicePaymentError('Bitte diesen Serviceentwurf zuerst im Rechnungseditor prüfen und eine echte Rechnungsdatei erstellen.', 409);
    if (old.type !== 'INVOICE' || old.status === 'CANCELLED') {
      throw new InvoicePaymentError('Dieser Beleg kann nicht als Rechnung geändert werden', 409);
    }
    if (old.paidAt && old.status !== 'PAID') {
      throw new InvoicePaymentError('Die Rechnung enthält einen Zahlungsnachweis bei inkonsistentem Status und kann nicht geändert werden.', 409);
    }
    if (customerId !== undefined && customerId !== null && !await tx.customer.findFirst({ where: { id: customerId, userId } })) {
      throw new InvoicePaymentError('Kunde nicht gefunden', 404);
    }
    const nextStatus = status ?? old.status;
    const allocationHistory = await tx.bankPaymentBinding.findFirst({ where: { userId, OR: [
      { paymentJournalEvent: { invoiceId: id } },
      { allocationChanges: { some: { userId, OR: [{ fromInvoiceId: id }, { toInvoiceId: id }] } } },
    ] }, select: { id: true } });
    if (allocationHistory) {
      // Incoming allocations may have neither a local Income nor an origin root.
      // Verify the effective projection before accepting even an idempotent no-op.
      await loadInvoicePaymentState(tx, userId, id);
      const dateChanged = paidAt !== undefined && (paidAt === null ? null : new Date(paidAt).getTime()) !== (old.paidAt?.getTime() ?? null);
      if (nextStatus !== old.status || dateChanged || (customerId !== undefined && customerId !== old.customerId)) {
        throw new PaymentJournalError('Diese Rechnung hat unveränderliche Bank- oder Rechnungszuordnungshistorie. Zahlung, Berichtigung oder Zuordnungsänderung bitte im jeweiligen Zahlungsablauf prüfen; Status, Zahlungsdatum und Kunde können hier nicht überschrieben werden.', 409, 'PAYMENT_ALLOCATION_WORKFLOW_REQUIRED');
      }
    }
    if ((old.status === 'PAID' && nextStatus !== 'PAID')
      || (old.status === 'SENT' && nextStatus === 'DRAFT')) {
      throw new InvoicePaymentError('Ausgestellte Rechnungen können nicht wieder geöffnet werden; bitte stornieren Sie sie über eine Gutschrift.', 409);
    }
    if (nextStatus !== 'PAID' && paidAt != null) throw new InvoicePaymentError('Zahlungsdatum erfordert den Status PAID');
    const explicitPaymentDate = paidAt == null ? null : paymentDate(paidAt, true);
    if (old.status === 'PAID' && explicitPaymentDate
      && old.paidAt?.getTime() !== explicitPaymentDate.getTime()) {
      throw new InvoicePaymentError('Das Zahlungsdatum einer gebuchten Zahlung kann nicht nachträglich geändert werden.', 409);
    }
    // Never turn a missing historical date into today's date.
    const nextPaidAt = nextStatus === 'PAID' ? explicitPaymentDate ?? old.paidAt : null;
    const paidDateChanged = nextStatus === 'PAID'
      && (old.paidAt?.getTime() ?? null) !== (nextPaidAt?.getTime() ?? null);
    const customerChanged = customerId !== undefined && customerId !== old.customerId;
    if (customerChanged && old.billingNotes.length > 0) {
      throw new InvoicePaymentError('Der Kunde einer Rechnung mit Leistungsnotizen kann nicht geändert werden.', 409);
    }
    const statusChanged = nextStatus !== old.status;
    const changed = statusChanged || paidDateChanged || customerChanged;
    if (changed && old.incomes.some(income => income.cashTransaction)) {
      throw new InvoicePaymentError('Die Zahlung ist mit dem Kassenbuch verknüpft. Bitte zuerst dort korrigieren.', 409);
    }

    if (old.paymentJournalEvents.length > 0 && changed && nextStatus === 'PAID' && old.status !== 'PAID') {
      throw new PaymentJournalError('Bitte die Restzahlung mit Betrag, Datum und Bezug im Zahlungsdialog erfassen.', 409, 'PAYMENT_DETAILS_REQUIRED');
    }
    if ((old.incomes.length > 0 || old.paymentJournalEvents.length > 0) && changed) {
      throw new InvoicePaymentError('Die Rechnung ist bereits als Einnahme gebucht und kann nicht erneut verändert werden.', 409);
    }
    if (changed && nextStatus === 'PAID') {
      if (!explicitPaymentDate) {
        throw new PaymentJournalError('Bitte die tatsächliche Zahlung mit Betrag, Datum und Bezug über den Zahlungsdialog erfassen.', 400, 'PAYMENT_DETAILS_REQUIRED');
      }
      if (customerChanged) await tx.invoice.update({ where: { id, userId }, data: { customerId } });
      await recordFullPaymentInTransaction(tx, userId, id, {
        amount: old.totalAmount!, currency: 'EUR', paidAt: paidAt!, source: 'LEGACY_STATUS',
        reference: old.invoiceNumber?.trim() || `invoice:${id}`, idempotencyKey: `legacy-status:invoice:${id}`,
      });
    } else if (changed) {
      await tx.invoice.update({ where: { id, userId }, data: {
        status: nextStatus,
        ...(customerId !== undefined ? { customerId } : {}),
        ...(nextStatus === 'SENT' ? { issuanceState: 'ISSUED' } : {}),
      } });
    }
    const persisted = await tx.invoice.findUniqueOrThrow({ where: { id }, include: { incomes: true, customer: true } });
    if (changed && nextStatus !== 'PAID') {
      await createFinancialAuditLog({
        userId,
        action: 'STATUS_CHANGED',
        entityType: 'Invoice',
        entityId: id,
        entityName: persisted.invoiceNumber ?? undefined,
        oldValues: { status: old.status, paidAt: old.paidAt, customerId: old.customerId },
        newValues: { status: persisted.status, paidAt: persisted.paidAt, customerId: persisted.customerId },
        metadata: {
          actorId: userId,
          tenantId: userId,
          operation: 'invoice.status-change',
          originalReference: persisted.invoiceNumber ?? `invoice:${id}`,
          reason: `status changed to ${nextStatus}`,
        },
      }, tx);
    }
    return { old, invoice: persisted, changed };
  });
  return result.invoice;
}
