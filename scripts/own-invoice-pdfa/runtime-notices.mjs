/** Offline notice/source inventory of the unchanged, pinned veraPDF CLI JAR. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

export const VERAPDF_CLI_SHA256 = '19f6edd5c92841a38d9b3b018a555b7ba173b13e4e0d29edecc232e5ba6c1d70';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const veraSources = Object.freeze({
  'org.verapdf.apps:cli': 'veraPDF-apps',
  'org.verapdf.apps:apps': 'veraPDF-apps',
  'org.verapdf:parser': 'veraPDF-parser',
  'org.verapdf:metadata-fixer': 'veraPDF-validation',
  'org.verapdf:feature-reporting': 'veraPDF-validation',
  'org.verapdf:validation-model': 'veraPDF-validation',
  'org.verapdf:pdf-model': 'veraPDF-model',
  'org.verapdf:core': 'veraPDF-library',
  'org.verapdf:verapdf-xmp-core': 'veraPDF-library',
});
const json = value => JSON.stringify(value, null, 2) + '\n';

export async function collectVerapdfMetadata(zip) {
  const files = new Map();
  const artifacts = [];
  for (const name of Object.keys(zip.files).sort()) {
    const entry = zip.files[name];
    if (entry.dir) continue;
    const metadata = name === 'META-INF/MANIFEST.MF' || /^META-INF\/maven\/[^/]+\/[^/]+\/pom\.(?:xml|properties)$/u.test(name);
    const notice = /(?:^|\/)[^/]*(?:licen[cs]e|notice|copying|copyright)[^/]*$/iu.test(name) && !name.endsWith('.class');
    if (!metadata && !notice) continue;
    if (name.split('/').some(part => part === '..' || part === '.') || name.startsWith('/') || name.includes('\\')) throw new Error('Unsafe veraPDF metadata path.');
    const bytes = await entry.async('nodebuffer');
    const destination = `licenses/embedded/${name}`;
    files.set(destination, bytes);
    if (!name.endsWith('/pom.properties')) continue;
    const properties = Object.fromEntries(bytes.toString('utf8').split(/\r?\n/u)
      .filter(line => line && !line.startsWith('#')).map(line => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      }));
    const { groupId, artifactId, version } = properties;
    if (![groupId, artifactId, version].every(value => value && /^[a-z0-9_.-]+$/iu.test(value))) throw new Error('Invalid embedded Maven coordinates.');
    const key = `${groupId}:${artifactId}`;
    const repository = veraSources[key];
    artifacts.push({
      groupId, artifactId, version, evidence: destination,
      // These are the published source artifacts matching embedded coordinates,
      // not a claim that Maven metadata enumerates every shaded component.
      sourceArtifact: repository ? `https://repo.maven.apache.org/maven2/${groupId.replaceAll('.', '/')}/${artifactId}/${version}/${artifactId}-${version}-sources.jar` : null,
      upstreamRepository: repository ? `https://github.com/veraPDF/${repository}` : null,
      selectedLicense: repository && artifactId !== 'verapdf-xmp-core' ? 'MPL-2.0' : null,
      licensingNote: artifactId === 'verapdf-xmp-core'
        ? 'Embedded POM declares BSD 3-Clause while its header offers GPLv3+ OR MPLv2+; preserve both notices and audit source-file licenses, do not relicense this module en bloc.'
        : repository ? 'MPL-2.0 alternative selected for veraPDF code offered under GPLv3+ OR MPLv2+; separately licensed code remains under its own terms.'
          : 'Separate dependency: inspect original embedded POM/notices. No license selection or complete source mapping asserted here.',
    });
  }
  return { files, artifacts };
}

export async function writeVerapdfNotices(destination, asset) {
  const jar = await readFile(path.join(destination, 'bin', `cli-${asset.version}.jar`));
  if (digest(jar) !== VERAPDF_CLI_SHA256) throw new Error('Installed veraPDF CLI differs from the notice-reviewed artifact.');
  const zip = await JSZip.loadAsync(jar, { checkCRC32: true });
  const inventory = await collectVerapdfMetadata(zip);
  for (const filename of ['GPL-3.0.txt', 'MPL-2.0.txt']) {
    inventory.files.set(`licenses/${filename}`, await readFile(new URL(`./licenses/${filename}`, import.meta.url)));
  }
  const manifest = {
    schemaVersion: 1,
    scope: 'Observed metadata/notices in pinned official veraPDF CLI; incomplete inventory of shaded dependencies and resources, not a complete SBOM or legal clearance.',
    veraPDF: {
      version: asset.version, archive: asset.url, archiveSha256: asset.sha256,
      binary: `bin/cli-${asset.version}.jar`, binarySha256: VERAPDF_CLI_SHA256,
      selectedLicense: 'MPL-2.0 for dual-licensed veraPDF components, not the entire shaded JAR',
      license: 'licenses/MPL-2.0.txt', alternativeUpstreamLicense: 'licenses/GPL-3.0.txt',
      modified: false,
      sourceInstructions: 'Source Code Form for inventoried veraPDF modules is available without charge from the versioned upstream Maven -sources.jar URLs below. Preserve the original source notices and MPL terms. These URLs do not assert complete shaded-dependency source coverage.',
      licensingEvidence: 'https://github.com/veraPDF/veraPDF-apps/blob/v1.30.3/README.md',
    },
    artifacts: inventory.artifacts,
    copiedFiles: [...inventory.files].map(([file, bytes]) => ({ file, sha256: digest(bytes) })).sort((a, b) => a.file.localeCompare(b.file, 'en')),
    limitations: [
      'Maven metadata survives only for some classes in the shaded CLI. Embedded license files may have been overwritten upstream during JAR assembly; copying surviving files is not proof of complete attribution.',
      'Shaded code without complete coordinates/source mapping includes namespaces org/mozilla/javascript (Rhino), net/sf/saxon (Saxon), org/xmlresolver, com/beust/jcommander and javanet/staxutils. Their source/version/license coverage requires a separate final-artifact audit.',
      'Source URLs identify published source artifacts for exact embedded coordinates; no source-to-binary reproducibility or completeness audit has been performed.',
      'JRE/Debian packages, other validators, npm/native dependencies and fonts are outside this manifest. No project license is changed.',
    ],
  };
  inventory.files.set('THIRD_PARTY_SOURCES.json', Buffer.from(json(manifest)));
  inventory.files.set('THIRD-PARTY-NOTICES.txt', Buffer.from([
    `veraPDF CLI ${asset.version} — unmodified official distribution.`,
    'For veraPDF code offered as GPLv3+ OR MPLv2+, Bivaro uses the MPL-2.0 alternative. This does not apply MPL to separately licensed dependencies or to Bivaro.',
    'MPL license: licenses/MPL-2.0.txt. The upstream alternative GPL text is retained as licenses/GPL-3.0.txt.',
    'Source Code Form and observed component versions: THIRD_PARTY_SOURCES.json (upstream versioned -sources.jar links, available without charge).',
    'Upstream copyright/license notices and Maven evidence are copied verbatim under licenses/embedded/; original JAR remains unchanged.',
    'The embedded verapdf-xmp-core POM declares BSD-3-Clause as well as a dual-license header; those notices are preserved, not overridden.',
    asset.url, `SHA-256 ${asset.sha256}`, `CLI SHA-256 ${VERAPDF_CLI_SHA256}`,
    `The archive digest was pinned after detached GPG signature verification with official fingerprint ${asset.signingFingerprint}.`,
    'Official verification documentation: https://docs.verapdf.org/install/',
    'Builds check the pinned archive and CLI digests; they do not claim a new GPG verification on every build.',
    '', 'Important remaining limits:', ...manifest.limitations.map(item => `- ${item}`), '',
  ].join('\n')));
  for (const [filename, bytes] of inventory.files) {
    const target = path.join(destination, filename);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: 'wx', mode: 0o644 });
  }
  return manifest;
}
