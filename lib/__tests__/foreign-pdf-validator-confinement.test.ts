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
    expect(args).toContain('org.verapdf.apps.GreenfieldCliWrapper');expect(args).toContain('/opt/verapdf/foreign-runtime/classes:/opt/verapdf/etc:/opt/verapdf/bin/*');
    expect(args).toContain('path-beneath:read-file,read-dir:/tmp/private-unit');
    expect(args).toContain('path-beneath:read-file:/usr/lib/jvm/synthetic/conf/security/java.security');
    expect(args).not.toContain('path-beneath:read-file,read-dir:/usr/lib/jvm/synthetic/conf');
    expect(args.some(a=>a.includes('write-file')||a.includes('make-reg')||a==='sh'||a==='--allow-child-process')).toBe(false);
    expect(args.filter(a=>a.startsWith('path-beneath:')).some(a=>a.includes('/proc')||a.includes('/app/data')||a.includes('/home')||a===`path-beneath:read-file,read-dir:${process.cwd()}`)).toBe(false);
    expect(args).toContain('-XX:-UsePerfData');expect(args).toContain('-XX:+DisableAttachMechanism');
    expect(args.slice(-3)).toEqual(['--flavour','3b','/tmp/private-unit/final.pdf']);
  });
  it.each(['amd64','arm64'])('grants only the exact Debian 21 security leaf for the %s packaging layout',async architecture=>{
    const home=`/usr/lib/jvm/java-21-openjdk-${architecture}`;
    const logical=`${home}/conf/security/java.security`,canonical='/etc/java-21-openjdk/security/java.security';
    mocks.realpath.mockImplementation(async p=>p==='/usr/bin/java'?`${home}/bin/java`:p===logical?canonical:p);
    const command=await foreignVerifierCommand('/opt/verapdf/verapdf','/tmp/private-unit'),args=command(['--version']);
    expect(args).toContain(`path-beneath:read-file:${canonical}`);
    expect(args.filter(a=>a.startsWith('path-beneath:')&&a.includes('/etc/'))).toEqual([
      `path-beneath:read-file:${canonical}`,'path-beneath:read-file:/etc/ld.so.cache',
    ]);
    expect(args).not.toContain(`path-beneath:read-file,execute:${canonical}`);
    expect(mocks.realpath.mock.calls.some(([p])=>String(p).endsWith('/conf')||String(p).includes('/management/')||String(p).endsWith('/net.properties'))).toBe(false);
    expect(args.filter(a=>a.startsWith('path-beneath:')).some(a=>a.includes('write-file')||a.includes('make-reg')||a.includes('/proc')||a.includes('/home')||a.includes('/app/data'))).toBe(false);
  });
  it('fails closed when the required security leaf is absent',async()=>{
    mocks.realpath.mockImplementation(async p=>{
      if(p==='/usr/bin/java')return '/usr/lib/jvm/synthetic/bin/java';
      if(p==='/usr/lib/jvm/synthetic/conf/security/java.security')throw new Error('synthetic missing config');
      return p;
    });
    await expect(foreignVerifierCommand('/opt/verapdf/verapdf','/tmp/private-unit')).rejects.toThrow();
  });
  it.each(['/etc/shadow','/app/.env','/proc/self/environ','/etc/java-21-openjdk/management/jmxremote.password','/etc/java-17-openjdk/security/java.security','/etc/java-21-openjdk/security/other.security'])('rejects an unexpected canonical security target %s without probing or granting it',async target=>{
    mocks.realpath.mockImplementation(async p=>p==='/usr/bin/java'?'/usr/lib/jvm/synthetic/bin/java':p==='/usr/lib/jvm/synthetic/conf/security/java.security'?target:p);
    await expect(foreignVerifierCommand('/opt/verapdf/verapdf','/tmp/private-unit')).rejects.toThrow();
    expect(mocks.lstat).not.toHaveBeenCalledWith(target);
  });
  it.each([{file:false,link:false},{file:true,link:true}])('requires the canonical security leaf to remain a regular non-symlink file (%j)',async info=>{
    mocks.lstat.mockImplementation(async p=>({isFile:()=>p.endsWith('/conf/security/java.security')?info.file:true,isSymbolicLink:()=>p.endsWith('/conf/security/java.security')?info.link:false}));
    await expect(foreignVerifierCommand('/opt/verapdf/verapdf','/tmp/private-unit')).rejects.toThrow();
  });
  it('does not follow a second symlink at the approved Debian boundary',async()=>{
    const canonical='/etc/java-21-openjdk/security/java.security';
    mocks.realpath.mockImplementation(async p=>p==='/usr/bin/java'?'/usr/lib/jvm/synthetic/bin/java':p==='/usr/lib/jvm/synthetic/conf/security/java.security'?canonical:p);
    mocks.lstat.mockImplementation(async p=>({isFile:()=>true,isSymbolicLink:()=>p===canonical}));
    await expect(foreignVerifierCommand('/opt/verapdf/verapdf','/tmp/private-unit')).rejects.toThrow();
    expect(mocks.realpath.mock.calls.filter(([p])=>p===canonical)).toEqual([]);
  });
  it('does not fall back when the approved canonical file probe fails',async()=>{
    const canonical='/etc/java-21-openjdk/security/java.security';
    mocks.realpath.mockImplementation(async p=>p==='/usr/bin/java'?'/usr/lib/jvm/synthetic/bin/java':p==='/usr/lib/jvm/synthetic/conf/security/java.security'?canonical:p);
    mocks.lstat.mockImplementation(async p=>{
      if(p===canonical)throw new Error('synthetic missing canonical file');
      return {isFile:()=>true,isSymbolicLink:()=>false};
    });
    await expect(foreignVerifierCommand('/opt/verapdf/verapdf','/tmp/private-unit')).rejects.toThrow();
    expect(mocks.lstat).toHaveBeenCalledWith(canonical);
  });
  it('does not confuse the trusted filter filename under a GitHub home checkout with a filesystem grant',async()=>{
    const checkout='/home/runner/work/synthetic/synthetic';vi.spyOn(process,'cwd').mockReturnValue(checkout);
    const command=await foreignVerifierCommand('/opt/verapdf/verapdf','/tmp/private-unit'),args=command(['--version']);
    expect(args[args.indexOf('--seccomp-filter')+1]).toBe(`${checkout}/scripts/foreign-pdf/sandbox-${process.arch}.bpf`);
    expect(args.filter(a=>a.startsWith('path-beneath:')).some(a=>a.includes('/home')||a.includes('/proc')||a.includes('/app/data'))).toBe(false);
    expect(args).not.toContain(`path-beneath:read-file,read-dir:${checkout}`);
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
