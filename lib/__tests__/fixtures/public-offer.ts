import { PUBLIC_OFFER_FIELDS, PUBLIC_OFFER_GATES } from '@/lib/public-offer';

/** TEST ONLY. Unmistakably fictional; never import into a route or live config. */
export function fictionalCompleteOffer() {
  return {
    revision: 'FICTIONAL-TEST-ONLY-NOT-A-LIVE-OFFER-v1',
    status: 'approved',
    approvedFields: [...PUBLIC_OFFER_FIELDS],
    gates: Object.fromEntries(PUBLIC_OFFER_GATES.map(gate => [gate, true])),
    providerName: 'FIKTIVE TESTFIRMA – KEIN ECHTES ANGEBOT',
    operatingModel: 'managed-instance',
    included: ['FIKTIVER TEST: ein begrenzter Demoumfang'],
    excluded: ['FIKTIVER TEST: kein echter Betrieb'],
    responsibilities: 'FIKTIVER TEST: Zuständigkeiten nur für Schemaprüfung.',
    price: { amountCents: 1234, currency: 'EUR', interval: 'FIKTIVER TEST: pro Demomonat', taxNote: 'FIKTIVER TEST: reine Test-Steuerdarstellung' },
    term: 'FIKTIVER TEST: keine echte Laufzeit oder Kündigung.',
    support: 'FIKTIVER TEST: keine erreichbare Hilfestelle.',
    exit: 'FIKTIVER TEST: keine echten Daten oder Fristen.',
    supportContact: { label: 'FIKTIVER TESTKONTAKT – NICHT VERWENDEN', href: 'mailto:fictional-test-only@example.invalid' },
    documents: { provider: 'https://fictional-test-only.example.invalid/provider', privacy: 'https://fictional-test-only.example.invalid/privacy', terms: 'https://fictional-test-only.example.invalid/terms' },
    source: { href: 'https://fictional-test-only.example.invalid/source/test-only', licenseHref: 'https://fictional-test-only.example.invalid/license', revision: 'FICTIONAL-SOURCE-NOT-DEPLOYED', matchesDeployment: true },
  };
}
