import { beforeEach,describe,expect,it,vi } from 'vitest';
import { createHash } from 'node:crypto';
const m=vi.hoisted(()=>({open:vi.fn(),lstat:vi.fn(),realpath:vi.fn(),mkdir:vi.fn(),writeFile:vi.fn(),chmod:vi.fn(),files:new Map<string,Buffer>(),handles:[] as {close:ReturnType<typeof vi.fn>}[]}));
vi.mock('node:fs/promises',()=>({open:m.open,lstat:m.lstat,realpath:m.realpath,mkdir:m.mkdir,writeFile:m.writeFile,chmod:m.chmod}));
import { prepareVerifierConfigAssets,CONFIG_NAMES,LOGGING_PROPERTIES } from '../foreign-pdf/prepare-verifier-config.mjs';
import { FOREIGN_CONFIG_NAMES,FOREIGN_LOGGING_PROPERTIES } from '../../lib/server/foreign-pdf-verifier-config';
const asset={version:'1.30.3',sha256:'b512bf24945503a33fc10738ecffc1f2dccaaf8593a448e94ee9ac86a9559a59'},source='/tmp/fresh-build/.verapdf/config',destination='/opt/verapdf';
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
beforeEach(()=>{
  vi.clearAllMocks();m.files=new Map(CONFIG_NAMES.map(name=>[`${source}/${name}`,Buffer.from(`\uFEFF<official-default name="${name}">\r\n  unchanged &amp; exact\r\n</official-default>\r\n`)]));m.handles=[];
  m.realpath.mockImplementation(async p=>p);m.mkdir.mockResolvedValue(undefined);m.writeFile.mockResolvedValue(undefined);m.chmod.mockResolvedValue(undefined);
  m.lstat.mockImplementation(async file=>({isFile:()=>true,isSymbolicLink:()=>false,nlink:1,size:m.files.get(file)!.length}));
  m.open.mockImplementation(async file=>{const value=m.files.get(file)!;const handle={stat:vi.fn(async()=>({isFile:()=>true,nlink:1,size:value.length})),read:vi.fn(async(buffer:Buffer)=>{value.copy(buffer);return{bytesRead:value.length};}),close:vi.fn(async()=>{})};m.handles.push(handle);return handle;});
});
describe('build-only exact upstream verifier configuration assets (mocked IO; no JVM)',()=>{
  it('packages byte-identical fresh defaults with archive/JAR provenance and immutable output modes, matching runtime specification',async()=>{
    const result=await prepareVerifierConfigAssets(destination,asset,source);
    expect(CONFIG_NAMES).toEqual([...FOREIGN_CONFIG_NAMES]);expect(LOGGING_PROPERTIES).toBe(FOREIGN_LOGGING_PROPERTIES);expect(LOGGING_PROPERTIES).toContain('handlers=\n');expect(LOGGING_PROPERTIES).not.toContain('LogsFileHandler');
    for(const name of CONFIG_NAMES){const original=m.files.get(`${source}/${name}`)!;expect(m.writeFile).toHaveBeenCalledWith(`${destination}/foreign-runtime/templates/${name}`,original,{flag:'wx',mode:0o444});expect(result.templates.find(e=>e.name===name)).toEqual({name,bytes:original.length,sha256:sha(original)});}
    expect(result).toMatchObject({schema:1,version:asset.version,sourceArchiveSha256:asset.sha256,cliSha256:'19f6edd5c92841a38d9b3b018a555b7ba173b13e4e0d29edecc232e5ba6c1d70',generatedBy:'official-cli-version-build-only'});
    expect(m.writeFile.mock.calls.every(([file,,options])=>file.startsWith(`${destination}/foreign-runtime/`)&&options.mode===0o444&&options.flag==='wx')).toBe(true);
    expect(m.writeFile.mock.calls.some(([file])=>file.startsWith(source)||file.startsWith(`${destination}/config`))).toBe(false);
    expect(m.handles.every(h=>h.close.mock.calls.length===1)).toBe(true);
  });
  it.each(['symlink','nonregular','hardlink','empty','oversized','canonical-target'])('fails closed on %s source defaults without packaging any asset',async kind=>{
    if(kind==='canonical-target')m.realpath.mockImplementation(async p=>p.endsWith('app.xml')?'/outside/untrusted.xml':p);
    else m.lstat.mockResolvedValue({isFile:()=>kind!=='nonregular',isSymbolicLink:()=>kind==='symlink',nlink:kind==='hardlink'?2:1,size:kind==='empty'?0:kind==='oversized'?64*1024+1:100});
    await expect(prepareVerifierConfigAssets(destination,asset,source)).rejects.toThrow();expect(m.writeFile).not.toHaveBeenCalled();
  });
  it('closes descriptors and fails before packaging on an incomplete bounded source read',async()=>{
    const close=vi.fn(async()=>{});m.open.mockResolvedValue({stat:async()=>({isFile:()=>true,nlink:1,size:100}),read:async()=>({bytesRead:99}),close});
    await expect(prepareVerifierConfigAssets(destination,asset,source)).rejects.toThrow();expect(close).toHaveBeenCalledOnce();expect(m.writeFile).not.toHaveBeenCalled();
  });
});
