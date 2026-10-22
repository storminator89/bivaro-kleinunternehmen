import { afterEach, describe, expect, it } from 'vitest';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import { collectPdfNotices, writePdfNotices } from '../third-party-notices/build-notices.mjs';
import { collectVerapdfMetadata, writeVerapdfNotices, VERAPDF_CLI_SHA256 } from '../own-invoice-pdfa/runtime-notices.mjs';
import { VERAPDF_ASSET } from '../own-invoice-pdfa/install-runtime.mjs';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'bivaro-notices-unit-'));
  roots.push(root);
  const packages = {
    'node_modules/pdfkit': { name: 'pdfkit', version: '0.20.2', license: 'MIT', dependencies: { shared: '1' } },
    'node_modules/fontkit': { name: 'fontkit', version: '2.0.4', license: 'MIT', dependencies: { shared: '2' } },
    'node_modules/shared': { name: 'shared', version: '1.0.0', license: 'MIT' },
    'node_modules/fontkit/node_modules/shared': { name: 'shared', version: '2.0.0', license: 'BSD-3-Clause' },
  };
  for (const [location, metadata] of Object.entries(packages)) {
    const directory = path.join(root, location);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'package.json'), JSON.stringify(metadata));
    if (metadata.name !== 'fontkit') await writeFile(path.join(directory, 'LICENSE'), `Exact synthetic license ${metadata.version}\r\n`);
    else await writeFile(path.join(directory, 'readme.md'), '## License\n\nMIT\n');
  }
  await writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ packages: Object.fromEntries(Object.entries(packages).map(([location, metadata]) => [location, { ...metadata, resolved: `https://registry.npmjs.org/${metadata.name}/-/${metadata.name}-${metadata.version}.tgz`, integrity: 'synthetic-integrity' }])) }));
  await mkdir(path.join(root, 'public/fonts/invoice'), { recursive: true });
  for (const filename of ['BivaroSans-Bold.ttf', 'BivaroSans-Regular.ttf', 'FONT-LICENSE.txt', 'README.md']) await writeFile(path.join(root, 'public/fonts/invoice', filename), `Unchanged synthetic ${filename}\r\n`);
  return root;
}

describe('offline PDF runtime notice packaging (synthetic files only)', () => {
  it('is deterministic, follows nested declared dependencies, and preserves exact notices/OFL bytes', async () => {
    const root = await fixture();
    const first = await collectPdfNotices(root);
    const second = await collectPdfNotices(root);
    expect([...first.files]).toEqual([...second.files]);
    expect(first.manifest.packages.map(item => `${item.name}@${item.version}`).sort()).toEqual(['fontkit@2.0.4', 'pdfkit@0.20.2', 'shared@1.0.0', 'shared@2.0.0']);
    expect(first.files.get('licenses/npm/pdfkit/LICENSE')?.toString()).toBe('Exact synthetic license 0.20.2\r\n');
    expect(first.files.get('licenses/invoice-fonts/FONT-LICENSE.txt')).toEqual(await readFile(path.join(root, 'public/fonts/invoice/FONT-LICENSE.txt')));
    const fontkit = first.manifest.packages.find(item => item.name === 'fontkit');
    expect(fontkit?.limitations).toHaveLength(1);
    expect(fontkit?.notices).toEqual([]);
    expect(first.files.get('licenses/npm/fontkit/readme.md')?.toString()).toBe('## License\n\nMIT\n');
    expect(first.files.has('licenses/npm/fontkit/LICENSE')).toBe(false);
    expect(first.files.get('licenses/MIT-reference.txt')?.toString()).toContain('<copyright holders>');
    expect(first.files.get('THIRD_PARTY_SOURCES.json')?.toString()).not.toContain(root);
  });

  it('normalizes a trailing root separator before dependency traversal', async () => {
    const root = await fixture();
    const normalized = await collectPdfNotices(root);
    const trailing = await collectPdfNotices(root + path.sep);
    expect([...trailing.files]).toEqual([...normalized.files]);
    expect(trailing.manifest.packages).toHaveLength(4);
  });

  it('runs the genuine CLI default-root entrypoint against a synthetic standalone marker only', async () => {
    const root = await fixture();
    const scripts = path.join(root, 'scripts/third-party-notices');
    const standalone = path.join(root, '.next/standalone');
    await mkdir(scripts, { recursive: true });
    await mkdir(standalone, { recursive: true });
    await writeFile(path.join(standalone, 'server.js'), '// synthetic marker, never executed');
    for (const filename of ['build-notices.mjs', 'MIT-reference.txt']) {
      await copyFile(new URL(`../third-party-notices/${filename}`, import.meta.url), path.join(scripts, filename));
    }
    // Execute only the offline notice collector, never server.js or PDF tools.
    await promisify(execFile)(process.execPath, [path.join(scripts, 'build-notices.mjs')], {
      cwd: root, env: { PATH: path.dirname(process.execPath), NODE_ENV: 'test' }, timeout: 10_000, maxBuffer: 32 * 1024,
    });
    const manifest = JSON.parse(await readFile(path.join(standalone, 'THIRD_PARTY_SOURCES.json'), 'utf8'));
    expect(manifest.packages).toHaveLength(4);
    expect(await readFile(path.join(standalone, 'licenses/npm/pdfkit/LICENSE'), 'utf8')).toBe('Exact synthetic license 0.20.2\r\n');
    expect(await readFile(path.join(standalone, 'licenses/invoice-fonts/FONT-LICENSE.txt'))).toEqual(await readFile(path.join(root, 'public/fonts/invoice/FONT-LICENSE.txt')));
  });

  it('hooks notice collection after the build and retains Docker standalone propagation without relicensing', async () => {
    const metadata = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(metadata.scripts.postbuild).toBe('node scripts/third-party-notices/build-notices.mjs');
    expect(metadata.license).toBe('AGPL-3.0-only');
    expect(await readFile(new URL('../../Dockerfile', import.meta.url), 'utf8')).toContain('/app/.next/standalone ./');
  });

  it('writes manifests/license files into the standalone root only after a built server exists', async () => {
    const root = await fixture();
    const destination = path.join(root, '.next/standalone');
    await expect(writePdfNotices(root, destination)).rejects.toThrow();
    await mkdir(destination, { recursive: true });
    await writeFile(path.join(destination, 'server.js'), '// synthetic marker, never executed');
    await writePdfNotices(root, destination);
    await writePdfNotices(root, destination);
    expect(await readFile(path.join(destination, 'THIRD_PARTY_NOTICES.txt'), 'utf8')).toContain('attribution remains unresolved');
    expect(JSON.parse(await readFile(path.join(destination, 'THIRD_PARTY_SOURCES.json'), 'utf8')).roots.pdfkit).toBe('0.20.2');
  });

  it('fails closed when installed packages differ from the lock or reviewed PDF version', async () => {
    const root = await fixture();
    const location = path.join(root, 'node_modules/pdfkit/package.json');
    await writeFile(location, JSON.stringify({ name: 'pdfkit', version: '0.20.1' }));
    await expect(collectPdfNotices(root)).rejects.toThrow('lockfile');
    const lockPath = path.join(root, 'package-lock.json');
    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    lock.packages['node_modules/pdfkit'].version = '0.20.1';
    await writeFile(lockPath, JSON.stringify(lock));
    await expect(collectPdfNotices(root)).rejects.toThrow('Review PDF notices');
  });
});

