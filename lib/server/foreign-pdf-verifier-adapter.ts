import { constants, type Stats } from 'node:fs';
import { lstat,open,readdir,realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {ADAPTER_MAIN,ADAPTER_CLASS,ADAPTER_SOURCE,ADAPTER_SOURCE_SHA256,OFFICIAL_CLI_SHA256,NEW_STREAM_MAX_BYTES,BUFFER_THRESHOLD_BYTES,COMPILER_FLAGS} from '../../scripts/foreign-pdf/adapter-identity.mjs';
const sha=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
const hash=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
function requireValue(value:unknown):asserts value {if(!value)throw Error('Trusted verifier adapter unavailable');}
function keys(value:unknown,names:string[]):asserts value is Record<string,unknown>{requireValue(value!==null&&typeof value==='object'&&!Array.isArray(value));requireValue(Object.keys(value).sort().join(',')===[...names].sort().join(','));}
function safe(info:Stats,max:number){requireValue(info.isFile()&&!info.isSymbolicLink()&&info.uid===0&&info.nlink===1&&info.size>0&&info.size<=max&&(info.mode&0o022)===0);}
async function bytes(file:string,max:number){
  requireValue(await realpath(file)===file);const info=await lstat(file);safe(info,max);
  const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const current=await handle.stat();safe(current,max);requireValue(current.ino===info.ino&&current.dev===info.dev&&current.size===info.size);const buffer=Buffer.alloc(info.size+1);let total=0;while(total<buffer.length){const {bytesRead}=await handle.read(buffer,total,buffer.length-total,total);if(!bytesRead)break;total+=bytesRead;}requireValue(total===info.size);return buffer.subarray(0,total);}finally{await handle.close();}
}
export type ForeignVerifierAdapterEvidence={schema:1;purpose:'fixed-foreign-verifier-entry';mainClass:string;delegates:string;officialCliSha256:string;source:{name:string;bytes:number;sha256:string};compiled:{name:string;bytes:number;sha256:string};compiler:{package:string;packageVersion:string;version:string;launcherSha256:string;moduleImageSha256:string;flags:string[]};limits:{newStreamMaxBytes:number;bufferThresholdBytes:number}};
export function requireForeignVerifierAdapterEvidence(value:unknown):ForeignVerifierAdapterEvidence {
  keys(value,['schema','purpose','mainClass','delegates','officialCliSha256','source','compiled','compiler','limits']);
  requireValue(value.schema===1&&value.purpose==='fixed-foreign-verifier-entry'&&value.mainClass===ADAPTER_MAIN&&value.delegates==='org.verapdf.apps.GreenfieldCliWrapper'&&value.officialCliSha256===OFFICIAL_CLI_SHA256);
  keys(value.source,['name','bytes','sha256']);requireValue(value.source.name===ADAPTER_SOURCE&&value.source.sha256===ADAPTER_SOURCE_SHA256&&Number.isSafeInteger(value.source.bytes)&&Number(value.source.bytes)>0&&Number(value.source.bytes)<=8192);
  keys(value.compiled,['name','bytes','sha256']);requireValue(value.compiled.name===ADAPTER_CLASS&&hash(value.compiled.sha256)&&Number.isSafeInteger(value.compiled.bytes)&&Number(value.compiled.bytes)>=8&&Number(value.compiled.bytes)<=16384);
  keys(value.compiler,['package','packageVersion','version','launcherSha256','moduleImageSha256','flags']);
  requireValue(value.compiler.package==='openjdk-21-jdk-headless'&&typeof value.compiler.packageVersion==='string'&&/^[0-9A-Za-z.+:~_\-]{1,128}$/u.test(value.compiler.packageVersion)&&typeof value.compiler.version==='string'&&/^javac 21(?:\.[0-9]+){0,3}(?:[+\-][A-Za-z0-9.+\-]+)?$/u.test(value.compiler.version)&&hash(value.compiler.launcherSha256)&&hash(value.compiler.moduleImageSha256)&&JSON.stringify(value.compiler.flags)===JSON.stringify(COMPILER_FLAGS));
  keys(value.limits,['newStreamMaxBytes','bufferThresholdBytes']);requireValue(value.limits.newStreamMaxBytes===NEW_STREAM_MAX_BYTES&&value.limits.bufferThresholdBytes===BUFFER_THRESHOLD_BYTES);
  return value as unknown as ForeignVerifierAdapterEvidence;
}
/** Trusts only the fixed source and reviewed fresh compiler recipe, with actual
 * source/JAR/class bytes checked; hosted evidence independently seals compilation.
 * This does not infer arbitrary manifest claims are a source-equivalence proof.
 */
export async function verifyForeignVerifierAdapter(distribution:string):Promise<ForeignVerifierAdapterEvidence>{
  requireValue(path.isAbsolute(distribution));const root=path.join(distribution,'foreign-runtime/adapter');
  for(const [dir,names]of [[root,['ForeignVerifierMain.java','classes','manifest.json']],[path.join(root,'classes'),['org']],[path.join(root,'classes/org'),['bivaro']],[path.join(root,'classes/org/bivaro'),['pdfa']],[path.join(root,'classes/org/bivaro/pdfa'),['ForeignVerifierMain.class']]] as const){
    requireValue(await realpath(dir)===dir);const info=await lstat(dir);requireValue(info.isDirectory()&&!info.isSymbolicLink()&&info.uid===0&&(info.mode&0o022)===0);requireValue((await readdir(dir)).sort().join(',')===[...names].sort().join(','));
  }
  const evidence=requireForeignVerifierAdapterEvidence(JSON.parse((await bytes(path.join(root,'manifest.json'),8192)).toString('utf8')));
  const source=await bytes(path.join(root,ADAPTER_SOURCE),8192);requireValue(source.length===evidence.source.bytes&&sha(source)===ADAPTER_SOURCE_SHA256);
  const compiled=await bytes(path.join(root,'classes',ADAPTER_CLASS),16384);requireValue(compiled.length===evidence.compiled.bytes&&sha(compiled)===evidence.compiled.sha256&&compiled.readUInt32BE(0)===0xcafebabe&&compiled.readUInt16BE(4)===0&&compiled.readUInt16BE(6)===65&&compiled.includes(Buffer.from(ADAPTER_MAIN.replaceAll('.','/'))));
  requireValue(sha(await bytes(path.join(distribution,'bin/cli-1.30.3.jar'),64*1024*1024))===OFFICIAL_CLI_SHA256);
  return evidence;
}
