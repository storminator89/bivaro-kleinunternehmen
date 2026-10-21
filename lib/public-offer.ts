import 'server-only';

/** Public, owner-reviewed data only. Never pass process.env or settings records here. */
export const PUBLIC_OFFER_FIELDS = [
  'providerName', 'operatingModel', 'included', 'excluded', 'responsibilities',
  'price', 'term', 'support', 'exit', 'supportContact', 'documents', 'source',
] as const;
export type PublicOfferField = typeof PUBLIC_OFFER_FIELDS[number];
export const PUBLIC_OFFER_GATES = ['model', 'offer', 'legal', 'support', 'source'] as const;
export type PublicOfferGate = typeof PUBLIC_OFFER_GATES[number];
type Contact = { label: string; href: string };
type OfferPrice = { amountCents: number; currency: 'EUR'; interval: string; taxNote: string };
type Documents = { provider: string; privacy: string; terms: string };
type Source = { href: string; licenseHref: string; revision: string; matchesDeployment: true };
export type PublicOffer = {
  revision: string;
  status: 'concept' | 'approved';
  approvedFields: PublicOfferField[];
  gates: Record<PublicOfferGate, boolean>;
  providerName: string | null;
  operatingModel: 'self-hosted' | 'managed-instance' | 'saas' | null;
  included: string[];
  excluded: string[];
  responsibilities: string | null;
  price: OfferPrice | null;
  term: string | null;
  support: string | null;
  exit: string | null;
  supportContact: Contact | null;
  documents: Documents | null;
  source: Source | null;
  missing: string[];
  complete: boolean;
  /** This foundation does not implement a purchase, contract or pilot acceptance. */
  onlineConclusionEnabled: false;
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, max = 2000): string | null =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max
    && !/[\u0000-\u001f\u007f]/u.test(value) ? value.trim() : null;
const list = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 30) return [];
  const values = value.map(item => text(item, 500));
  return values.every((item): item is string => item !== null) ? values : [];
};

/** No executable schemes, credentials, relative redirects or mail header injection. */
export function safePublicUrl(value: unknown, contact = false): string | null {
  const candidate = text(value, 2048);
  if (!candidate || /[\s\\]/u.test(candidate) || /%0[ad]/i.test(candidate)) return null;
  if (contact && /^mailto:[A-Z0-9._+-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+$/i.test(candidate)) {
    return candidate;
  }
  if (!/^https:\/\//i.test(candidate)) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

/** Unknown keys are discarded. Values need an explicit field approval AND revision. */
export function parsePublicOffer(input: unknown): PublicOffer {
  const raw = record(input);
  const revision = text(raw.revision, 120);
  const approvedFields = revision && Array.isArray(raw.approvedFields)
    ? PUBLIC_OFFER_FIELDS.filter(field => raw.approvedFields instanceof Array && raw.approvedFields.includes(field)) : [];
  const approved = (field: PublicOfferField) => approvedFields.includes(field);
  const rawGates = record(raw.gates);
  const gates = Object.fromEntries(PUBLIC_OFFER_GATES.map(gate => [gate, !!revision && rawGates[gate] === true])) as Record<PublicOfferGate, boolean>;
  const priceInput = record(raw.price);
  const interval = text(priceInput.interval, 200);
  const taxNote = text(priceInput.taxNote, 500);
  const price: OfferPrice | null = approved('price') && Number.isSafeInteger(priceInput.amountCents)
    && (priceInput.amountCents as number) >= 0 && priceInput.currency === 'EUR' && interval && taxNote
    ? { amountCents: priceInput.amountCents as number, currency: 'EUR', interval, taxNote } : null;
  const contactInput = record(raw.supportContact);
  const contactHref = safePublicUrl(contactInput.href, true);
  const contactLabel = text(contactInput.label, 200);
  const supportContact = approved('supportContact') && gates.support && contactHref && contactLabel
    ? { label: contactLabel, href: contactHref } : null;
  const docsInput = record(raw.documents);
  const provider = safePublicUrl(docsInput.provider);
  const privacy = safePublicUrl(docsInput.privacy);
  const terms = safePublicUrl(docsInput.terms);
  const documents = approved('documents') && provider && privacy && terms ? { provider, privacy, terms } : null;
  const sourceInput = record(raw.source);
  const sourceHref = safePublicUrl(sourceInput.href);
  const licenseHref = safePublicUrl(sourceInput.licenseHref);
  const sourceRevision = text(sourceInput.revision, 120);
  const source: Source | null = approved('source') && gates.source && sourceHref && licenseHref && sourceRevision && sourceInput.matchesDeployment === true
    ? { href: sourceHref, licenseHref, revision: sourceRevision, matchesDeployment: true } : null;
  const operatingModel = approved('operatingModel') && typeof raw.operatingModel === 'string' && ['self-hosted', 'managed-instance', 'saas'].includes(raw.operatingModel)
    ? raw.operatingModel as PublicOffer['operatingModel'] : null;
  const fields = {
    providerName: approved('providerName') ? text(raw.providerName, 300) : null,
    operatingModel,
    included: approved('included') ? list(raw.included) : [],
    excluded: approved('excluded') ? list(raw.excluded) : [],
    responsibilities: approved('responsibilities') ? text(raw.responsibilities) : null,
    price,
    term: approved('term') ? text(raw.term) : null,
    support: approved('support') ? text(raw.support) : null,
    exit: approved('exit') ? text(raw.exit) : null,
    supportContact, documents, source,
  };
  const missing: string[] = PUBLIC_OFFER_FIELDS.filter(field => {
    const value = fields[field];
    return value === null || (Array.isArray(value) && value.length === 0);
  });
  if (!revision) missing.push('revision');
  for (const gate of PUBLIC_OFFER_GATES) if (!gates[gate]) missing.push(`gate:${gate}`);
  if (raw.status !== 'approved') missing.push('status:approved');
  return {
    revision: revision ?? 'unconfigured', status: raw.status === 'approved' ? 'approved' : 'concept',
    approvedFields, gates, ...fields, missing, complete: missing.length === 0, onlineConclusionEnabled: false,
  };
}

/** Reviewed source configuration; intentionally no environmental or database object spread. */
export function getPublicOffer(): PublicOffer {
  return parsePublicOffer({
    revision: 'concept-unconfigured-v1',
    status: 'concept',
    approvedFields: [],
    gates: { model: false, offer: false, legal: false, support: false, source: false },
  });
}

export function formatOfferPrice(price: OfferPrice): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: price.currency }).format(price.amountCents / 100);
}
