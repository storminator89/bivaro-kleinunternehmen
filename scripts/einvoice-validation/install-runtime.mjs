#!/usr/bin/env node
/** Build-time only. Download official, digest-pinned tools; never accepts documents. */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

const root = path.resolve(process.argv[2] || '/opt/bivaro/einvoice');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const assets = [
  { url: 'https://github.com/itplr-kosit/validator/releases/download/v1.6.3/validator-1.6.3-standalone.jar', file: 'validator-1.6.3-standalone.jar', sha: '799e64befca97d4080e03608c80b85dd5a5ecc5f4ae4f35d1116ec2855b9a7c9', limit: 11_000_000 },
  { url: 'https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/download/v2026-08-31/xrechnung-3.0.2-validator-configuration-2026-08-31.zip', file: 'rules.zip', sha: '2530cd107c414511c5d0462ec10f886910395abfca820db82e83d70bf01221a8', limit: 600_000 },
  { url: 'https://raw.githubusercontent.com/itplr-kosit/validator/v1.6.3/LICENSE', file: 'LICENSE.validator', sha: 'a6cba85bc92e0cff7a450b1d873c0eaa2e9fc96bf472df0247a26bec77bf3ff9', limit: 20_000 },
  { url: 'https://raw.githubusercontent.com/itplr-kosit/validator-configuration-xrechnung/v2026-08-31/LICENSE', file: 'LICENSE.configuration', sha: '73f2898ad26e1fcb9ec4649cdf8466ea0bda47644b7c12efc10a703bdfb94a9f', limit: 20_000 },
];
await mkdir(root, { recursive: true });
const downloaded = new Map();
for (const asset of assets) {
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Official asset unavailable: ${asset.file} (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > asset.limit || digest(bytes) !== asset.sha) throw new Error(`Official asset integrity failed: ${asset.file}`);
  downloaded.set(asset.file, bytes);
  if (asset.file !== 'rules.zip') await writeFile(path.join(root, asset.file), bytes, { mode: 0o644, flag: 'wx' });
}
const zip = await JSZip.loadAsync(downloaded.get('rules.zip'), { checkCRC32: true });
let total = 0, count = 0;
for (const entry of Object.values(zip.files)) {
  if (entry.dir) continue;
  const name = entry.name;
  if (++count > 200 || name.startsWith('/') || name.includes('\\') || name.split('/').some(part => part === '..') || entry.unsafeOriginalName !== name || ((entry.unixPermissions || 0) & 0o170000) === 0o120000) throw new Error('Unsafe official archive entry');
  const bytes = await entry.async('nodebuffer');
  if ((total += bytes.length) > 12 * 1024 * 1024) throw new Error('Official archive limit');
  await mkdir(path.dirname(path.join(root, 'rules', name)), { recursive: true });
  await writeFile(path.join(root, 'rules', name), bytes, { mode: 0o644, flag: 'wx' });
}
const source = await zip.file('scenarios.xml').async('string');
const scenarios = source.match(/  <scenario>[\s\S]*?<\/scenario>/g) || [];
for (const [format, name, expected] of [
  ['cii', 'EN16931 XRechnung (CII)', 'f79b645e9dbe3ad568024861dfcaa2f4d2736be25b6a57e96f39464055b1179e'],
  ['ubl', 'EN16931 XRechnung (UBL Invoice)', '292fdd6b8646f8a36a8ce1edd4e56e866a8085728f5c76c737baa7887b5816ca'],
]) {
  const selected = scenarios.filter(value => value.includes(`<name>${name}</name>`));
  if (selected.length !== 1 || !source.includes('  <!-- In case none')) throw new Error('Official scenario selection changed');
  // Preserve the selected official scenario byte-for-byte, including custom levels.
  const derived = source.slice(0, source.indexOf('  <scenario>')) + selected[0] + source.slice(source.indexOf('  <!-- In case none'));
  if (digest(Buffer.from(derived)) !== expected) throw new Error('Derived scenario integrity failed');
  await writeFile(path.join(root, `scenarios-${format}.xml`), derived, { mode: 0o644, flag: 'wx' });
}
await writeFile(path.join(root, 'THIRD-PARTY-NOTICES.txt'), assets.map(asset => `${asset.file}\n${asset.url}\nSHA-256 ${asset.sha}\n`).join('\n') + '\nKoSIT Validator and configuration: Apache-2.0. Embedded dependency notices remain inside the unmodified standalone JAR. The system JRE is distributed under its Debian package copyright notices.\n', { mode: 0o644, flag: 'wx' });
console.log(`Installed pinned offline e-invoice runtime assets (${count} rule files, ${total} uncompressed rule bytes).`);
