import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { EventEmitter } from 'node:events';
const m=vi.hoisted(()=>({spawn:vi.fn(),prepare:vi.fn(),confinement:vi.fn(),mkdtemp:vi.fn(),writeFile:vi.fn(),rm:vi.fn(),children:[] as Child[],report:'',version:'veraPDF 1.30.3\n',versionCode:0 as number|null,validationCode:1 as number|null,versionSignal:null as string|null,validationSignal:null as string|null,manual:false}));
vi.mock('node:child_process',()=>({spawn:m.spawn}));
vi.mock('fs/promises',()=>({mkdtemp:m.mkdtemp,writeFile:m.writeFile,rm:m.rm}));
vi.mock('@/lib/server/foreign-pdf-verifier-config',()=>({prepareForeignVerifierConfig:m.prepare}));
vi.mock('@/lib/server/foreign-pdf-validator-confinement',()=>({foreignVerifierCommand:m.confinement}));
import { PdfA3ValidationError,validatePdfA3 } from '@/lib/server/pdfa-validator';
import { OwnInvoicePdfAValidationError,validateOwnInvoicePdfA3 } from '@/lib/server/own-invoice-pdfa-validator';
const DIR='/tmp/private-exit-contract',BYTES=new Uint8Array([37,80,68,70,45,49,46,55]),PRIVATE='PRIVATE_CUSTOMER_PROCESS_REPORT_NEVER_EXPOSE';
const OWN_MESSAGE='Die abschließende PDF/A-3b-Prüfung ist fehlgeschlagen. Es wurde keine Rechnungsdatei erstellt.';
class Child extends EventEmitter {stdout=new EventEmitter();stderr=new EventEmitter();kill=vi.fn();constructor(readonly pid:number){super();}}
function report(compliant=false){return {report:{jobs:[{itemDetails:{name:`${DIR}/final.pdf`,size:BYTES.byteLength},validationResult:[{profileName:'PDF/A-3B validation profile',compliant,jobEndStatus:'normal',details:{passedRules:140,failedRules:compliant?0:2,passedChecks:2400,failedChecks:compliant?0:4,ruleSummaries:[]},description:PRIVATE}]}],batchSummary:{totalJobs:1,failedParsingJobs:0,failedEncryptedJobs:0,outOfMemory:0,veraExceptions:0,validationSummary:{totalJobCount:1,successfulJobCount:1,compliantPdfaCount:compliant?1:0,nonCompliantPdfaCount:compliant?0:1,failedJobCount:0}}}};}
const validation=(r:ReturnType<typeof report>)=>r.report.jobs[0].validationResult[0];
async function flush(){for(let i=0;i<50;i++)await Promise.resolve();}
async function outcome(promise:Promise<void>){return promise.then(()=>({ok:true,error:undefined}),error=>({ok:false,error}));}
async function foreign(){return outcome(validatePdfA3(BYTES,{confined:true}));}
function expectSafeUnavailable(value:Awaited<ReturnType<typeof outcome>>){expect(value.ok).toBe(false);expect(value.error).toBeInstanceOf(PdfA3ValidationError);expect(value.error).toMatchObject({kind:'unavailable',status:503});expect(value.error.message).not.toContain(PRIVATE);expect(value.error.message).not.toContain(DIR);expect(JSON.stringify(value.error)).not.toContain(PRIVATE);}
function expectUnsupported(value:Awaited<ReturnType<typeof outcome>>){expect(value.ok).toBe(false);expect(value.error).toBeInstanceOf(PdfA3ValidationError);expect(value.error).toMatchObject({kind:'unsupported',status:422});expect(value.error.message).not.toContain(PRIVATE);expect(JSON.stringify(value.error)).not.toContain(PRIVATE);}
beforeEach(()=>{
  vi.clearAllMocks();vi.stubEnv('BIVARO_VERAPDF_BIN',undefined);m.children=[];m.report=JSON.stringify(report());m.version='veraPDF 1.30.3\n';m.versionCode=0;m.validationCode=1;m.versionSignal=null;m.validationSignal=null;m.manual=false;
  m.prepare.mockResolvedValue(undefined);m.confinement.mockImplementation(async()=> (args:string[])=>['/usr/bin/setpriv','--','/usr/bin/java',...args]);
  m.mkdtemp.mockResolvedValue(DIR);m.writeFile.mockResolvedValue(undefined);m.rm.mockResolvedValue(undefined);vi.spyOn(process,'kill').mockImplementation(()=>true);
  m.spawn.mockImplementation((_binary:string,args:string[])=>{const child=new Child(47000+m.children.length);m.children.push(child);const version=args.includes('--version');if(!version&&m.manual)return child;
    queueMicrotask(()=>{child.stdout.emit('data',Buffer.from(version?m.version:m.report));child.emit('exit',version?m.versionCode:m.validationCode,version?m.versionSignal:m.validationSignal);child.emit('close',version?m.versionCode:m.validationCode,version?m.versionSignal:m.validationSignal);});return child;});
});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllEnvs();});
describe('confined foreign veraPDF exit/report contract (mocked processes only)',()=>{
  it('maps only exit1 with exact coherent noncompliance to existing unsupported422; never treats it as success',async()=>{
    expectUnsupported(await foreign());expect(m.prepare).toHaveBeenCalledExactlyOnceWith('/opt/verapdf/verapdf',DIR);expect(m.confinement).toHaveBeenCalledExactlyOnceWith('/opt/verapdf/verapdf',DIR);
    expect(m.spawn).toHaveBeenCalledTimes(2);expect(m.writeFile).toHaveBeenCalledExactlyOnceWith(`${DIR}/final.pdf`,BYTES,{flag:'wx',mode:0o600});expect(m.rm).toHaveBeenCalledExactlyOnceWith(DIR,{recursive:true,force:true});
    for(const child of m.children)expect(vi.mocked(process.kill).mock.calls.filter(([pid])=>pid===-child.pid)).toHaveLength(1);
  });
  it('still requires exit0 and a complete coherent compliant report to succeed',async()=>{
    m.validationCode=0;m.report=JSON.stringify(report(true));expect(await foreign()).toEqual({ok:true,error:undefined});
  });
  it('keeps the existing strict exit0 noncompliance rejection',async()=>{
    m.validationCode=0;expectUnsupported(await foreign());
  });
  it('does not accept or downgrade exit1 with compliant-looking output',async()=>{
    m.report=JSON.stringify(report(true));expectSafeUnavailable(await foreign());
  });
  it.each(['','not JSON','[]','{}','{"report":null}'])('keeps exit1 with malformed/missing report unavailable503 (%s)',async text=>{
    m.report=text;expectSafeUnavailable(await foreign());
  });
  it.each([
    ['extra-root',(r:ReturnType<typeof report>)=>{Object.assign(r,{private:PRIVATE});}],
    ['two-jobs',(r:ReturnType<typeof report>)=>{r.report.jobs.push(r.report.jobs[0]);}],
    ['two-validations',(r:ReturnType<typeof report>)=>{r.report.jobs[0].validationResult.push(validation(r));}],
    ['task-exception',(r:ReturnType<typeof report>)=>{Object.assign(r.report.jobs[0],{taskException:{message:PRIVATE}});}],
    ['task-exception-null',(r:ReturnType<typeof report>)=>{Object.assign(r.report.jobs[0],{taskException:null});}],
    ['identity',(r:ReturnType<typeof report>)=>{r.report.jobs[0].itemDetails.name=`/tmp/${PRIVATE}.pdf`;}],
    ['size',(r:ReturnType<typeof report>)=>{r.report.jobs[0].itemDetails.size++;}],
    ['profile',(r:ReturnType<typeof report>)=>{validation(r).profileName='PDF/A-2B validation profile';}],
    ['job-end',(r:ReturnType<typeof report>)=>{validation(r).jobEndStatus='failed';}],
    ['missing-details',(r:ReturnType<typeof report>)=>{delete (validation(r) as {details?:unknown}).details;}],
    ['zero-failed-rules',(r:ReturnType<typeof report>)=>{validation(r).details.failedRules=0;}],
    ['zero-failed-checks',(r:ReturnType<typeof report>)=>{validation(r).details.failedChecks=0;}],
    ['fraction-failed-checks',(r:ReturnType<typeof report>)=>{validation(r).details.failedChecks=1.5;}],
    ['string-count',(r:ReturnType<typeof report>)=>{Object.assign(validation(r).details,{failedChecks:'4'});}],
    ['parse-failure',(r:ReturnType<typeof report>)=>{r.report.batchSummary.failedParsingJobs=1;}],
    ['encrypted',(r:ReturnType<typeof report>)=>{r.report.batchSummary.failedEncryptedJobs=1;}],
    ['oom',(r:ReturnType<typeof report>)=>{r.report.batchSummary.outOfMemory=1;}],
    ['engine-exception',(r:ReturnType<typeof report>)=>{r.report.batchSummary.veraExceptions=1;}],
    ['total-jobs',(r:ReturnType<typeof report>)=>{r.report.batchSummary.totalJobs=2;}],
    ['total-count',(r:ReturnType<typeof report>)=>{r.report.batchSummary.validationSummary.totalJobCount=2;}],
    ['successful-count',(r:ReturnType<typeof report>)=>{r.report.batchSummary.validationSummary.successfulJobCount=0;}],
    ['compliant-count',(r:ReturnType<typeof report>)=>{r.report.batchSummary.validationSummary.compliantPdfaCount=1;}],
    ['noncompliant-count',(r:ReturnType<typeof report>)=>{r.report.batchSummary.validationSummary.nonCompliantPdfaCount=0;}],
    ['failed-count',(r:ReturnType<typeof report>)=>{r.report.batchSummary.validationSummary.failedJobCount=1;}],
  ] satisfies [string,(r:ReturnType<typeof report>)=>void][])('does not reinterpret exit1 plus incoherent report: %s',async(_name,change)=>{
    const value=report();change(value);m.report=JSON.stringify(value);expectSafeUnavailable(await foreign());expect(m.rm).toHaveBeenCalledTimes(1);
  });
  it.each([2,3,4,5,6,7,8,9,10,11,12,22,70,126,127,255,null])('keeps other validation exit%s unavailable despite coherent false output',async code=>{
    m.validationCode=code;expectSafeUnavailable(await foreign());
  });
  it.each(['SIGTERM','SIGSYS','SIGKILL','SIGABRT','SIGSEGV'])('keeps signal%s unavailable even alongside exit1/coherent false',async signal=>{
    m.validationSignal=signal;expectSafeUnavailable(await foreign());
  });
  it.each(['veraPDF 1.30.3\n','coherent-report'])('never interprets version exit1 as noncompliance or writes the document (%s)',async text=>{
    m.versionCode=1;m.version=text==='coherent-report'?m.report:text;expectSafeUnavailable(await foreign());expect(m.writeFile).not.toHaveBeenCalled();expect(m.spawn).toHaveBeenCalledTimes(1);
  });
  it('never applies the exit1 report context to the unconfined shared/own-invoice path',async()=>{
    expectSafeUnavailable(await outcome(validatePdfA3(BYTES)));expect(m.prepare).not.toHaveBeenCalled();expect(m.confinement).not.toHaveBeenCalled();
  });
  it.each([1,2,0])('preserves exact own-invoice public500/name/message for failed validation exit%s',async code=>{
    m.validationCode=code;const value=await outcome(validateOwnInvoicePdfA3(BYTES));expect(value.ok).toBe(false);expect(value.error).toBeInstanceOf(OwnInvoicePdfAValidationError);expect(value.error).toMatchObject({status:500,name:'OwnInvoicePdfAValidationError',message:OWN_MESSAGE});expect(m.prepare).not.toHaveBeenCalled();expect(m.confinement).not.toHaveBeenCalled();
  });
  it('waits for close before classifying coherent exit1 or cleaning; kills the whole private group exactly once',async()=>{
    m.manual=true;let settled=false;const pending=foreign().then(value=>{settled=true;return value;});await flush();const child=m.children[1];expect(child).toBeDefined();child.stdout.emit('data',Buffer.from(m.report));child.emit('exit',1,null);await flush();
    expect(settled).toBe(false);expect(m.rm).not.toHaveBeenCalled();expect(process.kill).toHaveBeenCalledWith(-child.pid,'SIGKILL');
    child.emit('close',1,null);expectUnsupported(await pending);expect(m.rm).toHaveBeenCalledExactlyOnceWith(DIR,{recursive:true,force:true});expect(vi.mocked(process.kill).mock.calls.filter(([pid])=>pid===-child.pid)).toHaveLength(1);
  });
  it('drains bounded coherent JSON chunks after ordinary foreign exit1 but classifies only after close',async()=>{
    m.manual=true;let settled=false;const pending=foreign().then(value=>{settled=true;return value;});await flush();const child=m.children[1],split=Math.floor(m.report.length/2);
    child.stdout.emit('data',Buffer.from(m.report.slice(0,split)));child.emit('exit',1,null);await flush();
    expect(settled).toBe(false);expect(m.rm).not.toHaveBeenCalled();
    child.stdout.emit('data',Buffer.from(m.report.slice(split)));await flush();
    expect(settled).toBe(false);expect(m.rm).not.toHaveBeenCalled();child.emit('close',1,null);
    expectUnsupported(await pending);expect(m.rm).toHaveBeenCalledExactlyOnceWith(DIR,{recursive:true,force:true});expect(vi.mocked(process.kill).mock.calls.filter(([pid])=>pid===-child.pid)).toHaveLength(1);
  });
  it('does not ignore late JSON junk after foreign exit1 before close',async()=>{
    m.manual=true;const pending=foreign();await flush();const child=m.children[1];child.stdout.emit('data',Buffer.from(m.report));child.emit('exit',1,null);
    child.stdout.emit('data',Buffer.from(` trailing-${PRIVATE}`));await flush();expect(m.rm).not.toHaveBeenCalled();child.emit('close',1,null);expectSafeUnavailable(await pending);
  });
  it.each(['output-limit','stream-error'])('suppresses exit1 unsupported classification on late%s while draining',async failure=>{
    m.manual=true;const pending=foreign();await flush();const child=m.children[1];child.stdout.emit('data',Buffer.from(m.report));child.emit('exit',1,null);
    if(failure==='output-limit')child.stderr.emit('data',Buffer.alloc(2*1024*1024));else child.stdout.emit('error',Error(PRIVATE));
    await flush();expect(m.rm).not.toHaveBeenCalled();child.emit('close',1,null);expectSafeUnavailable(await pending);expect(m.rm).toHaveBeenCalledTimes(1);
  });
  it.each(['stdout','stderr','launch','output','timeout'])('never lets coherent false output override an earlier%s failure',async failure=>{
    if(failure==='timeout')vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});m.manual=true;const pending=foreign();await flush();const child=m.children[1];child.stdout.emit('data',Buffer.from(m.report));
    if(failure==='stdout')child.stdout.emit('error',Error(PRIVATE));if(failure==='stderr')child.stderr.emit('error',Error(PRIVATE));if(failure==='launch')child.emit('error',Error(PRIVATE));if(failure==='output')child.stderr.emit('data',Buffer.alloc(2*1024*1024));if(failure==='timeout')await vi.advanceTimersByTimeAsync(30_000);
    expect(process.kill).toHaveBeenCalledWith(-child.pid,'SIGKILL');expect(m.rm).not.toHaveBeenCalled();child.emit('exit',1,null);child.emit('close',1,null);expectSafeUnavailable(await pending);expect(m.rm).toHaveBeenCalledTimes(1);
  });
  it('lets cleanup failure remain infrastructure503 rather than returning unsupported422',async()=>{
    m.rm.mockRejectedValue(Error(PRIVATE));expectSafeUnavailable(await foreign());
  });
});
