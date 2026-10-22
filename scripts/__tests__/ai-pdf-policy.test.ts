import { describe, expect, it } from 'vitest';
import { completeSandboxPolicy } from '../ai-pdf/seccomp-policy.mjs';

const ALLOW = 0x7fff0000, TRAP = 0x30000, EPERM = 0x50001, ENOSYS = 0x50026;
const ins = (code: number, jt: number, jf: number, k: number) => { const out = Buffer.alloc(8); out.writeUInt16LE(code); out[2] = jt; out[3] = jf; out.writeUInt32LE(k, 4); return out; };
const base = (arch: number) => Buffer.concat([
  ins(0x20, 0, 0, 4), ins(0x15, 1, 0, arch), ins(0x06, 0, 0, TRAP),
  ins(0x20, 0, 0, 0), ins(0x15, 0, 1, 999), ins(0x06, 0, 0, EPERM), ins(0x06, 0, 0, ALLOW),
]);
// Model only the four cBPF instruction kinds used by this policy. This is a
// deterministic bytecode unit test: it installs no filter and issues no syscall.
function evaluate(filter: Buffer, arch: number, nr: number, flags = 0) {
  const data = new Map([[0, nr >>> 0], [4, arch], [16, flags >>> 0]]);
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

describe('AI renderer seccomp policy DATA, not native execution', () => {
  it.each([
    ['x86_64', 0xc000003e, 56, 435], ['aarch64', 0xc00000b7, 220, 435],
  ] as const)('preserves architecture and denylist while allowing only thread clone on %s', (name, arch, clone, clone3) => {
    const filter = completeSandboxPolicy(base(arch), name, `${clone} clone\n${clone3} clone3\n10 allowed\n999 denied`);
    expect(evaluate(filter, arch, 10)).toBe(ALLOW);
    expect(evaluate(filter, arch, 999)).toBe(EPERM);
    expect(evaluate(filter, arch, 1000)).toBe(ENOSYS);
    expect(evaluate(filter, arch, 468)).toBe(ENOSYS);
    expect(evaluate(filter, arch ^ 1, 10)).toBe(TRAP);
    expect(evaluate(filter, arch, clone3)).toBe(ENOSYS);
    for (const flags of [0, 17, 0x100, 0x100 | 0x800]) expect(evaluate(filter, arch, clone, flags)).toBe(EPERM);
    expect(evaluate(filter, arch, clone, 0x10000 | 0x100 | 0x800)).toBe(ALLOW);
  });
  it('rejects every x32 number, including separately numbered pointer/IPC calls', () => {
    const arch = 0xc000003e, filter = completeSandboxPolicy(base(arch), 'x86_64', '56 clone\n435 clone3');
    for (const number of [0, 41, 56, 435, 512, 521, 538, 539, 540, 547, 1023, 0x3fffffff]) expect(evaluate(filter, arch, (0x40000000 | number) >>> 0, 0x10000)).toBe(EPERM);
  });
  it('fails closed for unknown architecture, unsupported prologue or missing clone definitions', () => {
    expect(() => completeSandboxPolicy(base(0xc000003e), 'unknown', '56 clone\n435 clone3')).toThrow();
    expect(() => completeSandboxPolicy(Buffer.alloc(48), 'x86_64', '56 clone\n435 clone3')).toThrow();
    expect(() => completeSandboxPolicy(base(0xc000003e), 'x86_64', '56 clone')).toThrow();
    expect(() => completeSandboxPolicy(base(0xc00000b7), 'x86_64', '56 clone\n435 clone3')).toThrow();
  });
});
