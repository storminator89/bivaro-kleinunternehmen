#!/usr/bin/env node
/** Offline, build-time notice inventory for the PDFKit/fontkit runtime closure. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REQUIRED = Object.freeze({ pdfkit: '0.20.2', fontkit: '2.0.4' });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const relative = (root, target) => path.relative(root, target).split(path.sep).join('/');
const noticeName = name => /^(?:licen[cs]e|notice|copying|copyright)(?:[._-].*)?$/iu.test(name);

async function resolvePackage(name, from, root) {
  if (!/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/iu.test(name)) throw new Error('Invalid dependency name.');
  let current = from;
  while (current === root || current.startsWith(root + path.sep)) {
    const candidate = path.join(current, 'node_modules', name);
    try {
      await stat(path.join(candidate, 'package.json'));
      return candidate;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (current === root) break;
    current = path.dirname(current);
  }
  throw new Error(`Missing PDF runtime dependency: ${name}`);
}

export async function collectPdfNotices(projectRoot = ROOT) {
  const lock = JSON.parse(await readFile(path.join(projectRoot, 'package-lock.json'), 'utf8'));
  const files = new Map();
  const packages = new Map();
  async function visit(name, from) {
    const directory = await resolvePackage(name, from, projectRoot);
    const location = relative(projectRoot, directory);
    if (packages.has(location)) return;
    const bytes = await readFile(path.join(directory, 'package.json'));
    const metadata = JSON.parse(bytes);
    const locked = lock.packages?.[location];
    if (metadata.name !== name || !locked || locked.version !== metadata.version) {
      throw new Error(`PDF dependency does not match lockfile: ${location}`);
    }
    if (REQUIRED[name] && metadata.version !== REQUIRED[name]) throw new Error(`Review PDF notices for ${name} ${metadata.version}.`);
    const prefix = `licenses/npm/${location.slice('node_modules/'.length)}`;
    files.set(`${prefix}/package.json`, bytes);
    const entries = (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isFile());
    const names = entries.filter(entry => noticeName(entry.name)).map(entry => entry.name).sort();
    const notices = [];
    for (const filename of names) {
      const content = await readFile(path.join(directory, filename));
      const destination = `${prefix}/${filename}`;
      files.set(destination, content);
      notices.push({ file: destination, sha256: digest(content) });
    }
    // Some upstream packages publish only an MIT declaration, not a LICENSE.
    // Preserve the actual declaration rather than fabricate a copyright grant.
    if (names.length === 0) {
      for (const entry of entries.filter(entry => /^readme(?:[._-].*)?$/iu.test(entry.name))) {
        files.set(`${prefix}/${entry.name}`, await readFile(path.join(directory, entry.name)));
      }
    }
    const record = {
      name, version: metadata.version, installedPath: location,
      declaredLicense: metadata.license ?? null,
      declaredRepository: metadata.repository ?? null,
      packageArchive: locked.resolved ?? null,
      packageIntegrity: locked.integrity ?? null,
      metadata: `${prefix}/package.json`, notices,
      limitations: names.length ? [] : ['Upstream package contains no root license/copyright text. Copied metadata/README declarations are not a substitute for missing upstream attribution.'],
    };
    packages.set(location, record);
    for (const dependency of Object.keys(metadata.dependencies ?? {}).sort()) await visit(dependency, directory);
  }
  for (const name of Object.keys(REQUIRED).sort()) await visit(name, projectRoot);
  const fonts = [];
  for (const filename of ['BivaroSans-Bold.ttf', 'BivaroSans-Regular.ttf', 'FONT-LICENSE.txt', 'README.md']) {
    const source = `public/fonts/invoice/${filename}`;
    const bytes = await readFile(path.join(projectRoot, source));
    fonts.push({ file: source, sha256: digest(bytes) });
    if (!filename.endsWith('.ttf')) files.set(`licenses/invoice-fonts/${filename}`, bytes);
  }
  files.set('licenses/MIT-reference.txt', await readFile(new URL('./MIT-reference.txt', import.meta.url)));
  const manifest = {
    schemaVersion: 1,
    scope: 'PDFKit/fontkit declared npm dependency closure and invoice fonts only; not an application/container SBOM or legal clearance.',
    roots: REQUIRED,
    packages: [...packages.values()].sort((a, b) => a.installedPath.localeCompare(b.installedPath, 'en')),
    invoiceFonts: { declaredLicense: 'OFL-1.1', originalNotice: 'licenses/invoice-fonts/FONT-LICENSE.txt', files: fonts },
    externalRuntime: {
      veraPDF: { version: '1.30.3', notices: '/opt/verapdf/THIRD-PARTY-NOTICES.txt', sources: '/opt/verapdf/THIRD_PARTY_SOURCES.json' },
    },
    limitations: [
      'Original package license/copyright/notice files are copied byte-for-byte. MIT-reference.txt is the SPDX v3.26.0 template, with unfilled placeholders, not a recovered fontkit/brotli/dfa copyright notice.',
      'Package archive URLs/integrities identify the locked npm distributions; declared repositories are not verified exact source revisions or a complete inventory of code bundled inside a package.',
      'Missing upstream license/copyright texts (including fontkit 2.0.4) remain unresolved and require upstream clarification before claiming complete distribution compliance.',
      'Audit the final image separately: Debian/JRE, existing npm/native dependencies (including sharp/libvips), PDF.js fonts and Canvas native/transitive components if introduced, veraPDF shaded dependencies/resources, and other validators.',
      'No project license change or conclusion about the right to relicense Bivaro is made by this inventory.',
    ],
  };
  const notices = [
    'THIRD-PARTY NOTICES — scoped PDF generation runtime inventory',
    manifest.scope, '',
    'PDFKit 0.20.2: MIT. Its exact upstream LICENSE is included below licenses/npm/pdfkit/.',
    'fontkit 2.0.4: upstream declares MIT, but publishes no full license/copyright text. Exact package/README declarations are retained; attribution remains unresolved.',
    'Invoice fonts remain OFL-1.1; the original FONT-LICENSE.txt is preserved unchanged alongside the fonts and in licenses/invoice-fonts/.',
    'veraPDF 1.30.3: select MPL-2.0 for the components offered as GPLv3+ OR MPLv2+; this selection does not relicense separately licensed dependencies.',
    'For veraPDF source locations, exact embedded notices and incomplete shaded-artifact inventory, see /opt/verapdf/THIRD_PARTY_SOURCES.json and /opt/verapdf/THIRD-PARTY-NOTICES.txt.',
    'Source and version inventory: THIRD_PARTY_SOURCES.json. License texts: licenses/.', '',
    ...manifest.packages.map(item => `${item.name} ${item.version} — declared license: ${item.declaredLicense ?? 'not declared; inspect copied LICENSE'}; ${item.notices.length ? item.notices.map(n => n.file).join(', ') : 'NO UPSTREAM LICENSE TEXT; inspect copied declarations'}`),
    '', 'Remaining limitations:', ...manifest.limitations.map(item => `- ${item}`), '',
    'MIT reference template source: https://raw.githubusercontent.com/spdx/license-list-data/v3.26.0/text/MIT.txt', '',
  ].join('\n');
  files.set('THIRD_PARTY_SOURCES.json', Buffer.from(json(manifest)));
  files.set('THIRD_PARTY_NOTICES.txt', Buffer.from(notices));
  return { manifest, files };
}

export async function writePdfNotices(projectRoot = ROOT, destination = path.join(projectRoot, '.next/standalone')) {
  // The caller must supply the built standalone root; never silently create it.
  if (!(await stat(path.join(destination, 'server.js'))).isFile()) throw new Error('Built standalone server is required.');
  const inventory = await collectPdfNotices(projectRoot);
  for (const [filename, bytes] of [...inventory.files].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    const target = path.join(destination, filename);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes, { mode: 0o644 });
  }
  return inventory.manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await writePdfNotices();
