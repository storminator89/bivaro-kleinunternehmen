import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { constants } from 'node:fs';

type Entry={kind:'file'|'directory'|'symlink';value:Buffer;uid:number;mode:number;nlink:number};
const m=vi.hoisted(()=>({
  files:new Map<string,Entry>(),aliases:new Map<string,string>(),open:vi.fn(),lstat:vi.fn(),realpath:vi.fn(),readdir:vi.fn(),mkdtemp:vi.fn(),writeFile:vi.fn(),rm:vi.fn(),spawn:vi.fn(),
  closes:[] as string[],reads:[] as string[],
}));
vi.mock('node:fs/promises',()=>({open:m.open,lstat:m.lstat,realpath:m.realpath,readdir:m.readdir,mkdtemp:m.mkdtemp,writeFile:m.writeFile,rm:m.rm}));
vi.mock('node:child_process',()=>({spawn:m.spawn}));
import { createFixtureProvenance,digest } from '../../scripts/foreign-pdf/fixture-provenance.mjs';
import { probeTrustedFixtureValidation,fixtureExitBucket } from '../../scripts/foreign-pdf/fixture-validation-probe.mjs';

const CHECKOUT='a'.repeat(40),FIXTURE='/tmp/foreign-pdf-test',WORK='/tmp/synthetic-fixture-unit',PDF=`${WORK}/final.pdf`,MANIFEST=`${FIXTURE}/fixture-provenance.json`;
const SOURCE=`${FIXTURE}/provenance/generator.mjs`,FONT=`${FIXTURE}/provenance/font.ttf`,LOCK=`${FIXTURE}/provenance/package-lock.json`;
const PDFKIT=`${FIXTURE}/node_modules/pdfkit/js/pdfkit.node.mjs`,PDFKIT_PACKAGE=`${FIXTURE}/node_modules/pdfkit/package.json`;
const CONFIG_NAMES=['app.xml','features.xml','fixer.xml','plugins.xml','validator.xml'];
const vector=Buffer.from('%PDF-1.7\nSYNTHETIC INERT MOCK BYTES; NEVER PARSED\n');
function add(file:string,value:Buffer|string='',kind:Entry['kind']='file',mode=kind==='directory'?0o700:0o644){m.files.set(file,{kind,value:Buffer.from(value),uid:1000,mode,nlink:kind==='directory'?2:1});}
function entry(file:string){const result=m.files.get(file);if(!result)throw Error('Synthetic missing file');return result;}
function stats(file:string){const value=entry(file);return {uid:value.uid,mode:value.mode,nlink:value.nlink,size:value.value.length,isFile:()=>value.kind==='file',isDirectory:()=>value.kind==='directory',isSymbolicLink:()=>value.kind==='symlink'};}
function children(dir:string){const prefix=`${dir}/`;return [...m.files.keys()].filter(file=>file.startsWith(prefix)&&!file.slice(prefix.length).includes('/')).map(file=>file.slice(prefix.length));}
function provenance(){return createFixtureProvenance({sourceCheckout:CHECKOUT,vector,generator:entry(SOURCE).value,font:entry(FONT).value,lock:entry(LOCK).value,pdfkit:entry(PDFKIT).value,pdfkitVersion:'0.20.2'});}
function rewrite(change:(value:ReturnType<typeof provenance>)=>void){const value=provenance();change(value);entry(MANIFEST).value=Buffer.from(JSON.stringify(value));}
function report(compliant=true){return {report:{jobs:[{itemDetails:{name:PDF,size:vector.length},validationResult:[{jobEndStatus:'normal',profileName:'PDF/A-3B validation profile',compliant,details:{passedRules:10,passedChecks:20,failedRules:compliant?0:1,failedChecks:compliant?0:1,ruleSummaries:compliant?[]:[{specification:'ISO 19005-3:2012',clause:'6.7.3',testNumber:1,failedChecks:1,description:'PRIVATE_DOCUMENT_DESCRIPTION',checks:[{context:'PRIVATE_DOCUMENT_CONTEXT'}],object:'PRIVATE_DOCUMENT_OBJECT'}]}}]}],batchSummary:{totalJobs:1,failedParsingJobs:0,failedEncryptedJobs:0,outOfMemory:0,veraExceptions:0,validationSummary:{totalJobCount:1,successfulJobCount:1,failedJobCount:0,compliantPdfaCount:compliant?1:0,nonCompliantPdfaCount:compliant?0:1}}}};}
function config(){return {templates:CONFIG_NAMES.map(name=>{const value=Buffer.from(`<synthetic-default name="${name}"/>`);return {name,bytes:value.length,sha256:digest(value)};})};}
function seed(){const evidence=config();add(`${WORK}/.verapdf`,'','directory');add(`${WORK}/.verapdf/config`,'','directory');for(const file of evidence.templates)add(`${WORK}/.verapdf/config/${file.name}`,`<synthetic-default name="${file.name}"/>`,'file',0o600);return evidence;}
let child:EventEmitter&{pid:number;stdout:EventEmitter;stderr:EventEmitter;kill:ReturnType<typeof vi.fn>};
let autoFinish=true,stdout:Buffer,stderr:Buffer,exit:number|null,signal:string|null,beforeClose:undefined|(()=>void);
const prepare=vi.fn(),assertOnly=vi.fn(),command=vi.fn(),factory=vi.fn(),spec=vi.fn();
const factories={prepareForeignVerifierConfig:prepare,assertForeignVerifierConfigOnly:assertOnly,foreignVerifierCommand:factory,veraPdfSpawnSpecification:spec};
async function flush(){for(let i=0;i<1000;i++)await Promise.resolve();}
beforeEach(()=>{
  vi.clearAllMocks();m.files.clear();m.aliases.clear();m.closes=[];m.reads=[];autoFinish=true;stdout=Buffer.from(JSON.stringify(report()));stderr=Buffer.alloc(0);exit=0;signal=null;beforeClose=undefined;
  vi.spyOn(process,'getuid').mockReturnValue(1000);vi.spyOn(process,'kill').mockReturnValue(true);
  add(`${FIXTURE}/vector-text.pdf`,vector);add(SOURCE,'SYNTHETIC GENERATOR SOURCE');add(FONT,'SYNTHETIC FONT BYTES');add(LOCK,'SYNTHETIC LOCK BYTES');add(PDFKIT,'SYNTHETIC ESM PDFKIT SOURCE');add(PDFKIT_PACKAGE,JSON.stringify({version:'0.20.2',exports:{'.':{node:{import:'./js/pdfkit.node.mjs'}}}}));add(MANIFEST,JSON.stringify(provenance()));
  m.realpath.mockImplementation(async file=>m.aliases.get(file)??file);m.lstat.mockImplementation(async file=>stats(file));m.readdir.mockImplementation(async file=>children(file));
  m.open.mockImplementation(async(file,flags)=>{expect(flags).toBe(constants.O_RDONLY|constants.O_NOFOLLOW);entry(file);return {stat:async()=>stats(file),read:async(buffer:Buffer,offset:number,length:number,position:number)=>{m.reads.push(file);const bytes=entry(file).value,bytesRead=Math.min(length,bytes.length-position);bytes.copy(buffer,offset,position,position+bytesRead);return {bytesRead,buffer};},close:async()=>{m.closes.push(file);}};});
  m.mkdtemp.mockImplementation(async prefix=>{expect(prefix).toMatch(/bivaro-foreign-fixture-$/u);add(WORK,'','directory');return WORK;});
  m.writeFile.mockImplementation(async(file,value,options)=>{expect(file).toBe(PDF);expect(options).toEqual({flag:'wx',mode:0o600});if(m.files.has(file))throw Error('Synthetic EEXIST');add(file,value,'file',options.mode);});
  m.rm.mockResolvedValue(undefined);
  prepare.mockImplementation(async(binary,directory)=>{expect(binary).toBe('/opt/verapdf/verapdf');expect(directory).toBe(WORK);return seed();});
  assertOnly.mockImplementation(async(directory)=>{expect(directory).toBe(WORK);expect(children(WORK)).toEqual(['.verapdf']);});
  command.mockImplementation(args=>['/usr/bin/setpriv','SYNTHETIC-UNCHANGED-POLICY','--','/usr/bin/java',...args]);factory.mockResolvedValue(command);
  spec.mockImplementation((binary,args,directory,confined)=>({binary:'/usr/bin/prlimit',args:['SYNTHETIC-UNCHANGED-CAPS',...confined(args)],options:{cwd:directory,detached:true,shell:false,env:{PATH:'/usr/bin:/bin',HOME:directory,LANG:'C.UTF-8'},stdio:['ignore','pipe','pipe']}}));
  m.spawn.mockImplementation(()=>{
    child=Object.assign(new EventEmitter(),{pid:987654,stdout:new EventEmitter(),stderr:new EventEmitter(),kill:vi.fn()});
    if(autoFinish)Promise.resolve().then(()=>{if(stdout.length)child.stdout.emit('data',stdout);if(stderr.length)child.stderr.emit('data',stderr);beforeClose?.();child.emit('exit',exit,signal);child.emit('close',exit,signal);});
    return child;
  });
});
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});

