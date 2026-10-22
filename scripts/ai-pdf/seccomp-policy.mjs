/** Pure cBPF policy-data construction, separately testable without syscalls.
 * Layout is the documented linux/{seccomp,filter,audit}.h interface.
 */
export function completeSandboxPolicy(base, arch, syscallList) {
  if (!['x86_64', 'aarch64'].includes(arch)) throw new Error('Unsupported policy target');
  const syscalls = new Map(syscallList.split('\n').map(line => line.trim().split(/\s+/)).filter(pair => pair.length === 2).map(([number, name]) => [name, Number(number)]));
  const clone = syscalls.get('clone'), clone3 = syscalls.get('clone3');
  const knownNumbers = [...new Set(syscalls.values())].sort((a, b) => a - b);
  if (!knownNumbers.length || knownNumbers.some(number => !Number.isSafeInteger(number) || number < 0 || number >= 0x40000000)) throw new Error('Invalid syscall inventory');
  if (!Number.isInteger(clone) || !Number.isInteger(clone3)) throw new Error('Missing clone policy support');
  const auditArch = arch === 'x86_64' ? 0xc000003e : 0xc00000b7;
  // Validate the maintained enosys architecture gate and number reload before
  // adding instructions. Never extend unknown compiler output optimistically.
  if (base.length % 8 || base.length < 32 || base.readUInt16LE(0) !== 0x20 || base.readUInt32LE(4) !== 4 || base.readUInt16LE(8) !== 0x15 || base[10] !== 1 || base[11] !== 0 || base.readUInt32LE(12) !== auditArch || base.readUInt16LE(16) !== 0x06 || base.readUInt32LE(20) !== 0x30000 || base.readUInt16LE(24) !== 0x20 || base.readUInt32LE(28) !== 0) throw new Error('Unexpected enosys policy format');
  const instructions = [];
  const add = (code, jt, jf, k) => { const instruction = Buffer.alloc(8); instruction.writeUInt16LE(code); instruction[2] = jt; instruction[3] = jf; instruction.writeUInt32LE(k, 4); instructions.push(instruction); };
  add(0x20, 0, 0, 0); // LD syscall number, after enosys's architecture gate.
  if (arch === 'x86_64') {
    add(0x45, 0, 1, 0x40000000); // JSET __X32_SYSCALL_BIT, reject all x32.
    add(0x06, 0, 0, 0x50001); // ERRNO EPERM.
  }
  // Deny unknown/reserved numbers, not just known dangerous syscall names.
  // Otherwise a newer host could add metadata or network calls absent from
  // the image's headers. JA has a 32-bit offset; conditional jumps stay tiny.
  for (let index = 0; index < knownNumbers.length; index++) {
    add(0x15, 0, 1, knownNumbers[index]);
    add(0x05, 0, 0, 2 * (knownNumbers.length - index - 1) + 1);
  }
  add(0x06, 0, 0, 0x50026); // Unknown syscall -> ENOSYS.
  add(0x15, 0, 1, clone3);
  add(0x06, 0, 0, 0x50026); // ERRNO ENOSYS: libc may use clone for threads.
  add(0x15, 0, 3, clone);
  add(0x20, 0, 0, 16); // LD low 32 bits of args[0], little-endian targets only.
  add(0x45, 1, 0, 0x10000); // CLONE_THREAD required: no separate process budget.
  add(0x06, 0, 0, 0x50001);
  // Remaining enosys policy reloads the syscall number. Relative jumps in its
  // unchanged body still target exactly the same denylist/return instructions.
  const result = Buffer.concat([base.subarray(0, 24), ...instructions, base.subarray(24)]);
  if (result.length / 8 > 4096) throw new Error('Policy exceeds kernel limit');
  return result;
}
