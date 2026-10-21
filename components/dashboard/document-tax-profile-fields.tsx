"use client";

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Settings2 } from 'lucide-react';
import { readFiscalProfile } from '@/lib/fiscal-profile';
import { type DocumentFiscalSettings, type DocumentTaxCase, type DocumentTaxMode, type DocumentTaxSelection, resolveDocumentTaxState } from '@/lib/document-tax-profile';
import styles from '@/components/dashboard/sales-workspace.module.css';

interface DocumentTaxProfileFieldsProps {
  id: string;
  settings: DocumentFiscalSettings | null;
  issueDate: string;
  selection: DocumentTaxSelection | null;
  acknowledged: boolean;
  onAcknowledged: (value: boolean) => void;
  onModeChange: (mode: DocumentTaxMode | '') => void;
  taxCase: DocumentTaxCase;
  onTaxCaseChange: (value: DocumentTaxCase) => void;
  foreignAddress?: boolean;
  domesticConfirmed?: boolean;
  onDomesticConfirmed?: (value: boolean) => void;
}

export function DocumentTaxProfileFields({ id, settings, issueDate, selection, acknowledged, onAcknowledged, onModeChange, taxCase, onTaxCaseChange, foreignAddress = false, domesticConfirmed = false, onDomesticConfirmed }: DocumentTaxProfileFieldsProps) {
  const state = resolveDocumentTaxState(settings, issueDate, selection, acknowledged);
  const profile = readFiscalProfile(settings);
  const futureProfile = profile.fiscalEffectiveFrom && issueDate < profile.fiscalEffectiveFrom;
  return (
    <section className={`${styles.section} ${styles.taxSection}`} aria-labelledby={`${id}-tax-heading`}>
      <div className={styles.sectionHeading}>
        <h2 id={`${id}-tax-heading`}>Steuerbehandlung</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground" role="status">{state.source === 'template' ? 'Vorlage' : state.source === 'quote' ? 'Angebot' : state.source === 'manual' ? 'Dieses Dokument' : state.profileMode ? 'Firmenprofil' : 'Profil fehlt'}</span>
          <a href="/settings#fiscal-profile" target="_blank" rel="noopener noreferrer" aria-label="Steuerprofil öffnen (neuer Tab)" title="Steuerprofil" className="inline-flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><Settings2 className="size-4" aria-hidden="true" /></a>
        </div>
      </div>
      <div className="space-y-3 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${id}-tax-mode`}>Umsatzsteuer</Label>
            <select id={`${id}-tax-mode`} className={styles.select} value={state.mode} onChange={event => onModeChange(event.target.value as DocumentTaxMode | '')}>
              <option value="" disabled>Bitte wählen</option>
              <option value="small-business">Kleinunternehmer (§ 19)</option>
              <option value="standard">Regelbesteuerung</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-tax-case`}>Steuerfall</Label>
            <select id={`${id}-tax-case`} className={styles.select} value={taxCase} onChange={event => onTaxCaseChange(event.target.value as DocumentTaxCase)}>
              <option value="domestic">Inland · EUR</option>
              <option value="cross-border">Grenzüberschreitend</option>
              <option value="reverse-charge">Reverse Charge</option>
            </select>
          </div>
        </div>
        {state.needsAcknowledgement && (
          <Label htmlFor={`${id}-tax-acknowledged`} className="flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-6">
            <Input id={`${id}-tax-acknowledged`} type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={acknowledged} onChange={event => onAcknowledged(event.target.checked)} />
            <span>Steuerbehandlung für dieses Dokument bestätigen.</span>
          </Label>
        )}
        {taxCase !== 'domestic' && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">Nicht unterstützt. Vorschau und Erstellung sind gesperrt.</p>}
        {foreignAddress && taxCase === 'domestic' && (
          <Label htmlFor={`${id}-domestic-confirmed`} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-border p-3 text-sm leading-6">
            <Input id={`${id}-domestic-confirmed`} type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={domesticConfirmed} onChange={event => onDomesticConfirmed?.(event.target.checked)} />
            <span>Ausländische Anschrift geprüft: einfacher Inlandsfall, kein Reverse Charge.</span>
          </Label>
        )}
        <details className="text-xs text-muted-foreground">
          <summary className="w-fit cursor-pointer py-2">Hinweise</summary>
          <div className="space-y-2 pt-1 leading-relaxed">
        <p>
          {state.source === 'template' || state.source === 'quote'
            ? `Steuerangaben aus ${state.source === 'template' ? 'der Vorlage' : 'dem Angebot'} bleiben erhalten. Das Firmenprofil überschreibt sie nicht.${!state.mode ? ' Ohne eindeutigen Steuermodus bitte unten ausdrücklich wählen; 0 % bedeutet nicht automatisch § 19.' : ''}`
            : state.source === 'manual'
              ? 'Auswahl nur für dieses Dokument.'
              : state.profileMode
                ? `Aus dem bestätigten Firmenprofil übernommen, gültig ab ${profile.fiscalEffectiveFrom}. Die einzelnen Positionen bleiben prüfbar.`
                : futureProfile
                  ? `Das Firmenprofil gilt erst ab ${profile.fiscalEffectiveFrom}, nicht für dieses Dokumentdatum. Bitte die Behandlung für dieses Dokument ausdrücklich wählen.`
                  : 'Kein gültiges Steuerprofil für dieses Datum. Steuerbehandlung auswählen.'}
        </p>
        <p className="text-xs text-muted-foreground">Profiländerungen werden erst beim Öffnen eines neuen Dokuments übernommen.</p>
        <p className="text-xs leading-relaxed text-muted-foreground">Nur einfache Inlandsfälle in EUR; kein Reverse Charge oder grenzüberschreitender Sonderfall. Berechtigung und Leistungsort selbst prüfen; keine vollständige Umsatzsteuerbuchhaltung.</p>
        {foreignAddress && <p>Eine ausländische Anschrift bestimmt den Steuerfall nicht allein. Berechtigung und Leistungsort gesondert prüfen.</p>}
          </div>
        </details>
      </div>
    </section>
  );
}
