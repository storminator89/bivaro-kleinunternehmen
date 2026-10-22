import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { formatOfferPrice, getPublicOffer, parsePublicOffer, PUBLIC_OFFER_FIELDS, PUBLIC_OFFER_GATES, safePublicUrl } from '@/lib/public-offer';
import { fictionalCompleteOffer } from './fixtures/public-offer';

vi.mock('next/link', () => ({ default: ({ children, ...props }: Record<string, unknown>) => createElement('a', props, children as string) }));
import { OfferSummary, SupportContact } from '@/components/public/offer-summary';

const html = (offer = getPublicOffer()) => renderToStaticMarkup(createElement(OfferSummary, { offer }));

describe('owner-reviewed public offer schema', () => {
  it('publishes an honest concept without contacts, prices, model preference or checkout', () => {
    const offer = getPublicOffer();
    expect(offer.status).toBe('concept');
    expect(offer.complete).toBe(false);
    expect(offer.approvedFields).toEqual([]);
    expect(offer.onlineConclusionEnabled).toBe(false);
    for (const field of ['providerName', 'operatingModel', 'price', 'supportContact', 'documents', 'source'] as const) expect(offer[field]).toBeNull();
    const output = html();
    expect(output).toContain('Konzept – kein verbindliches Angebot');
    expect(output).toContain('Preis und Steuerdarstellung noch offen');
    expect(output).toContain('keine Laufzeitzuordnung');
    expect(output).toContain('Apache-2.0');
    expect(output).toContain('Drittkomponenten behalten ihre eigenen Lizenzen.');
    expect(output).not.toContain('AGPL-3.0-only');
    expect(output).toContain('Kein Supportkontakt hinterlegt');
    expect(output).not.toMatch(/mailto:|tel:|<form|<button|checkout\/|FICTIONAL|FIKTIV/);
  });

  it('accepts a clearly fictional complete fixture, never enabling a transaction', () => {
    const fixture = fictionalCompleteOffer();
    const offer = parsePublicOffer(fixture);
    expect(offer.complete).toBe(true);
    expect(offer.missing).toEqual([]);
    expect(offer.onlineConclusionEnabled).toBe(false);
    expect(formatOfferPrice(offer.price!)).toBe('12,34\u00a0€');
    expect(html(offer)).toContain('FIKTIVE TESTFIRMA');
    expect(html(offer)).toContain('FICTIONAL-SOURCE-NOT-DEPLOYED');
    expect(html(offer)).toContain('Kein Onlineabschluss');
    expect(html(offer)).not.toMatch(/<form|<button/);
  });

  it('fails closed for every missing field, every missing gate and unapproved revision/status', () => {
    for (const field of PUBLIC_OFFER_FIELDS) {
      const fixture: Record<string, unknown> = fictionalCompleteOffer();
      delete fixture[field];
      expect(parsePublicOffer(fixture).complete, field).toBe(false);
      expect(parsePublicOffer(fixture).missing).toContain(field);
      expect(parsePublicOffer({ ...fictionalCompleteOffer(), approvedFields: PUBLIC_OFFER_FIELDS.filter(key => key !== field) }).complete, `unapproved:${field}`).toBe(false);
    }
    for (const gate of PUBLIC_OFFER_GATES) {
      const fixture = fictionalCompleteOffer();
      fixture.gates[gate] = false;
      expect(parsePublicOffer(fixture).complete, gate).toBe(false);
      expect(parsePublicOffer(fixture).missing).toContain(`gate:${gate}`);
    }
    expect(parsePublicOffer({ ...fictionalCompleteOffer(), revision: '' }).approvedFields).toEqual([]);
    expect(parsePublicOffer({ ...fictionalCompleteOffer(), status: 'concept' }).complete).toBe(false);
  });

  it('drops unknown/secret settings and requires an independently approved support contact', () => {
    const parsed = parsePublicOffer({ ...fictionalCompleteOffer(), smtpPassword: 'SECRET-TEST-SENTINEL', env: { DATABASE_URL: 'SECRET-TEST-SENTINEL' } });
    expect(JSON.stringify(parsed)).not.toContain('SECRET-TEST-SENTINEL');
    const partial = parsePublicOffer({ revision: 'contact-only-test', approvedFields: ['supportContact'], supportContact: fictionalCompleteOffer().supportContact, gates: { support: true } });
    expect(partial.complete).toBe(false);
    expect(partial.supportContact?.href).toContain('example.invalid');
    expect(parsePublicOffer({ ...fictionalCompleteOffer(), gates: {} }).supportContact).toBeNull();
    expect(parsePublicOffer({ ...fictionalCompleteOffer(), gates: {} }).source).toBeNull();
    const source = readFileSync(new URL('../public-offer.ts', import.meta.url), 'utf8');
    expect(source).toContain("import 'server-only'");
    expect(source).not.toMatch(/process\.env\[|\.\.\.process\.env|process\.env\./);
  });

  it('does not treat missing price as zero, rejects malformed/unsafe prices and formats actual zero explicitly', () => {
    const fixture = fictionalCompleteOffer();
    for (const amountCents of [-1, 1.2, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '1234']) {
      expect(parsePublicOffer({ ...fixture, price: { ...fixture.price, amountCents } }).price).toBeNull();
    }
    for (const price of [null, {}, { ...fixture.price, currency: 'USD' }, { ...fixture.price, taxNote: '' }, { ...fixture.price, interval: '' }]) {
      expect(parsePublicOffer({ ...fixture, price }).complete).toBe(false);
    }
    const free = parsePublicOffer({ ...fixture, price: { ...fixture.price, amountCents: 0 } });
    expect(formatOfferPrice(free.price!)).toBe('0,00\u00a0€');
    expect(parsePublicOffer({ ...fixture, included: ['valid', ''] }).included).toEqual([]);
  });

  it('rejects executable, credentialed, ambiguous and injected links; no invalid contact becomes clickable', () => {
    for (const value of ['javascript:alert(1)', 'data:text/html,x', '//evil.invalid', '/redirect', 'http://example.invalid', 'https:/example.invalid', 'https:example.invalid', 'https://user:password@example.invalid', 'https://example.invalid/\\evil', 'https://example.invalid/\n', 'mailto:a@example.invalid?subject=secret', 'mailto:a%3Fcc=other@example.invalid', 'mailto:a#fragment@example.invalid', 'mailto:a@-.invalid', 'mailto:a@example.invalid%0d%0abcc:b@example.invalid']) {
      expect(safePublicUrl(value, true), value).toBeNull();
      const contact = parsePublicOffer({ ...fictionalCompleteOffer(), supportContact: { label: 'test', href: value } });
      expect(contact.supportContact, value).toBeNull();
    }
    expect(safePublicUrl('https://example.invalid/help')).toBe('https://example.invalid/help');
    expect(safePublicUrl('mailto:help@example.invalid', true)).toBe('mailto:help@example.invalid');
    expect(safePublicUrl('mailto:help@example.invalid')).toBeNull();
    expect(renderToStaticMarkup(createElement(SupportContact, { offer: getPublicOffer() }))).not.toContain('<a');
  });

  it('requires exact source mapping and safe document URLs instead of claiming a runtime commit', () => {
    const fixture = fictionalCompleteOffer();
    for (const source of [null, { ...fixture.source, matchesDeployment: false }, { ...fixture.source, revision: '' }, { ...fixture.source, licenseHref: 'javascript:alert(1)' }]) {
      const offer = parsePublicOffer({ ...fixture, source });
      expect(offer.source).toBeNull();
      expect(offer.complete).toBe(false);
      expect(html(offer)).toContain('Quellcode-Zuordnung zum laufenden Release noch offen');
    }
    expect(parsePublicOffer({ ...fixture, documents: { ...fixture.documents, privacy: 'not-a-url' } }).documents).toBeNull();
  });
});
