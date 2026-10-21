import { isFiscalCalendarDate, readFiscalProfile } from '@/lib/fiscal-profile';

export type DocumentTaxMode = 'small-business' | 'standard';
export type DocumentTaxSource = 'manual' | 'template' | 'quote';
export interface DocumentTaxSelection {
  mode: DocumentTaxMode | '';
  source: DocumentTaxSource;
}
export interface DocumentFiscalSettings {
  fiscalTaxRegime?: string | null;
  fiscalEffectiveFrom?: string | null;
  fiscalConfirmedAt?: string | Date | null;
}
export type DocumentTaxCase = 'domestic' | 'cross-border' | 'reverse-charge';

/** The current declaration is not a fiscal history or an eligibility calculation. */
export function applicableDocumentTaxMode(settings: DocumentFiscalSettings | null, issueDate: string): DocumentTaxMode | '' {
  const profile = readFiscalProfile(settings);
  if (!isFiscalCalendarDate(issueDate) || !profile.fiscalEffectiveFrom || issueDate < profile.fiscalEffectiveFrom) return '';
  if (profile.fiscalTaxRegime === 'SMALL_BUSINESS') return 'small-business';
  if (profile.fiscalTaxRegime === 'STANDARD') return 'standard';
  return '';
}

/** Zero alone never establishes §19. Preserve explicit modes and existing E/Z lines. */
export function preservedDocumentTaxMode(data: {
  taxMode?: unknown;
  items?: readonly { taxRate?: number; taxCategory?: string; exemptionReason?: string }[];
}): DocumentTaxMode | '' {
  if (data.taxMode === 'small-business' || data.taxMode === 'standard') return data.taxMode;
  if (data.items?.some(item => (item.taxRate ?? 0) > 0 || item.taxCategory === 'E' || item.taxCategory === 'Z')) return 'standard';
  return '';
}

/** Document/template decisions take precedence, even when a later company profile changes. */
export function resolveDocumentTaxState(
  settings: DocumentFiscalSettings | null,
  issueDate: string,
  selection: DocumentTaxSelection | null,
  acknowledged: boolean,
) {
  const profileMode = applicableDocumentTaxMode(settings, issueDate);
  const mode = selection ? selection.mode : profileMode;
  const needsAcknowledgement = selection?.source === 'manual' && (!profileMode || mode !== profileMode);
  return {
    mode,
    profileMode,
    source: selection?.source ?? (profileMode ? 'profile' : 'unresolved'),
    needsAcknowledgement,
    ready: Boolean(mode) && (!needsAcknowledgement || acknowledged),
  };
}

export function isSupportedDocumentTaxCase(taxCase: DocumentTaxCase, foreignAddress: boolean, domesticConfirmed: boolean): boolean {
  return taxCase === 'domestic' && (!foreignAddress || domesticConfirmed);
}

/** Never reinterpret an imported/template reverse-charge category as domestic. */
export function hasUnsupportedDocumentTaxCategory(items: readonly { taxCategory?: string }[]): boolean {
  return items.some(item => item.taxCategory !== undefined && !['S', 'E', 'Z'].includes(item.taxCategory));
}
