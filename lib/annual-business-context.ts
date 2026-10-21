/** Optional user declarations. Never a tax decision or a historical document source. */
export const ANNUAL_CONTEXT_VERSION = 1 as const;
export const MAX_ANNUAL_CONTEXT_REVISIONS = 1000;
export const CONTEXT_COMPLETENESS = ['UNKNOWN', 'PARTIAL', 'COMPLETE'] as const;
export type ContextCompleteness = typeof CONTEXT_COMPLETENESS[number];
export type AnnualContextInput = {
  contextYear: number;
  effectiveFrom: string;
  foundingYear: number | null;
  previousYearTurnoverCents: string | null;
  previousYearExternalTurnoverCents: string | null;
  completeness: ContextCompleteness;
  sourceNote: string;
};
export type AnnualContextRevision = AnnualContextInput & {
  version: 1;
  revision: number;
  provenance: 'USER_DECLARED';
  declaredAt: string;
};
export type AnnualContextResponse = { version: 1; revision: number; history: AnnualContextRevision[] };

export function validateAnnualContext(value: unknown): { ok: true; data: AnnualContextInput } | { ok: false; fieldErrors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, fieldErrors: { form: 'Ein Jahreskontext ist erforderlich.' } };
  const input = value as Record<string, unknown>;
  const year = input.contextYear;
  if (typeof year !== 'number' || !Number.isInteger(year) || year < 1901 || year > 9999) errors.contextYear = 'Bitte ein Jahr zwischen 1901 und 9999 angeben.';
  const effective = input.effectiveFrom;
  if (typeof effective !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(effective) || !Number.isFinite(Date.parse(`${effective}T00:00:00.000Z`)) || (typeof effective === 'string' && Number.isFinite(Date.parse(`${effective}T00:00:00.000Z`)) && new Date(`${effective}T00:00:00.000Z`).toISOString() !== `${effective}T00:00:00.000Z`) || Number(effective.slice(0, 4)) !== year) errors.effectiveFrom = 'Bitte ein gültiges Datum im Kontextjahr angeben.';
  const founding = input.foundingYear;
  if (founding !== null && (typeof founding !== 'number' || !Number.isInteger(founding) || founding < 1900 || typeof year !== 'number' || founding > year)) errors.foundingYear = 'Gründungsjahr muss bekannt und spätestens im Kontextjahr sein, oder leer bleiben.';
  for (const field of ['previousYearTurnoverCents', 'previousYearExternalTurnoverCents'] as const) {
    const cents = input[field];
    if (cents !== null && (typeof cents !== 'string' || !/^(0|[1-9]\d{0,15})$/u.test(cents) || BigInt(cents) > BigInt('9223372036854775807'))) errors[field] = 'Unbekannt (leer) oder einen nicht negativen, centgenauen EUR-Betrag angeben.';
  }
  if (!errors.previousYearTurnoverCents && !errors.previousYearExternalTurnoverCents) {
    const total = input.previousYearTurnoverCents as string | null;
    const external = input.previousYearExternalTurnoverCents as string | null;
    if (total !== null && external !== null && BigInt(external) > BigInt(total)) errors.previousYearExternalTurnoverCents = 'Der externe Anteil darf den bekannten Gesamtumsatz nicht übersteigen.';
    if (founding === year && ((total !== null && BigInt(total) > BigInt(0)) || (external !== null && BigInt(external) > BigInt(0)))) errors.foundingYear = 'Bei Gründung im Kontextjahr passt ein positiver Vorjahresumsatz nicht zu diesen Angaben.';
  }
  if (!CONTEXT_COMPLETENESS.includes(input.completeness as ContextCompleteness)) errors.completeness = 'Bitte den erklärten Datenstand auswählen.';
  if (input.completeness === 'COMPLETE' && (founding === null || input.previousYearTurnoverCents === null || input.previousYearExternalTurnoverCents === null)) errors.completeness = 'Vollständig erfordert ein bekanntes Gründungsjahr sowie Gesamtumsatz und externen Anteil (auch 0 ist möglich).';
  if (typeof input.sourceNote !== 'string' || input.sourceNote.trim().length < 1 || input.sourceNote.trim().length > 200 || /[\u0000-\u001f\u007f]/u.test(input.sourceNote)) errors.sourceNote = 'Bitte die Quelle als kurzen Text mit 1 bis 200 Zeichen angeben.';
  return Object.keys(errors).length ? { ok: false, fieldErrors: errors } : { ok: true, data: { contextYear: year as number, effectiveFrom: effective as string, foundingYear: founding as number | null, previousYearTurnoverCents: input.previousYearTurnoverCents as string | null, previousYearExternalTurnoverCents: input.previousYearExternalTurnoverCents as string | null, completeness: input.completeness as ContextCompleteness, sourceNote: (input.sourceNote as string).trim() } };
}

export function readAnnualContextRevision(row: Omit<AnnualContextInput, 'completeness'> & { completeness: string; revision: number; declaredAt: Date | string }): AnnualContextRevision {
  return { version: ANNUAL_CONTEXT_VERSION, revision: row.revision, contextYear: row.contextYear, effectiveFrom: row.effectiveFrom, foundingYear: row.foundingYear, previousYearTurnoverCents: row.previousYearTurnoverCents, previousYearExternalTurnoverCents: row.previousYearExternalTurnoverCents, completeness: row.completeness as ContextCompleteness, sourceNote: row.sourceNote, provenance: 'USER_DECLARED', declaredAt: new Date(row.declaredAt).toISOString() };
}

/** Strict backup adapter: no gaps, no inferred verification, no arbitrary fields. */
export function validateAnnualContextHistory(value: unknown): AnnualContextRevision[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ANNUAL_CONTEXT_REVISIONS) throw new Error('annualBusinessContextRevisions ist ungültig');
  return value.map((item, index) => {
    const result = validateAnnualContext(item);
    if (!result.ok || item.version !== 1 || item.revision !== index + 1 || item.provenance !== 'USER_DECLARED' || typeof item.declaredAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(item.declaredAt) || !Number.isFinite(Date.parse(item.declaredAt)) || new Date(item.declaredAt).toISOString() !== item.declaredAt || Object.keys(item).some(key => !['version', 'revision', 'provenance', 'declaredAt', 'contextYear', 'effectiveFrom', 'foundingYear', 'previousYearTurnoverCents', 'previousYearExternalTurnoverCents', 'completeness', 'sourceNote'].includes(key))) throw new Error(`annualBusinessContextRevisions[${index}] ist ungültig`);
    return { ...result.data, version: 1, revision: item.revision, provenance: 'USER_DECLARED', declaredAt: item.declaredAt };
  });
}

/** Prefix-only merge: a restore must never erase or rewrite existing declarations. */
export function annualContextAppendAfter(existing: AnnualContextRevision[], incoming: AnnualContextRevision[]): AnnualContextRevision[] {
  for (let index = 0; index < Math.min(existing.length, incoming.length); index++) {
    if (JSON.stringify(readAnnualContextRevision(existing[index])) !== JSON.stringify(readAnnualContextRevision(incoming[index]))) throw new Error('Jahreskontext-Konflikt: bestehende Änderungshistorie bleibt erhalten. Ein leeres Ziel oder eine passende Historie ist erforderlich.');
  }
  return incoming.slice(existing.length);
}
