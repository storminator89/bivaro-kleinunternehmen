import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const temporary: string[] = [];
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
afterEach(async () => { await Promise.all(temporary.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'bivaro-image-notices-unit-'));
  temporary.push(root);
  const app = path.join(root, 'app');
  const vera = path.join(root, 'verapdf');
  async function file(base: string, relative: string, text: string) {
    await mkdir(path.dirname(path.join(base, relative)), { recursive: true });
    await writeFile(path.join(base, relative), text);
  }
  const pdfkit = 'Synthetic PDFKit notice, never an actual attribution grant.';
  const font = 'Synthetic OFL fixture, never an actual font.';
  const cli = 'Synthetic JAR marker, never executed.';
  const applicationLicense = 'Synthetic application license, not a grant.';
  const recoveredNotice = 'Synthetic recovered upstream notice.';
  const runtime = '// Synthetic inert asset, never executed.';
  const recovered = { schemaVersion: 1, files: [{ file: 'licenses/recovered/NOTICE', sha256: hash(recoveredNotice) }], verifiedRuntimeFiles: [{ file: 'node_modules/pdfjs-dist/wasm/synthetic.js', sha256: hash(runtime) }], limitations: ['Synthetic unresolved provenance.'] };
  const recoveredBytes = JSON.stringify(recovered);
  const expected = { pdfkit: hash(pdfkit), font: hash(font), cli: hash(cli), applicationLicense: hash(applicationLicense), supplemental: hash(recoveredBytes) };
  const packages = [
    { name: 'pdfkit', version: '0.20.2', metadata: 'licenses/npm/pdfkit/package.json', notices: [{ file: 'licenses/npm/pdfkit/LICENSE', sha256: expected.pdfkit }], limitations: [] },
    { name: 'fontkit', version: '2.0.4', metadata: 'licenses/npm/fontkit/package.json', notices: [], limitations: ['Missing upstream text.'] },
    { name: 'pdfjs-dist', version: '6.4.299', metadata: 'licenses/npm/pdfjs-dist/package.json',
      notices: ['LICENSE', 'cmaps/LICENSE', 'iccs/LICENSE', 'standard_fonts/LICENSE_FOXIT', 'standard_fonts/LICENSE_LIBERATION',
        ...['JBIG2', 'OPENJPEG', 'PDFJS_JBIG2', 'PDFJS_OPENJPEG', 'PDFJS_QCMS', 'QCMS'].map(name => `wasm/LICENSE_${name}`)]
        .map(file => ({ file: `licenses/npm/pdfjs-dist/${file}`, sha256: hash('Synthetic separate PDF.js resource license.') })), limitations: [] },
  ];
  for (const item of packages) await file(app, item.metadata, JSON.stringify({ name: item.name, version: item.version, license: 'MIT' }));
  for (const notice of packages[2].notices) await file(app, notice.file, 'Synthetic separate PDF.js resource license.');
  await file(app, 'licenses/npm/pdfkit/LICENSE', pdfkit);
  await file(app, 'LICENSE', applicationLicense);
  await file(app, 'licenses/recovered/NOTICE', recoveredNotice);
  await file(app, 'licenses/third-party-sources.json', recoveredBytes);
  await file(app, 'node_modules/pdfjs-dist/wasm/synthetic.js', runtime);
  await file(app, 'licenses/invoice-fonts/FONT-LICENSE.txt', font);
  await file(app, 'public/fonts/invoice/FONT-LICENSE.txt', font);
  await file(app, 'THIRD_PARTY_NOTICES.txt', 'Synthetic: attribution remains unresolved.');
  const npm = { schemaVersion: 1, roots: { pdfkit: '0.20.2', fontkit: '2.0.4', 'pdfjs-dist': '6.4.299' }, packages,
    application: { declaredLicense: 'Apache-2.0', file: 'LICENSE', sha256: expected.applicationLicense },
    supplemental: { file: 'licenses/third-party-sources.json', sha256: expected.supplemental, noticeFiles: 1, verifiedRuntimeFiles: 1 },
    scope: 'not an application/container SBOM', limitations: ['Synthetic incomplete inventory.'] };
  await file(app, 'THIRD_PARTY_SOURCES.json', JSON.stringify(npm));
  const modules = ['org.verapdf.apps:apps', 'org.verapdf.apps:cli', ...['core', 'feature-reporting', 'metadata-fixer', 'parser', 'pdf-model', 'validation-model', 'verapdf-xmp-core'].map(name => `org.verapdf:${name}`)];
  const artifacts = modules.map(coordinate => {
    const [groupId, artifactId] = coordinate.split(':');
    return { groupId, artifactId, version: '1.30.3', selectedLicense: artifactId === 'verapdf-xmp-core' ? null : 'MPL-2.0', sourceArtifact: `https://repo.maven.apache.org/maven2/${groupId.replaceAll('.', '/')}/${artifactId}/1.30.3/${artifactId}-1.30.3-sources.jar` };
  });
  const licenses = ['licenses/MPL-2.0.txt', 'licenses/GPL-3.0.txt'];
  for (const license of licenses) await file(vera, license, 'Synthetic license fixture: ' + license);
  await file(vera, 'bin/cli-1.30.3.jar', cli);
  await file(vera, 'THIRD-PARTY-NOTICES.txt', 'Synthetic separate-license notice.');
  const verifier = { schemaVersion: 1, veraPDF: { version: '1.30.3', binary: 'bin/cli-1.30.3.jar', binarySha256: expected.cli, selectedLicense: 'MPL-2.0 for dual-licensed veraPDF components, not the entire shaded JAR', license: 'licenses/MPL-2.0.txt' }, artifacts, copiedFiles: licenses.map(file => ({ file, sha256: hash('Synthetic license fixture: ' + file) })), scope: 'incomplete inventory', limitations: ['Synthetic incomplete source coverage.'] };
  await file(vera, 'THIRD_PARTY_SOURCES.json', JSON.stringify(verifier));
  return { root, app, vera, expected, npm, verifier };
}