describe('fixed trusted synthetic fixture probe (mock fs/process only)',()=>{
  it('binds exact bytes and source provenance before using the unchanged supplied command/environment specification',async()=>{
    const output=await probeTrustedFixtureValidation(factories,CHECKOUT);
    expect(output).toMatchObject({event:'foreign-pdf-trusted-fixture-validation',outcome:'passed',exit:'0',report:{verdict:'coherent-compliant'},excerpt:'',provenance:provenance()});
    expect(m.writeFile).toHaveBeenCalledWith(PDF,vector,{flag:'wx',mode:0o600});expect(assertOnly).toHaveBeenCalledOnce();
    const args=['--flavour','3b','--format','json','--maxfailuresdisplayed','10','--loglevel','0',PDF];expect(spec).toHaveBeenCalledWith('/opt/verapdf/verapdf',args,WORK,command);
    const specification=spec.mock.results[0].value;expect(m.spawn).toHaveBeenCalledWith(specification.binary,specification.args,specification.options);
    expect(specification.options.env).not.toHaveProperty('DATABASE_URL');expect(specification.options.env).not.toHaveProperty('OPENAI_API_KEY');
    expect(process.kill).toHaveBeenCalledExactlyOnceWith(-987654,'SIGKILL');expect(m.rm).toHaveBeenCalledWith(WORK,{recursive:true,force:true});expect(m.closes).toHaveLength(m.open.mock.calls.length);
    expect(m.reads).toContain(PDFKIT);expect(m.reads).toContain(PDFKIT_PACKAGE);expect(m.reads).not.toContain(`${FIXTURE}/node_modules/pdfkit/js/pdfkit.js`);
    expect(m.reads).not.toContain(`${FIXTURE}/invoice.xml`);expect(m.reads.filter(file=>file.startsWith(FIXTURE))).toEqual([PDFKIT_PACKAGE,`${FIXTURE}/vector-text.pdf`,SOURCE,FONT,LOCK,PDFKIT,MANIFEST]);expect(m.reads.every(file=>file.startsWith(`${FIXTURE}/`)||file.startsWith(`${WORK}/`))).toBe(true);expect(m.reads.some(file=>file.startsWith('/app/'))).toBe(false);
  });
  it.each([
    ['name',(v:ReturnType<typeof provenance>)=>{v.fixture.name='customer.pdf';}],['hash',(v:ReturnType<typeof provenance>)=>{v.fixture.sha256='0'.repeat(64);}],['bytes',(v:ReturnType<typeof provenance>)=>{v.fixture.bytes++;}],
    ['checkout',(v:ReturnType<typeof provenance>)=>{v.sourceCheckout='b'.repeat(40);}],['generator',(v:ReturnType<typeof provenance>)=>{v.generatorSha256='0'.repeat(64);}],['font',(v:ReturnType<typeof provenance>)=>{v.fontSha256='0'.repeat(64);}],['lock',(v:ReturnType<typeof provenance>)=>{v.lockSha256='0'.repeat(64);}],
    ['pdfkit',(v:ReturnType<typeof provenance>)=>{v.pdfkit.sha256='0'.repeat(64);}],['version',(v:ReturnType<typeof provenance>)=>{v.pdfkit.version='0.20.3';}],['purpose',(v:ReturnType<typeof provenance>)=>{v.purpose='customer-data';}],['unknown-field',(v:ReturnType<typeof provenance>)=>{Object.assign(v,{privateData:'DO_NOT_LEAK'});}],
  ])('rejects mismatched/unknown %s before private preparation or spawn',async(_name,change)=>{
    rewrite(change);const result=await probeTrustedFixtureValidation(factories,CHECKOUT);expect(result.outcome).toBe('unavailable');expect(result).not.toHaveProperty('provenance');expect(prepare).not.toHaveBeenCalled();expect(m.spawn).not.toHaveBeenCalled();expect(JSON.stringify(result)).not.toContain('DO_NOT_LEAK');
  });
  it.each([undefined,{}, {'.':{}},{'.':{node:{import:'./js/pdfkit.js'}}},{'.':{node:{import:'PRIVATE_WRONG_ENTRY'}}}])('rejects missing/wrong ESM exports before reading fixture bytes or launching',async exports=>{
    entry(PDFKIT_PACKAGE).value=Buffer.from(JSON.stringify({version:'0.20.2',exports}));const output=await probeTrustedFixtureValidation(factories,CHECKOUT);expect(output.outcome).toBe('unavailable');expect(m.reads).toEqual([PDFKIT_PACKAGE]);expect(prepare).not.toHaveBeenCalled();expect(m.spawn).not.toHaveBeenCalled();expect(JSON.stringify(output)).not.toContain('PRIVATE_WRONG_ENTRY');
  });
  it.each(['','not-a-head','A'.repeat(40),undefined])('rejects invalid source-checkout binding %s before spawn',async head=>{expect((await probeTrustedFixtureValidation(factories,head)).outcome).toBe('unavailable');expect(m.spawn).not.toHaveBeenCalled();});
  it.each(['symlink','nonregular','hardlink','empty','oversize','writable','canonical'])('rejects unsafe fixed fixture source %s before spawn',async variant=>{
    const file=entry(`${FIXTURE}/vector-text.pdf`);if(variant==='symlink')file.kind='symlink';if(variant==='nonregular')file.kind='directory';if(variant==='hardlink')file.nlink=2;if(variant==='empty')file.value=Buffer.alloc(0);if(variant==='oversize')file.value=Buffer.alloc(20*1024*1024+1);if(variant==='writable')file.mode=0o666;if(variant==='canonical')m.aliases.set(`${FIXTURE}/vector-text.pdf`,'/customer.pdf');
    expect((await probeTrustedFixtureValidation(factories,CHECKOUT)).outcome).toBe('unavailable');expect(m.spawn).not.toHaveBeenCalled();
  });
  it('rejects a malformed provenance manifest without serializing parser errors',async()=>{entry(MANIFEST).value=Buffer.from('{PRIVATE_MANIFEST');const result=await probeTrustedFixtureValidation(factories,CHECKOUT);expect(m.spawn).not.toHaveBeenCalled();expect(JSON.stringify(result)).not.toContain('PRIVATE_MANIFEST');});
  it('rejects extra private data before a child can launch',async()=>{prepare.mockImplementationOnce(async()=>{const evidence=seed();add(`${WORK}/customer.xml`,'PRIVATE');return evidence;});const result=await probeTrustedFixtureValidation(factories,CHECKOUT);expect(result.outcome).toBe('unavailable');expect(m.spawn).not.toHaveBeenCalled();expect(m.rm).toHaveBeenCalledOnce();});
  it.each(['extra-file','input-bytes','config-bytes','mode','owner','symlink','hardlink'])('rejects changed private tree after launch (%s), never leaking child output',async variant=>{
    stdout=Buffer.from('PRIVATE_CHILD_OUTPUT');exit=6;beforeClose=()=>{if(variant==='extra-file')add(`${WORK}/secret.xml`,'PRIVATE');if(variant==='input-bytes')entry(PDF).value[0]^=1;const target=entry(`${WORK}/.verapdf/config/app.xml`);if(variant==='config-bytes')target.value[0]^=1;if(variant==='mode')target.mode=0o644;if(variant==='owner')target.uid=0;if(variant==='symlink')target.kind='symlink';if(variant==='hardlink')target.nlink=2;};
    const output=await probeTrustedFixtureValidation(factories,CHECKOUT);expect(output.outcome).toBe('unavailable');expect(output.excerpt).toBe('');expect(JSON.stringify(output)).not.toContain('PRIVATE_CHILD_OUTPUT');expect(m.rm).toHaveBeenCalledOnce();
  });
  it('emits only closed rule identities/counts for coherent noncompliance even if stderr contains private text',async()=>{
    stdout=Buffer.from(JSON.stringify(report(false)));stderr=Buffer.from('PRIVATE_STDERR');exit=1;const output=await probeTrustedFixtureValidation(factories,CHECKOUT);
    expect(output).toMatchObject({outcome:'nonzero-exit',exit:'1',excerpt:'',report:{verdict:'coherent-noncompliant',failedRules:1,failedChecks:1,rules:[{specification:'ISO 19005-3:2012',clause:'6.7.3',testNumber:1,failedChecks:1}]}});expect(JSON.stringify(output)).not.toContain('PRIVATE_');
  });
  it('limits malformed/infrastructure-only excerpts to4KiB and removes paths, credentials and terminal controls',async()=>{
    stdout=Buffer.from(`failure at ${WORK}/final.pdf /private/customer.pdf\napi_key=PRIVATE_CREDENTIAL\n\u001b[31m${'界'.repeat(5000)}`);exit=6;
    const output=await probeTrustedFixtureValidation(factories,CHECKOUT);expect(output.report.verdict).toBe('no-coherent-report');expect(Buffer.byteLength(output.excerpt)).toBeLessThanOrEqual(4096);expect(output.excerpt).not.toContain(WORK);expect(output.excerpt).not.toContain('/private/customer.pdf');expect(output.excerpt).not.toContain('PRIVATE_CREDENTIAL');expect(output.excerpt).not.toContain('\u001b');expect(output.excerpt).not.toContain('\uFFFD');
  });
  it('diagnoses an exit0 malformed report rather than suppressing its bounded synthetic excerpt',async()=>{stdout=Buffer.from('INVALID_SYNTHETIC_REPORT');const output=await probeTrustedFixtureValidation(factories,CHECKOUT);expect(output.report.verdict).toBe('no-coherent-report');expect(output.excerpt).toContain('INVALID_SYNTHETIC_REPORT');});
  it('suppresses unexpected exception messages and still cleans up an allocated private directory',async()=>{factory.mockRejectedValueOnce(new Error('PRIVATE_FACTORY_ERROR'));const output=await probeTrustedFixtureValidation(factories,CHECKOUT);expect(output.outcome).toBe('unavailable');expect(JSON.stringify(output)).not.toContain('PRIVATE_FACTORY_ERROR');expect(m.rm).toHaveBeenCalledOnce();});
  it('handles synchronous spawn failure without leaking the thrown error',async()=>{m.spawn.mockImplementationOnce(()=>{throw Error('PRIVATE_SPAWN_ERROR');});const output=await probeTrustedFixtureValidation(factories,CHECKOUT);expect(output.outcome).toBe('launch-error');expect(JSON.stringify(output)).not.toContain('PRIVATE_SPAWN_ERROR');expect(m.rm).toHaveBeenCalledOnce();});
  it('fails closed on cleanup errors without retaining any child excerpt',async()=>{stdout=Buffer.from('PRIVATE_OUTPUT');exit=6;m.rm.mockRejectedValueOnce(Error('PRIVATE_CLEANUP'));const output=await probeTrustedFixtureValidation(factories,CHECKOUT);expect(output).toMatchObject({outcome:'cleanup-unavailable',exit:'other',report:{verdict:'no-coherent-report'},excerpt:''});expect(JSON.stringify(output)).not.toContain('PRIVATE_');});
  it('kills the group on excess output and never includes the rejected chunk',async()=>{stdout=Buffer.alloc(2*1024*1024+1,65);exit=1;const output=await probeTrustedFixtureValidation(factories,CHECKOUT);expect(output.outcome).toBe('output-limit');expect(output.excerpt).not.toContain('AAAA');expect(process.kill).toHaveBeenCalledExactlyOnceWith(-987654,'SIGKILL');});
  it('waits for close/reaping before inspecting/removing private files',async()=>{
    autoFinish=false;const pending=probeTrustedFixtureValidation(factories,CHECKOUT);await flush();expect(m.spawn).toHaveBeenCalledOnce();child.emit('exit',1,null);await flush();expect(m.rm).not.toHaveBeenCalled();child.emit('close',1,null);await pending;expect(m.rm).toHaveBeenCalledOnce();expect(process.kill).toHaveBeenCalledOnce();
  });
  it('drains a split coherent noncompliance report after exit1 until close, with numeric-only output',async()=>{
    autoFinish=false;const bytes=Buffer.from(JSON.stringify(report(false))),split=Math.floor(bytes.length/2);
    const pending=probeTrustedFixtureValidation(factories,CHECKOUT);let settled=false;void pending.then(()=>{settled=true;});await flush();
    child.stdout.emit('data',bytes.subarray(0,split));child.emit('exit',1,null);await flush();expect(settled).toBe(false);expect(m.rm).not.toHaveBeenCalled();
    child.stdout.emit('data',bytes.subarray(split));child.stderr.emit('data',Buffer.from('PRIVATE_LATE_STDERR'));await flush();expect(settled).toBe(false);expect(m.rm).not.toHaveBeenCalled();
    child.emit('close',1,null);const output=await pending;
    expect(output).toMatchObject({outcome:'nonzero-exit',exit:'1',report:{verdict:'coherent-noncompliant',failedRules:1,failedChecks:1,rules:[{specification:'ISO 19005-3:2012',clause:'6.7.3',testNumber:1,failedChecks:1}]},excerpt:''});
    expect(JSON.stringify(output)).not.toContain('PRIVATE_');expect(m.rm).toHaveBeenCalledOnce();expect(process.kill).toHaveBeenCalledExactlyOnceWith(-987654,'SIGKILL');
  });
  it('does not mistake a report followed by late JSON junk after exit1 for coherent noncompliance',async()=>{
    autoFinish=false;const pending=probeTrustedFixtureValidation(factories,CHECKOUT);await flush();child.stdout.emit('data',Buffer.from(JSON.stringify(report(false))));child.emit('exit',1,null);
    child.stdout.emit('data',Buffer.from('LATE_SYNTHETIC_JUNK'));await flush();expect(m.rm).not.toHaveBeenCalled();child.emit('close',1,null);const output=await pending;
    expect(output).toMatchObject({outcome:'nonzero-exit',exit:'1',report:{verdict:'no-coherent-report'}});expect(output.excerpt).toContain('LATE_SYNTHETIC_JUNK');expect(Buffer.byteLength(output.excerpt)).toBeLessThanOrEqual(4096);expect(m.rm).toHaveBeenCalledOnce();
  });
  it('enforces the combined output cap on post-exit chunks and stops capturing after an actual abort',async()=>{
    autoFinish=false;const pending=probeTrustedFixtureValidation(factories,CHECKOUT);await flush();child.stdout.emit('data',Buffer.from('SYNTHETIC_PREFIX'));child.emit('exit',1,null);
    child.stdout.emit('data',Buffer.alloc(2*1024*1024,65));child.stdout.emit('data',Buffer.from('PRIVATE_AFTER_ABORT'));child.stderr.emit('data',Buffer.from('PRIVATE_LATE_STDERR'));await flush();expect(m.rm).not.toHaveBeenCalled();
    child.emit('close',1,null);const output=await pending;expect(output.outcome).toBe('output-limit');expect(output.excerpt).toContain('SYNTHETIC_PREFIX');expect(output.excerpt).not.toContain('AAAA');expect(output.excerpt).not.toContain('PRIVATE_');expect(Buffer.byteLength(output.excerpt)).toBeLessThanOrEqual(4096);expect(process.kill).toHaveBeenCalledExactlyOnceWith(-987654,'SIGKILL');expect(m.rm).toHaveBeenCalledOnce();
  });
  it('uses the unchanged30s timeout, kills once and awaits close before cleanup',async()=>{
    vi.useFakeTimers();autoFinish=false;const pending=probeTrustedFixtureValidation(factories,CHECKOUT);await flush();await vi.advanceTimersByTimeAsync(29_999);expect(process.kill).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1);expect(process.kill).toHaveBeenCalledExactlyOnceWith(-987654,'SIGKILL');expect(m.rm).not.toHaveBeenCalled();child.emit('close',null,'SIGKILL');expect((await pending).outcome).toBe('timeout');expect(m.rm).toHaveBeenCalledOnce();
  });
  it('treats stream errors as fatal and awaits close without serializing messages',async()=>{
    autoFinish=false;const pending=probeTrustedFixtureValidation(factories,CHECKOUT);await flush();child.stderr.emit('error',Error('PRIVATE_STREAM_ERROR'));expect(process.kill).toHaveBeenCalledOnce();expect(m.rm).not.toHaveBeenCalled();child.emit('close',1,null);const output=await pending;expect(output.outcome).toBe('stream-error');expect(JSON.stringify(output)).not.toContain('PRIVATE_STREAM_ERROR');
  });
  it.each([0,1,2,3,4,6,7,8,9,10,11,12,22,70,126,127])('allows only fixed exit bucket %s',code=>{expect(fixtureExitBucket(code)).toBe(String(code));});
  it.each([5,13,-1,128,null,undefined,'1',{toString(){throw Error('NO_COERCION');}}])('does not coerce unknown exit values',code=>{expect(fixtureExitBucket(code)).toBe('other');});
});
