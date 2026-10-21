import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccessHelpHref, getAccessLoginHref, getAccessReturnTarget } from '@/lib/access-help';

const getToken = vi.hoisted(() => vi.fn());
vi.mock('next-auth/jwt', () => ({ getToken }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: Record<string, unknown>) => createElement('a', props, children as string) }));
import AccessHelpPage from '@/app/help/access/page';
import { proxy } from '@/proxy';

beforeEach(() => { getToken.mockReset(); getToken.mockResolvedValue(null); });

describe('anonymous access-help foundation', () => {
  it('permits only the exact new public route without querying account existence', async () => {
    const response = await proxy(new NextRequest('https://app.invalid/help/access?callbackUrl=%2Fdashboard'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Security-Policy')).toContain('nonce-');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    for (const path of ['/help/access/private', '/help/access-extra', '/users', '/settings']) {
      const guarded = await proxy(new NextRequest(`https://app.invalid${path}`));
      expect(guarded.status).toBe(307);
      expect(new URL(guarded.headers.get('location')!).pathname).toBe('/login');
    }
    const source = readFileSync(new URL('../../app/help/access/page.tsx', import.meta.url), 'utf8');
    expect(source).not.toMatch(/prisma|fetch\(|getServerSession|localStorage|sessionStorage|<form|type="password"/);
  });

  it('round-trips a safe workspace selection without auth loops or sensitive query values', () => {
    const target = '/dashboard?tab=invoices&year=2026&status=paid';
    const help = new URL(getAccessHelpHref(target), 'https://app.invalid');
    const login = new URL(getAccessLoginHref(help.searchParams.get('callbackUrl')), 'https://app.invalid');
    expect(help.pathname).toBe('/help/access');
    expect(login.pathname).toBe('/login');
    expect(login.searchParams.get('callbackUrl')).toBe(target);
    expect(getAccessReturnTarget('/dashboard?email=private%40example.invalid&password=secret&token=secret&tab=invoices#secret')).toBe('/dashboard?tab=invoices');
    for (const value of ['https://evil.invalid', '//evil.invalid', '/%2f%2fevil.invalid', '/\\evil.invalid', 'javascript:alert(1)', '/login?callbackUrl=/login', '/register', '/help/access', '/help/access/', '/%6cogin', '/dashboard?tab=secret@example.invalid']) {
      const result = getAccessReturnTarget(value);
      expect(result).toBe('/dashboard');
    }
  });

  it('explains the actual process, absent contact, no self-service and sole-admin boundary on direct/repeated visits', async () => {
    const props = { searchParams: Promise.resolve({ callbackUrl: '/dashboard?tab=expenses' }) };
    const first = renderToStaticMarkup(await AccessHelpPage(props));
    const second = renderToStaticMarkup(await AccessHelpPage(props));
    expect(second).toBe(first);
    expect(first).toContain('Ihre Identität und Berechtigung unabhängig prüfen');
    expect(first).toContain('Kein Supportkontakt hinterlegt');
    expect(first).toContain('Wiederherstellung muss mit dem Betreiber gesondert autorisiert werden');
    expect(first).toContain('keinen Resetlink per E-Mail');
    expect(first).toContain('Keine Passwörter');
    expect(first).toContain('Geschäftsdaten');
    expect(first).toContain('href="/login?callbackUrl=%2Fdashboard%3Ftab%3Dexpenses"');
    expect(first).not.toMatch(/mailto:|tel:|<form|<input|resetToken|localStorage/);
    const malicious = renderToStaticMarkup(await AccessHelpPage({ searchParams: Promise.resolve({ callbackUrl: '//evil.invalid' }) }));
    expect(malicious).toContain('href="/login?callbackUrl=%2Fdashboard"');
    expect(malicious).not.toContain('evil.invalid');
    const ambiguous = renderToStaticMarkup(await AccessHelpPage({ searchParams: Promise.resolve({ callbackUrl: ['/settings', '//evil.invalid'] }) }));
    expect(ambiguous).toContain('href="/login?callbackUrl=%2Fdashboard"');
  });

  it('uses exact native help-fragment returns rather than the cached SPA hash route', async () => {
    const source = readFileSync(new URL('../../app/help/access/page.tsx', import.meta.url), 'utf8');
    // Next 16 learns the initial location hash, then appends the destination
    // hash again when revisiting its cached route. These two public help links
    // deliberately perform fresh document navigations, not Link interception.
    expect(source).toContain('<a href="/help#angebot">Betreiber und Angebot</a>');
    expect(source).toContain('<a className={styles.textLink} href="/help#zugang">Zur Aufgabenhilfe</a>');
    expect(source).not.toMatch(/<Link[^>]+href="\/help#/);
    const output = renderToStaticMarkup(await AccessHelpPage({ searchParams: Promise.resolve({}) }));
    expect(output).toContain('href="/help#angebot"');
    expect(output).toContain('href="/help#zugang"');
    expect(output).not.toContain('#angebot#angebot');
  });

  it('keeps login, register and footer guidance discoverable without adding account recovery mutations', () => {
    const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
    expect(read('app/login/page.tsx')).toContain('getAccessHelpHref(searchParams.get("callbackUrl"))');
    expect(read('app/register/page.tsx')).toContain('href="/help/access"');
    expect(read('components/app-shell.tsx')).toContain("'/help/access'");
    expect(read('components/app-shell.tsx')).toContain('href="/help#angebot"');
    const runbook = read('docs/operations/account-access.md');
    for (const boundary of ['sessionVersion', 'API-Schlüssel', 'letzte', 'G-SUPPORT', 'keinen', 'Produkt', 'Source']) expect(runbook.toLowerCase()).toContain(boundary.toLowerCase());
  });
});
