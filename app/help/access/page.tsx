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
    <header className={styles.helpHeader}><a className={styles.textLink} href="/help#zugang">Zur Aufgabenhilfe</a><h1>Zugangshilfe</h1></header>
    <div className="mx-auto max-w-3xl pb-12">
      <section className={styles.guideSection} aria-labelledby="access-next">
        <h2 id="access-next">Zugang wiederherstellen</h2>
        <ol className={styles.instructions}><li>Anmeldedaten prüfen. Nach Fehlversuchen kurz warten.</li><li>Betreiber über einen bestätigten Kontaktweg erreichen.</li><li>Ein angemeldeter Administrator kann Ihr Passwort ändern. Es gibt keinen Resetlink per E-Mail.</li></ol>
        <SupportContact />
        <p className={styles.small}>Keine Passwörter oder Geschäftsdaten weitergeben.</p>
        <details className={styles.disclosure}><summary>Wiederherstellung und Sicherheit</summary><p>Der Betreiber muss Ihre Identität und Berechtigung unabhängig prüfen. Nach einer Passwortänderung werden bisherige Sitzungen ungültig.</p><p>Keine Sitzungscookies, API-Schlüssel, Einmalcodes oder Passwörter weitergeben. Keine unbereinigten Screenshots oder Logdateien senden.</p><p>Einziger Administrator ausgesperrt? Die Wiederherstellung muss mit dem Betreiber gesondert autorisiert werden. Eine neue Registrierung ersetzt den Zugang nicht.</p></details>
      </section>
      <section className={styles.guideSection} aria-labelledby="access-incident"><h2 id="access-incident">Betriebsstörung</h2><p>Zeitpunkt, betroffene Seite und bereinigte Fehlermeldung an den Betreiber melden.</p><details className={styles.disclosure}><summary>Vor einem erneuten Versuch</summary><p>Zeitzone angeben und personenbezogene Daten entfernen. Vor erneutem Buchen oder Bezahlen prüfen, ob der erste Versuch gespeichert wurde.</p></details></section>
      {/* A document navigation avoids Next 16 caching a previously hydrated hash
          and appending it again on the return to this help fragment. */}
      <div className={styles.actions}><Button asChild><Link href={loginHref}>Zurück zur Anmeldung</Link></Button><Button asChild variant="outline"><a href="/help#angebot">Betreiber und Angebot</a></Button></div>
    </div>
  </div>;
}
