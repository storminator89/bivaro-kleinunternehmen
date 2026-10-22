#!/usr/bin/env node
/** Offline, bounded build-time notice inventory; never a bundle-wide clearance. */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REQUIRED = Object.freeze({ pdfkit: '0.20.2', fontkit: '2.0.4', 'pdfjs-dist': '6.4.299' });
const REVIEWED = Object.freeze({ ...REQUIRED, brotli: '1.3.3' });
const SUPPLEMENTAL = 'licenses/third-party-sources.json';
const PDFJS_NOTICE_DIRECTORIES = ['cmaps', 'iccs', 'standard_fonts', 'wasm'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const relative = (root, target) => path.relative(root, target).split(path.sep).join('/');
const noticeName = name => /^(?:licen[cs]e|notice|copying|copyright)(?:[._-].*)?$/iu.test(name);

function safePath(root, filename) {
  if (typeof filename !== 'string' || filename.length > 1024 || path.isAbsolute(filename)
    || filename.includes('\\') || filename.includes('\0')
    || !filename.split('/').every(part => part && part !== '.' && part !== '..')) throw new Error('Unsafe notice path.');
  return path.join(root, filename);
}

async function regularPath(root, filename, createDirectories = false) {
  const target = safePath(root, filename);
  if (!(await lstat(root)).isDirectory() || await realpath(root) !== root) throw new Error('Unsafe notice root.');
  const parts = filename.split('/');
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    if (createDirectories && index < parts.length - 1) await mkdir(current).catch(error => { if (error.code !== 'EEXIST') throw error; });
    let info;
    try { info = await lstat(current); } catch (error) {
      if (createDirectories && index === parts.length - 1 && error.code === 'ENOENT') break;
      throw error;
    }
    if (info.isSymbolicLink() || !(index === parts.length - 1 ? info.isFile() : info.isDirectory())) throw new Error('Notice path is not regular.');
  }
  return target;
}

async function readRegular(root, filename, maximum = 2 * 1024 * 1024) {
  const handle = await open(await regularPath(root, filename), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size <= 0 || info.size > maximum) throw new Error('Notice input exceeded its bound.');
    const bytes = Buffer.alloc(info.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, null);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length !== info.size) throw new Error('Notice input changed while reading.');
    return bytes.subarray(0, length);
  } finally { await handle.close(); }
}

