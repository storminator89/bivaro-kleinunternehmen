import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pilotGuides, publicAccessCopy, registrationAccessState } from '@/components/public-accounting/pilot-guides';

const getToken = vi.hoisted(() => vi.fn());
vi.mock('next-auth/jwt', () => ({ getToken }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/components/public-accounting/pilot-access', () => ({ PilotAccess: () => null }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: Record<string, unknown>) => createElement('a', props, children as string) }));
vi.mock('next/image', () => ({ default: ({ priority: _priority, ...props }: Record<string, unknown>) => createElement('img', props) }));
import Home from '@/app/page';
import HelpPage from '@/app/help/page';
import { proxy } from '@/proxy';

beforeEach(() => { getToken.mockReset(); getToken.mockResolvedValue(null); });

describe('public buyer and task guidance', () => {
  it('makes only the exact help page public and keeps workspaces and lookalikes guarded', async () => {
    for (const path of ['/', '/help', '/help/access', '/login', '/register']) {
      const response = await proxy(new NextRequest(`http://localhost${path}`));
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Security-Policy')).toContain('nonce-');
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    }
    for (const path of ['/help/private', '/help-export', '/dashboard?tab=invoices', '/settings', '/customers']) {
      const response = await proxy(new NextRequest(`http://localhost${path}`));
      expect(response.status).toBe(307);
      const target = new URL(response.headers.get('location')!);
      expect(target.pathname).toBe('/login');
      expect(target.searchParams.get('callbackUrl')).toBe(path);
    }
  });

  it('links the public product sequence to existing help anchors rather than gated workspaces', () => {
    const html = renderToStaticMarkup(createElement(Home));
    const help = renderToStaticMarkup(createElement(HelpPage));
    for (const guide of pilotGuides) {
      expect(html).toContain(`href="/help#${guide.id}"`);
      expect(help).toContain(`id="${guide.id}"`);
      for (const link of guide.links) expect(help).toContain(`href="${link.href.replaceAll('&', '&amp;')}"`);
    }
    expect(html).not.toContain('href="/register"');
    expect(html).not.toContain('href="/dashboard');
    expect(html).toContain('keine interaktive Demo');
    expect(html).toContain('keinen Checkout');
  });

  it('publishes concrete task help with incoming/outgoing and export limitations', () => {
    const html = renderToStaticMarkup(createElement(HelpPage));
    expect(pilotGuides.map(guide => guide.id)).toEqual(['erste-rechnung', 'zahlung', 'belege', 'export']);
    expect(html).toContain('automatisch. Erfassen Sie denselben Geldeingang nicht zusätzlich');
    expect(html).toContain('Rechnungsimport ist keine automatische Ausgabenbuchung');
    expect(html).toContain('nicht auf „Bezahlt“');
    expect(html).toContain('keine ELSTER-Einreichung');
    expect(html).toContain('2024, 2025 und 2026');
    expect(html).toContain('unbekannte Formularjahre werden abgewiesen');
    expect(html).toContain('verifizierten Jahreszuordnungen für 2024, 2025, 2026');
    expect(html).not.toContain('ist auf 2024 und 2025 begrenzt');
    expect(html).toContain('kein öffentlicher Betreiber- oder Supportkontakt hinterlegt');
    expect(html).toContain('Zugang verloren oder Betriebsstörung');
    expect(html).toContain('id="steuerprofil"');
    expect(html).toContain('das tatsächliche Datum und eine nachvollziehbare Zahlungsreferenz');
    expect(html).toContain('nach der ersten Zahlung bleiben 80 EUR offen');
    expect(html).toContain('payments.csv');
    expect(html).not.toContain('Ein eigenes Datumsfeld gibt es dort nicht');
    expect(html).not.toContain('aktuellen Buchungszeitpunkt als Zahlungsdatum');
    expect(html).not.toMatch(/mailto:|tel:|kostenlos testen|rechtssicher|GoBD-konform/i);
  });

  it('keeps the absent-contact explanation directly within the access section as well as offer details', () => {
    const help = renderToStaticMarkup(createElement(HelpPage));
    const access = help.match(/<section id="zugang"[\s\S]*?<\/section>/)?.[0];
    const offer = help.match(/<section id="angebot"[\s\S]*?<\/section>/)?.[0];
    for (const section of [access, offer]) {
      expect(section).toContain('kein öffentlicher Betreiber- oder Supportkontakt hinterlegt');
      expect(section).toContain('Der Hilfeweg ist noch nicht eingerichtet');
      expect(section).not.toMatch(/mailto:|tel:/);
    }
    const source = readFileSync(new URL('../../app/help/page.tsx', import.meta.url), 'utf8');
    expect(source).toContain('<a href="#angebot">Bestätigte Angebots- und Kontaktdaten prüfen</a>');
  });

  it('reserves sticky-header clearance before hash navigation activates a target', () => {
    const css = readFileSync(new URL('../../components/public-accounting/pilot-public.module.css', import.meta.url), 'utf8');
    // Link navigation may call scrollIntoView before the browser updates :target.
    // Every public anchor needs an unconditional offset, not a :target-only rule.
    expect(css).toMatch(/\.page \[id\]\s*\{\s*scroll-margin-top:\s*calc\(var\(--layout-topbar\) \+ var\(--space-lg\)\)/);
    expect(css).not.toMatch(/:target\s*\{\s*scroll-margin/);
    const help = renderToStaticMarkup(createElement(HelpPage));
    for (const id of [...pilotGuides.map(guide => guide.id), 'steuerprofil', 'umfang', 'zugang']) {
      expect(help).toContain(`id="${id}"`);
    }
  });

  it('gives public header links and CTAs a solid keyboard focus outline beyond primitive resets', () => {
    const css = readFileSync(new URL('../../components/public-accounting/pilot-public.module.css', import.meta.url), 'utf8');
    const focusRule = css.match(/\.publicHeader a:focus-visible[\s\S]*?\{([^}]+)\}/)?.[1];
    expect(css).toContain('.publicHeader button:focus-visible');
    expect(css).toContain('.page a:focus-visible');
    expect(css).toContain('.page button:focus-visible');
    expect(focusRule).toContain('outline-width: 2px');
    expect(focusRule).toContain('outline-style: solid');
    expect(focusRule).toContain('outline-color: var(--color-focus)');
    expect(focusRule).toContain('outline-offset: 4px');
    const shell = readFileSync(new URL('../../components/app-shell.tsx', import.meta.url), 'utf8');
    expect(shell).toContain('${publicStyles.publicHeader} sticky');
  });

  it('uses native public help-fragment links without changing non-hash navigation', () => {
    const paths = ['app/page.tsx', 'app/help/page.tsx', 'app/help/access/page.tsx', 'app/register/page.tsx', 'components/app-shell.tsx', 'components/public/offer-summary.tsx'];
    for (const path of paths) {
      const source = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
      // Both literal and guide-generated /help# links must bypass the cache.
      expect(source, path).not.toMatch(/<Link\b[^>]*\bhref=(?:"\/help#|\{`\/help#)/);
    }
    const home = readFileSync(new URL('../../app/page.tsx', import.meta.url), 'utf8');
    expect(home).toContain('<a href="/help#erste-rechnung">Den ersten Ablauf kennenlernen</a>');
    expect(home).toContain('<a href={`/help#${guide.id}`}>{guide.title}</a>');
    expect(home).toContain('<a className={styles.textLink} href={`/help#${guide.id}`}>Anleitung');
    const shell = readFileSync(new URL('../../components/app-shell.tsx', import.meta.url), 'utf8');
    expect(shell).toContain('<a href="/help#umfang"');
    expect(shell).toContain('<a href="/help#angebot"');
    expect(shell).toContain('<Link href="/help/access"');
    expect(shell).toContain('<Link href="/help"');
    const registration = readFileSync(new URL('../../app/register/page.tsx', import.meta.url), 'utf8');
    expect(registration).toContain('<a href="/help#angebot"');
    expect(registration).toContain('<Link href="/help/access"');
  });

  it('keeps public help in the shell and removes unconditional registration advertising', () => {
    const shell = readFileSync(new URL('../../components/app-shell.tsx', import.meta.url), 'utf8');
    expect(shell).toContain("const publicPaths = ['/', '/login', '/register', '/help', '/help/access']");
    expect(shell).toContain('if (status === "loading" && !isPublicPage)');
    expect(shell).not.toContain('if (status === "loading")');
    expect(shell).toContain('href="/help"');
    expect(shell).not.toContain('href="/register"');
  });
});

describe('truthful registration CTA', () => {
  it('offers registration only for an existing explicitly open installation', () => {
    expect(registrationAccessState({ isFirstUser: false, allowRegistration: true, bootstrapRequired: false })).toBe('open');
    expect(publicAccessCopy.open.href).toBe('/register');
    expect(publicAccessCopy.open.description).toContain('keine Bestellung');
  });

  it('does not market administrator bootstrap or a closed installation as customer signup', () => {
    expect(registrationAccessState({ isFirstUser: true, allowRegistration: true, bootstrapRequired: true })).toBe('setup');
    expect(registrationAccessState({ isFirstUser: true, allowRegistration: false })).toBe('setup');
    expect(registrationAccessState({ isFirstUser: false, allowRegistration: false })).toBe('closed');
    expect(registrationAccessState({ isFirstUser: false, allowRegistration: true, bootstrapRequired: true })).toBe('setup');
    for (const state of ['checking', 'closed', 'setup', 'unavailable'] as const) expect(publicAccessCopy[state].href).toBe('/login');
  });

  it('fails safely on malformed or unavailable status payloads', () => {
    for (const value of [null, undefined, [], {}, { error: 'unavailable' }, { isFirstUser: false, allowRegistration: 'true' }]) {
      expect(registrationAccessState(value)).toBe('unavailable');
    }
    const source = readFileSync(new URL('../../components/public-accounting/pilot-access.tsx', import.meta.url), 'utf8');
    expect(source).toContain("fetch('/api/auth/registration-status'");
    expect(source).toContain("cache: 'no-store'");
    expect(source).toContain('AbortController');
    expect(source).toContain('Status erneut prüfen');
    expect(source).not.toContain("method: 'POST'");
  });
});
