import { inTransaction } from '@/lib/db-transaction';
import { auditDelete, createAuditLog } from '@/lib/audit-log';
import { getEInvoiceBookingRejection } from '@/lib/e-invoice-parser';

export class InvoicePaymentError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function deleteInvoice(userId: string, id: number) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new InvoicePaymentError('Ungültige Rechnungs-ID');
  const old = await inTransaction(async tx => {
    const invoice = await tx.invoice.findFirst({ where: { id, userId, type: { not: 'QUOTE' } }, include: { income: { include: { cashTransaction: true } } } });
    if (!invoice) throw new InvoicePaymentError('Rechnung nicht gefunden', 404);
    if (invoice.income?.cashTransaction) throw new InvoicePaymentError('Die Rechnung ist mit dem Kassenbuch verknüpft', 409);
    if (invoice.income) await tx.income.delete({ where: { id: invoice.income.id, userId } });
    // If a credit-note FK rejects deletion, the income deletion rolls back too.
    await tx.invoice.delete({ where: { id, userId } });
    return invoice;
  });
  await auditDelete(userId, 'Invoice', old, old.invoiceNumber ?? old.fileName);
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
    const old = await tx.invoice.findFirst({ where: { id, userId }, include: { income: { include: { cashTransaction: true } } } });
    if (!old) throw new InvoicePaymentError('Rechnung nicht gefunden', 404);
    if (old.type !== 'INVOICE' || old.status === 'CANCELLED') {
      throw new InvoicePaymentError('Dieser Beleg kann nicht als Rechnung geändert werden', 409);
    }
    if (old.income?.cashTransaction) {
      throw new InvoicePaymentError('Die Zahlung ist mit dem Kassenbuch verknüpft. Bitte zuerst dort korrigieren.', 409);
    }
    if (customerId !== undefined && customerId !== null && !await tx.customer.findFirst({ where: { id: customerId, userId } })) {
      throw new InvoicePaymentError('Kunde nicht gefunden', 404);
    }
    const nextStatus = status ?? old.status;
    const paymentDate = nextStatus === 'PAID' ? new Date(paidAt ?? old.paidAt ?? new Date()) : null;
    if (nextStatus !== 'PAID' && paidAt != null) throw new InvoicePaymentError('Zahlungsdatum erfordert den Status PAID');
    const invoice = await tx.invoice.update({ where: { id, userId }, data: {
      status: nextStatus, paidAt: paymentDate, ...(customerId !== undefined ? { customerId } : {}),
    } });
    if (nextStatus === 'PAID') {
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
    } else {
      await tx.income.deleteMany({ where: { invoiceId: id, userId } });
    }
    return { old, invoice: await tx.invoice.findUniqueOrThrow({ where: { id }, include: { income: true, customer: true } }) };
  });
  await createAuditLog({ userId, action: status === 'PAID' ? 'PAYMENT_RECEIVED' : 'STATUS_CHANGED', entityType: 'Invoice',
    entityId: id, entityName: result.invoice.invoiceNumber ?? undefined,
    oldValues: { status: result.old.status, paidAt: result.old.paidAt },
    newValues: { status: result.invoice.status, paidAt: result.invoice.paidAt },
  });
  return result.invoice;
}
