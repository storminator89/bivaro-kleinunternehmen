/** Test-image build invariant only; never part of PDF interpretation/execution.
 * Hash the production tree without following links. Browser tool installation
 * must not modify, add or mask any /app module, asset or policy file.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readlink, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function runtimeManifest(root) {
  const records = [];
  async function visit(relative) {
    const absolute = path.join(root, relative), stat = await lstat(absolute);
    const record = { path: relative, mode: stat.mode, uid: stat.uid, gid: stat.gid };
    if (stat.isSymbolicLink()) record.link = await readlink(absolute);
    else if (stat.isDirectory()) {
      records.push(record);
      for (const name of (await readdir(absolute)).sort()) await visit(path.join(relative, name));
      return;
    } else if (stat.isFile()) {
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(absolute)) hash.update(chunk);
      record.sha256 = hash.digest('hex'); record.bytes = stat.size;
    } else throw new Error('Unsupported production runtime file type');
    records.push(record);
  }
  await visit('.');
  return { entries: records.length, sha256: createHash('sha256').update(JSON.stringify(records)).digest('hex') };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const snapshot = '/tmp/bivaro-production-closure.json', mode = process.argv[2];
  if (process.argv.length !== 3 || !['capture', 'verify'].includes(mode)) throw new Error('Invalid runtime-manifest invocation');
  const current = await runtimeManifest('/app');
  if (mode === 'capture') await writeFile(snapshot, JSON.stringify(current), { flag: 'wx', mode: 0o600 });
  else {
    if (JSON.stringify(current) !== await readFile(snapshot, 'utf8')) throw new Error('Browser tools changed the production runtime closure');
    process.stdout.write('Production /app closure unchanged after isolated browser tool installation.\n');
  }
}
