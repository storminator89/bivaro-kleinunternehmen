import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

type Entry={kind:'file'|'directory'|'symlink';value:Buffer;uid:number;mode:number;nlink:number;ino:number;dev:number};
type Override=Partial<{size:number;uid:number;mode:number;nlink:number;ino:number;dev:number}>;
const m=vi.hoisted(()=>({entries:new Map<string,Entry>(),aliases:new Map<string,string>(),stats:new Map<string,Override>(),handles:new Map<string,Override>(),open:vi.fn(),lstat:vi.fn(),realpath:vi.fn(),mkdir:vi.fn(),mkdtemp:vi.fn(),writeFile:vi.fn(),readdir:vi.fn(),rm:vi.fn(),execute:vi.fn(),execFile:vi.fn(),log:vi.fn(),closed:[] as string[],reads:[] as {file:string;length:number}[],readFiles:[] as string[],compiler:'/usr/lib/jvm/java-21-openjdk-amd64/bin/javac',version:{stdout:'javac 21.0.8\n',stderr:''},pkg:{stdout:'21.0.8+9-1~deb13u1',stderr:''},rejectAt:0,extraOutput:'',chunkSize:Number.MAX_SAFE_INTEGER,truncated:new Set<string>(),appended:new Set<string>(),nonregularHandles:new Set<string>()}));
vi.mock('node:fs/promises',()=>({lstat:m.lstat,open:m.open,realpath:m.realpath,mkdir:m.mkdir,mkdtemp:m.mkdtemp,writeFile:m.writeFile,readdir:m.readdir,rm:m.rm}));
vi.mock('node:child_process',()=>({execFile:m.execFile}));
vi.mock('node:util',async original=>({...await original<typeof import('node:util')>(),promisify:()=>m.execute}));
vi.mock('node:os',()=>({tmpdir:()=>'/tmp'}));
// No vendor JAR is read. Only this exact synthetic sentinel is assigned the
// pinned vendor digest; every other source/class/JDK/module digest is real SHA256.
vi.mock('node:crypto',async original=>{
  const actual=await original<typeof import('node:crypto')>();
  return {...actual,createHash:(algorithm:string)=>{
    const hash=actual.createHash(algorithm),chunks:Buffer[]=[];
    const wrapper={update:(bytes:Uint8Array)=>{const value=Buffer.from(bytes);chunks.push(value);hash.update(value);return wrapper;},digest:()=>Buffer.concat(chunks).equals(Buffer.from('PINNED_OFFICIAL_JAR_VIRTUAL_DOUBLE'))?'19f6edd5c92841a38d9b3b018a555b7ba173b13e4e0d29edecc232e5ba6c1d70':hash.digest('hex')};return wrapper;
  }};
});
import { prepareForeignVerifierAdapter } from '../../scripts/foreign-pdf/prepare-verifier-adapter.mjs';
import { ADAPTER_MAIN,ADAPTER_CLASS,ADAPTER_SOURCE,ADAPTER_SOURCE_SHA256,OFFICIAL_CLI_SHA256,NEW_STREAM_MAX_BYTES,BUFFER_THRESHOLD_BYTES,COMPILER_FLAGS } from '../../scripts/foreign-pdf/adapter-identity.mjs';
const ROOT='/opt/verapdf',TEMP='/tmp/bivaro-verifier-compiler-unit',OUT=`${ROOT}/foreign-runtime/adapter`,JAR=`${ROOT}/bin/cli-1.30.3.jar`,SOURCE=fileURLToPath(new URL('../../scripts/foreign-pdf/ForeignVerifierMain.java',import.meta.url));
const PRIVATE='PRIVATE_CREDENTIAL_INPUT_NEVER_EXPOSE';
const SOURCE_BYTES=Buffer.from(`package org.bivaro.pdfa;

import org.verapdf.apps.GreenfieldCliWrapper;
import org.verapdf.io.SeekableInputStream;

/** Foreign-only stream storage configuration; official validation is unchanged. */
public final class ForeignVerifierMain {
    private ForeignVerifierMain() { }

    public static void main(String[] args) throws Exception {
        SeekableInputStream.setMaxStreamSize(2097152);
        SeekableInputStream.setMaxBufferSize(2097153);
        GreenfieldCliWrapper.main(args);
    }
}
`);
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const modules=()=>path.resolve(m.compiler,'../../lib/modules');
const compiledPath=()=>`${TEMP}/classes/${ADAPTER_CLASS}`;
function classBytes(){const header=Buffer.alloc(8);header.writeUInt32BE(0xcafebabe,0);header.writeUInt16BE(65,6);return Buffer.concat([header,Buffer.from(`${ADAPTER_MAIN.replaceAll('.','/')} synthetic-class-identity-only`)]);}
function add(file:string,kind:Entry['kind']='file',value=Buffer.alloc(0),mode=kind==='directory'?0o755:0o444){m.entries.set(file,{kind,value,uid:0,mode,nlink:kind==='directory'?2:1,ino:m.entries.size+1,dev:7});}
function entry(file:string){const item=m.entries.get(file);if(!item)throw Error('Synthetic missing entry');return item;}
function stat(file:string,overrides:Map<string,Override>){const e=entry(file);return {uid:e.uid,mode:e.mode,nlink:e.nlink,size:e.value.length,ino:e.ino,dev:e.dev,isFile:()=>e.kind==='file',isDirectory:()=>e.kind==='directory',isSymbolicLink:()=>e.kind==='symlink',...overrides.get(file)};}
function children(file:string){entry(file);const prefix=`${file}/`;return [...m.entries.keys()].filter(key=>key.startsWith(prefix)&&!key.slice(prefix.length).includes('/')).map(key=>key.slice(prefix.length));}
function compilerOutput(){for(const directory of ['classes/org','classes/org/bivaro','classes/org/bivaro/pdfa'])add(`${TEMP}/${directory}`,'directory');add(compiledPath(),'file',classBytes());if(m.extraOutput)add(`${TEMP}/${m.extraOutput}`,'file',Buffer.from('unexpected'));}
function expectNoPublication(){expect(m.writeFile.mock.calls.some(([file])=>file.startsWith(OUT))).toBe(false);expect(m.log).not.toHaveBeenCalled();expect(m.execFile).not.toHaveBeenCalled();}
beforeEach(()=>{
  vi.clearAllMocks();m.entries.clear();m.aliases.clear();m.stats.clear();m.handles.clear();m.closed=[];m.reads=[];m.readFiles=[];m.rejectAt=0;m.extraOutput='';m.chunkSize=Number.MAX_SAFE_INTEGER;m.truncated.clear();m.appended.clear();m.nonregularHandles.clear();m.compiler='/usr/lib/jvm/java-21-openjdk-amd64/bin/javac';m.version={stdout:'javac 21.0.8\n',stderr:''};m.pkg={stdout:'21.0.8+9-1~deb13u1',stderr:''};
  vi.spyOn(process,'getuid').mockReturnValue(0);vi.spyOn(console,'log').mockImplementation(m.log);
  for(const name of ['BIVARO_SECRET','JAVA_TOOL_OPTIONS','JDK_JAVA_OPTIONS','NODE_OPTIONS','CLASSPATH'])vi.stubEnv(name,PRIVATE);
  for(const directory of [ROOT,`${ROOT}/bin`,`${ROOT}/foreign-runtime`])add(directory,'directory');
  add(SOURCE,'file',Buffer.from(SOURCE_BYTES));add(JAR,'file',Buffer.from('PINNED_OFFICIAL_JAR_VIRTUAL_DOUBLE'));add(m.compiler,'file',Buffer.from('synthetic-javac-launcher'),0o555);add(modules(),'file',Buffer.from('synthetic-JDK-module-image'));
  m.realpath.mockImplementation(async(file:string)=>file==='/usr/bin/javac'?m.compiler:(m.aliases.get(file)??file));m.lstat.mockImplementation(async(file:string)=>stat(file,m.stats));
  m.open.mockImplementation(async(file:string,flags:number)=>{entry(file);expect(flags).toBe(constants.O_RDONLY|constants.O_NOFOLLOW);let cursor=0;return {stat:async()=>({...stat(file,m.handles),isFile:()=>!m.nonregularHandles.has(file)&&entry(file).kind==='file'}),readFile:async()=>{m.readFiles.push(file);return Buffer.from(entry(file).value);},read:async(buffer:Buffer,offset:number,length:number,position:number|null)=>{const start=position??cursor,original=entry(file).value,value=m.appended.has(file)?Buffer.concat([original,Buffer.from([0])]):m.truncated.has(file)?original.subarray(0,-1):original,bytesRead=Math.min(length,m.chunkSize,Math.max(0,value.length-start));value.copy(buffer,offset,start,start+bytesRead);cursor=start+bytesRead;m.reads.push({file,length});return {bytesRead,buffer};},close:vi.fn(async()=>{m.closed.push(file);})};});
  m.mkdtemp.mockImplementation(async(prefix:string)=>{expect(prefix).toBe('/tmp/bivaro-verifier-compiler-');add(TEMP,'directory',Buffer.alloc(0),0o700);return TEMP;});
  m.mkdir.mockImplementation(async(file:string,options:{recursive?:boolean;mode:number})=>{if(m.entries.has(file))throw Error('Synthetic EEXIST');if(options.recursive){const missing:string[]=[];for(let current=file;!m.entries.has(current);current=path.dirname(current))missing.unshift(current);for(const directory of missing)add(directory,'directory',Buffer.alloc(0),options.mode);}else add(file,'directory',Buffer.alloc(0),options.mode);});
  m.writeFile.mockImplementation(async(file:string,value:Uint8Array,options:{flag:string;mode:number})=>{expect(options.flag).toBe('wx');if(m.entries.has(file))throw Error('Synthetic EEXIST');add(file,'file',Buffer.from(value),options.mode);});m.readdir.mockImplementation(async(file:string)=>children(file));
  m.rm.mockImplementation(async(file:string)=>{for(const key of [...m.entries.keys()])if(key===file||key.startsWith(`${file}/`))m.entries.delete(key);});
  m.execFile.mockImplementation(()=>{throw Error('Forbidden actual child process');});
  m.execute.mockImplementation(async(_binary:string,args:string[])=>{if(m.rejectAt===m.execute.mock.calls.length)throw Error(PRIVATE);if(args[0]==='-version')return m.version;if(args[0]==='-W')return m.pkg;compilerOutput();return {stdout:'',stderr:''};});
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});

