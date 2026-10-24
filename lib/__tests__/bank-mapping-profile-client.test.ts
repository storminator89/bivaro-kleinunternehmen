import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BankMappingProfiles } from '@/components/bank-csv/bank-mapping-profiles';
import { inferBankCsvMapping, parseBankCsv } from '@/lib/bank-csv';
import { createBankMappingProfileConfiguration } from '@/lib/bank-mapping-profile-contract';
import { loadBankMappingProfile, loadBankMappingProfiles, mutateBankMappingProfile } from '@/lib/bank-mapping-profile-client';
const parsed = parseBankCsv('Datum;Betrag;Währung\n24.10.2026;0,01;EUR');
const mapping = { ...inferBankCsvMapping(parsed.headers), accountAlias: 'Synthetisches Konto' };
describe('profile request and compact UI boundaries', () => {
  it('uses same-origin no-store requests and identical immutable mutation payload for an unknown response retry', async () => {
    const configuration = await createBankMappingProfileConfiguration('Bankexport', mapping, parsed), id = randomUUID();
    const payload = { id, mutationId: randomUUID(), expectedRevision: 0, configuration };
    const profile = { id, revision: 1, latestRevision: 1, configuration };
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('response lost')).mockResolvedValueOnce(Response.json({ profile }));
    const signal = new AbortController().signal;
    await expect(mutateBankMappingProfile('POST', payload, signal, fetcher)).rejects.toThrow('response lost');
    expect(await mutateBankMappingProfile('POST', payload, signal, fetcher)).toEqual(profile);
    expect(fetcher.mock.calls[0][1]?.body).toBe(fetcher.mock.calls[1][1]?.body);
    expect(fetcher.mock.calls[0]).toMatchObject(['/api/bank-mapping-profiles', { method: 'POST', credentials: 'same-origin', cache: 'no-store' }]);
    expect(String(fetcher.mock.calls[0][1]?.body)).not.toContain('24.10.2026');
  });
  it('distinguishes deleted/foreign profiles, concurrent revisions and unverifiable server responses', async () => {
    const id = randomUUID(), signal = new AbortController().signal;
    await expect(loadBankMappingProfile(id, 1, signal, vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 'Nicht gefunden' }, { status: 404 })))).rejects.toMatchObject({ status: 404 });
    const configuration = await createBankMappingProfileConfiguration('Bankexport', mapping, parsed);
    const payload = { id, mutationId: randomUUID(), expectedRevision: 0, configuration };
    await expect(mutateBankMappingProfile('POST', payload, signal, vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 'Neue Revision verfügbar' }, { status: 409 })))).rejects.toMatchObject({ status: 409 });
    await expect(mutateBankMappingProfile('DELETE', { id, expectedRevision: 1, mutationId: randomUUID() }, signal, vi.fn<typeof fetch>().mockResolvedValue(Response.json({ deleted: false })))).rejects.toMatchObject({ status: 502 });
    await expect(loadBankMappingProfiles(signal, vi.fn<typeof fetch>().mockResolvedValue(Response.json({ profiles: Array.from({ length: 101 }, () => ({})) })))).rejects.toMatchObject({ status: 502 });
    const config = await createBankMappingProfileConfiguration('Bankexport', mapping, parsed);
    await expect(loadBankMappingProfile(id, 1, signal, vi.fn<typeof fetch>().mockResolvedValue(Response.json({ profile: { id: randomUUID(), revision: 1, latestRevision: 1, configuration: config } })))).rejects.toMatchObject({ status: 502 });
  });
  it('keeps malformed or mismatched successful write responses uncertain rather than classifying them as rejected requests', async () => {
    const configuration = await createBankMappingProfileConfiguration('Bankexport', mapping, parsed), id = randomUUID();
    const payload = { id, mutationId: randomUUID(), expectedRevision: 0, configuration };
    const good = { id, revision: 1, latestRevision: 2, configuration };
    for (const returned of [null, { ...good, id: 'invalid UUID' }, { ...good, id: randomUUID() }, { ...good, revision: 2 }, { ...good, configuration: { ...configuration, version: 2 } }, { ...good, configuration: { ...configuration, name: 'Wrong configuration' } }]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ profile: returned }));
      await expect(mutateBankMappingProfile('POST', payload, new AbortController().signal, fetcher)).rejects.toMatchObject({ status: 502 });
      expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual(payload);
    }
    expect(await mutateBankMappingProfile('POST', payload, new AbortController().signal, vi.fn<typeof fetch>().mockResolvedValue(Response.json({ profile: good })))).toEqual(good);
  });
  it('offers explicit loading/saving only and renders no bank rows or sample values in the profile menu', () => {
    const html = renderToStaticMarkup(createElement(BankMappingProfiles, { mapping, parsed, hasSource: true, disabled: false, onApply: async () => true, onPending: () => {}, onDetach: () => {} }));
    expect(html).toContain('Profil ausdrücklich laden'); expect(html).toContain('Diese Zuordnung merken'); expect(html).toContain('Als neue Revision aktualisieren');
    expect(html).toContain('Die Datei hat benannte, eindeutige Überschriften');
    expect(html).not.toContain('24.10.2026'); expect(html).not.toContain('0,01'); expect(html).not.toContain('localStorage');
    expect(html).toContain('disabled=""');
  });
});
