import { describe, expect, it } from 'vitest';
import { completeSandboxPolicy } from '../foreign-pdf/seccomp-policy.mjs';

const ALLOW = 0x7fff0000, TRAP = 0x30000, EPERM = 0x50001, ENOSYS = 0x50026;
const ins = (code: number, jt: number, jf: number, k: number) => { const out = Buffer.alloc(8); out.writeUInt16LE(code); out[2] = jt; out[3] = jf; out.writeUInt32LE(k, 4); return out; };
const base = (arch: number, ioctl = 16) => Buffer.concat([
  ins(0x20, 0, 0, 4), ins(0x15, 1, 0, arch), ins(0x06, 0, 0, TRAP),
  ins(0x20, 0, 0, 0), ins(0x15, 0, 1, ioctl), ins(0x06, 0, 0, EPERM), ins(0x15, 0, 1, 999), ins(0x06, 0, 0, EPERM), ins(0x06, 0, 0, ALLOW),
]);
// Model only the four cBPF instruction kinds used by this policy. This is a
// deterministic bytecode unit test: it installs no filter and issues no syscall.
function evaluate(filter: Buffer, arch: number, nr: number, args: readonly bigint[] = []) {
  const data = new Map([[0, nr >>> 0], [4, arch]]);
  for (let index = 0; index < 6; index++) {
    const value = BigInt.asUintN(64, args[index] ?? BigInt('0'));
    data.set(16 + 8 * index, Number(value & BigInt('0xffffffff')));
    data.set(20 + 8 * index, Number(value >> BigInt('32')));
  }
  let a = 0;
  for (let pc = 0, steps = 0; pc < filter.length / 8 && steps++ < 4096; pc++) {
    const pos = pc * 8, code = filter.readUInt16LE(pos), k = filter.readUInt32LE(pos + 4);
    if (code === 0x20) a = data.get(k)!;
    else if (code === 0x15) pc += a === k ? filter[pos + 2] : filter[pos + 3];
    else if (code === 0x45) pc += (a & k) !== 0 ? filter[pos + 2] : filter[pos + 3];
    else if (code === 0x05) pc += k;
    else if (code === 0x06) return k;
    else throw new Error('Unsupported test instruction');
  }
  throw new Error('Unterminated policy');
}

describe('Foreign PDF seccomp policy DATA, not native execution', () => {
  it.each([
    ['x86_64', 0xc000003e, 56, 435, 16], ['aarch64', 0xc00000b7, 220, 435, 29],
  ] as const)('preserves architecture and denylist while allowing only thread clone on %s', (name, arch, clone, clone3, ioctl) => {
    const filter = completeSandboxPolicy(base(arch, ioctl), name, `${clone} clone\n${clone3} clone3\n${ioctl} ioctl\n10 allowed\n999 denied`);
    expect(evaluate(filter, arch, 10)).toBe(ALLOW);
    expect(evaluate(filter, arch, 999)).toBe(EPERM);
    expect(evaluate(filter, arch, 1000)).toBe(ENOSYS);
    expect(evaluate(filter, arch, 468)).toBe(ENOSYS);
    expect(evaluate(filter, arch ^ 1, 10)).toBe(TRAP);
    expect(evaluate(filter, arch, clone3)).toBe(ENOSYS);
    for (const flags of [0, 17, 0x100, 0x100 | 0x800]) expect(evaluate(filter, arch, clone, [BigInt(flags)])).toBe(EPERM);
    expect(evaluate(filter, arch, clone, [BigInt('0x10900')])).toBe(ALLOW);
  });
  it.each([
    ['x86_64', 0xc000003e, 56, 16], ['aarch64', 0xc00000b7, 220, 29],
  ] as const)('allows only exact FIONBIO on fd1/2, checking both full arguments on %s', (name, arch, clone, ioctl) => {
    const filter = completeSandboxPolicy(base(arch, ioctl), name, `${clone} clone\n435 clone3\n${ioctl} ioctl\n10 allowed\n999 denied`);
    for (const fd of [BigInt('1'), BigInt('2')]) {
      for (const pointer of [BigInt('0'), BigInt('0x123456789abcdef0'), BigInt('-1')]) expect(evaluate(filter, arch, ioctl, [fd, BigInt('0x5421'), pointer])).toBe(ALLOW);
      for (const request of [BigInt('0'), BigInt('0x5420'), BigInt('0x5422'), BigInt('0x5412'), BigInt('0x5401'), BigInt('0x5452'), BigInt('0x40086602'), BigInt('0x40049409'), BigInt('-1')]) expect(evaluate(filter, arch, ioctl, [fd, request])).toBe(EPERM);
      for (const high of [BigInt('1'), BigInt('0x80000000'), BigInt('0xffffffff')]) {
        expect(evaluate(filter, arch, ioctl, [(high << BigInt('32')) | fd, BigInt('0x5421')])).toBe(EPERM);
        expect(evaluate(filter, arch, ioctl, [fd, (high << BigInt('32')) | BigInt('0x5421')])).toBe(EPERM);
      }
    }
    for (const fd of [BigInt('-1'), BigInt('0'), BigInt('3'), BigInt('63'), BigInt('0x7fffffff'), BigInt('0xffffffff')]) expect(evaluate(filter, arch, ioctl, [fd, BigInt('0x5421')])).toBe(EPERM);
    expect(evaluate(filter, arch ^ 1, ioctl, [BigInt('1'), BigInt('0x5421')])).toBe(TRAP);
    expect(evaluate(filter, arch, 999, [BigInt('1'), BigInt('0x5421')])).toBe(EPERM);
    expect(evaluate(filter, arch, 1000, [BigInt('1'), BigInt('0x5421')])).toBe(ENOSYS);
    expect(evaluate(filter, arch, 10, [BigInt('1'), BigInt('0x5421')])).toBe(ALLOW);
    if (name === 'x86_64') expect(evaluate(filter, arch, 0x40000000 | ioctl, [BigInt('1'), BigInt('0x5421')])).toBe(EPERM);
  });
  it('rejects every x32 number, including separately numbered pointer/IPC calls', () => {
    const arch = 0xc000003e, filter = completeSandboxPolicy(base(arch), 'x86_64', '56 clone\n435 clone3\n16 ioctl');
    for (const number of [0, 41, 56, 435, 512, 521, 538, 539, 540, 547, 1023, 0x3fffffff]) expect(evaluate(filter, arch, (0x40000000 | number) >>> 0, [BigInt('0x10000')])).toBe(EPERM);
  });
  it('fails closed for unknown architecture, unsupported prologue or missing clone definitions', () => {
    expect(() => completeSandboxPolicy(base(0xc000003e), 'unknown', '56 clone\n435 clone3\n16 ioctl')).toThrow();
    expect(() => completeSandboxPolicy(Buffer.alloc(48), 'x86_64', '56 clone\n435 clone3\n16 ioctl')).toThrow();
    expect(() => completeSandboxPolicy(base(0xc000003e), 'x86_64', '56 clone')).toThrow();
    expect(() => completeSandboxPolicy(base(0xc000003e), 'x86_64', '56 clone\n435 clone3')).toThrow();
    expect(() => completeSandboxPolicy(base(0xc000003e), 'x86_64', '56 clone\n435 clone3\n29 ioctl')).toThrow();
    expect(() => completeSandboxPolicy(base(0xc00000b7), 'x86_64', '56 clone\n435 clone3\n16 ioctl')).toThrow();
  });
});
