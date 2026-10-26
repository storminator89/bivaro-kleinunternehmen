import fs from 'node:fs';
import path from 'node:path';
import { selectFocusedBrowser, validFocusedSelection } from './focused-browser-selection.mjs';
const input = process.argv[2];
const root = fs.realpathSync(process.env.RUNNER_TEMP);
if (path.dirname(input) !== root || path.basename(input) !== 'bivaro-focused-changed-paths.json') throw Error('Untrusted path inventory');
const fd = fs.openSync(input, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
let bytes;
try {
  const info = fs.fstatSync(fd);
  if (!info.isFile() || info.size < 1 || info.size > 3 * 1024 * 1024) throw Error('Unbounded path inventory');
  const buffer = Buffer.alloc(3 * 1024 * 1024 + 1);
  const length = fs.readSync(fd, buffer, 0, buffer.length, 0);
  if (length !== info.size || length > 3 * 1024 * 1024) throw Error('Changed path inventory');
  bytes = buffer.subarray(0, length);
} finally { fs.closeSync(fd); }
const paths = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
const selection = selectFocusedBrowser(paths, file => fs.existsSync(file));
if (!validFocusedSelection(selection)) throw Error('Invalid focused selection');
fs.appendFileSync(process.env.GITHUB_OUTPUT, 'run=' + selection.core + '\nselection=' + JSON.stringify(selection) + '\n', 'utf8');
console.log(`Focused browser scope: core=${selection.core}, approved specs=${selection.specs.length}, unmapped source paths=${selection.unmappedSourceCount}, critical mappings required=${selection.unknownCriticalCount}. This is not full acceptance.`);
if (selection.criticalMappingRequired) throw Error('Changed critical source requires an explicit focused browser mapping; no broad fallback is started.');