describe('trusted verifier adapter build (virtualFS and compiler doubles only)',()=>{
  it('pins the exact reviewed Java source and fixed no-processor Java21 compiler flags',()=>{
    expect(sha(SOURCE_BYTES)).toBe(ADAPTER_SOURCE_SHA256);expect(ADAPTER_SOURCE).toBe('ForeignVerifierMain.java');expect(ADAPTER_MAIN).toBe('org.bivaro.pdfa.ForeignVerifierMain');expect(ADAPTER_CLASS).toBe('org/bivaro/pdfa/ForeignVerifierMain.class');
    expect(COMPILER_FLAGS).toEqual(['--release','21','-proc:none','-g:none','-encoding','UTF-8']);expect(Object.isFrozen(COMPILER_FLAGS)).toBe(true);
    expect(NEW_STREAM_MAX_BYTES).toBe(2097152);expect(BUFFER_THRESHOLD_BYTES).toBe(2097153);
  });
  it('compiles only the pinned source with fixed vendor classpath and publishes complete provenance',async()=>{
    const manifest=await prepareForeignVerifierAdapter(ROOT);
    const options={cwd:TEMP,env:{PATH:'/usr/bin:/bin',HOME:TEMP,TMPDIR:TEMP,LANG:'C.UTF-8',TZ:'UTC'},timeout:30000,maxBuffer:4096,killSignal:'SIGKILL',shell:false};
    expect(m.execute.mock.calls).toEqual([[m.compiler,['-version'],options],['/usr/bin/dpkg-query',['-W','-f=${Version}','openjdk-21-jdk-headless'],options],[m.compiler,[...COMPILER_FLAGS,'-classpath',JAR,'-d',`${TEMP}/classes`,`${TEMP}/${ADAPTER_SOURCE}`],options]]);
    expect(manifest).toEqual({schema:1,purpose:'fixed-foreign-verifier-entry',mainClass:ADAPTER_MAIN,delegates:'org.verapdf.apps.GreenfieldCliWrapper',officialCliSha256:OFFICIAL_CLI_SHA256,source:{name:ADAPTER_SOURCE,bytes:SOURCE_BYTES.length,sha256:ADAPTER_SOURCE_SHA256},compiled:{name:ADAPTER_CLASS,bytes:classBytes().length,sha256:sha(classBytes())},compiler:{package:'openjdk-21-jdk-headless',packageVersion:m.pkg.stdout,version:'javac 21.0.8',launcherSha256:sha(Buffer.from('synthetic-javac-launcher')),moduleImageSha256:sha(Buffer.from('synthetic-JDK-module-image')),flags:[...COMPILER_FLAGS]},limits:{newStreamMaxBytes:2097152,bufferThresholdBytes:2097153}});
    expect(entry(`${OUT}/${ADAPTER_SOURCE}`).value).toEqual(SOURCE_BYTES);expect(entry(`${OUT}/classes/${ADAPTER_CLASS}`).value).toEqual(classBytes());expect(JSON.parse(entry(`${OUT}/manifest.json`).value.toString())).toEqual(manifest);
    for(const [file,,flags]of m.writeFile.mock.calls)expect(flags).toEqual({flag:'wx',mode:file.startsWith(OUT)?0o444:0o600});
    expect(m.rm).toHaveBeenCalledExactlyOnceWith(TEMP,{recursive:true,force:true});expect(m.closed).toHaveLength(m.open.mock.calls.length);expect(m.readFiles).toEqual([]);expect(m.reads.filter(read=>read.file!==modules()).every(read=>read.length<=(read.file===SOURCE?8193:read.file===JAR?64*1024*1024+1:read.file===compiledPath()?16385:1024*1024+1))).toBe(true);expect(m.reads.filter(read=>read.file===modules()).every(read=>read.length<=65536)).toBe(true);
    expect(m.log).toHaveBeenCalledOnce();expect(JSON.parse(m.log.mock.calls[0][0])).toEqual({event:'foreign-verifier-adapter-built',...manifest});expect(JSON.stringify(m.log.mock.calls)).not.toContain(PRIVATE);expect(m.execFile).not.toHaveBeenCalled();
  });
  it('accepts only the alternate explicitly pinned arm64 JDK21 installation',async()=>{
    m.compiler='/usr/lib/jvm/java-21-openjdk-arm64/bin/javac';add(m.compiler,'file',Buffer.from('synthetic-arm64-javac'),0o555);add(modules(),'file',Buffer.from('synthetic-arm64-modules'));
    await expect(prepareForeignVerifierAdapter(ROOT)).resolves.toMatchObject({compiler:{launcherSha256:sha(Buffer.from('synthetic-arm64-javac')),moduleImageSha256:sha(Buffer.from('synthetic-arm64-modules'))}});expect(m.execute.mock.calls[0][0]).toBe(m.compiler);
  });
  it.each(['','relative','../verapdf'])('rejects a nonabsolute distribution (%s) before source reads',async distribution=>{await expect(prepareForeignVerifierAdapter(distribution)).rejects.toThrow();expect(m.open).not.toHaveBeenCalled();expectNoPublication();});
  it('requires root for this build-only preparation',async()=>{vi.mocked(process.getuid!).mockReturnValue(1000);await expect(prepareForeignVerifierAdapter(ROOT)).rejects.toThrow();expect(m.realpath).not.toHaveBeenCalled();expectNoPublication();});
  it('rejects a noncanonical distribution',async()=>{m.aliases.set(ROOT,'/tmp/arbitrary');await expect(prepareForeignVerifierAdapter(ROOT)).rejects.toThrow();expect(m.open).not.toHaveBeenCalled();expectNoPublication();});
  it.each([SOURCE,JAR])('rejects a mismatched pinned input digest: %s',async file=>{entry(file).value=Buffer.from(PRIVATE);await expect(prepareForeignVerifierAdapter(ROOT)).rejects.toThrow('Trusted verifier adapter build unavailable');expect(m.execute).not.toHaveBeenCalled();expectNoPublication();});
  it.each(['/usr/bin/java','/tmp/javac','/usr/lib/jvm/java-17-openjdk-amd64/bin/javac','/usr/lib/jvm/java-21-openjdk-riscv64/bin/javac','/usr/lib/jvm/java-21-openjdk-amd64/bin/javac/evil'])('rejects arbitrary compiler/runtime path %s',async compiler=>{m.compiler=compiler;await expect(prepareForeignVerifierAdapter(ROOT)).rejects.toThrow();expect(m.execute).not.toHaveBeenCalled();expectNoPublication();});
  it.each(['javac 17.0.9','java 21.0.8','javac 21.0.8\n'+PRIVATE,'javac 21.1.2.3.4','',PRIVATE])('rejects a wrong or unbounded compiler version (%s)',async version=>{m.version={stdout:version,stderr:''};await expect(prepareForeignVerifierAdapter(ROOT)).rejects.toThrow('Trusted verifier adapter build unavailable');expect(m.execute).toHaveBeenCalledTimes(1);expect(m.writeFile).not.toHaveBeenCalled();expectNoPublication();expect(m.rm).toHaveBeenCalledTimes(1);});
  it('accepts the conventional stderr-only javac version banner',async()=>{m.version={stdout:'',stderr:'javac 21.0.8\n'};await expect(prepareForeignVerifierAdapter(ROOT)).resolves.toMatchObject({compiler:{version:'javac 21.0.8'}});});
  it.each(['',PRIVATE+'\ninvalid','1.0 invalid','1'.repeat(129)])('rejects an invalid package version (%s)',async version=>{m.pkg.stdout=version;await expect(prepareForeignVerifierAdapter(ROOT)).rejects.toThrow();expect(m.execute).toHaveBeenCalledTimes(2);expectNoPublication();});
  it('rejects package-query stderr even alongside an otherwise valid package version',async()=>{m.pkg.stderr=PRIVATE;await expect(prepareForeignVerifierAdapter(ROOT)).rejects.toThrow('Trusted verifier adapter build unavailable');expectNoPublication();});
  it.each([1,2,3])('fails closed and reaps the temporary tree after command %i rejects',async call=>{m.rejectAt=call;await expect(prepareForeignVerifierAdapter(ROOT)).rejects.toThrow('Trusted verifier adapter build unavailable');expect(m.execute).toHaveBeenCalledTimes(call);expectNoPublication();expect(m.rm).toHaveBeenCalledExactlyOnceWith(TEMP,{recursive:true,force:true});});
  it.each(['classes/Unexpected.class','classes/org/Unexpected.class','classes/org/bivaro/Unexpected.class','classes/org/bivaro/pdfa/Unexpected.class','classes/org/bivaro/pdfa/private-resource.txt'])('requires exactly one compiled class and no extra package/resource entries (%s)',async extra=>{m.extraOutput=extra;await expect(prepareForeignVerifierAdapter(ROOT)).rejects.toThrow('Trusted verifier adapter build unavailable');expectNoPublication();expect(m.rm).toHaveBeenCalledTimes(1);});
  it.each(['missing-class','bad-magic','nonzero-minor','wrong-major','wrong-identity','short-header'])('rejects an invalid compiled identity (%s)',async variant=>{
    const base=m.execute.getMockImplementation()!;m.execute.mockImplementation(async(...args)=>{const result=await base(...args);if(args[1][0]==='--release'){const value=entry(compiledPath()).value;if(variant==='missing-class')m.entries.delete(compiledPath());if(variant==='bad-magic')value.writeUInt32BE(0,0);if(variant==='nonzero-minor')value.writeUInt16BE(1,4);if(variant==='wrong-major')value.writeUInt16BE(64,6);if(variant==='wrong-identity')value.fill(0,8);if(variant==='short-header')entry(compiledPath()).value=Buffer.alloc(7);}return result;});
    await expect(prepareForeignVerifierAdapter(ROOT)).rejects.toThrow('Trusted verifier adapter build unavailable');expectNoPublication();expect(m.rm).toHaveBeenCalledTimes(1);
  });
  it.each(['source','jar','compiler','class'])('rejects symlinks or canonical-path substitutions for %s',async kind=>{
    const file=kind==='source'?SOURCE:kind==='jar'?JAR:kind==='compiler'?m.compiler:compiledPath();m.aliases.set(file,'/tmp/arbitrary');await expect(prepareForeignVerifierAdapter(ROOT)).rejects.toThrow();expectNoPublication();
  });
  it.each(['source','jar','compiler','class'])('rejects nonregular, linked or writable input objects for %s',async kind=>{
    const file=kind==='source'?SOURCE:kind==='jar'?JAR:kind==='compiler'?m.compiler:compiledPath();m.stats.set(file,{nlink:2,mode:0o666});await expect(prepareForeignVerifierAdapter(ROOT)).rejects.toThrow();expectNoPublication();
  });
  it.each(['source','jar','compiler','class'])('rejects zero or oversized declared input length for %s',async kind=>{
    const file=kind==='source'?SOURCE:kind==='jar'?JAR:kind==='compiler'?m.compiler:compiledPath();m.stats.set(file,{size:0});await expect(prepareForeignVerifierAdapter(ROOT)).rejects.toThrow();expectNoPublication();
  });
  it.each([
    ['source',8193],['jar',64*1024*1024+1],['compiler',1024*1024+1],['class',16385],['module',512*1024*1024+1],
  ])('rejects oversized declared %s bytes before opening the file',async(kind,size)=>{
    const file=kind==='source'?SOURCE:kind==='jar'?JAR:kind==='compiler'?m.compiler:kind==='class'?compiledPath():modules();m.stats.set(file,{size:Number(size)});
    await expect(prepareForeignVerifierAdapter(ROOT)).rejects.toThrow();expect(m.open.mock.calls.some(([opened])=>opened===file)).toBe(false);expectNoPublication();
  });
  it.each(['source','jar','compiler','class','module'])('rejects an actual nonregular %s object',async kind=>{
    const file=kind==='source'?SOURCE:kind==='jar'?JAR:kind==='compiler'?m.compiler:kind==='class'?compiledPath():modules();
    m.lstat.mockImplementation(async(target:string)=>{if(target===file)entry(target).kind='directory';return stat(target,m.stats);});
    await expect(prepareForeignVerifierAdapter(ROOT)).rejects.toThrow();expectNoPublication();
  });
  it('rejects a canonical-path substitution of the JDK module image',async()=>{
    m.aliases.set(modules(),'/tmp/arbitrary-module-image');await expect(prepareForeignVerifierAdapter(ROOT)).rejects.toThrow('Trusted verifier adapter build unavailable');expectNoPublication();expect(m.rm).toHaveBeenCalledTimes(1);
  });
  it.each(['source','jar','compiler','module'])('rejects a missing trusted %s input',async kind=>{
    const file=kind==='source'?SOURCE:kind==='jar'?JAR:kind==='compiler'?m.compiler:modules();m.entries.delete(file);
    await expect(prepareForeignVerifierAdapter(ROOT)).rejects.toThrow();expectNoPublication();
  });
  it.each(['ino','dev','size','nlink','uid','mode'])('rejects source descriptor %s changing across open',async field=>{m.handles.set(SOURCE,{[field]:field==='uid'?1000:field==='mode'?0o666:999999});await expect(prepareForeignVerifierAdapter(ROOT)).rejects.toThrow();expect(m.closed).toContain(SOURCE);expectNoPublication();});
  it.each(['uid','nlink','size','mode'])('rejects unsafe JDK module-image %s metadata',async field=>{m.stats.set(modules(),{[field]:field==='uid'?1000:field==='nlink'?2:field==='size'?0:0o666});await expect(prepareForeignVerifierAdapter(ROOT)).rejects.toThrow('Trusted verifier adapter build unavailable');expectNoPublication();expect(m.rm).toHaveBeenCalledTimes(1);});
  it.each(['ino','dev','size','uid','nlink','mode'])('rejects JDK module-image descriptor %s changing across open',async field=>{m.handles.set(modules(),{[field]:field==='uid'?1000:field==='mode'?0o666:999999});await expect(prepareForeignVerifierAdapter(ROOT)).rejects.toThrow('Trusted verifier adapter build unavailable');expect(m.closed).toContain(modules());expectNoPublication();});
  it('accepts short positional reads without changing source/class/module hashes',async()=>{
    m.chunkSize=3;await expect(prepareForeignVerifierAdapter(ROOT)).resolves.toMatchObject({source:{sha256:ADAPTER_SOURCE_SHA256},compiled:{sha256:sha(classBytes())},compiler:{moduleImageSha256:sha(Buffer.from('synthetic-JDK-module-image'))}});
    expect(m.reads.filter(read=>read.file===SOURCE).length).toBeGreaterThan(2);expect(m.readFiles).toEqual([]);expect(m.closed).toHaveLength(m.open.mock.calls.length);
  });
  it.each(['source','jar','compiler','class','module'])('rejects a short EOF inconsistent with declared %s bytes',async kind=>{
    const file=kind==='source'?SOURCE:kind==='jar'?JAR:kind==='compiler'?m.compiler:kind==='class'?compiledPath():modules();m.truncated.add(file);await expect(prepareForeignVerifierAdapter(ROOT)).rejects.toThrow();expect(m.closed).toContain(file);expectNoPublication();
  });
  it.each(['source','jar','compiler','class','module'])('rejects an extra byte beyond the declared %s EOF',async kind=>{
    const file=kind==='source'?SOURCE:kind==='jar'?JAR:kind==='compiler'?m.compiler:kind==='class'?compiledPath():modules();m.appended.add(file);await expect(prepareForeignVerifierAdapter(ROOT)).rejects.toThrow();expect(m.closed).toContain(file);expectNoPublication();
  });
  it.each(['source','module'])('rejects a nonregular %s descriptor after opening',async kind=>{
    const file=kind==='source'?SOURCE:modules();m.nonregularHandles.add(file);await expect(prepareForeignVerifierAdapter(ROOT)).rejects.toThrow();expect(m.closed).toContain(file);expectNoPublication();
  });
  it('does not overwrite a preexisting published adapter tree',async()=>{add(OUT,'directory');await expect(prepareForeignVerifierAdapter(ROOT)).rejects.toThrow('Trusted verifier adapter build unavailable');expectNoPublication();expect(m.rm).toHaveBeenCalledTimes(1);});
  it('fails closed on a partial final publication write and still cleans the temporary compiler tree',async()=>{const base=m.writeFile.getMockImplementation()!;m.writeFile.mockImplementation(async(...args)=>{if(args[0]===`${OUT}/manifest.json`)throw Error(PRIVATE);return base(...args);});await expect(prepareForeignVerifierAdapter(ROOT)).rejects.toThrow('Trusted verifier adapter build unavailable');expect(m.log).not.toHaveBeenCalled();expect(m.rm).toHaveBeenCalledTimes(1);});
  it('rejects rather than claiming a successful build when temporary-tree cleanup fails',async()=>{m.rm.mockRejectedValue(Error('Synthetic cleanup failed'));await expect(prepareForeignVerifierAdapter(ROOT)).rejects.toThrow('Synthetic cleanup failed');expect(m.rm).toHaveBeenCalledTimes(1);expect(m.execFile).not.toHaveBeenCalled();});
});
