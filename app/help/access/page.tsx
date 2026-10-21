import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { SupportContact } from '@/components/public/offer-summary';
import { getAccessLoginHref } from '@/lib/access-help';
import styles from '@/components/public-accounting/pilot-public.module.css';

export const metadata: Metadata = { title: 'Bivaro – Zugang verloren oder Betriebsstörung', description: 'Sichere Hilfe ohne Kontoabfrage: vorhandener Betreiberprozess, Grenzen und Rückweg zur Anmeldung.' };

export default async function AccessHelpPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string | string[] }> }) {
  const params = await searchParams;
  const loginHref = getAccessLoginHref(typeof params.callbackUrl === 'string' ? params.callbackUrl : null);
  return <div className={styles.page}>
    <header className={styles.helpHeader}><a className={styles.textLink} href="/help#zugang">Zur Aufgabenhilfe</a><h1>Zugang verloren oder Bivaro nicht erreichbar?</h1><p>Diese Hilfe ist ohne Anmeldung lesbar. Sie prüft nicht, ob ein Konto existiert, und löst keine Passwortänderung aus.</p></header>
    <div className="mx-auto max-w-3xl pb-12">
      <section className={styles.guideSection} aria-labelledby="access-next"><h2 id="access-next">Der sichere nächste Schritt</h2><SupportContact /><ol className={styles.instructions}><li>Prüfen Sie die Adresse dieser Installation und Ihre eigenen Anmeldedaten. Wiederholen Sie fehlgeschlagene Anmeldungen nicht fortlaufend; der bestehende Anmeldeschutz kann weitere Versuche vorübergehend begrenzen.</li><li>Wenn Sie Ihren Zugang nicht wiederfinden, wenden Sie sich nur über den bestätigten Kontaktweg an den zuständigen Betreiber. Eine unabhängige Identitäts- und Berechtigungsprüfung ist notwendig. Diese öffentliche Seite kann Ihre Identität nicht prüfen.</li><li>Ein bereits berechtigter, angemeldeter Administrator kann das Passwort über die vorhandene Benutzerverwaltung ändern. Dabei werden bisherige Sitzungen beim nächsten geprüften Zugriff ungültig. Ein E-Mail-Self-Service, Resetlink oder garantierter Wiederherstellungsdienst existiert hier nicht.</li></ol><aside className={styles.caution}><p>Geben Sie niemals Ihr bisheriges Passwort, Sitzungscookies, API-Schlüssel, Einmalcodes, Rechnungen oder vollständige Backups an eine vermeintliche Hilfestelle weiter. Diese Seite fordert nichts davon an und bietet keinen Upload.</p></aside></section>
      <section className={styles.guideSection} aria-labelledby="access-incident"><h2 id="access-incident">Bei einer Betriebsstörung</h2><p>Notieren Sie Zeitpunkt mit Zeitzone, betroffene Seite und die sichtbare Fehlermeldung oder Fehlerreferenz ohne personenbezogene Daten. Eine App-/Releaseversion nur angeben, wenn sie Ihnen tatsächlich angezeigt oder vom Betreiber bestätigt wurde; Konfigurationsrevision und Paketversion beweisen keinen Auslieferungsstand.</p><p>Senden Sie keine unbereinigten Screenshots, Logdateien oder Geschäftsdaten. Der Betreiber muss zuerst Dienstzustand und Zuständigkeit prüfen. Ein erneuter Versuch darf keine Buchung oder Zahlung doppelt erfassen.</p><p>Ist der einzige Administrator ausgesperrt, gibt es hier keinen öffentlichen Wiederherstellungsweg und keine Umgehung der Anmeldung. Das muss mit dem verantwortlichen Betreiber über ein gesondert autorisiertes Verfahren geklärt werden. Eine Registrierung ersetzt diesen Zugang nicht.</p></section>
      {/* A document navigation avoids Next 16 caching a previously hydrated hash
          and appending it again on the return to this help fragment. */}
      <div className={styles.actions}><Button asChild><Link href={loginHref}>Zurück zur Anmeldung</Link></Button><Button asChild variant="outline"><a href="/help#angebot">Angebot und Zuständigkeit prüfen</a></Button></div>
    </div>
  </div>;
}
