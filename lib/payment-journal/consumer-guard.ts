import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
/** Positive-only consumers must never silently omit immutable adjustment effects. */
export const PAYMENT_ADJUSTMENT_REVIEW_RESPONSE = {
  error: 'Zahlungsberichtigungen oder tatsächliche Rückzahlungen sind vorhanden. Diese positive-only Auswertung ist dafür gesperrt; Steuerzuordnung und betroffene Vorperioden müssen fachlich geprüft werden. Originale, Zahlungsjournal und neutrales Kanzleipaket bleiben verfügbar.',
  code: 'PAYMENT_ADJUSTMENTS_REVIEW_REQUIRED', fiscalMappingStatus: 'UNREVIEWED', paymentContractVersion: 2,
  alternative: '/handoff',
} as const;
export async function hasPaymentAdjustments(userId: string, client: Pick<Prisma.TransactionClient, 'paymentAdjustment'> = prisma) {
  return await client.paymentAdjustment.count({ where: { userId } }) > 0;
}

export class PaymentAdjustmentConsumerError extends Error {
  constructor() { super(PAYMENT_ADJUSTMENT_REVIEW_RESPONSE.error); }
}
export async function assertPositiveOnlySnapshot(client: Pick<Prisma.TransactionClient, 'paymentAdjustment'>, userId: string) {
  if (await hasPaymentAdjustments(userId, client)) throw new PaymentAdjustmentConsumerError();
}
