import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';

type Entry={kind:'file'|'directory'|'symlink';uid:number;mode:number;nlink:number;value:Buffer};
type StatOverride=Partial<{uid:number;mode:number;nlink:number;size:number}>;
const m=vi.hoisted(()=>({
  entries:new Map<string,Entry>(),aliases:new Map<string,string>(),lstatOverrides:new Map<string,StatOverride>(),handleOverrides:new Map<string,StatOverride>(),
  open:vi.fn(),realpath:vi.fn(),lstat:vi.fn(),mkdir:vi.fn(),writeFile:vi.fn(),readdir:vi.fn(),closed:[] as string[],reads:[] as {file:string;length:number}[],
}));
vi.mock('node:fs/promises',()=>({open:m.open,realpath:m.realpath,lstat:m.lstat,mkdir:m.mkdir,writeFile:m.writeFile,readdir:m.readdir}));
import { prepareForeignVerifierConfig,assertForeignVerifierConfigOnly,FOREIGN_CONFIG_NAMES,FOREIGN_LOGGING_PROPERTIES,type ForeignVerifierConfigEvidence } from '@/lib/server/foreign-pdf-verifier-config';
const ROOT='/opt/verapdf',ASSETS=`${ROOT}/foreign-runtime`,WORK='/tmp/private-config-unit',PRIVATE=`${WORK}/.verapdf/config`;
const MANIFEST=`${ASSETS}/manifest.json`,LOGGING=`${ASSETS}/classes/org/verapdf/processor/logging.properties`;
const sha=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
const expected=()=>({schema:1,version:'1.30.3',sourceArchiveSha256:'b512bf24945503a33fc10738ecffc1f2dccaaf8593a448e94ee9ac86a9559a59',cliSha256:'19f6edd5c92841a38d9b3b018a555b7ba173b13e4e0d29edecc232e5ba6c1d70',generatedBy:'official-cli-version-build-only',templates:FOREIGN_CONFIG_NAMES.map(name=>({name,bytes:m.entries.get(`${ASSETS}/templates/${name}`)!.value.length,sha256:sha(m.entries.get(`${ASSETS}/templates/${name}`)!.value)})),logging:{bytes:Buffer.byteLength(FOREIGN_LOGGING_PROPERTIES),sha256:sha(Buffer.from(FOREIGN_LOGGING_PROPERTIES))}});
function add(file:string,kind:Entry['kind']='file',value:Buffer=Buffer.alloc(0),uid=0,mode=kind==='directory'?0o755:0o444){m.entries.set(file,{kind,value,uid,mode,nlink:kind==='directory'?2:1});}
function entry(file:string){const value=m.entries.get(file);if(!value)throw new Error('Synthetic missing entry');return value;}
function stat(file:string,overrides=new Map<string,StatOverride>()){
  const value=entry(file);return {uid:value.uid,mode:value.mode,nlink:value.nlink,size:value.value.length,isFile:()=>value.kind==='file',isDirectory:()=>value.kind==='directory',isSymbolicLink:()=>value.kind==='symlink',...overrides.get(file)};
}
function children(file:string){entry(file);const prefix=`${file}/`;return [...m.entries.keys()].filter(p=>p.startsWith(prefix)&&!p.slice(prefix.length).includes('/')).map(p=>p.slice(prefix.length));}
function rewriteManifest(change:(value:ReturnType<typeof expected>)=>void){const value=expected();change(value);entry(MANIFEST).value=Buffer.from(JSON.stringify(value));}
const originalGlobal=()=>new Map([...m.entries].filter(([file])=>file.startsWith(ROOT)).map(([file,e])=>[file,{...e,value:Buffer.from(e.value)}]));
beforeEach(()=>{
  vi.clearAllMocks();m.entries.clear();m.aliases.clear();m.lstatOverrides.clear();m.handleOverrides.clear();m.closed=[];m.reads=[];
  vi.spyOn(process,'getuid').mockReturnValue(1000);
  for(const file of [ROOT,ASSETS,`${ASSETS}/templates`,`${ASSETS}/classes`,`${ASSETS}/classes/org`,`${ASSETS}/classes/org/verapdf`,`${ASSETS}/classes/org/verapdf/processor`])add(file,'directory');
  add(WORK,'directory',Buffer.alloc(0),1000,0o700);
  // Byte-identity fixtures only; not generated defaults or PDF/A evidence.
  for(const name of FOREIGN_CONFIG_NAMES)add(`${ASSETS}/templates/${name}`,'file',Buffer.from(`\uFEFF<?xml version="1.0"?>\r\n<synthetic-default name="${name}"> unchanged &amp; whitespace </synthetic-default>\r\n`));
  add(LOGGING,'file',Buffer.from(FOREIGN_LOGGING_PROPERTIES));add(MANIFEST,'file',Buffer.from(JSON.stringify(expected())));
  m.realpath.mockImplementation(async file=>m.aliases.get(file)??file);
  m.lstat.mockImplementation(async file=>stat(file,m.lstatOverrides));
  m.readdir.mockImplementation(async file=>children(file));
  m.mkdir.mockImplementation(async(file,options)=>{if(m.entries.has(file))throw new Error('Synthetic EEXIST');if(!file.startsWith(`${WORK}/`))throw new Error('Unexpected global write');add(file,'directory',Buffer.alloc(0),1000,options.mode);});
  m.writeFile.mockImplementation(async(file,value,options)=>{if(!file.startsWith(`${WORK}/`))throw new Error('Unexpected global write');if(options.flag==='wx'&&m.entries.has(file))throw new Error('Synthetic EEXIST');add(file,'file',Buffer.from(value),1000,options.mode);});
  m.open.mockImplementation(async(file,flags)=>{
    entry(file);expect(flags).toBe(constants.O_RDONLY|constants.O_NOFOLLOW);
    return {stat:async()=>stat(file,m.handleOverrides),read:async(buffer:Buffer,offset:number,length:number,position:number)=>{m.reads.push({file,length});const value=entry(file).value,bytesRead=Math.min(length,Math.max(0,value.length-position));value.copy(buffer,offset,position,position+bytesRead);return {bytesRead,buffer};},close:vi.fn(async()=>{m.closed.push(file);})};
  });
});
afterEach(()=>vi.restoreAllMocks());
describe('trusted foreign-verifier parent preparation (in-memory fs mocks only)',()=>{
  it('copies exact vendor-template bytes without changing global assets, default values, modes or any JVM grant',async()=>{
    const globals=originalGlobal(),evidence=await prepareForeignVerifierConfig(`${ROOT}/verapdf`,WORK);
    expect(evidence).toEqual(expected());expect(m.mkdir.mock.calls).toEqual([[`${WORK}/.verapdf`,{mode:0o700}],[PRIVATE,{mode:0o700}]]);
    expect(m.writeFile).toHaveBeenCalledTimes(5);
    for(const name of FOREIGN_CONFIG_NAMES){
      const target=entry(`${PRIVATE}/${name}`);expect(target.value).toEqual(entry(`${ASSETS}/templates/${name}`).value);expect(target.mode).toBe(0o600);expect(target.uid).toBe(1000);
      expect(m.writeFile).toHaveBeenCalledWith(`${PRIVATE}/${name}`,expect.any(Uint8Array),{flag:'wx',mode:0o600});
    }
    expect(originalGlobal()).toEqual(globals);
    expect(m.closed).toHaveLength(m.open.mock.calls.length);expect(m.reads.every(r=>r.length<=(r.file===MANIFEST?4097:65537))).toBe(true);
    expect(JSON.stringify(evidence)).not.toContain(WORK);expect(JSON.stringify(evidence)).not.toContain('synthetic-default');
    expect(FOREIGN_LOGGING_PROPERTIES).toContain('handlers=\n');expect(FOREIGN_LOGGING_PROPERTIES).not.toContain('LogsFileHandler');
    await expect(assertForeignVerifierConfigOnly(WORK,evidence)).resolves.toBeUndefined();
  });
  it('refuses a repeat/nonempty workdir without overwriting existing files or reading global assets again',async()=>{
    await prepareForeignVerifierConfig(`${ROOT}/verapdf`,WORK);m.open.mockClear();m.writeFile.mockClear();
    await expect(prepareForeignVerifierConfig(`${ROOT}/verapdf`,WORK)).rejects.toThrow();expect(m.open).not.toHaveBeenCalled();expect(m.writeFile).not.toHaveBeenCalled();
  });
  it.each(['relative',''])('requires absolute workdir and binary (%s)',async value=>{
    await expect(prepareForeignVerifierConfig(`${ROOT}/verapdf`,value)).rejects.toThrow();await expect(prepareForeignVerifierConfig(value,WORK)).rejects.toThrow();expect(m.mkdir).not.toHaveBeenCalled();
  });
  it('rejects root execution before filesystem work',async()=>{
    vi.mocked(process.getuid!).mockReturnValue(0);await expect(prepareForeignVerifierConfig(`${ROOT}/verapdf`,WORK)).rejects.toThrow();expect(m.lstat).not.toHaveBeenCalled();
  });
  it.each(['nonroot','writable','symlink','nonregular','hardlink','empty','oversize'])('rejects unsafe global regular-file identity: %s',async variant=>{
    const source=entry(MANIFEST);
    if(variant==='nonroot')source.uid=1000;if(variant==='writable')source.mode=0o466;if(variant==='symlink')source.kind='symlink';if(variant==='nonregular')source.kind='directory';if(variant==='hardlink')source.nlink=2;if(variant==='empty')source.value=Buffer.alloc(0);if(variant==='oversize')source.value=Buffer.alloc(4097,32);
    await expect(prepareForeignVerifierConfig(`${ROOT}/verapdf`,WORK)).rejects.toThrow();expect(m.mkdir).not.toHaveBeenCalled();
  });
  it.each(['nonroot','writable','symlink','non-directory'])('rejects unsafe immutable global ancestor: %s',async variant=>{
    const source=entry(`${ASSETS}/classes/org`);if(variant==='nonroot')source.uid=1000;if(variant==='writable')source.mode=0o777;if(variant==='symlink')source.kind='symlink';if(variant==='non-directory')source.kind='file';
    await expect(prepareForeignVerifierConfig(`${ROOT}/verapdf`,WORK)).rejects.toThrow();expect(m.open).not.toHaveBeenCalled();
  });
  it.each([ASSETS,MANIFEST,`${ASSETS}/templates/validator.xml`,LOGGING])('rejects noncanonical/symlink traversal boundary %s',async file=>{
    m.aliases.set(file,'/app/private-input');await expect(prepareForeignVerifierConfig(`${ROOT}/verapdf`,WORK)).rejects.toThrow();expect(m.mkdir).not.toHaveBeenCalled();
  });
  it('requires every exact template and the logging resource to exist',async()=>{
    m.entries.delete(`${ASSETS}/templates/validator.xml`);await expect(prepareForeignVerifierConfig(`${ROOT}/verapdf`,WORK)).rejects.toThrow();expect(m.mkdir).not.toHaveBeenCalled();
  });
  it('does not read or copy a template above64KiB',async()=>{
    entry(`${ASSETS}/templates/validator.xml`).value=Buffer.alloc(65537,32);await expect(prepareForeignVerifierConfig(`${ROOT}/verapdf`,WORK)).rejects.toThrow();expect(m.open.mock.calls.some(([file])=>file===`${ASSETS}/templates/validator.xml`)).toBe(false);expect(m.mkdir).not.toHaveBeenCalled();
  });
  it.each(['template-hash','logging-content','logging-hash','manifest-json'])('fails closed on corrupt content/identity: %s',async variant=>{
    if(variant==='template-hash')entry(`${ASSETS}/templates/app.xml`).value[0]^=1;
    if(variant==='logging-content')entry(LOGGING).value=Buffer.from('handlers=org.verapdf.core.utils.LogsFileHandler\n');
    if(variant==='logging-hash')rewriteManifest(v=>{v.logging.sha256='0'.repeat(64);});if(variant==='manifest-json')entry(MANIFEST).value=Buffer.from('{malformed');
    await expect(prepareForeignVerifierConfig(`${ROOT}/verapdf`,WORK)).rejects.toThrow();expect(m.mkdir).not.toHaveBeenCalled();
  });
  it.each([
    ['schema',(v:ReturnType<typeof expected>)=>{v.schema=2;}],['version',(v:ReturnType<typeof expected>)=>{v.version='1.30.4';}],
    ['archive',(v:ReturnType<typeof expected>)=>{v.sourceArchiveSha256='0'.repeat(64);}],['cli',(v:ReturnType<typeof expected>)=>{v.cliSha256='0'.repeat(64);}],
    ['generator',(v:ReturnType<typeof expected>)=>{v.generatedBy='untrusted-runtime';}],['extra-key',(v:ReturnType<typeof expected>)=>{Object.assign(v,{password:'must-not-be-used'});}],
    ['extra-template',(v:ReturnType<typeof expected>)=>{v.templates.push(v.templates[0]);}],['template-order',(v:ReturnType<typeof expected>)=>{v.templates.reverse();}],
    ['template-path',(v:ReturnType<typeof expected>)=>{v.templates[0].name='../invoice.xml' as typeof v.templates[0]['name'];}],['template-zero',(v:ReturnType<typeof expected>)=>{v.templates[0].bytes=0;}],
    ['template-overflow',(v:ReturnType<typeof expected>)=>{v.templates[0].bytes=65537;}],['template-digest',(v:ReturnType<typeof expected>)=>{v.templates[0].sha256='unknown';}],
    ['template-extra-key',(v:ReturnType<typeof expected>)=>{Object.assign(v.templates[0],{source:'/app/invoice.xml'});}],['logging-extra-key',(v:ReturnType<typeof expected>)=>{Object.assign(v.logging,{handler:'file'});}],
    ['logging-size',(v:ReturnType<typeof expected>)=>{v.logging.bytes++;}],
  ])('rejects unknown or mismatched pinned manifest field %s',async(_name,change)=>{
    rewriteManifest(change);await expect(prepareForeignVerifierConfig(`${ROOT}/verapdf`,WORK)).rejects.toThrow();expect(m.mkdir).not.toHaveBeenCalled();
  });
  it.each([
    ['extra-root',`${ASSETS}/unexpected.bin`],
    ['extra-template',`${ASSETS}/templates/extra.xml`],
    ['top-level-class',`${ASSETS}/classes/Injected.class`],
    ['nested-class',`${ASSETS}/classes/org/verapdf/processor/Injected.class`],
    ['nested-resource',`${ASSETS}/classes/org/verapdf/processor/unexpected.properties`],
    ['intermediate-resource',`${ASSETS}/classes/org/unexpected.properties`],
  ])('rejects global classpath/resource allowlist violation %s before any private writes',async(_name,file)=>{
    add(file,'file',Buffer.from('unexpected trusted-asset content'));
    await expect(prepareForeignVerifierConfig(`${ROOT}/verapdf`,WORK)).rejects.toThrow();
    expect(m.mkdir).not.toHaveBeenCalled();expect(m.writeFile).not.toHaveBeenCalled();
  });
  it('rejects a new package/class capable of shadowing vendor classes even with safe filesystem metadata',async()=>{
    const packageDir=`${ASSETS}/classes/org/verapdf/apps`;add(packageDir,'directory');add(`${packageDir}/VeraPdfCli.class`,'file',Buffer.from('synthetic class bytes'));
    await expect(prepareForeignVerifierConfig(`${ROOT}/verapdf`,WORK)).rejects.toThrow();
    expect(m.mkdir).not.toHaveBeenCalled();expect(m.writeFile).not.toHaveBeenCalled();
  });
  it.each(['nonroot','writable','size-race'])('rechecks opened descriptors and closes on failure: %s',async variant=>{
    m.handleOverrides.set(MANIFEST,variant==='nonroot'?{uid:1000}:variant==='writable'?{mode:0o666}:{size:entry(MANIFEST).value.length-1});
    await expect(prepareForeignVerifierConfig(`${ROOT}/verapdf`,WORK)).rejects.toThrow();expect(m.closed).toContain(MANIFEST);expect(m.mkdir).not.toHaveBeenCalled();
  });
  it('never overwrites a concurrently-created target or alters global assets after partial failure',async()=>{
    const globals=originalGlobal();m.writeFile.mockImplementationOnce(async(file)=>{add(file,'file',Buffer.from('concurrent'),1000,0o600);throw new Error('Synthetic EEXIST');});
    await expect(prepareForeignVerifierConfig(`${ROOT}/verapdf`,WORK)).rejects.toThrow();expect(m.writeFile).toHaveBeenCalledTimes(1);expect(originalGlobal()).toEqual(globals);
    // The caller owns unconditional whole-workdir cleanup; this helper neither
    // retries nor deletes/replaces files after a partial copy failure.
  });
  it.each(['top-file','nested-file','config-extra','changed-template','missing-template','bad-mode','wrong-owner','symlink','hardlink'])('rejects anything outside the exact trusted-config-only probe boundary: %s',async variant=>{
    const evidence=await prepareForeignVerifierConfig(`${ROOT}/verapdf`,WORK);
    if(variant==='top-file')add(`${WORK}/invoice.pdf`,'file',Buffer.from('not allowed'),1000,0o600);
    if(variant==='nested-file')add(`${WORK}/.verapdf/invoice.xml`,'file',Buffer.from('not allowed'),1000,0o600);
    if(variant==='config-extra')add(`${PRIVATE}/unknown.xml`,'file',Buffer.from('not allowed'),1000,0o600);
    const target=entry(`${PRIVATE}/app.xml`);if(variant==='changed-template')target.value[0]^=1;if(variant==='missing-template')m.entries.delete(`${PRIVATE}/app.xml`);if(variant==='bad-mode')target.mode=0o644;if(variant==='wrong-owner')target.uid=0;if(variant==='symlink')target.kind='symlink';if(variant==='hardlink')target.nlink=2;
    await expect(assertForeignVerifierConfigOnly(WORK,evidence)).rejects.toThrow();
  });
  it('rejects private directory alias/permission changes and evidence mutation',async()=>{
    const evidence=await prepareForeignVerifierConfig(`${ROOT}/verapdf`,WORK);entry(`${WORK}/.verapdf`).mode=0o755;
    await expect(assertForeignVerifierConfigOnly(WORK,evidence)).rejects.toThrow();entry(`${WORK}/.verapdf`).mode=0o700;m.aliases.set(PRIVATE,'/app/other');
    await expect(assertForeignVerifierConfigOnly(WORK,evidence)).rejects.toThrow();m.aliases.clear();
    const altered={...evidence,templates:evidence.templates.map(e=>({...e,sha256:'0'.repeat(64)}))};await expect(assertForeignVerifierConfigOnly(WORK,altered as ForeignVerifierConfigEvidence)).rejects.toThrow();
  });
});