async function collectSupplemental(projectRoot, files) {
  const bytes = await readRegular(projectRoot, SUPPLEMENTAL, 256 * 1024);
  const manifest = JSON.parse(bytes);
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 128
    || !Array.isArray(manifest.verifiedRuntimeFiles) || manifest.verifiedRuntimeFiles.length > 32
    || !Array.isArray(manifest.limitations) || !manifest.limitations.length) throw new Error('Invalid supplemental notice inventory.');
  const seen = new Set([SUPPLEMENTAL]);
  for (const item of manifest.files) {
    if (!item.file?.startsWith('licenses/') || seen.has(item.file) || !/^[a-f0-9]{64}$/u.test(item.sha256)
      || !/^https:\/\//u.test(item.source) || !/^[a-f0-9]{64}$/u.test(item.sourceSha256)) throw new Error('Invalid supplemental notice record.');
    const content = await readRegular(projectRoot, item.file, 256 * 1024);
    if (digest(content) !== item.sha256) throw new Error(`Supplemental notice hash mismatch: ${item.file}`);
    seen.add(item.file);
    files.set(item.file, content);
  }
  for (const item of manifest.verifiedRuntimeFiles) {
    if (!item.file?.startsWith('node_modules/') || seen.has(item.file) || !/^[a-f0-9]{64}$/u.test(item.sha256)) throw new Error('Invalid supplemental runtime record.');
    if (digest(await readRegular(projectRoot, item.file)) !== item.sha256) throw new Error(`Reviewed runtime source changed: ${item.file}`);
    seen.add(item.file);
  }
  files.set(SUPPLEMENTAL, bytes);
  return { file: SUPPLEMENTAL, sha256: digest(bytes), noticeFiles: manifest.files.length, verifiedRuntimeFiles: manifest.verifiedRuntimeFiles.length };
}

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
  // Directory URLs keep their trailing separator; traversal boundaries must not.
  projectRoot = path.resolve(projectRoot);
  const lock = JSON.parse(await readRegular(projectRoot, 'package-lock.json', 4 * 1024 * 1024));
  const files = new Map();
  const packages = new Map();
  async function visit(name, from) {
    const directory = await resolvePackage(name, from, projectRoot);
    const location = relative(projectRoot, directory);
    if (packages.has(location)) return;
    const bytes = await readRegular(projectRoot, `${location}/package.json`);
    const metadata = JSON.parse(bytes);
    const locked = lock.packages?.[location];
    if (metadata.name !== name || !locked || locked.version !== metadata.version) {
      throw new Error(`PDF dependency does not match lockfile: ${location}`);
    }
    if (REVIEWED[name] && metadata.version !== REVIEWED[name]) throw new Error(`Review PDF notices for ${name} ${metadata.version}.`);
    const prefix = `licenses/npm/${location.slice('node_modules/'.length)}`;
    files.set(`${prefix}/package.json`, bytes);
    const rootEntries = await readdir(directory, { withFileTypes: true });
    if (rootEntries.some(entry => entry.isSymbolicLink() && (noticeName(entry.name) || /^readme(?:[._-].*)?$/iu.test(entry.name)))) throw new Error('Notice path is not regular.');
    const entries = rootEntries.filter(entry => entry.isFile());
    const names = entries.filter(entry => noticeName(entry.name)).map(entry => entry.name).sort();
    // These shipped PDF.js resources have separate original licenses. Keep
    // them separate; the npm package's Apache label is not a blanket license.
    if (name === 'pdfjs-dist') {
      for (const subdirectory of PDFJS_NOTICE_DIRECTORIES) {
        if (!(await lstat(path.join(directory, subdirectory))).isDirectory()) throw new Error('Notice path is not regular.');
        const children = await readdir(path.join(directory, subdirectory), { withFileTypes: true });
        if (children.some(entry => entry.isSymbolicLink() && noticeName(entry.name))) throw new Error('Notice path is not regular.');
        names.push(...children.filter(entry => entry.isFile() && noticeName(entry.name)).map(entry => `${subdirectory}/${entry.name}`).sort());
      }
    }
    const notices = [];
    for (const filename of names) {
      const content = await readRegular(projectRoot, `${location}/${filename}`);
      const destination = `${prefix}/${filename}`;
      files.set(destination, content);
      notices.push({ file: destination, sha256: digest(content) });
    }
    // Some upstream packages publish only an MIT declaration, not a LICENSE.
    // Preserve the actual declaration rather than fabricate a copyright grant.
    if (names.length === 0) {
      for (const entry of entries.filter(entry => /^readme(?:[._-].*)?$/iu.test(entry.name))) {
        files.set(`${prefix}/${entry.name}`, await readRegular(projectRoot, `${location}/${entry.name}`));
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
    const bytes = await readRegular(projectRoot, source);
    fonts.push({ file: source, sha256: digest(bytes) });
    if (!filename.endsWith('.ttf')) files.set(`licenses/invoice-fonts/${filename}`, bytes);
  }
  files.set('licenses/MIT-reference.txt', await readFile(new URL('./MIT-reference.txt', import.meta.url)));
  const applicationMetadata = JSON.parse(await readRegular(projectRoot, 'package.json'));
  if (applicationMetadata.license !== lock.packages?.['']?.license) throw new Error('Application license metadata does not match lockfile.');
  const applicationLicense = await readRegular(projectRoot, 'LICENSE', 256 * 1024);
  files.set('LICENSE', applicationLicense);
  const supplemental = await collectSupplemental(projectRoot, files);
  const manifest = {
    schemaVersion: 1,
    scope: 'PDFKit/fontkit declared npm dependency closure, PDF.js shipped notices, invoice fonts and bounded recovered upstream notices; not an application/container SBOM or legal clearance.',
    roots: REQUIRED,
    application: { declaredLicense: applicationMetadata.license, file: 'LICENSE', sha256: digest(applicationLicense) },
    supplemental,
    packages: [...packages.values()].sort((a, b) => a.installedPath.localeCompare(b.installedPath, 'en')),
    invoiceFonts: { declaredLicense: 'OFL-1.1', originalNotice: 'licenses/invoice-fonts/FONT-LICENSE.txt', files: fonts },
    externalRuntime: {
      veraPDF: { version: '1.30.3', notices: '/opt/verapdf/THIRD-PARTY-NOTICES.txt', sources: '/opt/verapdf/THIRD_PARTY_SOURCES.json' },
    },
    limitations: [
      'Original package license/copyright/notice files are copied byte-for-byte. MIT-reference.txt is the SPDX v3.26.0 template, with unfilled placeholders, not a recovered fontkit/brotli/dfa copyright notice.',
      'Package archive URLs/integrities identify the locked npm distributions; declared repositories are not verified exact source revisions or a complete inventory of code bundled inside a package.',
      'Missing upstream license/copyright texts (including fontkit 2.0.4) remain unresolved and require upstream clarification before claiming complete distribution compliance.',
      'PDF.js nested resource notices are retained under their separate original terms; Canvas optional/native/transitive components, sharp/libvips, Debian/JRE, veraPDF shaded dependencies/resources and other validators still need a separate final-image audit.',
      'Recovered source-bound Brotli decoder headers do not resolve its missing wrapper MIT attribution. QuickJS compiler/libc-runtime provenance remains unresolved; its wrapper notice was supplied later upstream, not present as a license file at build time. See licenses/third-party-sources.json.',
      'No project license change or conclusion about the right to relicense Bivaro is made by this inventory.',
    ],
  };
  const notices = [
    'THIRD-PARTY NOTICES — scoped PDF generation runtime inventory',
    manifest.scope, '',
    `Application: ${applicationMetadata.license}; original current root LICENSE is included unchanged. Foreign components retain their own licenses.`,
    'PDFKit 0.20.2: MIT. Its exact upstream LICENSE is included below licenses/npm/pdfkit/.',
    'fontkit 2.0.4: upstream declares MIT, but publishes no full license/copyright text. Exact package/README declarations are retained; attribution remains unresolved.',
    'Invoice fonts remain OFL-1.1; the original FONT-LICENSE.txt is preserved unchanged alongside the fonts and in licenses/invoice-fonts/.',
    'veraPDF 1.30.3: select MPL-2.0 for the components offered as GPLv3+ OR MPLv2+; this selection does not relicense separately licensed dependencies.',
    'For veraPDF source locations, exact embedded notices and incomplete shaded-artifact inventory, see /opt/verapdf/THIRD_PARTY_SOURCES.json and /opt/verapdf/THIRD-PARTY-NOTICES.txt.',
    'Source and version inventory: THIRD_PARTY_SOURCES.json. License texts: licenses/.', '',
    'shadcn/ui copied scaffolds: exact original MIT notice in licenses/shadcn-ui/LICENSE.md (Copyright (c) 2023 shadcn).',
    'Brotli 1.3.3: seven exact Google-2013 Apache-2.0 decoder headers and complete Apache text in licenses/brotli/. Package wrapper metadata still declares MIT; missing wrapper attribution remains unresolved.',
    'PDF.js 6.4.299 QuickJS assets: original engine MIT LICENSE and source-file headers in licenses/quickjs/, including separate dtoa 2024 attribution. Assets are unchanged.',
    'LICENSE_PDFJS_QUICKJS is a subsequently supplied official wrapper project notice, not an original asset-build file. Exact compiler/libc-runtime provenance remains unresolved.',
    'Recovered notice source URLs, full-source and extracted-notice hashes, build pins, and explicit limits: licenses/third-party-sources.json.', '',
    ...manifest.packages.map(item => `${item.name} ${item.version} — declared license: ${item.declaredLicense ?? 'not declared; inspect copied LICENSE'}; ${item.notices.length ? item.notices.map(n => n.file).join(', ') : 'NO UPSTREAM LICENSE TEXT; inspect copied declarations'}`),
    '', 'Remaining limitations:', ...manifest.limitations.map(item => `- ${item}`), '',
    'MIT reference template source: https://raw.githubusercontent.com/spdx/license-list-data/v3.26.0/text/MIT.txt', '',
  ].join('\n');
  files.set('THIRD_PARTY_SOURCES.json', Buffer.from(json(manifest)));
  files.set('THIRD_PARTY_NOTICES.txt', Buffer.from(notices));
  return { manifest, files };
}

export async function writePdfNotices(projectRoot = ROOT, destination = path.join(projectRoot, '.next/standalone')) {
  projectRoot = path.resolve(projectRoot);
  destination = path.resolve(destination);
  // The caller must supply the built standalone root; never silently create it.
  await regularPath(destination, 'server.js');
  const inventory = await collectPdfNotices(projectRoot);
  for (const [filename, bytes] of [...inventory.files].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    const target = await regularPath(destination, filename, true);
    // Check the opened inode before truncating: an old artifact must not be a
    // hard link that would modify a source file or another distribution.
    const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o644);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1) throw new Error('Notice output must be a single-link regular file.');
      await handle.truncate(0);
      await handle.writeFile(bytes);
    } finally { await handle.close(); }
  }
  return inventory.manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await writePdfNotices();
