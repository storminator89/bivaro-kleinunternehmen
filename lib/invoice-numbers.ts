import { Prisma } from '@prisma/client';
import { defaultNumberingPolicy, DOCUMENT_TYPES, numberingNamespacesOverlap, DocumentNumberingError, formatDocumentNumber, isNumberingYear, knownNumberingFormats, matchDocumentNumber, MAX_NUMBERING_REVISIONS, MAX_DOCUMENT_SEQUENCE, validateNumberingFormat, type DocumentNumberSelection, type DocumentType, type NumberingPolicy } from '@/lib/document-numbering-policy';
export type { DocumentType } from '@/lib/document-numbering-policy';

type NumberDb = Pick<Prisma.TransactionClient, 'invoice' | 'invoiceNumberCounter' | 'documentNumberingPolicy'>;
export function documentNumberPrefix(type: DocumentType, year: number) { return `${defaultNumberingPolicy(type, year).prefix}${year}-`; }
export function maximumDocumentSequence(numbers: Array<string | null>, prefix: string): number {
  return numbers.reduce<number>((max, number) => {
    if (!number?.startsWith(prefix)) return max;
    const suffix = number.slice(prefix.length);
    const sequence = /^\d+$/.test(suffix) ? Number(suffix) : 0;
    return Number.isSafeInteger(sequence) ? Math.max(max, sequence) : max;
  }, 0);
}
export async function loadNumberingPolicies(db: NumberDb, userId: string): Promise<NumberingPolicy[]> {
  const rows = await db.documentNumberingPolicy.findMany({ where: { userId }, orderBy: [{ type: 'asc' }, { revision: 'asc' }], take: MAX_NUMBERING_REVISIONS * 3 + 1 });
  if (rows.length > MAX_NUMBERING_REVISIONS * 3) throw new DocumentNumberingError('Zu viele Nummernformat-Revisionen.', 422);
  return rows.map(row => ({ ...validateNumberingFormat(row), type: row.type as DocumentType, revision: row.revision }));
}
async function numberingContext(db: NumberDb, userId: string, type: DocumentType, year: number, override?: NumberingPolicy) {
  if (!isNumberingYear(year)) throw new DocumentNumberingError('Ungültiges Nummernjahr.', 400);
  const [policies, documents, counters] = await Promise.all([
    loadNumberingPolicies(db, userId),
    db.invoice.findMany({ where: { userId, invoiceNumber: { not: null } }, select: { invoiceNumber: true, type: true }, take: 10_001 }),
    db.invoiceNumberCounter.findMany({ where: { userId, type }, take: 10_001 }),
  ]);
  if (documents.length > 10_000 || counters.length > 10_000) throw new DocumentNumberingError('Nummernprüfung ist für diesen Bestand zu groß. Bitte den Support kontaktieren.', 422);
  if (counters.some(row => !Number.isInteger(row.value) || row.value < 0 || row.value > MAX_DOCUMENT_SEQUENCE)) throw new DocumentNumberingError('Ungültiger Nummernzähler. Es wurde keine Nummer vergeben.', 422, 'NUMBERING_OVERFLOW');
  const history = policies.filter(row => row.type === type);
  const policy = override ?? history.at(-1) ?? defaultNumberingPolicy(type, year);
  // Removing the year is a durable switch to a continuous sequence. Re-enabling
  // the year changes display only; it cannot safely invent a reset after restore.
  const carryAcrossYears = !policy.includeYear || history.some(row => !row.includeYear);
  let maximum = Math.max(0, ...counters.filter(row => carryAcrossYears || row.year === year).map(row => row.value));
  maximum = Math.max(maximum, ...history.filter(row => carryAcrossYears || row.effectiveYear === year).map(row => row.startSequence - 1));
  const formats = knownNumberingFormats(type, policies);
  for (const document of documents.filter(row => row.type === type && row.invoiceNumber)) {
    const matches = formats.map(format => matchDocumentNumber(document.invoiceNumber!, format)).filter(match => match !== null);
    if (override && (!matches.length || new Set(matches.map(match => match.value)).size !== 1)) throw new DocumentNumberingError('Ein historisches oder importiertes Nummernformat ist unklar. Die Umstellung wurde blockiert; bestehende Nummern bleiben unverändert.', 422, 'NUMBERING_LEGACY_REVIEW');
    for (const match of matches) if (carryAcrossYears || match.year === year || match.year === null) maximum = Math.max(maximum, match.value);
  }
  const floor = carryAcrossYears || policy.effectiveYear === year ? policy.startSequence : 1;
  const value = Math.max(maximum + 1, floor);
  const number = formatDocumentNumber(policy, year, value);
  if (documents.some(row => row.invoiceNumber === number)) throw new DocumentNumberingError('Die nächste Nummer kollidiert mit einem vorhandenen Dokument. Bitte einen höheren Startwert oder ein eindeutiges Präfix wählen.', 409, 'NUMBERING_COLLISION');
  return { policy, value, number, safeMinimum: maximum + 1 };
}
export async function previewDocumentNumber(db: NumberDb, userId: string, type: DocumentType, year = new Date().getFullYear()) {
  const next = await numberingContext(db, userId, type, year);
  return { value: next.value, number: next.number, revision: next.policy.revision, year, type };
}
/** Must run inside the transaction that creates the document. GET previews never reserve numbers. */
export async function getNextDocumentNumber(tx: Prisma.TransactionClient, userId: string, type: DocumentType, year = new Date().getFullYear(), expected?: { revision: number; number: string }): Promise<string> {
  const next = await previewDocumentNumber(tx, userId, type, year);
  if (expected && (next.revision !== expected.revision || next.number !== expected.number)) throw new DocumentNumberingError('Die Nummernvorschau ist veraltet. Bitte die Nummer im Editor ausdrücklich aktualisieren.', 409, 'NUMBERING_STALE');
  await tx.invoiceNumberCounter.upsert({ where: { userId_type_year: { userId, type, year } }, create: { userId, type, year, value: next.value }, update: { value: next.value } });
  return next.number;
}
export async function previewNumberingChange(db: NumberDb, userId: string, policy: NumberingPolicy) {
  const policies = await loadNumberingPolicies(db, userId);
  const current = policies.filter(row => row.type === policy.type).at(-1)?.revision ?? 0;
  const otherFormats = DOCUMENT_TYPES.filter(type => type !== policy.type).map(type => policies.filter(row => row.type === type).at(-1) ?? defaultNumberingPolicy(type, policy.effectiveYear));
  if (otherFormats.some(format => numberingNamespacesOverlap(policy, format))) throw new DocumentNumberingError('Das Nummernformat überschneidet sich mit einer anderen Dokumentart. Bitte ein eindeutiges Präfix wählen.', 409, 'NUMBERING_COLLISION');
  if (policy.revision !== current + 1) throw new DocumentNumberingError('Eine neuere Einstellung liegt vor. Bitte neu laden und erneut prüfen.', 409, 'NUMBERING_STALE');
  if (policy.revision > MAX_NUMBERING_REVISIONS) throw new DocumentNumberingError('Maximal 100 Nummernformat-Revisionen pro Dokumenttyp.', 422);
  const next = await numberingContext(db, userId, policy.type, policy.effectiveYear, policy);
  if (policy.startSequence < next.safeMinimum) throw new DocumentNumberingError(`Der Startwert muss mindestens ${next.safeMinimum} sein. Zähler und vorhandene Dokumente werden nicht zurückgesetzt.`, 422);
  return { nextNumber: next.number, safeMinimum: next.safeMinimum };
}
/** Manual/imported numbers stay unchanged. Generated previews reserve the exact bytes already rendered. */
export async function consumeDocumentNumberSelection(tx: Prisma.TransactionClient, userId: string, type: DocumentType, year: number, submittedNumber: string | null, input: unknown, requireSelection = false): Promise<void> {
  const policies = await loadNumberingPolicies(tx, userId);
  const revision = policies.filter(row => row.type === type).at(-1)?.revision ?? 0;
  if (input == null) {
    if (requireSelection && revision > 0) throw new DocumentNumberingError('Nummernformat geändert. Bitte die Nummer im Editor aktualisieren.', 409, 'NUMBERING_STALE');
    return;
  }
  const row = input as Partial<DocumentNumberSelection>;
  if (typeof input !== 'object' || Array.isArray(input) || row.version !== 1 || row.type !== type || !Number.isInteger(row.revision) || row.revision! < 0 || row.revision! > MAX_NUMBERING_REVISIONS || row.year !== year || typeof row.number !== 'string' || row.number.length > 64 || typeof row.automatic !== 'boolean') throw new DocumentNumberingError('Nummernvorschau passt nicht zum Dokumentjahr. Bitte aktualisieren.', 409, 'NUMBERING_STALE');
  if (row.revision !== revision) throw new DocumentNumberingError('Nummernformat geändert. Bitte die Nummer im Editor ausdrücklich aktualisieren.', 409, 'NUMBERING_STALE');
  if (row.automatic) {
    if (submittedNumber !== row.number) throw new DocumentNumberingError('Die Dokumentnummer passt nicht zur Vorschau.', 409, 'NUMBERING_STALE');
    await getNextDocumentNumber(tx, userId, type, year, { revision, number: row.number });
  }
}
