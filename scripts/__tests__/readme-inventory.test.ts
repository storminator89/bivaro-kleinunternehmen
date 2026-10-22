import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (name: string) => readFileSync(path.join(root, name), 'utf8');
const documentation = [
  'README.md', 'README.en.md', 'docs/readme-source-map.md', 'docs/screenshots/README.md',
  'docs/legal/application-license-transition.md', 'docs/operations/pdf-third-party-notices.md',
  'docs/operations/account-access.md',
];
function anchors(markdown: string) {
  const occurrences = new Map<string, number>();
  return markdown.split('\n').filter(line => /^#{1,6}\s/u.test(line)).map(line => {
    const base = line.replace(/^#{1,6}\s+/u, '').toLowerCase().replace(/<[^>]*>/gu, '')
      .replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s/gu, '-');
    const count = occurrences.get(base) ?? 0;
    occurrences.set(base, count + 1);
    return count ? `${base}-${count}` : base;
  });
}

describe('complete bilingual README inventory and dated screenshot provenance (files only)', () => {
  it('resolves every local Markdown/HTML link and heading anchor in the updated documentation', () => {
    let checked = 0;
    for (const file of documentation) {
      const text = read(file);
      const links = [...text.matchAll(/\]\(([^\s)]+)\)|(?:href|src)="([^"]+)"/gu)].map(match => match[1] ?? match[2]);
      for (const link of links) {
        if (/^(?:https?:|mailto:|data:|\/\/)/iu.test(link)) continue;
        const [relative, fragment] = link.split('#');
        const destination = path.resolve(root, path.dirname(file), decodeURIComponent(relative || path.basename(file)));
        expect(existsSync(destination), `${file}: ${link}`).toBe(true);
        if (fragment && statSync(destination).isFile() && destination.endsWith('.md')) {
          expect(anchors(readFileSync(destination, 'utf8')), `${file}: ${link}`).toContain(decodeURIComponent(fragment));
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('binds exactly seven original PNG hashes and recorded pixel identities to the older capture source', () => {
    const provenance = JSON.parse(read('docs/screenshots/provenance.json'));
    expect(provenance.sourceCommit).toBe('870d73be87dafa5918e0172bdf0ebe818684aa48');
    expect(provenance.sourceTree).toBe('b80c3873cdc58306cd9210a7939bba68175f00a8');
    expect(provenance.reviewDate).toBe('2026-10-22');
    expect(provenance.images).toHaveLength(7);
    expect(provenance.totalPngBytes).toBe(977308);
    let bytes = 0;
    for (const image of provenance.images) {
      const original = readFileSync(path.join(root, 'docs/screenshots', image.file));
      expect(createHash('sha256').update(original).digest('hex')).toBe(image.sha256);
      expect(original.length).toBe(image.bytes);
      expect(original.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(original.readUInt32BE(16)).toBe(1440);
      expect(original.readUInt32BE(20)).toBe(1000);
      expect(image.decodedRgbSha256).toMatch(/^[a-f0-9]{64}$/u);
      for (const file of ['README.md', 'README.en.md']) expect(read(file)).toContain(`docs/screenshots/${image.file}`);
      bytes += original.length;
    }
    expect(bytes).toBe(provenance.totalPngBytes);
  });

  it('keeps both languages on the same accepted source and preserves the distinct PDF/Java/stream boundaries', () => {
    expect(read('docs/readme-source-map.md')).toContain('5fdc757971ce98e2351e0ed5cc8ce7da06f9bbd3');
    for (const file of ['README.md', 'README.en.md']) {
      const text = read(file);
      for (const term of ['PDF.js', 'Canvas', 'KoSIT', 'veraPDF', '6 MiB', '1–4', '2 MiB', 'PDF/A-3b', '870d73be', '422', '503']) expect(text, `${file}: ${term}`).toContain(term);
      expect(text).not.toContain('replacement in preparation');
      expect(text).not.toContain('Ersatzpfad in Vorbereitung');
    }
  });
});
