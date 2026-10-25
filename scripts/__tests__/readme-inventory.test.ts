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
  'docs/operations/getting-started.de.md', 'docs/operations/getting-started.en.md',
  'docs/features/bank-payment-allocation.md', 'docs/readme-source-map-2026-10-22.md',
  'docs/screenshots/README-870d73be.md', 'docs/screenshots/README-ea65fc2f.md',
  'docs/screenshots/coverage.md',
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


// Preserved PR #138 originals; constants are independent of both manifests.
const acceptedImages = [
  {
    "file": "customer-redesign-directory-light-1440.png",
    "width": 1440,
    "height": 1000,
    "sha256": "ac70a8b4b9af320a1b051708770d6ead7191c80ba0bedb588ffcfa0a74c79cb1",
    "decodedRgbSha256": "18661e747f62868f7fac6e82318ab739c50f92696189ccf639ec628ac86d5dba",
    "bytes": 130532,
    "artifactId": 12555475463
  },
  {
    "file": "invoice-redesign-light-1600.png",
    "width": 1585,
    "height": 1029,
    "sha256": "115f61206b92838843c83f3d8408cae3a9951772dabbc108740cf1577e5c7262",
    "decodedRgbSha256": "d072347e2312c2d6ac6f93dd76d7205d88e6fa3c90f0b4342945b4d9a0767917",
    "bytes": 137659,
    "artifactId": 12555475463
  },
  {
    "file": "cashflow-income-light-1440.png",
    "width": 1425,
    "height": 1454,
    "sha256": "4e0af1ee212d5a0b49ce6b2b02e118a4316b182d6ef8ef018e2bfa3a10146778",
    "decodedRgbSha256": "b21186402067165b6ab0cf8c4ee68414fff64a11d775963ffaa02209963b688c",
    "bytes": 149084,
    "artifactId": 12555231385
  },
  {
    "file": "cashflow-expense-dark-1440.png",
    "width": 1425,
    "height": 1798,
    "sha256": "bd426f14ac94908b687eea47778c42fe8d769684392d6ca7dfc1b31861bd07a2",
    "decodedRgbSha256": "fa114b1f6e4f0f71eb071f904a6f31855d9bf42c1919ce293245a7858a0a43cc",
    "bytes": 185824,
    "artifactId": 12555231385
  },
  {
    "file": "catalog-inbox-articles-light-1440.png",
    "width": 1440,
    "height": 1000,
    "sha256": "d2e0ef0eb9f0c45815798b405764c92a51a056e94ce2ccdfdf7e180395a4e6b7",
    "decodedRgbSha256": "548b6528700fca2f5d4c2d56b15462fe49cf4a4ff08310b111e3cfd616909351",
    "bytes": 101336,
    "artifactId": 12554624852
  },
  {
    "file": "catalog-inbox-receipts-light-1440.png",
    "width": 1440,
    "height": 1000,
    "sha256": "e32df79bdc6eedd1aea43421e9f2ac3f5268355291ace4d1d5eebb60bf30a542",
    "decodedRgbSha256": "730a6d75e83be8c86e6fc65d76bcbc10e73bdb88143d3769e566d25503fabba4",
    "bytes": 95860,
    "artifactId": 12554624852
  }
];
const previousSource = 'ea65fc2f59ef43f17d9abdc6a086982fd01522f3';
const currentSource = '0ed113074e1c97defaa84345e2e050cf7eb281ff';
const previousTree = '4cb608ac6901e893581997378c35c6f21c931428';
const currentTree = '6df04d075d64c1566187333e5536fa0bdd497d4d';
const previousAcceptedMerge = '1e6d9fe110c9206401da27b530f44f30e14be2dc';
const currentManifestSha256 = '684923951841afe64cb515ad9bf6d0e1dbd9fdf1bacc628784d79d97078adf68';
const readmes = ['README.md', 'README.en.md'];
const guides = ['docs/operations/getting-started.de.md', 'docs/operations/getting-started.en.md'];

