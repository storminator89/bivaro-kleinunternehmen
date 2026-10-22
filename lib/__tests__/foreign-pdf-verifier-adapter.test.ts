import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
type Entry={kind:'file'|'directory'|'symlink';value:Buffer;uid:number;mode:number;nlink:number;ino:number;dev:number};
type Override=Partial<{uid:number;mode:number;nlink:number;ino:number;dev:number;size:number}>;
const m=vi.hoisted(()=>({files:new Map<string,Entry>(),aliases:new Map<string,string>(),handles:new Map<string,Override>(),metadata:new Map<string,Override>(),open:vi.fn(),lstat:vi.fn(),realpath:vi.fn(),readdir:vi.fn(),closed:[]as string[],reads:[]as {file:string;length:number}[]}));
vi.mock('node:fs/promises',()=>({open:m.open,lstat:m.lstat,realpath:m.realpath,readdir:m.readdir}));
// The official JAR is NOT included/loaded/executed by this pure unit suite.
// Model its digest only for one inert marker; all source/class/manifest hashes
// use real SHA-256. Actual official JAR/compiler/source equivalence remains a
// separate mandatory hosted-image/build-evidence requirement.
vi.mock('node:crypto',async importOriginal=>{
  const actual=await importOriginal<typeof import('node:crypto')>();
  return {...actual,createHash:(algorithm:string)=>{let value=Buffer.alloc(0);return {update(bytes:Uint8Array){value=Buffer.concat([value,Buffer.from(bytes)]);return this;},digest(){return value.equals(Buffer.from('INERT OFFICIAL JAR DIGEST FIXTURE'))?'19f6edd5c92841a38d9b3b018a555b7ba173b13e4e0d29edecc232e5ba6c1d70':actual.createHash(algorithm).update(value).digest('hex');}};}};
});
import { requireForeignVerifierAdapterEvidence,verifyForeignVerifierAdapter } from '@/lib/server/foreign-pdf-verifier-adapter';
import { ADAPTER_MAIN,ADAPTER_CLASS,ADAPTER_SOURCE,ADAPTER_SOURCE_SHA256,OFFICIAL_CLI_SHA256,NEW_STREAM_MAX_BYTES,BUFFER_THRESHOLD_BYTES,COMPILER_FLAGS } from '../../scripts/foreign-pdf/adapter-identity.mjs';
const ROOT='/opt/verapdf',ADAPTER=`${ROOT}/foreign-runtime/adapter`,MANIFEST=`${ADAPTER}/manifest.json`,SOURCE=`${ADAPTER}/${ADAPTER_SOURCE}`,CLASS=`${ADAPTER}/classes/${ADAPTER_CLASS}`,JAR=`${ROOT}/bin/cli-1.30.3.jar`;
const source=Buffer.from(`package org.bivaro.pdfa;\n\nimport org.verapdf.apps.GreenfieldCliWrapper;\nimport org.verapdf.io.SeekableInputStream;\n\n/** Foreign-only stream storage configuration; official validation is unchanged. */\npublic final class ForeignVerifierMain {\n    private ForeignVerifierMain() { }\n\n    public static void main(String[] args) throws Exception {\n        SeekableInputStream.setMaxStreamSize(2097152);\n        SeekableInputStream.setMaxBufferSize(2097153);\n        GreenfieldCliWrapper.main(args);\n    }\n}\n`);
const sha=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
function add(file:string,value:Buffer|string='',kind:Entry['kind']='file'){m.files.set(file,{kind,value:Buffer.from(value),uid:0,mode:kind==='directory'?0o755:0o444,nlink:kind==='directory'?2:1,ino:m.files.size+1,dev:99});}
function entry(file:string){const value=m.files.get(file);if(!value)throw Error('Synthetic missing asset');return value;}
function stat(file:string,overrides=new Map<string,Override>()){const value=entry(file);return {...value,size:value.value.length,isFile:()=>value.kind==='file',isDirectory:()=>value.kind==='directory',isSymbolicLink:()=>value.kind==='symlink',...overrides.get(file)};}
function children(dir:string){entry(dir);const prefix=`${dir}/`;return [...m.files.keys()].filter(file=>file.startsWith(prefix)&&!file.slice(prefix.length).includes('/')).map(file=>file.slice(prefix.length));}
function evidence(){return {schema:1,purpose:'fixed-foreign-verifier-entry',mainClass:ADAPTER_MAIN,delegates:'org.verapdf.apps.GreenfieldCliWrapper',officialCliSha256:OFFICIAL_CLI_SHA256,source:{name:ADAPTER_SOURCE,bytes:source.length,sha256:ADAPTER_SOURCE_SHA256},compiled:{name:ADAPTER_CLASS,bytes:entry(CLASS).value.length,sha256:sha(entry(CLASS).value)},compiler:{package:'openjdk-21-jdk-headless',packageVersion:'21.0.12+1-1~deb13u1',version:'javac 21.0.12',launcherSha256:'1'.repeat(64),moduleImageSha256:'2'.repeat(64),flags:[...COMPILER_FLAGS]},limits:{newStreamMaxBytes:NEW_STREAM_MAX_BYTES,bufferThresholdBytes:BUFFER_THRESHOLD_BYTES}};}
function rewrite(change:(value:ReturnType<typeof evidence>)=>void){const value=evidence();change(value);entry(MANIFEST).value=Buffer.from(JSON.stringify(value));}
beforeEach(()=>{
  vi.clearAllMocks();m.files.clear();m.aliases.clear();m.handles.clear();m.metadata.clear();m.closed=[];m.reads=[];
  for(const dir of [ADAPTER,`${ADAPTER}/classes`,`${ADAPTER}/classes/org`,`${ADAPTER}/classes/org/bivaro`,`${ADAPTER}/classes/org/bivaro/pdfa`])add(dir,'','directory');
  add(SOURCE,source);
  // Inert class-header marker only, NOT compiled/valid Java bytecode evidence.
  const header=Buffer.alloc(8);header.writeUInt32BE(0xcafebabe);header.writeUInt16BE(65,6);add(CLASS,Buffer.concat([header,Buffer.from(ADAPTER_MAIN.replaceAll('.','/'))]));add(JAR,'INERT OFFICIAL JAR DIGEST FIXTURE');add(MANIFEST,JSON.stringify(evidence()));
  m.realpath.mockImplementation(async file=>m.aliases.get(file)??file);m.lstat.mockImplementation(async file=>stat(file,m.metadata));m.readdir.mockImplementation(async dir=>children(dir));
  m.open.mockImplementation(async(file,flags)=>{entry(file);expect(flags).toBe(constants.O_RDONLY|constants.O_NOFOLLOW);return {stat:async()=>stat(file,m.handles),read:async(buffer:Buffer,offset:number,length:number,position:number)=>{m.reads.push({file,length});const value=entry(file).value,bytesRead=Math.min(length,value.length-position);value.copy(buffer,offset,position,position+bytesRead);return {bytesRead,buffer};},close:async()=>{m.closed.push(file);}};});
});
afterEach(()=>vi.restoreAllMocks());
describe('fixed foreign verifier adapter identity (virtual filesystem; no compiler/JVM)',()=>{
  it('pins exact reviewed source, original wrapper, Java21 compiler recipe and N/N+1 constants',()=>{
    expect(ADAPTER_MAIN).toBe('org.bivaro.pdfa.ForeignVerifierMain');expect(ADAPTER_CLASS).toBe('org/bivaro/pdfa/ForeignVerifierMain.class');expect(ADAPTER_SOURCE).toBe('ForeignVerifierMain.java');
    expect(sha(source)).toBe(ADAPTER_SOURCE_SHA256);expect(ADAPTER_SOURCE_SHA256).toBe('6ead7b6d5f29551359661e8b077dd43461af4c9a3d4608a9812e96c2465484b9');expect(OFFICIAL_CLI_SHA256).toBe('19f6edd5c92841a38d9b3b018a555b7ba173b13e4e0d29edecc232e5ba6c1d70');
    expect(NEW_STREAM_MAX_BYTES).toBe(2*1024*1024);expect(BUFFER_THRESHOLD_BYTES).toBe(NEW_STREAM_MAX_BYTES+1);expect(COMPILER_FLAGS).toEqual(['--release','21','-proc:none','-g:none','-encoding','UTF-8']);expect(Object.isFrozen(COMPILER_FLAGS)).toBe(true);
  });
  it('checks actual bounded source/class/JAR bytes, closes all descriptors and never changes immutable assets',async()=>{
    const before=JSON.stringify([...m.files]);expect(await verifyForeignVerifierAdapter(ROOT)).toEqual(evidence());expect(JSON.stringify([...m.files])).toBe(before);
    expect(m.reads.map(read=>read.file)).toEqual([MANIFEST,SOURCE,CLASS,JAR].flatMap(file=>[file,file]));expect(m.closed).toEqual([MANIFEST,SOURCE,CLASS,JAR]);
    for(const [index,read]of m.reads.entries())expect(read.length).toBe(index%2?1:entry(read.file).value.length+1);
    expect(requireForeignVerifierAdapterEvidence(evidence())).toEqual(evidence());
  });
  it.each(['schema','purpose','main','delegates','official-jar','source-name','source-pin','source-size','class-name','class-hash','class-size','compiler-package','compiler-package-version','compiler-version','compiler-launcher','compiler-modules','compiler-flags-order','compiler-flags-extra','compiler-flags-missing','stream-max','buffer-threshold','unknown-root','unknown-source','unknown-class','unknown-compiler','unknown-limits'])('rejects mismatched or unknown manifest identity %s',async variant=>{
    rewrite(value=>{
      if(variant==='schema')value.schema=2;if(variant==='purpose')value.purpose='configurable-validator';if(variant==='main')value.mainClass='org.verapdf.cli.VeraPdfCli';if(variant==='delegates')value.delegates='org.verapdf.cli.VeraPdfCli';if(variant==='official-jar')value.officialCliSha256='0'.repeat(64);
      if(variant==='source-name')value.source.name='../Other.java';if(variant==='source-pin')value.source.sha256='0'.repeat(64);if(variant==='source-size')value.source.bytes=8193;if(variant==='class-name')value.compiled.name='org/verapdf/apps/GreenfieldCliWrapper.class';if(variant==='class-hash')value.compiled.sha256='unknown';if(variant==='class-size')value.compiled.bytes=16385;
      if(variant==='compiler-package')value.compiler.package='unreviewed-jdk';if(variant==='compiler-package-version')value.compiler.packageVersion='21\nPRIVATE';if(variant==='compiler-version')value.compiler.version='javac 22.0.1';if(variant==='compiler-launcher')value.compiler.launcherSha256='unknown';if(variant==='compiler-modules')value.compiler.moduleImageSha256='unknown';if(variant==='compiler-flags-order')value.compiler.flags.reverse();if(variant==='compiler-flags-extra')value.compiler.flags.push('--enable-preview');if(variant==='compiler-flags-missing')value.compiler.flags.splice(2,1);
      if(variant==='stream-max')value.limits.newStreamMaxBytes++;if(variant==='buffer-threshold')value.limits.bufferThresholdBytes--;
      if(variant==='unknown-root')Object.assign(value,{unexpected:true});if(variant==='unknown-source')Object.assign(value.source,{unexpected:true});if(variant==='unknown-class')Object.assign(value.compiled,{unexpected:true});if(variant==='unknown-compiler')Object.assign(value.compiler,{unexpected:true});if(variant==='unknown-limits')Object.assign(value.limits,{unexpected:true});
    });await expect(verifyForeignVerifierAdapter(ROOT)).rejects.toThrow();expect(m.open.mock.calls.map(([file])=>file)).toEqual([MANIFEST]);expect(m.closed).toEqual([MANIFEST]);
  });
  it.each([null,undefined,[],{},'unknown'])('rejects nonmanifest values without trusting claims (%j)',value=>{expect(()=>requireForeignVerifierAdapterEvidence(value)).toThrow();});
  it.each(['','relative'])('requires an absolute distribution root (%s)',async root=>{await expect(verifyForeignVerifierAdapter(root)).rejects.toThrow();expect(m.open).not.toHaveBeenCalled();});
  it.each([MANIFEST,SOURCE,CLASS,JAR])('rejects altered actual bytes despite metadata claims: %s',async file=>{
    entry(file).value=Buffer.concat([entry(file).value,Buffer.from('modified')]);await expect(verifyForeignVerifierAdapter(ROOT)).rejects.toThrow();expect(m.closed).toHaveLength(m.open.mock.calls.length);
  });
  it.each([SOURCE,CLASS,JAR])('compares actual hashes even when altered bytes retain their claimed size: %s',async file=>{
    entry(file).value[entry(file).value.length-1]^=1;await expect(verifyForeignVerifierAdapter(ROOT)).rejects.toThrow();expect(m.closed).toContain(file);
  });
  it('accepts bounded partial reads only after exact EOF and retains all immutable byte checks',async()=>{
    const original=m.open.getMockImplementation()!;m.open.mockImplementation(async(file,flags)=>{const handle=await original(file,flags);return {...handle,read:async(buffer:Buffer,offset:number,length:number,position:number)=>handle.read(buffer,offset,Math.min(length,7),position)};});
    expect(await verifyForeignVerifierAdapter(ROOT)).toEqual(evidence());expect(m.closed).toEqual([MANIFEST,SOURCE,CLASS,JAR]);
  });
  it.each(['magic','minor','major','main-name'])('rejects an invalid class header/identity even with a matching claimed digest (%s)',async variant=>{
    const bytes=entry(CLASS).value;if(variant==='magic')bytes.writeUInt32BE(0);if(variant==='minor')bytes.writeUInt16BE(65535,4);if(variant==='major')bytes.writeUInt16BE(66,6);if(variant==='main-name')bytes.fill(65,8);rewrite(()=>{});
    await expect(verifyForeignVerifierAdapter(ROOT)).rejects.toThrow();expect(m.closed).toContain(CLASS);
  });
  it.each(['unknown-file','extra-class','nested-class','official-shadow','source-shadow'])('rejects extra files/classes capable of shadowing official/application code (%s)',async variant=>{
    if(variant==='unknown-file')add(`${ADAPTER}/unexpected.txt`,'inert');if(variant==='extra-class')add(`${ADAPTER}/classes/org/bivaro/pdfa/ForeignVerifierMain$1.class`,'inert');if(variant==='nested-class')add(`${ADAPTER}/classes/Other.class`,'inert');if(variant==='official-shadow')add(`${ADAPTER}/classes/org/verapdf`,'','directory');if(variant==='source-shadow')add(`${ADAPTER}/Other.java`,'inert');
    await expect(verifyForeignVerifierAdapter(ROOT)).rejects.toThrow();expect(m.open).not.toHaveBeenCalled();
  });
  it.each(['owner','write','symlink','not-directory'])('requires safe canonical root-owned classpath directories (%s)',async variant=>{
    const dir=entry(`${ADAPTER}/classes/org`);if(variant==='owner')dir.uid=1000;if(variant==='write')dir.mode=0o775;if(variant==='symlink')dir.kind='symlink';if(variant==='not-directory')dir.kind='file';await expect(verifyForeignVerifierAdapter(ROOT)).rejects.toThrow();expect(m.open).not.toHaveBeenCalled();
  });
  it.each([ADAPTER,`${ADAPTER}/classes/org/bivaro`,MANIFEST,SOURCE,CLASS,JAR])('rejects canonical/symlink boundary changes (%s)',async file=>{m.aliases.set(file,'/outside/untrusted');await expect(verifyForeignVerifierAdapter(ROOT)).rejects.toThrow();expect(m.open.mock.calls.some(([opened])=>opened===file)).toBe(false);});
  it.each(['owner','writable','symlink','nonregular','hardlink','empty','oversize'])('requires bounded root-owned immutable regular files (%s)',async variant=>{
    const file=entry(SOURCE);if(variant==='owner')file.uid=1000;if(variant==='writable')file.mode=0o446;if(variant==='symlink')file.kind='symlink';if(variant==='nonregular')file.kind='directory';if(variant==='hardlink')file.nlink=2;if(variant==='empty')file.value=Buffer.alloc(0);if(variant==='oversize')m.metadata.set(SOURCE,{size:8193});
    await expect(verifyForeignVerifierAdapter(ROOT)).rejects.toThrow();expect(m.open.mock.calls.some(([opened])=>opened===SOURCE)).toBe(false);
  });
  it.each(['inode','device','size','owner','mode','hardlink'])('rechecks descriptor metadata and closes on opened-file race (%s)',async variant=>{
    const original=entry(SOURCE);m.handles.set(SOURCE,variant==='inode'?{ino:original.ino+1}:variant==='device'?{dev:original.dev+1}:variant==='size'?{size:original.value.length-1}:variant==='owner'?{uid:1000}:variant==='mode'?{mode:0o666}:{nlink:2});
    await expect(verifyForeignVerifierAdapter(ROOT)).rejects.toThrow();expect(m.closed).toContain(SOURCE);
  });
  it('closes descriptors on short reads and never accepts truncated source bytes',async()=>{
    let count=0;m.open.mockImplementationOnce(async()=>({stat:async()=>stat(MANIFEST),read:async()=>({bytesRead:count++?0:entry(MANIFEST).value.length-1}),close:async()=>{m.closed.push(MANIFEST);}}));await expect(verifyForeignVerifierAdapter(ROOT)).rejects.toThrow();expect(m.closed).toEqual([MANIFEST]);
  });
});
