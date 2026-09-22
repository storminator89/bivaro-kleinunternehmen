import { inTransaction } from '@/lib/db-transaction';
import { createFinancialAuditLog } from '@/lib/audit-log';
import { getEInvoiceBookingRejection } from '@/lib/e-invoice-parser';

export class InvoicePaymentError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function deleteInvoice(userId: string, id: number) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new InvoicePaymentError('Ungültige Rechnungs-ID');
  await inTransaction(async tx => {
    const invoice = await tx.invoice.findFirst({ where: { id, userId, type: 'INVOICE' }, include: { income: { include: { cashTransaction: true } } } });
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
    if (invoice.paidAt) throw new InvoicePaymentError('Die Rechnung hat einen Zahlungsnachweis und kann nicht gelöscht werden', 409);
    if (invoice.income) throw new InvoicePaymentError('Die Rechnung hat bereits eine Einnahme und kann nicht gelöscht werden', 409);
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
        income: { include: { cashTransaction: true } },
        billingNotes: { select: { id: true } },
      },
    });
    if (!old) throw new InvoicePaymentError('Rechnung nicht gefunden', 404);
    if (old.type !== 'INVOICE' || old.status === 'CANCELLED') {
      throw new InvoicePaymentError('Dieser Beleg kann nicht als Rechnung geändert werden', 409);
    }
    if (old.income?.cashTransaction) {
      throw new InvoicePaymentError('Die Zahlung ist mit dem Kassenbuch verknüpft. Bitte zuerst dort korrigieren.', 409);
    }
    if (old.paidAt && old.status !== 'PAID') {
      throw new InvoicePaymentError('Die Rechnung enthält einen Zahlungsnachweis bei inkonsistentem Status und kann nicht geändert werden.', 409);
    }
    if (customerId !== undefined && customerId !== null && !await tx.customer.findFirst({ where: { id: customerId, userId } })) {
      throw new InvoicePaymentError('Kunde nicht gefunden', 404);
    }
    const nextStatus = status ?? old.status;
    if ((old.status === 'PAID' && nextStatus !== 'PAID')
      || (old.status === 'SENT' && nextStatus === 'DRAFT')) {
      throw new InvoicePaymentError('Ausgestellte Rechnungen können nicht wieder geöffnet werden; bitte stornieren Sie sie über eine Gutschrift.', 409);
    }
    const paymentDate = nextStatus === 'PAID' ? new Date(paidAt ?? old.paidAt ?? new Date()) : null;
    if (nextStatus !== 'PAID' && paidAt != null) throw new InvoicePaymentError('Zahlungsdatum erfordert den Status PAID');
    if (old.status === 'PAID' && paidAt != null
      && old.paidAt?.getTime() !== paymentDate?.getTime()) {
      throw new InvoicePaymentError('Das Zahlungsdatum einer gebuchten Zahlung kann nicht nachträglich geändert werden.', 409);
    }
    const paidDateChanged = nextStatus === 'PAID'
      && (old.paidAt?.getTime() ?? null) !== (paymentDate?.getTime() ?? null);
    const customerChanged = customerId !== undefined && customerId !== old.customerId;
    if (customerChanged && old.billingNotes.length > 0) {
      throw new InvoicePaymentError('Der Kunde einer Rechnung mit Leistungsnotizen kann nicht geändert werden.', 409);
    }
    const statusChanged = nextStatus !== old.status;
    const changed = statusChanged || paidDateChanged || customerChanged;
    if (old.income && changed) {
      throw new InvoicePaymentError('Die Rechnung ist bereits als Einnahme gebucht und kann nicht erneut verändert werden.', 409);
    }
    let invoice;
    if (!changed) {
      invoice = await tx.invoice.findUniqueOrThrow({ where: { id }, include: { income: true, customer: true } });
    } else {
      invoice = await tx.invoice.update({ where: { id, userId }, data: {
        status: nextStatus,
        paidAt: paymentDate,
        ...(customerId !== undefined ? { customerId } : {}),
        ...(nextStatus === 'PAID' || nextStatus === 'SENT' ? { issuanceState: 'ISSUED' } : {}),
      } });
    }
    if (changed && nextStatus === 'PAID') {
      const importRejection = await getEInvoiceBookingRejection(invoice.parsedData);
      if (importRejection) {
        throw new InvoicePaymentError(`Die Zahlung kann nicht gebucht werden: ${importRejection}`, 409);
      }
      if (invoice.totalAmount === null || !Number.isFinite(invoice.totalAmount) || invoice.totalAmount < 0) {
        throw new InvoicePaymentError('Für die Zahlung ist ein gültiger Rechnungsbetrag erforderlich');
      }
      const data = { amount: invoice.totalAmount, date: paymentDate!, customerId: invoice.customerId };
      await tx.income.upsert({ where: { invoiceId: id },
        create: { ...data, userId, invoiceId: id, description: `Rechnung ${invoice.invoiceNumber ?? id}`, taxRelevant: true },
        update: data,
      });
    }
    const persisted = await tx.invoice.findUniqueOrThrow({ where: { id }, include: { income: true, customer: true } });
    if (changed) {
      await createFinancialAuditLog({
        userId,
        action: nextStatus === 'PAID' ? 'PAYMENT_RECEIVED' : 'STATUS_CHANGED',
        entityType: 'Invoice',
        entityId: id,
        entityName: persisted.invoiceNumber ?? undefined,
        oldValues: { status: old.status, paidAt: old.paidAt, customerId: old.customerId },
        newValues: { status: persisted.status, paidAt: persisted.paidAt, customerId: persisted.customerId },
        metadata: {
          actorId: userId,
          tenantId: userId,
          operation: nextStatus === 'PAID' ? 'invoice.payment' : 'invoice.status-change',
          originalReference: persisted.invoiceNumber ?? `invoice:${id}`,
          reason: nextStatus === 'PAID' ? 'payment recorded' : `status changed to ${nextStatus}`,
        },
      }, tx);
    }
    return { old, invoice: persisted, changed };
  });
  return result.invoice;
}
