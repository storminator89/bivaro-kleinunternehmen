import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(new URL(`../../${name}`, import.meta.url));
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const APACHE_SHA256 = 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30';
const HISTORICAL_AGPL_SHA256 = '0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0';

describe('scoped Apache-2.0 application declaration (static files only)', () => {
  it('uses the complete official Apache text and matching root package/lock SPDX identifiers', () => {
    expect(sha(read('LICENSE'))).toBe(APACHE_SHA256);
    expect(JSON.parse(read('package.json').toString()).license).toBe('Apache-2.0');
    expect(JSON.parse(read('package-lock.json').toString()).packages[''].license).toBe('Apache-2.0');
    const smoke = read('scripts/own-invoice-pdfa/container-smoke.mjs').toString();
    expect(smoke).toContain(`applicationLicense: '${APACHE_SHA256}'`);
    expect(smoke).toContain("npm.application?.declaredLicense === 'Apache-2.0'");
  });

  it('retains the exact prior application license as historical evidence, not current third-party terms', () => {
    expect(sha(read('licenses/historical/AGPL-3.0-only-pre-apache.txt'))).toBe(HISTORICAL_AGPL_SHA256);
    const transition = read('docs/legal/application-license-transition.md').toString();
    expect(transition).toContain('https://www.apache.org/licenses/LICENSE-2.0.txt');
    expect(transition).toContain(APACHE_SHA256);
    expect(transition).toContain(HISTORICAL_AGPL_SHA256);
    expect(transition).toContain('not retroactively replace their terms');
    for (const file of ['README.md', 'README.en.md']) {
      const text = read(file).toString();
      expect(text).toContain('`Apache-2.0`');
      expect(text).toContain('docs/legal/application-license-transition.md');
      expect(text).not.toContain('GNU Affero General Public License v3.0 only');
    }
  });

  it('suppresses aggregate image-license inference and separately pins the scoped application SPDX label', () => {
    const workflow = read('.github/workflows/docker-publish.yml').toString();
    const lines = workflow.split(/\r?\n/u).map(line => line.trim());
    expect(lines).toContain('org.opencontainers.image.licenses=');
    expect(lines).toContain('org.bivaro.application.license=Apache-2.0');
    expect(lines).not.toContain('org.opencontainers.image.licenses=Apache-2.0');
    // metadata-action v5 merges default labels then custom entries using a
    // last-wins Map; an explicitly empty value is retained, not discarded.
    const custom = lines.filter(line => /^(?:org\.opencontainers\.image\.licenses|org\.bivaro\.application\.license(?:\.scope)?)=/u.test(line));
    const merged = new Map([['org.opencontainers.image.licenses', 'AGPL-3.0-only'], ...custom.map(line => {
      const [key, ...value] = line.split('=');
      return [key, value.join('=')] as [string, string];
    })]);
    expect(merged.get('org.opencontainers.image.licenses')).toBe('');
    expect(merged.get('org.bivaro.application.license')).toBe('Apache-2.0');
    expect(workflow).toContain('Application only; third-party components retain their own licenses and source obligations.');
    expect(workflow).toContain('labels: ${{ steps.meta.outputs.labels }}');
    const offer = read('components/public/offer-summary.tsx').toString();
    expect(offer).toContain('Anwendungslizenz: Apache-2.0. Drittkomponenten behalten ihre eigenen Lizenzen.');
  });

  it('retains the separately licensed veraPDF alternatives and scope/source limitations', () => {
    const inventory = read('scripts/own-invoice-pdfa/runtime-notices.mjs').toString();
    expect(inventory).toContain('GPLv3+ OR MPLv2+');
    expect(inventory).toContain('not the entire shaded JAR');
    expect(inventory).toContain("artifactId !== 'verapdf-xmp-core'");
    expect(inventory).toContain('Maven -sources.jar URLs');
    for (const file of ['GPL-3.0.txt', 'MPL-2.0.txt']) {
      expect(read(`scripts/own-invoice-pdfa/licenses/${file}`).length).toBeGreaterThan(10_000);
    }
  });
});
