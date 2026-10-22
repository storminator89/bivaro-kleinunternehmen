import { describe,expect,it,vi } from 'vitest';
import { fixtureReportDiagnostic } from '../../scripts/foreign-pdf/fixture-validation-probe.mjs';

const PDF_PATH='/tmp/private-fixed-fixture/final.pdf',PDF_BYTES=4096;
const PRIVATE='PRIVATE_DOCUMENT_CUSTOMER_SECRET_NEVER_EMIT';
const rule=(index=1)=>({specification:'ISO 19005-3:2012',clause:`6.${index}.1`,testNumber:1,failedChecks:2});
function fixture(compliant=true){
  return {report:{jobs:[{itemDetails:{name:PDF_PATH,size:PDF_BYTES},validationResult:[{
    profileName:'PDF/A-3B validation profile',compliant,jobEndStatus:'normal',
    details:{passedRules:140,failedRules:compliant?0:2,passedChecks:2400,failedChecks:compliant?0:4,ruleSummaries:compliant?[]:[rule()]},
  }]}],batchSummary:{totalJobs:1,failedParsingJobs:0,failedEncryptedJobs:0,outOfMemory:0,veraExceptions:0,validationSummary:{totalJobCount:1,successfulJobCount:1,compliantPdfaCount:compliant?1:0,nonCompliantPdfaCount:compliant?0:1,failedJobCount:0}}}};
}
type Report=ReturnType<typeof fixture>;
const result=(report:unknown)=>fixtureReportDiagnostic(JSON.stringify(report),PDF_PATH,PDF_BYTES);
const validation=(report:Report)=>report.report.jobs[0].validationResult[0];
const noReport={verdict:'no-coherent-report'};
function expectPrivateAbsent(value:unknown){const encoded=JSON.stringify(value);expect(encoded).not.toContain(PRIVATE);expect(encoded).not.toContain(PDF_PATH);expect(encoded).not.toContain('description');expect(encoded).not.toContain('context');expect(encoded).not.toContain('excerpt');}