describe('veraPDF exact embedded notices and source references (synthetic ZIP only)', () => {
  it('retains notices/POMs verbatim, maps observed modules, and does not apply MPL to the whole JAR', async () => {
    const zip = new JSZip();
    zip.file('META-INF/NOTICE.txt', 'Exact synthetic notice\r\n');
    zip.file('org/xmlresolver/notices/w3c-license.txt', 'Exact synthetic license\n');
    zip.file('net/sf/saxon/trans/LicenseException.class', 'not a notice');
    for (const [groupId, artifactId] of [['org.verapdf.apps', 'cli'], ['org.verapdf', 'verapdf-xmp-core'], ['com.example', 'separate']]) {
      zip.file(`META-INF/maven/${groupId}/${artifactId}/pom.properties`, `groupId=${groupId}\nartifactId=${artifactId}\nversion=1.30.3\n`);
      zip.file(`META-INF/maven/${groupId}/${artifactId}/pom.xml`, '<project>Synthetic POM</project>');
    }
    const result = await collectVerapdfMetadata(zip);
    expect(result.files.get('licenses/embedded/META-INF/NOTICE.txt')?.toString()).toBe('Exact synthetic notice\r\n');
    expect(result.files.has('licenses/embedded/org/xmlresolver/notices/w3c-license.txt')).toBe(true);
    expect(result.files.has('licenses/embedded/net/sf/saxon/trans/LicenseException.class')).toBe(false);
    expect(result.artifacts.find(item => item.artifactId === 'cli')).toMatchObject({ selectedLicense: 'MPL-2.0', sourceArtifact: 'https://repo.maven.apache.org/maven2/org/verapdf/apps/cli/1.30.3/cli-1.30.3-sources.jar' });
    expect(result.artifacts.find(item => item.artifactId === 'verapdf-xmp-core')).toMatchObject({ selectedLicense: null });
    expect(result.artifacts.find(item => item.artifactId === 'verapdf-xmp-core')?.licensingNote).toContain('BSD');
    expect(result.artifacts.find(item => item.artifactId === 'separate')).toMatchObject({ selectedLicense: null, sourceArtifact: null });
  });

  it('rejects an unreviewed installed CLI before writing notices or running any process', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bivaro-verapdf-notices-unit-'));
    roots.push(root);
    await mkdir(path.join(root, 'bin'));
    await writeFile(path.join(root, 'bin/cli-1.30.3.jar'), 'not the reviewed JAR');
    await expect(writeVerapdfNotices(root, VERAPDF_ASSET)).rejects.toThrow('notice-reviewed artifact');
    expect(VERAPDF_CLI_SHA256).toBe('19f6edd5c92841a38d9b3b018a555b7ba173b13e4e0d29edecc232e5ba6c1d70');
  });
});
