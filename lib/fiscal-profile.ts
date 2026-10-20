/** A user declaration, not an automatic legal determination of § 19 UStG. */
export const FISCAL_TAX_REGIMES = ['UNSET', 'SMALL_BUSINESS', 'STANDARD'] as const;
export type FiscalTaxRegime = typeof FISCAL_TAX_REGIMES[number];

export interface FiscalProfile {
  fiscalTaxRegime: FiscalTaxRegime;
  fiscalEffectiveFrom: string | null;
  fiscalConfirmedAt: string | null;
}

export interface FiscalProfileSelection {
  fiscalTaxRegime: FiscalTaxRegime;
  fiscalEffectiveFrom: string | null;
}

export type FiscalProfileValidation =
  | { ok: true; selection: FiscalProfileSelection | undefined }
  | { ok: false; fieldErrors: Record<string, string> };

export const EMPTY_FISCAL_PROFILE: FiscalProfile = {
  fiscalTaxRegime: 'UNSET',
  fiscalEffectiveFrom: null,
  fiscalConfirmedAt: null,
};

/** Strict calendar dates avoid JS's silent normalization of e.g. February 30. */
export function isFiscalCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(?:19\d{2}|[2-9]\d{3})-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Omitting fiscal fields is a legacy settings update, not a reset. */
export function validateFiscalProfileInput(body: Record<string, unknown>): FiscalProfileValidation {
  const hasRegime = Object.hasOwn(body, 'fiscalTaxRegime');
  const hasDate = Object.hasOwn(body, 'fiscalEffectiveFrom');
  if (!hasRegime && !hasDate) return { ok: true, selection: undefined };

  const fieldErrors: Record<string, string> = {};
  const regime = body.fiscalTaxRegime;
  if (!hasRegime) {
    fieldErrors.fiscalTaxRegime = 'Bitte die steuerliche Einordnung ausdrücklich auswählen.';
  } else if (typeof regime !== 'string' || !FISCAL_TAX_REGIMES.includes(regime as FiscalTaxRegime)) {
    fieldErrors.fiscalTaxRegime = 'Zulässig sind UNSET, SMALL_BUSINESS oder STANDARD.';
  }

  if (!hasDate) {
    fieldErrors.fiscalEffectiveFrom = 'Bitte ein Gültigkeitsdatum angeben (bei UNSET: null).';
  } else if (regime === 'UNSET') {
    if (body.fiscalEffectiveFrom !== null) {
      fieldErrors.fiscalEffectiveFrom = 'Ohne bestätigte Einordnung muss das Gültigkeitsdatum null sein.';
    }
  } else if (!isFiscalCalendarDate(body.fiscalEffectiveFrom)) {
    fieldErrors.fiscalEffectiveFrom = 'Bitte ein gültiges Kalenderdatum im Format JJJJ-MM-TT ab 1900 angeben.';
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return {
    ok: true,
    selection: {
      fiscalTaxRegime: regime as FiscalTaxRegime,
      fiscalEffectiveFrom: body.fiscalEffectiveFrom as string | null,
    },
  };
}

/** Never turn a legacy/malformed row into a confirmed small-business profile. */
export function readFiscalProfile(settings?: {
  fiscalTaxRegime?: string | null;
  fiscalEffectiveFrom?: string | null;
  fiscalConfirmedAt?: Date | string | null;
} | null): FiscalProfile {
  if (!settings || !['SMALL_BUSINESS', 'STANDARD'].includes(settings.fiscalTaxRegime ?? '') ||
      !isFiscalCalendarDate(settings.fiscalEffectiveFrom) || !settings.fiscalConfirmedAt) {
    return { ...EMPTY_FISCAL_PROFILE };
  }
  const confirmedAt = new Date(settings.fiscalConfirmedAt);
  if (!Number.isFinite(confirmedAt.getTime())) return { ...EMPTY_FISCAL_PROFILE };
  return {
    fiscalTaxRegime: settings.fiscalTaxRegime as FiscalTaxRegime,
    fiscalEffectiveFrom: settings.fiscalEffectiveFrom,
    fiscalConfirmedAt: confirmedAt.toISOString(),
  };
}
