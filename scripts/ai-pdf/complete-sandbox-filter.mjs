/** Compile policy DATA for setpriv's documented --seccomp-filter interface.
 * No syscall is probed and no native executable is generated. The maintained
 * enosys compiler supplies its architecture gate and portable denylist.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { completeSandboxPolicy } from './seccomp-policy.mjs';

const [source, destination, arch, syscallList] = process.argv.slice(2);
if (!source || !destination || !syscallList) throw new Error('Missing policy input');
writeFileSync(destination, completeSandboxPolicy(readFileSync(source), arch, syscallList), { flag: 'wx', mode: 0o444 });
