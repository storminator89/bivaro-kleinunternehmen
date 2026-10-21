import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ArrowUpRight } from 'lucide-react';
import { formatDeclaredTurnover, type RevenueIndicatorBasis } from '@/lib/revenue-indicators';

const completeness = { UNKNOWN: 'Datenstand noch offen', PARTIAL: 'Teilweise selbst erklärt', COMPLETE: 'Als vollständig selbst erklärt' };
const currency = (value: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);

export function RevenueIndicators({ basis }: { basis: RevenueIndicatorBasis }) {
  const context = basis.context;
  const prior = context?.previousYearTurnoverCents;
  const priorOver = prior != null && basis.reference != null && BigInt(prior) > BigInt(basis.reference.previousYear * 100);
  const currentOver = basis.reference?.currentYear != null && basis.inAppRevenue > basis.reference.currentYear;
  return <details className="limit-disclosure min-w-0 rounded-xl border bg-card">
    <summary className="flex min-h-16 cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
      <span className="text-sm font-semibold">Umsatzindikatoren · {basis.year}</span>
      <span className="flex items-center gap-2 text-xs text-muted-foreground">Kein Steuerstatus<ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" /></span>
    </summary>
    <section aria-label={`Umsatzdatenbasis ${basis.year}`} className="min-w-0 space-y-4 border-t p-4 text-sm sm:p-5">
      <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">Kein Steuerstatus</Badge><Badge variant="secondary">{context ? completeness[context.completeness] : 'Jahreskontext fehlt'}</Badge></div>
      <p className="text-xs text-muted-foreground">{basis.period === 'TO_DATE' ? `${basis.year} bis Datenstand` : `Kalenderjahr ${basis.year}`} · Datenstand {new Date(basis.asOf).toLocaleString('de-DE')} · Zahlungsjahr wie in der Finanzübersicht.</p>
      <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="min-w-0 rounded-lg bg-muted/40 p-3"><dt className="text-xs text-muted-foreground">Operativer Zahlungssaldo in Bivaro · {basis.year}</dt><dd className="mt-1 break-words text-xl font-semibold tabular-nums">{currency(basis.inAppRevenue)}</dd><dd className="mt-1 text-xs text-muted-foreground">Eingänge abzüglich Fehlerkorrekturen und Erstattungen. Steuerlich ungeprüft; kein Gesamtumsatz nach § 19 UStG.</dd></div>
        <div className="min-w-0 rounded-lg bg-muted/40 p-3"><dt className="text-xs text-muted-foreground">Gesamtumsatz des Unternehmens · {basis.year}</dt><dd className="mt-1 text-xl font-semibold">Unbekannt</dd><dd className="mt-1 text-xs text-muted-foreground">Außerhalb Bivaro erfasste Umsätze {basis.year}: unbekannt und nicht enthalten. Vorjahresangaben schließen diese Lücke nicht.</dd></div>
        <div className="min-w-0 rounded-lg border p-3"><dt className="text-xs text-muted-foreground">Selbst erklärter Gesamtumsatz · Vorjahr {basis.previousYear}</dt><dd className="mt-1 break-words font-semibold tabular-nums">{formatDeclaredTurnover(prior)}</dd><dd className="mt-1 text-xs text-muted-foreground">Davon außerhalb Bivaro: {formatDeclaredTurnover(context?.previousYearExternalTurnoverCents)}. Bereits im erklärten Gesamtumsatz enthalten, wird nicht addiert.</dd></div>
        <div className="min-w-0 rounded-lg border p-3"><dt className="text-xs text-muted-foreground">Operativer Zahlungssaldo in Bivaro · Vorjahr {basis.previousYear}</dt><dd className="mt-1 break-words font-semibold tabular-nums">{currency(basis.previousYearInAppRevenue)}</dd><dd className="mt-1 text-xs text-muted-foreground">Steuerlich ungeprüfter Zahlungssaldo; nicht zur Vorjahreserklärung addieren.</dd></div>
      </dl>
      <div className="space-y-1 break-words rounded-lg border p-3 text-xs text-muted-foreground">
        {context ? <><p className="font-medium text-foreground">Eigene Erklärung · Revision {context.revision} · Kontext gültig ab {context.effectiveFrom}</p><p>Gründungsjahr: {context.foundingYear ?? 'unbekannt'} · Quelle: {context.sourceNote}</p><p>Erklärt am {new Date(context.declaredAt).toLocaleString('de-DE')} · nicht unabhängig geprüft.</p></> : <p>Keine zum angezeigten Zeitraum gültige eigene Erklärung vorhanden. Unbekannte Beträge werden nicht als 0 € behandelt.</p>}
        {basis.pendingRevision !== null && <p>Revision {basis.pendingRevision} liegt mit einem späteren Gültigkeitsdatum vor und wird hier noch nicht verwendet.</p>}
      </div>
      <div className="space-y-2 border-t pt-4 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Umsatzgrenzen · nur Orientierung, keine Einstufung</p>
        {basis.reference ? <><p>Referenz für das Vorjahr {basis.previousYear}: {currency(basis.reference.previousYear)}. {prior == null ? 'Ein eigener Gesamtbetrag ist noch unbekannt.' : priorOver ? 'Der selbst erklärte Vorjahresbetrag liegt darüber; fachlich prüfen lassen.' : 'Der selbst erklärte Vorjahresbetrag liegt nicht darüber; dies bestätigt keine Steuerbefreiung.'}</p>
          <p>{basis.reference.currentYear === null ? 'Referenz für das betrachtete Jahr nicht zugeordnet: Gründungsjahr unbekannt.' : <>Referenz {basis.year}: {currency(basis.reference.currentYear)} · {basis.reference.foundingYear ? 'Gründungsjahr laut eigener Erklärung' : 'kein Gründungsjahr laut eigener Erklärung'}. {currentOver ? 'Der operative Zahlungssaldo liegt oberhalb der Referenz; daraus folgt weder ein geprüfter Gesamtumsatz noch ein Steuerstatus. Daten fachlich prüfen lassen.' : 'Ein verbleibender Freibetrag wird aus der unvollständigen Datenbasis nicht berechnet.'}</>}</p></> : <p>Für {basis.year} ist hier keine geprüfte Grenzreferenz hinterlegt. Es werden keine aktuellen Grenzen auf andere Jahre übertragen.</p>}
        <p>Gesetzlichen Gesamtumsatz, weitere Tätigkeiten und möglichen Verzicht auf § 19 gesondert prüfen. Keine automatische Steuer-Einstufung.</p>
        <p>Quellen: <a className="underline underline-offset-4" href="https://www.gesetze-im-internet.de/ustg_1980/__19.html" target="_blank" rel="noreferrer">§ 19 UStG</a> · <a className="underline underline-offset-4" href="https://finanzamt.hessen.de/steuern/umsatzsteuer-kleinunternehmer" target="_blank" rel="noreferrer">Finanzverwaltung Hessen</a> · geprüft am 21.10.2026.</p>
      </div>
      <Link href="/settings#annual-context" className="inline-flex min-h-11 items-center gap-2 font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">Jahreskontext prüfen<ArrowUpRight className="h-4 w-4" aria-hidden="true" /></Link>
    </section>
  </details>;
}