describe('compact bilingual README, linked operational guidance and dated screenshot evidence (files only)', () => {
  it('resolves every local Markdown/HTML link and heading anchor across the complete documentation set', () => {
    for (const file of documentation) {
      const links = [...read(file).matchAll(/\]\(([^\s)]+)\)|(?:href|src)="([^"]+)"/gu)].map(match => match[1] ?? match[2]);
      let localLinks = 0;
      for (const link of links) {
        if (/^(?:https?:|mailto:|data:|\/\/)/iu.test(link)) continue;
        const [relative, fragment] = link.split('#');
        const destination = path.resolve(root, path.dirname(file), decodeURIComponent(relative || path.basename(file)));
        expect(existsSync(destination), `${file}: ${link}`).toBe(true);
        if (fragment && statSync(destination).isFile() && destination.endsWith('.md')) {
          expect(anchors(readFileSync(destination, 'utf8')), `${file}: ${link}`).toContain(decodeURIComponent(fragment));
        }
        localLinks++;
      }
      // Every declared document must participate; no arbitrary root-README link quota.
      expect(localLinks, file).toBeGreaterThan(0);
    }
    readmes.forEach((file, index) => expect(read(file)).toContain(`](${guides[index]})`));
  });

  it('preserves the six previous gallery originals and their independent pixel identities', () => {
    const provenance = JSON.parse(read('docs/screenshots/provenance-ea65fc2f.json'));
    expect(provenance.sourceCommit).toBe(previousSource);
    expect(provenance.sourceTree).toBe(previousTree);
    expect(provenance.acceptedMergeCommit).toBe(previousAcceptedMerge);
    expect(provenance.workflowRunId).toBe(40079455853);
    expect(provenance.captureDate).toBe('2026-10-24');
    expect(provenance.reviewDate).toBe('2026-10-24');
    expect(provenance.images).toHaveLength(acceptedImages.length);
    expect(provenance.images.map((image: { file: string }) => image.file)).toEqual(acceptedImages.map(image => image.file));
    expect(provenance.totalPngBytes).toBe(800295);
    let bytes = 0;
    for (const expected of acceptedImages) {
      const image = provenance.images.find((value: { file: string }) => value.file === expected.file);
      expect(image).toMatchObject(expected);
      expect(image.readmeReviewIndividuallyOpened).toBe(true);
      expect(image.reviewForReadableUiAndSyntheticData).toBe(true);
      expect(image.artifactSha256).toMatch(/^[a-f0-9]{64}$/u);
      const original = readFileSync(path.join(root, 'docs/screenshots', expected.file));
      expect(createHash('sha256').update(original).digest('hex')).toBe(expected.sha256);
      expect(original.length).toBe(expected.bytes);
      expect(original.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(original.readUInt32BE(16)).toBe(expected.width);
      expect(original.readUInt32BE(20)).toBe(expected.height);
      // Byte identity pins the accepted pixels without introducing a PNG decoder here.
      expect(image.decodedRgbSha256).toBe(expected.decodedRgbSha256);
      bytes += original.length;
    }
    expect(bytes).toBe(provenance.totalPngBytes);
    for (const file of readmes) {
      for (const image of acceptedImages) expect(read(file)).not.toContain(`src="docs/screenshots/${image.file}"`);
    }
  });

  it('pins every current native image, reviewed provenance and complete bilingual gallery without fabricating missing areas', () => {
    const raw = read('docs/screenshots/provenance.json');
    expect(createHash('sha256').update(raw).digest('hex')).toBe(currentManifestSha256);
    const provenance = JSON.parse(raw);
    expect(provenance.appSourceCommit).toBe(currentSource);
    expect(provenance.captured).toBe('2026-10-25');
    expect(provenance.images).toHaveLength(49);
    expect(provenance.availableImages).toBe(49);
    expect(provenance.missingImages).toBe(0);
    expect(provenance.gaps).toEqual([]);
    const paths = provenance.images.map((image: { path: string }) => image.path);
    expect(new Set(paths).size).toBe(49);
    let bytes = 0;
    for (const image of provenance.images) {
      expect(image.path).toBe(`docs/screenshots/2026-10-25/${image.filename}`);
      expect(image.filename).toMatch(/^[a-z0-9-]+\.png$/u);
      expect(image.reviewDate).toBe('2026-10-25');
      expect(image.visualReview.length).toBeGreaterThan(20);
      expect(image.status).toMatch(/^individually-reviewed/u);
      expect(image.outputSha256).toBe(image.reviewedSha256);
      for (const value of [image.outputSha256, image.fullPixelSha256, image.nonIdatSha256, image.sourceInputPngSha256]) expect(value).toMatch(/^[a-f0-9]{64}$/u);
      expect(image.artifactDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(image.artifactId).toBeGreaterThan(0);
      expect(image.sourceCommit).toMatch(/^[a-f0-9]{40}$/u);
      expect(image.checkoutCommit).toMatch(/^[a-f0-9]{40}$/u);
      expect(image.checkoutTree).toMatch(/^[a-f0-9]{40}$/u);
      const original = readFileSync(path.join(root, image.path));
      expect(createHash('sha256').update(original).digest('hex')).toBe(image.outputSha256);
      expect(original.length).toBe(image.outputBytes);
      expect(original.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(original.readUInt32BE(16)).toBe(image.width);
      expect(original.readUInt32BE(20)).toBe(image.height);
      // The independent manifest digest pins hosted full-pixel/metadata proofs;
      // no local browser, image recreation or new PNG decoder is introduced here.
      const source = provenance.sourceEvidence.find((value: { runId: number }) => value.runId === image.runId);
      expect(source.sourceCommit).toBe(image.sourceCommit);
      expect(source.checkoutCommit).toBe(image.checkoutCommit);
      expect(source.checkoutTree).toBe(image.checkoutTree);
      bytes += original.length;
    }
    expect(bytes).toBe(provenance.totalPngBytes);
    const galleries = readmes.map(file => [...read(file).matchAll(/<img\b[^>]*src="([^"]+)"[^>]*alt="([^"]+)"[^>]*>/gu)]);
    expect(galleries[0].map(image => image[1])).toEqual(galleries[1].map(image => image[1]));
    readmes.forEach((file, index) => {
      const text = read(file), images = galleries[index];
      expect(images).toHaveLength(49);
      expect(new Set(images.map(image => image[1])).size).toBe(49);
      expect(images.map(image => image[1]).sort()).toEqual([...paths].sort());
      expect(images.every(image => image[2].trim().length > 0)).toBe(true);
      expect(text.match(/<details>/gu)).toHaveLength(7);
      expect(text).not.toMatch(/<details[^>]+open/gu);
      expect(text.split('<details>')[0].match(/<img\b/gu)).toHaveLength(4);
      for (const image of provenance.images) expect(text).toContain(`href="${image.path}"`);
    });
    expect(read('docs/screenshots/coverage.md')).toContain('Route-area coverage: 33/33');
    expect(read('docs/screenshots/coverage.md')).toContain('Selected views: 49/49');
  });

  it('preserves all seven historical originals without relabelling them as current captures', () => {
    const historical = JSON.parse(read('docs/screenshots/provenance-870d73be.json'));
    expect(historical.sourceCommit).toBe('870d73be87dafa5918e0172bdf0ebe818684aa48');
    expect(historical.sourceTree).toBe('b80c3873cdc58306cd9210a7939bba68175f00a8');
    expect(historical.reviewDate).toBe('2026-10-22');
    expect(historical.images).toHaveLength(7);
    expect(historical.totalPngBytes).toBe(977308);
    let bytes = 0;
    for (const image of historical.images) {
      const original = readFileSync(path.join(root, 'docs/screenshots', image.file));
      expect(createHash('sha256').update(original).digest('hex')).toBe(image.sha256);
      expect(original.length).toBe(image.bytes);
      expect(original.readUInt32BE(16)).toBe(1440);
      expect(original.readUInt32BE(20)).toBe(1000);
      expect(image.decodedRgbSha256).toMatch(/^[a-f0-9]{64}$/u);
      for (const file of readmes) expect(read(file)).not.toContain(`src="docs/screenshots/${image.file}"`);
      bytes += original.length;
    }
    expect(bytes).toBe(historical.totalPngBytes);
    expect(read('docs/screenshots/README.md')).toContain('(provenance-870d73be.json)');
    expect(read('docs/screenshots/README-870d73be.md')).toContain('(provenance-870d73be.json)');
  });

  it('keeps both languages current while retaining distinct PDF, Java, stream and license boundaries in linked guides', () => {
    for (const term of [currentSource, currentTree]) expect(read('docs/readme-source-map.md')).toContain(term);
    readmes.forEach((file, index) => {
      const text = read(file), guide = read(guides[index]);
      for (const term of ['6 MiB', '1–4', 'PDF/A-3b', '`Apache-2.0`', 'docs/operations/pdf-third-party-notices.md', 'docs/legal/application-license-transition.md']) expect(text, `${file}: ${term}`).toContain(term);
      for (const term of ['PDF.js', 'Canvas', 'KoSIT', 'veraPDF', '6 MiB', '1–4', '2 MiB', 'PDF/A-3b', '422', '503']) expect(guide, `${guides[index]}: ${term}`).toContain(term);
      expect(text).not.toContain('replacement in preparation');
      expect(text).not.toContain('Ersatzpfad in Vorbereitung');
      expect(text).not.toContain('PREPARATION ONLY');
    });
  });
});