describe('fixed synthetic fixture veraPDF coherent-report diagnostic (pure JSON only)',()=>{
  it('accepts only a complete coherent-compliant report without adding document fields or diagnostics',()=>{
    expect(result(fixture())).toEqual({verdict:'coherent-compliant'});
    const report=fixture();validation(report).profileName='pdf/a-3b validation profile';expect(result(report)).toEqual({verdict:'coherent-compliant'});
  });
  it('distinguishes coherent noncompliance and emits only safe counts and whitelisted rule IDs',()=>{
    const report=fixture(false);Object.assign(report.report.jobs[0].itemDetails,{description:PRIVATE});
    Object.assign(validation(report).details.ruleSummaries[0],{description:PRIVATE,object:PRIVATE,test:PRIVATE,checks:[{context:PRIVATE,message:PRIVATE}],unknown:{text:PRIVATE}});
    const diagnostic=result(report);expect(diagnostic).toEqual({verdict:'coherent-noncompliant',failedRules:2,failedChecks:4,rules:[rule()]});expectPrivateAbsent(diagnostic);
  });
  it.each(['{malformed','',PRIVATE,'null','[]','true','12','"private string"'])('rejects malformed or non-object JSON without echoing it (%s)',text=>{
    const diagnostic=fixtureReportDiagnostic(text,PDF_PATH,PDF_BYTES);expect(diagnostic).toEqual(noReport);expectPrivateAbsent(diagnostic);
  });
  it('enforces the two-MiB UTF-8 report bound before accepting an otherwise coherent JSON body',()=>{
    const report=fixture();Object.assign(report.report.jobs[0].itemDetails,{description:'€'.repeat(700000)});
    const text=JSON.stringify(report);expect(text.length).toBeLessThan(2*1024*1024);expect(Buffer.byteLength(text)).toBeGreaterThan(2*1024*1024);
    expect(fixtureReportDiagnostic(text,PDF_PATH,PDF_BYTES)).toEqual(noReport);
  });
  it('never coerces hostile non-string inputs or touches their message/stack/serialization getters',()=>{
    const inspect=vi.fn(()=>{throw Error(PRIVATE);});const hostile={get message(){return inspect();},get stack(){return inspect();},toString:inspect,toJSON:inspect,[Symbol.toPrimitive]:inspect};
    for(const value of [hostile,undefined,null,42,true,[],Buffer.from(PRIVATE)])expect(fixtureReportDiagnostic(value,PDF_PATH,PDF_BYTES)).toEqual(noReport);
    expect(inspect).not.toHaveBeenCalled();
  });
  it.each([
    ['extra-root-key',(r:Report)=>{Object.assign(r,{error:PRIVATE});}],
    ['missing-report',(r:Report)=>{delete (r as Partial<Report>).report;}],
    ['report-array',(r:Report)=>{Object.assign(r,{report:[]});}],
    ['missing-batch-summary',(r:Report)=>{delete (r.report as {batchSummary?:unknown}).batchSummary;}],
    ['array-batch-summary',(r:Report)=>{Object.assign(r.report,{batchSummary:[]});}],
    ['missing-validation-summary',(r:Report)=>{delete (r.report.batchSummary as {validationSummary?:unknown}).validationSummary;}],
    ['array-validation-summary',(r:Report)=>{Object.assign(r.report.batchSummary,{validationSummary:[]});}],
    ['no-jobs',(r:Report)=>{r.report.jobs=[];}],
    ['two-jobs',(r:Report)=>{r.report.jobs.push(r.report.jobs[0]);}],
    ['task-exception-null',(r:Report)=>{Object.assign(r.report.jobs[0],{taskException:null});}],
    ['task-exception-false',(r:Report)=>{Object.assign(r.report.jobs[0],{taskException:false});}],
    ['task-exception-object',(r:Report)=>{Object.assign(r.report.jobs[0],{taskException:{message:PRIVATE,stack:PRIVATE}});}],
    ['wrong-path',(r:Report)=>{r.report.jobs[0].itemDetails.name=`/tmp/${PRIVATE}.pdf`;}],
    ['wrong-size',(r:Report)=>{r.report.jobs[0].itemDetails.size++;}],
    ['string-size',(r:Report)=>{Object.assign(r.report.jobs[0].itemDetails,{size:String(PDF_BYTES)});}],
    ['missing-item',(r:Report)=>{delete (r.report.jobs[0] as {itemDetails?:unknown}).itemDetails;}],
    ['no-validation',(r:Report)=>{r.report.jobs[0].validationResult=[];}],
    ['two-validations',(r:Report)=>{r.report.jobs[0].validationResult.push(validation(r));}],
    ['wrong-status',(r:Report)=>{validation(r).jobEndStatus='failed';}],
    ['status-case',(r:Report)=>{validation(r).jobEndStatus='NORMAL';}],
    ['wrong-part',(r:Report)=>{validation(r).profileName='PDF/A-2B validation profile';}],
    ['wrong-conformance',(r:Report)=>{validation(r).profileName='PDF/A-3A validation profile';}],
    ['unanchored-profile',(r:Report)=>{validation(r).profileName=' PDF/A-3B validation profile ';}],
    ['profile-object',(r:Report)=>{Object.assign(validation(r),{profileName:{message:PRIVATE}});}],
    ['compliant-string',(r:Report)=>{Object.assign(validation(r),{compliant:'true'});}],
    ['missing-compliant',(r:Report)=>{delete (validation(r) as {compliant?:unknown}).compliant;}],
    ['xml-attribute-name',(r:Report)=>{delete (validation(r) as {compliant?:unknown}).compliant;Object.assign(validation(r),{isCompliant:true});}],
    ['missing-details',(r:Report)=>{delete (validation(r) as {details?:unknown}).details;}],
    ['array-details',(r:Report)=>{Object.assign(validation(r),{details:[]});}],
    ['zero-passed-rules',(r:Report)=>{validation(r).details.passedRules=0;}],
    ['fraction-passed-checks',(r:Report)=>{validation(r).details.passedChecks=1.5;}],
    ['failed-compliant-rules',(r:Report)=>{validation(r).details.failedRules=1;}],
    ['failed-compliant-checks',(r:Report)=>{validation(r).details.failedChecks=1;}],
  ])('fails closed on a noncoherent report: %s',(_name,change)=>{
    const report=fixture();change(report);const diagnostic=result(report);expect(diagnostic).toEqual(noReport);expectPrivateAbsent(diagnostic);
  });
  it.each(['totalJobs','failedParsingJobs','failedEncryptedJobs','outOfMemory','veraExceptions'] as const)('enforces batch identity/zero infrastructure failure count %s',field=>{
    for(const noncompliant of [false,true]){const report=fixture(!noncompliant);report.report.batchSummary[field]=field==='totalJobs'?2:1;expect(result(report)).toEqual(noReport);}
    const report=fixture();delete (report.report.batchSummary as Partial<typeof report.report.batchSummary>)[field];expect(result(report)).toEqual(noReport);
  });
  it.each(['totalJobCount','successfulJobCount','compliantPdfaCount','nonCompliantPdfaCount','failedJobCount'] as const)('enforces exact validation-summary coherence %s',field=>{
    for(const compliant of [true,false]){const report=fixture(compliant);report.report.batchSummary.validationSummary[field]++;expect(result(report)).toEqual(noReport);}
    const report=fixture();delete (report.report.batchSummary.validationSummary as Partial<typeof report.report.batchSummary.validationSummary>)[field];expect(result(report)).toEqual(noReport);
  });
  it.each([0,-1,1.5,Number.MAX_SAFE_INTEGER+1,null,'2',{},[]])('requires positive safe failed counts for coherent noncompliance (%j)',count=>{
    for(const key of ['failedRules','failedChecks']){const report=fixture(false);Object.assign(validation(report).details,{[key]:count});expect(result(report)).toEqual(noReport);}
  });
  it('does not require noncompliant reports to claim passed counts or descriptive rule details',()=>{
    const report=fixture(false);delete (validation(report).details as {passedRules?:unknown}).passedRules;delete (validation(report).details as {passedChecks?:unknown}).passedChecks;
    delete (validation(report).details as {ruleSummaries?:unknown}).ruleSummaries;
    const diagnostic=result(report);expect(diagnostic).toMatchObject({verdict:'coherent-noncompliant',failedRules:2,failedChecks:4});expectPrivateAbsent(diagnostic);
  });
  it.each(['ISO 19005-1:2005','ISO 19005-2:2011','ISO 19005-3:2012','ISO 32000-1:2008','ISO 32000-2:2020'])('permits only the exact known specification identifier %s',specification=>{
    const report=fixture(false),id={...rule(),specification};validation(report).details.ruleSummaries=[id];expect(result(report)).toMatchObject({rules:[id]});
  });
  it.each([
    ['unknown-spec',{specification:`ISO 99999:2026 ${PRIVATE}`}],['spec-whitespace',{specification:'ISO 19005-3:2012 '}],['spec-case',{specification:'iso 19005-3:2012'}],
    ['clause-text',{clause:`6.2 ${PRIVATE}`}],['clause-long-segment',{clause:'6.100.2'}],['clause-too-many-segments',{clause:'1.2.3.4.5.6.7.8.9'}],['clause-empty-segment',{clause:'6..2'}],['clause-leading-dot',{clause:'.6.2'}],['clause-trailing-dot',{clause:'6.2.'}],['clause-object',{clause:{message:PRIVATE}}],
    ['test-zero',{testNumber:0}],['test-negative',{testNumber:-1}],['test-fraction',{testNumber:1.5}],['test-string',{testNumber:'1'}],['test-too-large',{testNumber:10000}],['test-object',{testNumber:{message:PRIVATE}}],
    ['checks-zero',{failedChecks:0}],['checks-negative',{failedChecks:-1}],['checks-fraction',{failedChecks:1.1}],['checks-string',{failedChecks:'2'}],['checks-too-large',{failedChecks:1000000001}],['checks-object',{failedChecks:{message:PRIVATE}}],
  ])('skips an unsafe rule identifier/count without leaking other fields: %s',(_name,override)=>{
    const report=fixture(false);Object.assign(validation(report).details.ruleSummaries[0],override,{description:PRIVATE,object:PRIVATE,test:PRIVATE,checks:[{context:PRIVATE}]});
    const diagnostic=result(report);expect(diagnostic).toMatchObject({verdict:'coherent-noncompliant',rules:[]});expectPrivateAbsent(diagnostic);
  });
  it('supports boundary rule IDs/counts and never emits more than ten valid rules',()=>{
    const report=fixture(false);const ids=Array.from({length:15},(_,i)=>({...rule(i+1),testNumber:i===0?9999:1,failedChecks:i===0?1000000000:1}));ids[0].clause='10.11.12.13.14.15.16.17';
    validation(report).details.ruleSummaries=ids;const diagnostic=result(report);expect(diagnostic).toMatchObject({rules:ids.slice(0,10)});expectPrivateAbsent(diagnostic);
  });
  it('bounds inspection to the first ten rule-summary inputs even if unknown entries precede a valid rule',()=>{
    const report=fixture(false);Object.assign(validation(report).details,{ruleSummaries:[...Array.from({length:10},()=>({message:PRIVATE})),rule()]});
    const diagnostic=result(report);expect(diagnostic).toMatchObject({verdict:'coherent-noncompliant',rules:[]});expectPrivateAbsent(diagnostic);
  });
  it('skips unknown rule entries and fields rather than serializing their messages or private strings',()=>{
    const report=fixture(false);Object.assign(validation(report).details,{ruleSummaries:[null,PRIVATE,[],{message:PRIVATE},{...rule(),description:PRIVATE,checks:[{context:PRIVATE,object:PRIVATE,test:PRIVATE}],exception:{message:PRIVATE}}]});
    const diagnostic=result(report);expect(diagnostic).toMatchObject({verdict:'coherent-noncompliant',rules:[rule()]});expectPrivateAbsent(diagnostic);
  });
});
