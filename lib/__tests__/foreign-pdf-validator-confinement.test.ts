import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({realpath:vi.fn(),lstat:vi.fn()}));
vi.mock('node:fs/promises',()=>({realpath:mocks.realpath,lstat:mocks.lstat}));
import { foreignVerifierCommand } from '@/lib/server/foreign-pdf-validator-confinement';
beforeEach(()=>{
  vi.clearAllMocks();mocks.realpath.mockImplementation(async p=>p==='/usr/bin/java'?'/usr/lib/jvm/synthetic/bin/java':p);
  mocks.lstat.mockResolvedValue({isFile:()=>true,isSymbolicLink:()=>false});
  vi.spyOn(process,'getuid').mockReturnValue(1000);vi.spyOn(process,'geteuid').mockReturnValue(1000);
});
afterEach(()=>vi.restoreAllMocks());
describe('foreign-only verifier kernel policy construction (no native execution)',()=>{
  it('uses direct pinned Java CLI with read-only distribution/JRE/privateinput grants and no shell, app tree, proc, database or writes',async()=>{
    const command=await foreignVerifierCommand('/opt/verapdf/verapdf','/tmp/private-unit');
    const args=command(['--flavour','3b','/tmp/private-unit/final.pdf']);
    expect(args[0]).toBe('/usr/bin/setpriv');expect(args).toContain('--no-new-privs');expect(args).toContain('--seccomp-filter');expect(args).toContain('/usr/lib/jvm/synthetic/bin/java');
    expect(args).toContain('org.verapdf.apps.GreenfieldCliWrapper');expect(args).toContain('/opt/verapdf/etc:/opt/verapdf/bin/*');
    expect(args).toContain('path-beneath:read-file,read-dir:/tmp/private-unit');
    expect(args.some(a=>a.includes('write-file')||a.includes('make-reg')||a==='sh'||a==='--allow-child-process')).toBe(false);
    expect(args.some(a=>a.includes('/proc')||a.includes('/app/data')||a.includes('/home')||a===`path-beneath:read-file,read-dir:${process.cwd()}`)).toBe(false);
    expect(args).toContain('-XX:-UsePerfData');expect(args).toContain('-XX:+DisableAttachMechanism');
    expect(args.slice(-3)).toEqual(['--flavour','3b','/tmp/private-unit/final.pdf']);
  });
  it('refuses root rather than relaxing policy',async()=>{
    vi.mocked(process.getuid!).mockReturnValue(0);await expect(foreignVerifierCommand('/opt/verapdf/verapdf','/tmp/private-unit')).rejects.toThrow();
  });
  it('requires the pinned official CLI JAR as a regular non-symlink file',async()=>{
    mocks.lstat.mockResolvedValue({isFile:()=>true,isSymbolicLink:()=>true});await expect(foreignVerifierCommand('/opt/verapdf/verapdf','/tmp/private-unit')).rejects.toThrow();
  });
  it('fails on unavailable filter/runtime path with no fallback launcher',async()=>{
    mocks.realpath.mockRejectedValue(new Error('synthetic absent confinement'));await expect(foreignVerifierCommand('/opt/verapdf/verapdf','/tmp/private-unit')).rejects.toThrow();
  });
});
