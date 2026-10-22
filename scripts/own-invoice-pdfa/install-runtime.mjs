#!/usr/bin/env node
/** Build-time only: authentic, version/digest-pinned official veraPDF CLI. */
import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import JSZip from 'jszip';

export const VERAPDF_ASSET = Object.freeze({
  version: '1.30.3',
  url: 'https://software.verapdf.org/releases/1.30/verapdf-greenfield-1.30.3-installer.zip',
  sha256: 'b512bf24945503a33fc10738ecffc1f2dccaaf8593a448e94ee9ac86a9559a59',
  bytes: 32_971_125,
  jar: 'verapdf-greenfield-1.30.3/verapdf-izpack-installer-1.30.3.jar',
  jarBytes: 33_217_113,
  signingFingerprint: '13DD102B4DD69354D12DE5A83184863278B17FE7',
});
const execFile = promisify(execFileCallback);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const escapeXml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function requirePinnedArchive(bytes) {
  if (bytes.byteLength !== VERAPDF_ASSET.bytes || digest(bytes) !== VERAPDF_ASSET.sha256) {
    throw new Error('Official veraPDF archive integrity failed.');
  }
}

export async function downloadArchive(fetcher = fetch) {
  const response = await fetcher(VERAPDF_ASSET.url, { signal: AbortSignal.timeout(120_000), redirect: 'error', credentials: 'omit' });
  if (!response.ok || !response.body) throw new Error('Official veraPDF archive unavailable.');
  const declared = Number(response.headers.get('content-length'));
  if (declared && declared !== VERAPDF_ASSET.bytes) throw new Error('Unexpected official veraPDF archive size.');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > VERAPDF_ASSET.bytes) throw new Error('Official veraPDF download exceeds its bound.');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  requirePinnedArchive(bytes);
  return bytes;
}

export function automatedInstallation(destination) {
  return `<AutomatedInstallation langpack="eng">
 <com.izforge.izpack.panels.htmlhello.HTMLHelloPanel id="welcome"/>
 <com.izforge.izpack.panels.target.TargetPanel id="install_dir"><installpath>${escapeXml(destination)}</installpath></com.izforge.izpack.panels.target.TargetPanel>
 <com.izforge.izpack.panels.packs.PacksPanel id="sdk_pack_select">
  <pack index="0" name="veraPDF GUI" selected="false"/>
  <pack index="1" name="veraPDF CLI" selected="true"/>
  <pack index="2" name="veraPDF Documentation" selected="true"/>
  <pack index="3" name="veraPDF Sample Plugins" selected="false"/>
 </com.izforge.izpack.panels.packs.PacksPanel>
 <com.izforge.izpack.panels.install.InstallPanel id="install"/>
 <com.izforge.izpack.panels.finish.FinishPanel id="finish"/>
</AutomatedInstallation>\n`;
}

export async function installRuntime(destination) {
  if (!path.isAbsolute(destination) || destination === path.parse(destination).root) throw new Error('An absolute installation directory is required.');
  const archive = await downloadArchive();
  // Never unpack an unchecked archive or execute an unverified installer.
  const zip = await JSZip.loadAsync(archive, { checkCRC32: true });
  const entry = zip.file(VERAPDF_ASSET.jar);
  if (!entry) throw new Error('Pinned veraPDF installer is missing.');
  const jar = await entry.async('nodebuffer');
  if (jar.byteLength !== VERAPDF_ASSET.jarBytes) throw new Error('Unexpected veraPDF installer size.');
  const temporary = await mkdtemp(path.join(tmpdir(), 'bivaro-verapdf-install-'));
  let created = false;
  try {
    // IzPack may clean its destination. Refuse any pre-existing path: never
    // overwrite an operator installation, configuration or original document.
    await mkdir(destination);
    created = true;
    const jarPath = path.join(temporary, 'installer.jar');
    const xmlPath = path.join(temporary, 'installation.xml');
    await writeFile(jarPath, jar, { flag: 'wx', mode: 0o600 });
    await writeFile(xmlPath, automatedInstallation(destination), { flag: 'wx', mode: 0o600 });
    const env = { PATH: '/usr/bin:/bin', HOME: temporary, TMPDIR: temporary, LANG: 'C.UTF-8', TZ: 'UTC', NODE_ENV: 'production',
      JAVACMD: '/usr/bin/java', JAVA_OPTS: '-Xms16m -Xmx192m -Djava.awt.headless=true' };
    await execFile('/usr/bin/java', ['-Xms16m', '-Xmx256m', '-Djava.awt.headless=true', '-jar', jarPath, xmlPath], {
      cwd: temporary, env, timeout: 120_000, killSignal: 'SIGKILL', maxBuffer: 2 * 1024 * 1024,
    });
    const binary = path.join(destination, 'verapdf');
    await chmod(binary, 0o755);
    const version = await execFile(binary, ['--version'], { cwd: temporary, env, timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 32 * 1024 });
    if (version.stdout.trim().split(/\r?\n/u)[0] !== `veraPDF ${VERAPDF_ASSET.version}`) throw new Error('Installed veraPDF version mismatch.');
    const licenseRoot = path.join(destination, 'licenses');
    await mkdir(licenseRoot);
    for (const name of ['GPL-3.0.txt', 'MPL-2.0.txt']) {
      await copyFile(fileURLToPath(new URL(`./licenses/${name}`, import.meta.url)), path.join(licenseRoot, name), constants.COPYFILE_EXCL);
    }
    await writeFile(path.join(destination, 'THIRD-PARTY-NOTICES.txt'), [
      `veraPDF CLI ${VERAPDF_ASSET.version}: GPLv3+ OR MPLv2+; retain upstream copyright notices and unmodified JAR dependency notices.`,
      VERAPDF_ASSET.url, `SHA-256 ${VERAPDF_ASSET.sha256}`,
      `This digest was pinned after detached GPG signature verification with official fingerprint ${VERAPDF_ASSET.signingFingerprint}.`,
      'Official verification documentation: https://docs.verapdf.org/install/',
      'The build checks the pinned digest; it does not claim a new GPG verification on each build.',
    ].join('\n') + '\n', { flag: 'wx', mode: 0o644 });
    return binary;
  } catch (error) {
    if (created) await rm(destination, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const binary = await installRuntime(path.resolve(process.argv[2] || '/opt/verapdf'));
  console.log(`Installed pinned official veraPDF ${VERAPDF_ASSET.version}: ${binary}`);
}
