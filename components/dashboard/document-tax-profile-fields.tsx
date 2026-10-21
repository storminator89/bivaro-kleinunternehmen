"use client";

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
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
    <section className={styles.section} aria-labelledby={`${id}-tax-heading`}>
      <div className={styles.sectionHeading}>
        <div><h2 id={`${id}-tax-heading`}>Steuerbehandlung bewusst festlegen</h2><p>Die Einordnung Ihres Unternehmens ist keine automatische Prüfung Ihrer steuerlichen Berechtigung.</p></div>
      </div>
      <div className="space-y-4 text-sm">
        <p role="status" className="text-muted-foreground">
          {state.source === 'template' || state.source === 'quote'
            ? `Steuerangaben aus ${state.source === 'template' ? 'der Vorlage' : 'dem Angebot'} bleiben erhalten. Das Firmenprofil überschreibt sie nicht.${!state.mode ? ' Ohne eindeutigen Steuermodus bitte unten ausdrücklich wählen; 0 % bedeutet nicht automatisch § 19.' : ''}`
            : state.source === 'manual'
              ? 'Diese Auswahl gilt nur für dieses Dokument. Das Firmenprofil wird nicht geändert.'
              : state.profileMode
                ? `Aus dem bestätigten Firmenprofil übernommen, gültig ab ${profile.fiscalEffectiveFrom}. Die einzelnen Positionen bleiben prüfbar.`
                : futureProfile
                  ? `Das Firmenprofil gilt erst ab ${profile.fiscalEffectiveFrom}, nicht für dieses Dokumentdatum. Bitte die Behandlung für dieses Dokument ausdrücklich wählen.`
                  : 'Für dieses Dokumentdatum liegt kein bestätigtes Firmen-Steuerprofil vor. Bivaro nimmt § 19 nicht automatisch an.'}
        </p>
        <a href="/settings#fiscal-profile" target="_blank" rel="noopener noreferrer" className="inline-block rounded-sm font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">Firmen-Steuerprofil einrichten oder prüfen (neuer Tab)</a>
        <p className="text-xs text-muted-foreground">Ihre Eingaben bleiben in diesem Tab erhalten. Nach dem Speichern des Profils dieses Dokument bewusst fertigstellen; neue Dokumente übernehmen das Profil beim Öffnen.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${id}-tax-mode`}>Umsatzsteuerbehandlung dieses Dokuments</Label>
            <select id={`${id}-tax-mode`} className={styles.select} value={state.mode} onChange={event => onModeChange(event.target.value as DocumentTaxMode | '')}>
              <option value="" disabled>Bitte ausdrücklich auswählen</option>
              <option value="small-business">Kleinunternehmer (§ 19 UStG), keine Umsatzsteuer</option>
              <option value="standard">Regelbesteuerung / Steuer je Position</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-tax-case`}>Steuerfall</Label>
            <select id={`${id}-tax-case`} className={styles.select} value={taxCase} onChange={event => onTaxCaseChange(event.target.value as DocumentTaxCase)}>
              <option value="domestic">Einfacher Inlandsfall in EUR</option>
              <option value="cross-border">Grenzüberschreitender Steuer-Sonderfall</option>
              <option value="reverse-charge">Reverse Charge</option>
            </select>
          </div>
        </div>
        {state.needsAcknowledgement && (
          <Label htmlFor={`${id}-tax-acknowledged`} className="flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-6">
            <Input id={`${id}-tax-acknowledged`} type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={acknowledged} onChange={event => onAcknowledged(event.target.checked)} />
            <span>Ich habe diese Steuerbehandlung für dieses Dokument geprüft und wähle sie ausdrücklich, ohne ein passendes bestätigtes Firmenprofil zu übernehmen.</span>
          </Label>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">Unterstützt sind einfache Inlandsfälle in EUR mit § 19 oder Steuer je Position. Keine automatische Prüfung von §-19-Berechtigung, Leistungsort oder Auslandsregeln; keine vollständige Umsatzsteuerbuchhaltung. Reverse Charge und grenzüberschreitende Steuer-Sonderfälle werden hier nicht erstellt.</p>
        {taxCase !== 'domestic' && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">Dieser Steuerfall wird nicht unterstützt. Vorschau und Erstellung sind gesperrt; Ihre Eingaben bleiben erhalten. Bitte den Fall fachlich klären und in einer dafür geeigneten Lösung bearbeiten.</p>}
        {foreignAddress && taxCase === 'domestic' && (
          <div className="space-y-2 rounded-md border border-border p-3">
            <p>Eine ausländische Anschrift bestimmt den Steuerfall nicht allein. Bitte prüfen Sie, ob tatsächlich ein unterstützter Inlandsfall vorliegt.</p>
            <Label htmlFor={`${id}-domestic-confirmed`} className="flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-6">
              <Input id={`${id}-domestic-confirmed`} type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={domesticConfirmed} onChange={event => onDomesticConfirmed?.(event.target.checked)} />
              <span>Die ausländische Anschrift ist geprüft; dieses Dokument betrifft einen einfachen Inlandsfall, keinen grenzüberschreitenden Steuer-Sonderfall und kein Reverse Charge.</span>
            </Label>
          </div>
        )}
        {(!state.ready || taxCase !== 'domestic' || (foreignAddress && !domesticConfirmed)) && <p className="text-xs font-medium" role="status">Vor Vorschau und Erstellung bitte Steuerbehandlung und Steuerfall klären.</p>}
      </div>
    </section>
  );
}
