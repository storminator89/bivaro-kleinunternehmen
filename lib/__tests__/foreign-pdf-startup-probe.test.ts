import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { EventEmitter } from 'node:events';
const m=vi.hoisted(()=>({spawn:vi.fn(),mkdtemp:vi.fn(),readdir:vi.fn(),rm:vi.fn(),realpath:vi.fn(),lstat:vi.fn(),children:[] as Child[],manual:false,codes:[0,1],output:'',prepare:vi.fn(),boundary:vi.fn(),directory:'/tmp/synthetic-startup-private'}));
vi.mock('node:child_process',()=>({spawn:m.spawn}));
vi.mock('node:fs/promises',()=>({mkdtemp:m.mkdtemp,readdir:m.readdir,rm:m.rm,realpath:m.realpath,lstat:m.lstat}));
import { foreignVerifierCommand } from '@/lib/server/foreign-pdf-validator-confinement';
import { veraPdfSpawnSpecification } from '@/lib/server/pdfa-validator';
import { probeTrustedVerifierStartup,sanitizeTrustedStartupText,startupCommand } from '../../scripts/foreign-pdf/startup-probe.mjs';
class Child extends EventEmitter {stdout=new EventEmitter();stderr=new EventEmitter();kill=vi.fn();constructor(readonly pid:number){super();}}
const factories={foreignVerifierCommand,veraPdfSpawnSpecification,prepareForeignVerifierConfig:m.prepare,assertForeignVerifierConfigOnly:m.boundary};
async function flush(){for(let i=0;i<60;i++)await Promise.resolve();}
beforeEach(()=>{
  vi.clearAllMocks();m.children=[];m.manual=false;m.codes=[0,1];m.output=`java.lang.InitializationFailure at ${m.directory}/config and /opt/verapdf/etc/application.xml\nCaused by synthetic startup failure`;
  m.prepare.mockResolvedValue({trusted:'synthetic-config-only'});m.boundary.mockResolvedValue(undefined);
  m.mkdtemp.mockResolvedValue(m.directory);m.readdir.mockResolvedValue([]);m.rm.mockResolvedValue(undefined);
  m.realpath.mockImplementation(async p=>p==='/usr/bin/java'?'/usr/lib/jvm/java-21-openjdk-amd64/bin/java':p);
  m.lstat.mockResolvedValue({isFile:()=>true,isSymbolicLink:()=>false});
  vi.spyOn(process,'getuid').mockReturnValue(1000);vi.spyOn(process,'geteuid').mockReturnValue(1000);vi.spyOn(process,'kill').mockImplementation(()=>true);
  m.spawn.mockImplementation(()=>{const index=m.children.length,child=new Child(32100+index);m.children.push(child);if(!m.manual||index!==0)queueMicrotask(()=>{child.stderr.emit('data',Buffer.from(m.output));child.emit('exit',m.codes[index]??0,null);child.emit('close',m.codes[index]??0,null);});return child;});
});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllEnvs();});
describe('trusted no-input startup-only diagnostic (mocked processes only)',()=>{
  it('uses exact compiled production policy/options/resource/env recipe, fixed version args and trusted-configuration-only input; never inherited credentials',async()=>{
    vi.stubEnv('BIVARO_SETUP_TOKEN','parent-secret-never-pass');vi.stubEnv('OPENAI_API_KEY','parent-secret-never-pass');vi.stubEnv('JDK_JAVA_OPTIONS','parent-secret-never-pass');
    const result=await probeTrustedVerifierStartup(factories);
    expect(result.results.map(r=>[r.mode,r.outcome])).toEqual([['jvm','passed'],['cli','nonzero-exit']]);
    expect(m.prepare).toHaveBeenCalledExactlyOnceWith('/opt/verapdf/verapdf',m.directory);expect(m.boundary).toHaveBeenCalledTimes(4);expect(m.spawn).toHaveBeenCalledTimes(2);
    const exact=await foreignVerifierCommand('/opt/verapdf/verapdf',m.directory);
    for(const [index,mode]of ['jvm','cli'].entries()){
      const expected=veraPdfSpawnSpecification('/opt/verapdf/verapdf',['--version'],m.directory,()=>startupCommand(exact(['--version']),mode));
      expect(m.spawn.mock.calls[index]).toEqual([expected.binary,expected.args,expected.options]);
      expect(JSON.stringify(expected.options.env)).not.toContain('parent-secret');
      expect(expected.args.at(-1)).toBe(mode==='jvm'?'-version':'--version');
      expect(expected.options.stdio).toEqual(['ignore','pipe','pipe']);
      expect(expected.args.some(a=>a.endsWith('.pdf')||a.endsWith('.xml'))).toBe(false);
      expect(expected.args).toContain('--no-new-privs');
      expect(expected.args.some(a=>a.includes('write-file')||a.includes('make-reg'))).toBe(false);
    }
    expect(result.results[0].excerpt).toBe('');
    expect(JSON.stringify(result)).not.toContain(m.directory);expect(JSON.stringify(result)).not.toContain('/opt/verapdf');
    expect(m.rm).toHaveBeenCalledExactlyOnceWith(m.directory,{recursive:true,force:true});
  });
  it('rejects any document argument or non-config startup bytes before spawning',async()=>{
    const build=await foreignVerifierCommand('/opt/verapdf/verapdf',m.directory),cli=build(['--version']);
    expect(()=>startupCommand([...cli,'/tmp/input.pdf'],'cli')).toThrow();
    expect(()=>startupCommand(cli.slice(0,-1),'cli')).toThrow();
    expect(()=>startupCommand(cli.map(value=>value==='org.bivaro.pdfa.ForeignVerifierMain'?'org.verapdf.apps.GreenfieldCliWrapper':value),'cli')).toThrow();
    m.boundary.mockRejectedValueOnce(Error('Unexpected invoice.pdf'));const result=await probeTrustedVerifierStartup(factories);
    expect(m.spawn).not.toHaveBeenCalled();expect(result.results[0]).toMatchObject({mode:'boundary',outcome:'unavailable',excerpt:''});
  });
  it('rejects changed configuration after a completed version-only launch before attempting another probe',async()=>{
    m.boundary.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error('changed private config'));
    const result=await probeTrustedVerifierStartup(factories);
    expect(m.spawn).toHaveBeenCalledTimes(1);expect(result.results).toEqual([{mode:'boundary',outcome:'unavailable',exit:'other',excerpt:''}]);
    expect(m.rm).toHaveBeenCalledOnce();expect(JSON.stringify(result)).not.toContain('changed private config');
  });
  it('returns no arbitrary constructor exception text',async()=>{
    const result=await probeTrustedVerifierStartup({...factories,foreignVerifierCommand:async()=>{throw Error('private secret document');}});
    expect(JSON.stringify(result)).not.toContain('private');expect(JSON.stringify(result)).not.toContain('secret');expect(m.spawn).not.toHaveBeenCalled();
  });
  it('limits both failed startup excerpts to a shared4KiB and removes fixed/other paths, URIs, controls and credential assignments',async()=>{
    m.codes=[1,1];m.output=`\u001b[31mFailure ${m.directory}/child /etc/java-21-openjdk/security/java.security ./config.xml https://user:pass@example.test/api\u0000\nOPENAI_API_KEY=secret-never-log\n${'€'.repeat(3000)}`;
    const result=await probeTrustedVerifierStartup(factories),text=JSON.stringify(result);
    expect(result.results.reduce((n,r)=>n+Buffer.byteLength(r.excerpt),0)).toBeLessThanOrEqual(4096);
    for(const forbidden of [m.directory,'/etc/','./config','example.test','user:pass','secret-never-log','\u001b','\u0000'])expect(text).not.toContain(forbidden);
    expect(text).not.toContain('�');expect(Buffer.byteLength(result.results[1].excerpt)).toBeLessThanOrEqual(2);
  });
  it('preserves whole-group kill and waits for close before cleanup or the next probe',async()=>{
    m.manual=true;let settled=false;const pending=probeTrustedVerifierStartup(factories).then(r=>{settled=true;return r;});await flush();
    expect(m.children).toHaveLength(1);const child=m.children[0];child.stderr.emit('data',Buffer.from('synthetic failure'));child.emit('exit',1,null);await flush();
    expect(process.kill).toHaveBeenCalledWith(-child.pid,'SIGKILL');expect(m.rm).not.toHaveBeenCalled();expect(settled).toBe(false);expect(m.spawn).toHaveBeenCalledTimes(1);
    child.emit('close',1,null);await pending;expect(m.rm).toHaveBeenCalledTimes(1);
  });
  it('enforces the unchanged2MiB combined process-output bound without retaining excess output',async()=>{
    m.manual=true;const pending=probeTrustedVerifierStartup(factories);await flush();const child=m.children[0];
    child.stderr.emit('data',Buffer.alloc(2*1024*1024+1,120));expect(process.kill).toHaveBeenCalledWith(-child.pid,'SIGKILL');child.emit('exit',1,null);child.emit('close',1,null);
    const result=await pending;expect(result.results[0].outcome).toBe('output-limit');expect(result.results[0].excerpt).not.toContain('xxxxx');
  });
  it('retains the30s walltime and close-before-cleanup lifecycle',async()=>{
    vi.useFakeTimers();m.manual=true;const pending=probeTrustedVerifierStartup(factories);await flush();const child=m.children[0];
    await vi.advanceTimersByTimeAsync(30_000);expect(process.kill).toHaveBeenCalledWith(-child.pid,'SIGKILL');expect(m.rm).not.toHaveBeenCalled();
    child.emit('exit',null,'SIGKILL');child.emit('close',null,'SIGKILL');const result=await pending;expect(result.results[0].outcome).toBe('timeout');
  });
  it('does not coerce unknown sanitizer data or exceed a valid UTF8 byte boundary',()=>{
    expect(sanitizeTrustedStartupText({toString(){throw Error('secret');}},m.directory)).toBe('');
    expect(sanitizeTrustedStartupText('safe',m.directory,4097)).toBe('');
    const text=sanitizeTrustedStartupText('€'.repeat(3000),m.directory);expect(Buffer.byteLength(text)).toBe(4095);expect(text).not.toContain('�');
  });
});
