import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
const mocks=vi.hoisted(()=>({spawn:vi.fn(),mkdtemp:vi.fn(),chmod:vi.fn(),writeFile:vi.fn(),rm:vi.fn(),lstat:vi.fn(),open:vi.fn(),realpath:vi.fn(),validate:vi.fn(),slot:vi.fn(),read:vi.fn(),close:vi.fn(),stat:vi.fn(),children:[] as MockChild[],manual:false,report:'',exitCode:0,directory:'/tmp/bivaro-foreign-unit',fileInfo:{isFile:():boolean=>true,isSymbolicLink:():boolean=>false,nlink:1,size:0,dev:1,ino:2}}));
vi.mock('node:child_process',()=>({spawn:mocks.spawn}));
vi.mock('node:fs/promises',()=>({mkdtemp:mocks.mkdtemp,chmod:mocks.chmod,writeFile:mocks.writeFile,rm:mocks.rm,lstat:mocks.lstat,open:mocks.open,realpath:mocks.realpath}));
vi.mock('@/lib/processing-limit',()=>({withProcessingSlot:mocks.slot}));
vi.mock('@/lib/server/pdfa-validator',()=>({validatePdfA3:mocks.validate,PdfA3ValidationError:class PdfA3ValidationError extends Error{constructor(readonly kind:'unsupported'|'unavailable'){super(kind);}}}));
import { createPdfA3Invoice,ForeignPdfError } from '@/lib/server/pdfa3-converter';
import { PdfA3ValidationError } from '@/lib/server/pdfa-validator';
import { MAX_PDF_INPUT_BYTES,RequestBodyLimitError } from '@/lib/resource-limits';
class MockChild extends EventEmitter {readonly stdout=new EventEmitter();readonly stderr=new EventEmitter();constructor(readonly pid:number){super();}}
const source=Buffer.from('%PDF-synthetic-original'),xml='<synthetic-xml-not-parsed-in-wrapper-unit/>',candidate=Buffer.from('%PDF-synthetic-final');
const sha=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
const invoke=()=>createPdfA3Invoice({basePdfBytes:source,xmlContent:xml,invoiceNumber:'UNIT-118',userId:'unit-owner'});
const manifest=()=>({status:'candidate',sourceSha256:sha(source),xmlSha256:sha(xml),sha256:sha(candidate),bytes:candidate.length});
async function flush(){for(let i=0;i<300;i++)await Promise.resolve();}
beforeEach(()=>{
  vi.clearAllMocks();mocks.children=[];mocks.manual=false;mocks.report=JSON.stringify(manifest());mocks.exitCode=0;
  mocks.fileInfo={isFile:():boolean=>true,isSymbolicLink:():boolean=>false,nlink:1,size:candidate.length,dev:1,ino:2};
  mocks.mkdtemp.mockResolvedValue(mocks.directory);mocks.realpath.mockImplementation(async p=>p);mocks.chmod.mockResolvedValue(undefined);
  mocks.writeFile.mockResolvedValue(undefined);mocks.rm.mockResolvedValue(undefined);mocks.lstat.mockImplementation(async()=>mocks.fileInfo);
  mocks.stat.mockImplementation(async()=>mocks.fileInfo);mocks.read.mockResolvedValue(candidate);mocks.close.mockResolvedValue(undefined);
  mocks.open.mockResolvedValue({stat:mocks.stat,readFile:mocks.read,close:mocks.close});mocks.validate.mockResolvedValue(undefined);
  mocks.slot.mockImplementation(async(_id,fn)=>fn());vi.spyOn(process,'kill').mockImplementation(()=>true);
  vi.spyOn(process,'getuid').mockReturnValue(1000);vi.spyOn(process,'geteuid').mockReturnValue(1000);
  mocks.spawn.mockImplementation(()=>{const child=new MockChild(51000+mocks.children.length);mocks.children.push(child);if(!mocks.manual)queueMicrotask(()=>{child.stdout.emit('data',Buffer.from(mocks.report));child.emit('exit',mocks.exitCode,null);child.emit('close',mocks.exitCode,null);});return child;});
});
afterEach(()=>{for(const child of mocks.children)child.emit('close',null,'SIGKILL');vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllEnvs();});
describe('confined foreign candidate orchestration (mocked kernel, not native evidence)',()=>{
  it('binds exact source/XML/output hashes and validates source then exact final bytes before returning',async()=>{
    const result=await invoke();expect(result).toEqual(new Uint8Array(candidate));
    expect(mocks.validate.mock.calls).toEqual([[new Uint8Array(source),{confined:true}],[new Uint8Array(candidate),{maxBytes:MAX_PDF_INPUT_BYTES*2,confined:true}]]);
    expect(mocks.slot).toHaveBeenCalledWith('unit-owner',expect.any(Function));
    expect(mocks.writeFile.mock.calls[0]).toEqual([`${mocks.directory}/original.pdf`,new Uint8Array(source),{mode:0o600,flag:'wx'}]);
    expect(mocks.chmod).toHaveBeenCalledWith(mocks.directory,0o700);
    expect(mocks.rm).toHaveBeenCalledWith(mocks.directory,{recursive:true,force:true});
    expect(mocks.close).toHaveBeenCalled();
  });
  it('has no unconfined executor, inherited secret, network grant, arbitrary output directory or shell',async()=>{
    vi.stubEnv('SYNTHETIC_SECRET','not for child');vi.stubEnv('NODE_OPTIONS','--synthetic-never-inherit');await invoke();
    const [binary,args,options]=mocks.spawn.mock.calls[0];expect(binary).toBe('/usr/bin/prlimit');
    expect(args).toContain('/usr/bin/setpriv');expect(args).toContain('--no-new-privs');expect(args).toContain('--seccomp-filter');expect(args).toContain('--permission');
    expect(args).not.toContain('--allow-child-process');expect(args).not.toContain('--allow-addons');
    expect(args).toContain(`--allow-fs-write=${mocks.directory}/candidate.pdf`);
    expect(args).not.toContain(`--allow-fs-write=${mocks.directory}`);
    expect(options).toEqual({cwd:mocks.directory,detached:true,shell:false,stdio:['ignore','pipe','pipe'],env:{LANG:'C',HOME:mocks.directory,TMPDIR:mocks.directory,NODE_ENV:'production',UV_THREADPOOL_SIZE:'1',MALLOC_ARENA_MAX:'2'}});
    expect(process.kill).toHaveBeenCalledWith(-51000,'SIGKILL');
  });
  it.each(['PDF_SIGNED','PDF_ATTACHMENTS_UNSUPPORTED','PDF_REQUIRES_NORMALIZATION','PDF_INVALID_OR_ENCRYPTED'])('returns known unsupported422 for %s',async code=>{
    mocks.exitCode=22;mocks.report=JSON.stringify({status:'unsupported',code});
    await expect(invoke()).rejects.toMatchObject({status:422,code});expect(mocks.validate).not.toHaveBeenCalled();expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each(['{}','invalid JSON',JSON.stringify({...manifest(),sourceSha256:'a'.repeat(64)}),JSON.stringify({...manifest(),xmlSha256:'b'.repeat(64)}),JSON.stringify({...manifest(),sha256:'b'.repeat(64)}),JSON.stringify({...manifest(),extra:'untrusted'})])('rejects unknown or mismatched protocol without returning a file',async report=>{
    mocks.report=report;await expect(invoke()).rejects.toMatchObject({status:503});
  });
  it('does not reinterpret unknown worker failures as unsupported input',async()=>{
    mocks.exitCode=70;mocks.report=JSON.stringify({status:'failed',code:'PDF_WORKER_FAILED'});await expect(invoke()).rejects.toMatchObject({status:503});
  });
  it('rejects source nonconformance even if a final candidate exists',async()=>{
    mocks.validate.mockRejectedValueOnce(new PdfA3ValidationError('unsupported'));await expect(invoke()).rejects.toMatchObject({status:422,code:'PDF_REQUIRES_NORMALIZATION'});
    expect(mocks.validate).toHaveBeenCalledTimes(1);expect(mocks.read).not.toHaveBeenCalled();
  });
  it('rejects final nonconformance after checking the source',async()=>{
    mocks.validate.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new PdfA3ValidationError('unsupported'));await expect(invoke()).rejects.toMatchObject({status:503,code:'PDF_PROCESSING_UNAVAILABLE'});expect(mocks.validate).toHaveBeenCalledTimes(2);
  });
  it('keeps verifier absence/timeout unavailable503',async()=>{
    mocks.validate.mockRejectedValue(new PdfA3ValidationError('unavailable'));await expect(invoke()).rejects.toMatchObject({status:503});
  });
  it.each(['symlink','hardlink','changed size','directory'])('rejects %s output',async type=>{
    if(type==='symlink')mocks.fileInfo.isSymbolicLink=()=>true;
    if(type==='hardlink')mocks.fileInfo.nlink=2;
    if(type==='changed size')mocks.fileInfo.size++;
    if(type==='directory')mocks.fileInfo.isFile=()=>false;
    await expect(invoke()).rejects.toBeInstanceOf(ForeignPdfError);
  });
  it('rejects unavailable confinement without a fallback',async()=>{
    mocks.realpath.mockRejectedValue(new Error('missing filter'));await expect(invoke()).rejects.toMatchObject({status:503});expect(mocks.spawn).not.toHaveBeenCalled();
  });
  it('never parses an oversized or empty file',async()=>{
    await expect(createPdfA3Invoice({basePdfBytes:new Uint8Array(MAX_PDF_INPUT_BYTES+1),xmlContent:xml,invoiceNumber:'x'})).rejects.toBeInstanceOf(RequestBodyLimitError);
    await expect(createPdfA3Invoice({basePdfBytes:new Uint8Array(),xmlContent:xml,invoiceNumber:'x'})).rejects.toMatchObject({status:422});expect(mocks.spawn).not.toHaveBeenCalled();
  });
  it('waits for descriptor closure after exit before cleanup or validation',async()=>{
    mocks.manual=true;let settled=false;const promise=invoke().then(value=>{settled=true;return value;});await flush();const child=mocks.children[0];
    child.stdout.emit('data',Buffer.from(mocks.report));child.emit('exit',0,null);await flush();expect(settled).toBe(false);expect(mocks.rm).not.toHaveBeenCalled();expect(mocks.validate).not.toHaveBeenCalled();
    child.emit('close',0,null);await expect(promise).resolves.toEqual(new Uint8Array(candidate));
  });
  it('kills the process group at wall limit but releases only after close',async()=>{
    vi.useFakeTimers();mocks.manual=true;const outcome=invoke().catch(error=>error);await flush();const child=mocks.children[0];
    await vi.advanceTimersByTimeAsync(30000);expect(process.kill).toHaveBeenCalledWith(-child.pid,'SIGKILL');expect(mocks.rm).not.toHaveBeenCalled();child.emit('close',null,'SIGKILL');await expect(outcome).resolves.toMatchObject({status:503});
  });
  it('kills oversized combined diagnostics without disclosing them',async()=>{
    mocks.manual=true;const outcome=invoke().catch(error=>error);await flush();const child=mocks.children[0];child.stderr.emit('data',Buffer.alloc(4097,65));expect(process.kill).toHaveBeenCalled();child.emit('close',null,'SIGKILL');await expect(outcome).resolves.toMatchObject({status:503});
  });
});
