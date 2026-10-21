/** Exact catalog prices remain strings until explicitly copied into an editor. */
export const serviceArticleNameKey = (name: string) => name.normalize('NFKC').trim().toLocaleLowerCase('de-DE').replace(/\s+/g, ' ');
export type ServiceArticle = {
  id: number;
  name: string;
  description: string;
  unit: string;
  unitPriceCents: string;
  sourcePriceCents: string;
  sourcePriceBasis: 'NET' | 'GROSS';
  taxRate: string;
};
/** Validate on reads too: restored/legacy JSON is not trusted catalog input. */
export function readServiceArticle(row: unknown): ServiceArticle | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const data = row as Record<string, string>;
  if (!Number.isSafeInteger(data.id)) return null;
  if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 200
    || typeof data.description !== 'string' || data.description.length > 2000
    || typeof data.unit !== 'string' || !data.unit.trim() || data.unit.length > 100
    || typeof data.unitPriceCents !== 'string' || !/^(0|[1-9]\d{0,8})$/.test(data.unitPriceCents)
    || typeof data.sourcePriceCents !== 'string' || !/^(0|[1-9]\d{0,8})$/.test(data.sourcePriceCents)
    || !['NET', 'GROSS'].includes(data.sourcePriceBasis)
    || !['0', '7', '19'].includes(data.taxRate)) return null;
  const source = BigInt(data.sourcePriceCents);
  const expectedNet = data.sourcePriceBasis === 'NET' ? source : (source * BigInt(100) + BigInt(100 + Number(data.taxRate)) / BigInt(2)) / BigInt(100 + Number(data.taxRate));
  if (String(expectedNet) !== data.unitPriceCents) return null;
  return { id: Number(data.id), name: data.name, description: data.description, unit: data.unit,
    unitPriceCents: data.unitPriceCents, sourcePriceCents: data.sourcePriceCents,
    sourcePriceBasis: data.sourcePriceBasis as 'NET' | 'GROSS', taxRate: data.taxRate };
}
export function formatArticlePrice(cents: string): string {
  const whole = cents.slice(0, -2) || '0';
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${cents.padStart(2, '0').slice(-2)} €`;
}
