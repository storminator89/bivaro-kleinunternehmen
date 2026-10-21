import { readFiscalProfile } from '@/lib/fiscal-profile';
import type { FiscalProfile, FiscalProfileSelection } from '@/lib/fiscal-profile';

export type SetupSettings = Partial<FiscalProfile> & {
  companyName?: string | null;
  companyAddress?: string | null;
  taxNumber?: string | null;
};

export function getSetupProgress(settings: SetupSettings, invoiceCount: number) {
  const companyComplete = [settings.companyName, settings.companyAddress, settings.taxNumber]
    .every(value => typeof value === 'string' && value.trim().length > 0);
  const fiscalComplete = readFiscalProfile(settings).fiscalTaxRegime !== 'UNSET';
  const invoiceComplete = Number.isFinite(invoiceCount) && invoiceCount > 0;
  const completed = [companyComplete, fiscalComplete, invoiceComplete].filter(Boolean).length;
  return { companyComplete, fiscalComplete, invoiceComplete, completed,
    nextStep: !companyComplete ? 'company' : !fiscalComplete ? 'fiscal' : !invoiceComplete ? 'invoice' : 'export' };
}

export function isFiscalSelectionChanged(saved: FiscalProfile, selection: FiscalProfileSelection) {
  return saved.fiscalTaxRegime !== selection.fiscalTaxRegime || saved.fiscalEffectiveFrom !== selection.fiscalEffectiveFrom;
}

/** Only the two declared fields travel to the server. Confirmation is server-owned. */
export function fiscalSelectionPayload(selection: FiscalProfileSelection): FiscalProfileSelection {
  return { fiscalTaxRegime: selection.fiscalTaxRegime,
    fiscalEffectiveFrom: selection.fiscalTaxRegime === 'UNSET' ? null : selection.fiscalEffectiveFrom };
}
