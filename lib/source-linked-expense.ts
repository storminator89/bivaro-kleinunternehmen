import type { Prisma } from '@prisma/client';

export class SourceLinkedExpenseError extends Error {
  readonly status = 409;
  readonly code = 'SOURCE_LINKED';
  constructor() { super('Diese Ausgabe ist unveränderlich mit einem Eingangsoriginal verknüpft. Generisches Ändern, Löschen oder Kassenverknüpfen ist nicht erlaubt.'); this.name = 'SourceLinkedExpenseError'; }
}
/** Run inside the same transaction as the mutation. No tenant predicate can hide a malformed cross-tenant source link. */
export async function assertExpenseNotSourceLinked(tx: Prisma.TransactionClient, expenseId: number): Promise<void> {
  if (await tx.purchaseDocument.findFirst({ where: { expenseId }, select: { id: true } })) throw new SourceLinkedExpenseError();
}