async function run(input: Awaited<ReturnType<typeof fixture>>, overrides = true) {
  const source = await readFile(new URL('../own-invoice-pdfa/container-smoke.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('// BEGIN isolated runtime-notice inspection');
  const end = source.indexOf('// END isolated runtime-notice inspection.');
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  // Evaluate only the exact exported inspection function plus builtin imports.
  // The full smoke module, main(), native tools, server and database never run.
  const isolatedModule = `import assert from 'node:assert/strict';\nimport { createHash } from 'node:crypto';\nimport { constants } from 'node:fs';\nimport { lstat, open, realpath } from 'node:fs/promises';\nimport path from 'node:path';\n${source.slice(start, end)}\nconsole.log(JSON.stringify(await inspectRuntimeNotices(process.argv[2],process.argv[3],${overrides ? 'JSON.parse(process.argv[4])' : 'undefined'})));`;
  return spawnSync(process.execPath, ['--input-type=module', '-', input.app, input.vera, JSON.stringify(input.expected)], {
    input: isolatedModule, env: { PATH: path.dirname(process.execPath), NODE_ENV: 'test' }, encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024,
  });
}

describe('read-only actual-image notice assertion logic (isolated function; synthetic files only)', () => {
  it('returns only a compact hash/count summary and leaves fixed image roots/default pins in the real invocation', async () => {
    const input = await fixture();
    const result = await run(input);
    expect(result.status, result.stderr).toBe(0);
    const evidence = JSON.parse(result.stdout);
    expect(evidence).toMatchObject({ status: 'passed', npmPackages: 3, npmNoticeFiles: 12, recoveredNoticeFiles: 1, verifiedRuntimeFiles: 1, supplementalSha256: input.expected.supplemental, applicationLicenseSha256: input.expected.applicationLicense, veraCopiedFiles: 2, veraSourceModules: 9, cliSha256: input.expected.cli, explicitAuditLimitsRetained: true });
    expect(result.stdout.length).toBeLessThan(1800);
    expect(result.stdout).not.toContain('Synthetic');
    const source = await readFile(new URL('../own-invoice-pdfa/container-smoke.mjs', import.meta.url), 'utf8');
    expect(source).toContain("const runtimeNotices = await inspectRuntimeNotices('/app', '/opt/verapdf');");
    expect(source).toContain("status: 'passed', syntheticIsolatedFixture: true, ...platform, runtimeNotices,");
    const fixed = await run(input, false);
    expect(fixed.status).not.toBe(0);
    expect(fixed.stderr).toContain('Application license changed or missing.');
  });

  it('rejects missing notice files', async () => {
    const input = await fixture();
    await unlink(path.join(input.app, 'THIRD_PARTY_NOTICES.txt'));
    expect((await run(input)).stderr).toContain('ENOENT');
  });

  it.each(['npm', 'embedded', 'binary', 'application', 'recovered', 'runtime', 'manifest'])('rejects tampered %s bytes', async kind => {
    const input = await fixture();
    const appPaths: Record<string, string> = { npm: 'licenses/npm/pdfkit/LICENSE', application: 'LICENSE', recovered: 'licenses/recovered/NOTICE', runtime: 'node_modules/pdfjs-dist/wasm/synthetic.js', manifest: 'licenses/third-party-sources.json' };
    const target = appPaths[kind] ? path.join(input.app, appPaths[kind]) : path.join(input.vera, kind === 'embedded' ? 'licenses/MPL-2.0.txt' : 'bin/cli-1.30.3.jar');
    await writeFile(target, 'Tampered synthetic bytes.');
    const result = await run(input);
    expect(result.status).not.toBe(0);
    const errors: Record<string, string> = { npm: 'Recorded npm notice hash mismatch.', embedded: 'Embedded notice hash mismatch.', binary: 'Pinned veraPDF CLI hash mismatch.', application: 'Application license changed or missing.', recovered: 'Recovered-notice/runtime hash mismatch.', runtime: 'Recovered-notice/runtime hash mismatch.', manifest: 'Recovered-notice manifest changed.' };
    expect(result.stderr).toContain(errors[kind]);
  });

  it('rejects manifest path escapes before reading outside a root', async () => {
    const input = await fixture();
    input.npm.packages[0].metadata = 'licenses/npm/../../../outside.json';
    await writeFile(path.join(input.app, 'THIRD_PARTY_SOURCES.json'), JSON.stringify(input.npm));
    const result = await run(input);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Unsafe notice path.');
  });

  it.each(['package', 'notice'])('rejects omitted PDF.js %s inventory entries', async kind => {
    const input = await fixture();
    if (kind === 'package') input.npm.packages.pop();
    else input.npm.packages[2].notices.pop();
    await writeFile(path.join(input.app, 'THIRD_PARTY_SOURCES.json'), JSON.stringify(input.npm));
    expect((await run(input)).stderr).toContain(kind === 'package' ? 'Missing PDF.js notice package.' : 'Incomplete PDF.js separate-resource notices.');
  });

  it.each(['file', 'directory'])('rejects a symlinked %s path component', async kind => {
    const input = await fixture();
    const target = path.join(input.app, kind === 'file' ? 'licenses/npm/pdfkit/LICENSE' : 'licenses/npm');
    const moved = path.join(input.root, kind === 'file' ? 'external-license.txt' : 'external-licenses');
    await rename(target, moved);
    await symlink(moved, target, kind === 'file' ? 'file' : 'dir');
    const result = await run(input);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Notice symlink traversal is forbidden.');
  });

  it('bounds file size before allocating/reading notice content', async () => {
    const input = await fixture();
    await writeFile(path.join(input.app, 'THIRD_PARTY_SOURCES.json'), 'x'.repeat(512 * 1024 + 1));
    const result = await run(input);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Notice file exceeded its bound.');
  });

  it('rejects a blanket MPL selection for the separately treated XMP module', async () => {
    const input = await fixture();
    input.verifier.artifacts.find(item => item.artifactId === 'verapdf-xmp-core')!.selectedLicense = 'MPL-2.0';
    await writeFile(path.join(input.vera, 'THIRD_PARTY_SOURCES.json'), JSON.stringify(input.verifier));
    const result = await run(input);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Wrong module source/license mapping.');
  });
});
