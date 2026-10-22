/** Harness ONLY: exact trusted synthetic vector fixture, never customer/API data.
 * Same production command/policy, no alternative validator or successful retry.
 */
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat,open,realpath,readdir,mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertFixtureProvenance,createFixtureProvenance,digest,VECTOR_NAME } from './fixture-provenance.mjs';
import { sanitizeTrustedStartupText } from './startup-probe.mjs';
const BINARY='/opt/verapdf/verapdf',FIXTURE='/tmp/foreign-pdf-test',MAX_OUTPUT=2*1024*1024,MAX_EXCERPT=4096,TIMEOUT=30_000;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const count=value=>Number.isSafeInteger(value)&&value>=0&&value<=1_000_000_000;
const specifications=new Set(['ISO 19005-1:2005','ISO 19005-2:2011','ISO 19005-3:2012','ISO 32000-1:2008','ISO 32000-2:2020']);
export function fixtureReportDiagnostic(stdout,pdfPath,pdfBytes){
  const unknown={verdict:'no-coherent-report'};
  try{
    if(typeof stdout!=='string'||Buffer.byteLength(stdout)>MAX_OUTPUT)return unknown;
    const root=JSON.parse(stdout),report=root?.report;
    if(!object(root)||Object.keys(root).length!==1||!object(report)||!Array.isArray(report.jobs)||report.jobs.length!==1)return unknown;
    const job=report.jobs[0],summary=report.batchSummary;
    if(!object(job)||'taskException'in job||!object(job.itemDetails)||job.itemDetails.name!==pdfPath||job.itemDetails.size!==pdfBytes||!Array.isArray(job.validationResult)||job.validationResult.length!==1||!object(summary))return unknown;
    const result=job.validationResult[0],counts=summary.validationSummary;
    if(!object(result)||result.jobEndStatus!=='normal'||typeof result.profileName!=='string'||!/^PDF\/A-3B validation profile$/iu.test(result.profileName)||!object(result.details)||!object(counts))return unknown;
    for(const key of ['failedParsingJobs','failedEncryptedJobs','outOfMemory','veraExceptions'])if(summary[key]!==0)return unknown;
    if(summary.totalJobs!==1||counts.totalJobCount!==1||counts.successfulJobCount!==1||counts.failedJobCount!==0)return unknown;
    const details=result.details;
    if(result.compliant===true&&counts.compliantPdfaCount===1&&counts.nonCompliantPdfaCount===0&&details.failedRules===0&&details.failedChecks===0&&count(details.passedRules)&&details.passedRules>0&&count(details.passedChecks)&&details.passedChecks>0)return {verdict:'coherent-compliant'};
    if(result.compliant!==false||counts.compliantPdfaCount!==0||counts.nonCompliantPdfaCount!==1||!count(details.failedRules)||details.failedRules<1||!count(details.failedChecks)||details.failedChecks<1)return unknown;
    const rules=[];
    for(const rule of Array.isArray(details.ruleSummaries)?details.ruleSummaries.slice(0,10):[]){
      if(object(rule)&&specifications.has(rule.specification)&&typeof rule.clause==='string'&&/^[0-9]{1,2}(?:\.[0-9]{1,2}){0,7}$/u.test(rule.clause)&&Number.isSafeInteger(rule.testNumber)&&rule.testNumber>=1&&rule.testNumber<=9999&&count(rule.failedChecks)&&rule.failedChecks>0)rules.push({specification:rule.specification,clause:rule.clause,testNumber:rule.testNumber,failedChecks:rule.failedChecks});
    }
    return {verdict:'coherent-noncompliant',failedRules:details.failedRules,failedChecks:details.failedChecks,rules};
  }catch{return unknown;}
}
export function fixtureExitBucket(code){return [0,1,2,3,4,6,7,8,9,10,11,12,22,70,126,127].includes(code)?String(code):'other';}
async function regularBytes(file,max,privateFile=false){
  if(await realpath(file)!==file)throw Error('Trusted fixture boundary unavailable');
  const check=info=>{if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size<1||info.size>max||(info.mode&0o022)!==0||(privateFile&&(info.uid!==process.getuid()||(info.mode&0o777)!==0o600)))throw Error('Trusted fixture boundary unavailable');};
  check(await lstat(file));const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const info=await handle.stat();check(info);const bytes=Buffer.alloc(max+1),read=await handle.read(bytes,0,bytes.length,0);if(read.bytesRead!==info.size)throw Error('Trusted fixture boundary unavailable');return bytes.subarray(0,read.bytesRead);}finally{await handle.close();}
}
async function boundary(directory,configuration,fixture){
  for(const [dir,names]of [[directory,['.verapdf','final.pdf']],[`${directory}/.verapdf`,['config']],[`${directory}/.verapdf/config`,configuration.templates.map(entry=>entry.name)]]){
    const info=await lstat(dir);if(await realpath(dir)!==dir||!info.isDirectory()||info.isSymbolicLink()||info.uid!==process.getuid()||(info.mode&0o077)!==0)throw Error('Trusted fixture boundary unavailable');
    const entries=(await readdir(dir)).sort();if(entries.length!==names.length||entries.some((name,index)=>name!==[...names].sort()[index]))throw Error('Trusted fixture boundary unavailable');
  }
  const input=await regularBytes(`${directory}/final.pdf`,20*1024*1024,true);if(input.length!==fixture.bytes||digest(input)!==fixture.sha256)throw Error('Trusted fixture boundary unavailable');
  for(const entry of configuration.templates){const bytes=await regularBytes(`${directory}/.verapdf/config/${entry.name}`,64*1024,true);if(bytes.length!==entry.bytes||digest(bytes)!==entry.sha256)throw Error('Trusted fixture boundary unavailable');}
}
// Capture exists ONLY inside this fixed-fixture harness, not the shared validator.
function collect(spec){return new Promise(resolve=>{
  let child,failed=false,aborted=false,outcome='passed',total=0,killed=false;const stdout=[],stderr=[];
  const kill=()=>{if(killed)return;killed=true;try{if(child?.pid)process.kill(-child.pid,'SIGKILL');else child?.kill('SIGKILL');}catch{try{child?.kill('SIGKILL');}catch{/* Reaped. */}}};
  const fail=reason=>{if(!aborted)outcome=reason;aborted=true;failed=true;kill();};
  try{child=spawn(spec.binary,spec.args,spec.options);}catch{return resolve({outcome:'launch-error',exit:'other',stdout:'',stderr:''});}
  const timer=setTimeout(()=>fail('timeout'),TIMEOUT);
  const consume=(chunk,target)=>{total+=chunk.byteLength;if(total>MAX_OUTPUT){fail('output-limit');return;}if(!aborted)target.push(Buffer.from(chunk));};
  child.stdout.on('data',chunk=>consume(chunk,stdout));child.stderr.on('data',chunk=>consume(chunk,stderr));child.stdout.on('error',()=>fail('stream-error'));child.stderr.on('error',()=>fail('stream-error'));child.once('error',()=>fail('launch-error'));
  child.once('exit',(code,signal)=>{if(code!==0||signal){if(!failed)outcome=signal?'signal':'nonzero-exit';failed=true;}kill();});
  child.once('close',(code,signal)=>{clearTimeout(timer);kill();if(code!==0||signal){if(!failed)outcome=signal?'signal':'nonzero-exit';failed=true;}resolve({outcome:failed?outcome:'passed',exit:fixtureExitBucket(code),stdout:Buffer.concat(stdout).toString('utf8'),stderr:Buffer.concat(stderr).toString('utf8')});});
});}
export async function probeTrustedFixtureValidation({foreignVerifierCommand,veraPdfSpawnSpecification,prepareForeignVerifierConfig,assertForeignVerifierConfigOnly},sourceCheckout){
  let directory,result={outcome:'unavailable',exit:'other',report:{verdict:'no-coherent-report'},excerpt:''},provenance;
  try{
    // All test-side inputs stay on the existing read-only fixture/dependency
    // mounts. Do not rely on incidental Next standalone copies under /app.
    const pdfkitRoot=`${FIXTURE}/node_modules/pdfkit`,pdfkitFile=`${pdfkitRoot}/js/pdfkit.node.mjs`;
    const pkg=JSON.parse((await regularBytes(`${pdfkitRoot}/package.json`,64*1024)).toString('utf8'));
    if(pkg.exports?.['.']?.node?.import!=='./js/pdfkit.node.mjs')throw Error('Trusted fixture provenance unavailable');
    const vector=await regularBytes(`${FIXTURE}/${VECTOR_NAME}`,20*1024*1024);
    const expected=createFixtureProvenance({sourceCheckout,vector,generator:await regularBytes(`${FIXTURE}/provenance/generator.mjs`,128*1024),font:await regularBytes(`${FIXTURE}/provenance/font.ttf`,1024*1024),lock:await regularBytes(`${FIXTURE}/provenance/package-lock.json`,2*1024*1024),pdfkit:await regularBytes(pdfkitFile,1024*1024),pdfkitVersion:pkg.version});
    const manifest=JSON.parse((await regularBytes(`${FIXTURE}/fixture-provenance.json`,4096)).toString('utf8'));
    assertFixtureProvenance(manifest,expected);provenance=expected;
    directory=await mkdtemp(path.join(tmpdir(),'bivaro-foreign-fixture-'));
    const configuration=await prepareForeignVerifierConfig(BINARY,directory),command=await foreignVerifierCommand(BINARY,directory);
    await assertForeignVerifierConfigOnly(directory,configuration);
    // The no-document version prerequisite already uses this exact recipe in
    // the mandatory startup probe. This separate diagnostic supplies ONLY the
    // authenticated fixed vector bytes to the actual validation argv.
    const pdfPath=path.join(directory,'final.pdf');await writeFile(pdfPath,vector,{flag:'wx',mode:0o600});await boundary(directory,configuration,expected.fixture);
    const args=['--flavour','3b','--format','json','--maxfailuresdisplayed','10','--loglevel','0',pdfPath];
    const collected=await collect(veraPdfSpawnSpecification(BINARY,args,directory,command));
    await boundary(directory,configuration,expected.fixture);
    const report=fixtureReportDiagnostic(collected.stdout,pdfPath,vector.length);
    // A coherent noncompliance result needs only numeric rule references/counts,
    // never report text, check contexts or PDF contents. Infrastructure/parser
    // failures alone may produce the bounded sanitized synthetic-only excerpt.
    const text=report.verdict==='coherent-noncompliant'?'':report.verdict==='coherent-compliant'?collected.stderr:`stdout:\n${collected.stdout}\nstderr:\n${collected.stderr}`;
    result={outcome:collected.outcome,exit:collected.exit,report,excerpt:report.verdict==='coherent-noncompliant'||(collected.outcome==='passed'&&report.verdict==='coherent-compliant')?'':sanitizeTrustedStartupText(text,directory,MAX_EXCERPT)};
  }catch{/* No unknown exception/message/path may leave the boundary. */}
  finally{if(directory)try{await rm(directory,{recursive:true,force:true});}catch{result={outcome:'cleanup-unavailable',exit:'other',report:{verdict:'no-coherent-report'},excerpt:''};}}
  return {event:'foreign-pdf-trusted-fixture-validation',...result,...(provenance?{provenance}:{})};
}
