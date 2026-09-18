import { Prisma } from '@prisma/client';

type NumberDb = Pick<Prisma.TransactionClient, 'invoice' | 'invoiceNumberCounter'>;
export type DocumentType = 'INVOICE' | 'QUOTE' | 'CREDIT_NOTE';

export function documentNumberPrefix(type: DocumentType, year: number) {
  return `${type === 'QUOTE' ? 'AN-' : type === 'CREDIT_NOTE' ? 'GS-' : ''}${year}-`;
}

export function maximumDocumentSequence(numbers: Array<string | null>, prefix: string): number {
  return numbers.reduce<number>((max, number) => {
    if (!number?.startsWith(prefix)) return max;
    const suffix = number.slice(prefix.length);
    const sequence = /^\d+$/.test(suffix) ? Number(suffix) : 0;
    return Number.isSafeInteger(sequence) ? Math.max(max, sequence) : max;
  }, 0);
}

export async function previewDocumentNumber(db: NumberDb, userId: string, type: DocumentType, year = new Date().getFullYear()) {
  const prefix = documentNumberPrefix(type, year);
  const [documents, counter] = await Promise.all([
    db.invoice.findMany({ where: { userId, invoiceNumber: { startsWith: prefix } }, select: { invoiceNumber: true } }),
    db.invoiceNumberCounter.findUnique({ where: { userId_type_year: { userId, type, year } } }),
  ]);
  const value = Math.max(maximumDocumentSequence(documents.map(item => item.invoiceNumber), prefix), counter?.value ?? 0) + 1;
  return { value, number: `${prefix}${String(value).padStart(2, '0')}` };
}

/** Must run inside the transaction that creates the document. GET previews never reserve numbers. */
export async function getNextDocumentNumber(tx: Prisma.TransactionClient, userId: string, type: DocumentType, year = new Date().getFullYear()): Promise<string> {
  const next = await previewDocumentNumber(tx, userId, type, year);
  await tx.invoiceNumberCounter.upsert({
    where: { userId_type_year: { userId, type, year } },
    create: { userId, type, year, value: next.value }, update: { value: next.value },
  });
  return next.number;
}
