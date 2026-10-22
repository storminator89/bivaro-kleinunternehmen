/** Synthetic no-document startup diagnostic ONLY. Never used by an API or worker.
 * Inputs are exact compiled production factories, not paths/argv/env from users.
 * Mandatory production PDF validation/derivation remains a separate unchanged gate.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const MAIN='org.verapdf.apps.GreenfieldCliWrapper',BINARY='/opt/verapdf/verapdf';
const MAX_OUTPUT=2*1024*1024,MAX_EXCERPT=4096,TIMEOUT=30_000;
export function sanitizeTrustedStartupText(text,directory,maxBytes=MAX_EXCERPT){
  if(typeof text!=='string'||typeof directory!=='string'||!directory.startsWith('/')||!Number.isSafeInteger(maxBytes)||maxBytes<0||maxBytes>MAX_EXCERPT)return '';
  let clean=text.split(directory).join('<workdir>')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu,'')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/gu,'')
    .replace(/\p{Cf}/gu,'')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/giu,'<uri>')
    .replace(/(?:[A-Za-z]:[\\/]|\/|\.\.?\/)[^\s<>"']+/gu,'<path>')
    .replace(/\b[\w.-]*(?:password|secret|token|api[_-]?key|authorization|cookie)[\w.-]*["']?\s*[:=][^\n]*/giu,'<credential>');
  const bytes=Buffer.from(clean);let end=Math.min(bytes.length,maxBytes);
  while(end>0&&end<bytes.length&&(bytes[end]&0xc0)===0x80)end--;
  return bytes.subarray(0,end).toString('utf8');
}
function exitBucket(code){return [0,1,2,22,70,126,127].includes(code)?String(code):'other';}
export function startupCommand(cli,mode){
  if(!Array.isArray(cli)||cli.some(a=>typeof a!=='string')||cli[0]!=='/usr/bin/setpriv'||!['jvm','cli'].includes(mode)||cli.filter(a=>a===MAIN).length!==1||cli.at(-2)!==MAIN||cli.at(-1)!=='--version')throw Error('Startup boundary unavailable');
  return mode==='cli'?[...cli]:[...cli.slice(0,-2),'-version'];
}
function collect(spec){
  return new Promise(resolve=>{
    let child,failed=false,outcome='passed',total=0,killed=false;
    const stdout=[],stderr=[];
    const kill=()=>{if(killed)return;killed=true;try{if(child?.pid)process.kill(-child.pid,'SIGKILL');else child?.kill('SIGKILL');}catch{try{child?.kill('SIGKILL');}catch{/* Reaped. */}}};
    const fail=reason=>{if(!failed)outcome=reason;failed=true;kill();};
    try{child=spawn(spec.binary,spec.args,spec.options);}catch{return resolve({outcome:'launch-error',exit:'other',text:''});}
    const timer=setTimeout(()=>fail('timeout'),TIMEOUT);
    const consume=(chunk,target)=>{total+=chunk.byteLength;if(total>MAX_OUTPUT){fail('output-limit');return;}if(!failed)target.push(Buffer.from(chunk));};
    child.stdout.on('data',chunk=>consume(chunk,stdout));child.stderr.on('data',chunk=>consume(chunk,stderr));
    child.stdout.on('error',()=>fail('stream-error'));child.stderr.on('error',()=>fail('stream-error'));child.once('error',()=>fail('launch-error'));
    child.once('exit',(code,signal)=>{if(code!==0||signal){if(!failed)outcome=signal?'signal':'nonzero-exit';failed=true;}kill();});
    child.once('close',(code,signal)=>{clearTimeout(timer);kill();if(code!==0||signal){if(!failed)outcome=signal?'signal':'nonzero-exit';failed=true;}
      resolve({outcome:failed?outcome:'passed',exit:exitBucket(code),text:failed?`stdout:\n${Buffer.concat(stdout).toString('utf8')}\nstderr:\n${Buffer.concat(stderr).toString('utf8')}`:''});});
  });
}
export async function probeTrustedVerifierStartup({foreignVerifierCommand,veraPdfSpawnSpecification,prepareForeignVerifierConfig,assertForeignVerifierConfigOnly}){
  let directory,configuration;const results=[];let remaining=MAX_EXCERPT;
  try{
    directory=await mkdtemp(path.join(tmpdir(),'bivaro-foreign-startup-'));
    configuration=await prepareForeignVerifierConfig(BINARY,directory);
    const build=await foreignVerifierCommand(BINARY,directory);
    for(const mode of ['jvm','cli']){
      // Only the exact trusted default configuration is allowed, never a PDF
      // or invoice XML. Hashes/tree are rechecked before AND after each launch.
      await assertForeignVerifierConfigOnly(directory,configuration);
      const command=startupCommand(build(['--version']),mode);
      const spec=veraPdfSpawnSpecification(BINARY,['--version'],directory,()=>command);
      const result=await collect(spec);
      await assertForeignVerifierConfigOnly(directory,configuration);
      const excerpt=sanitizeTrustedStartupText(result.text,directory,remaining);
      remaining-=Buffer.byteLength(excerpt);results.push({mode,outcome:result.outcome,exit:result.exit,excerpt});
    }
  }catch{results.push({mode:'boundary',outcome:'unavailable',exit:'other',excerpt:''});}
  finally{if(directory)try{await rm(directory,{recursive:true,force:true});}catch{results.push({mode:'cleanup',outcome:'unavailable',exit:'other',excerpt:''});}}
  return {event:'foreign-pdf-trusted-startup',results,...(configuration?{configuration}:{})};
}
