import { constants, type Stats } from 'node:fs';
import { open, realpath, lstat, mkdir, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
/** Configuration only: no validation profiles, parser or conformance rules here. */
export const FOREIGN_CONFIG_NAMES = ['app.xml','features.xml','fixer.xml','plugins.xml','validator.xml'] as const;
export const FOREIGN_LOGGING_PROPERTIES = '# Foreign-only runtime logging; PDF/A validation defaults are unchanged.\nhandlers=\n.level=OFF\n';
const VERSION='1.30.3';
const ARCHIVE='b512bf24945503a33fc10738ecffc1f2dccaaf8593a448e94ee9ac86a9559a59';
const CLI='19f6edd5c92841a38d9b3b018a555b7ba173b13e4e0d29edecc232e5ba6c1d70';
const MAX_TEMPLATE=64*1024, MAX_MANIFEST=4096;
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
type Identity={name:string;bytes:number;sha256:string};
export type ForeignVerifierConfigEvidence={schema:1;version:string;sourceArchiveSha256:string;cliSha256:string;generatedBy:'official-cli-version-build-only';templates:Identity[];logging:{bytes:number;sha256:string}};
function requireValue(ok:unknown):asserts ok {if(!ok)throw new Error('Trusted verifier configuration unavailable');}
function keys(value:unknown,expected:string[]):asserts value is Record<string,unknown>{requireValue(value!==null&&typeof value==='object'&&!Array.isArray(value));requireValue(Object.keys(value).sort().join(',')===[...expected].sort().join(','));}
function identity(value:unknown):ForeignVerifierConfigEvidence {
  keys(value,['schema','version','sourceArchiveSha256','cliSha256','generatedBy','templates','logging']);
  requireValue(value.schema===1&&value.version===VERSION&&value.sourceArchiveSha256===ARCHIVE&&value.cliSha256===CLI&&value.generatedBy==='official-cli-version-build-only');
  requireValue(Array.isArray(value.templates)&&value.templates.length===FOREIGN_CONFIG_NAMES.length);
  const templates=value.templates.map((entry,index)=>{keys(entry,['name','bytes','sha256']);requireValue(entry.name===FOREIGN_CONFIG_NAMES[index]&&Number.isSafeInteger(entry.bytes)&&Number(entry.bytes)>0&&Number(entry.bytes)<=MAX_TEMPLATE&&typeof entry.sha256==='string'&&/^[a-f0-9]{64}$/.test(entry.sha256));return {name:String(entry.name),bytes:Number(entry.bytes),sha256:entry.sha256};});
  keys(value.logging,['bytes','sha256']);requireValue(value.logging.bytes===Buffer.byteLength(FOREIGN_LOGGING_PROPERTIES)&&value.logging.sha256===digest(Buffer.from(FOREIGN_LOGGING_PROPERTIES)));
  return {schema:1,version:VERSION,sourceArchiveSha256:ARCHIVE,cliSha256:CLI,generatedBy:'official-cli-version-build-only',templates,logging:{bytes:Buffer.byteLength(FOREIGN_LOGGING_PROPERTIES),sha256:digest(Buffer.from(FOREIGN_LOGGING_PROPERTIES))}};
}
function safeFile(info:Stats,uid:number,max:number,privateFile:boolean){requireValue(info.isFile()&&!info.isSymbolicLink()&&info.uid===uid&&info.nlink===1&&info.size>0&&info.size<=max);requireValue(privateFile?(info.mode&0o777)===0o600:(info.mode&0o022)===0);}
async function bytes(file:string,max:number,uid:number,privateFile=false){
  requireValue(await realpath(file)===file);
  safeFile(await lstat(file),uid,max,privateFile);
  const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const info=await handle.stat();safeFile(info,uid,max,privateFile);
    const buffer=Buffer.alloc(max+1),result=await handle.read(buffer,0,buffer.length,0);
    requireValue(result.bytesRead===info.size&&result.bytesRead<=max);
    return buffer.subarray(0,result.bytesRead);
  }finally{await handle.close();}
}
async function directory(file:string,uid:number,privateDirectory=false){
  requireValue(await realpath(file)===file);const info=await lstat(file);
  requireValue(info.isDirectory()&&!info.isSymbolicLink()&&info.uid===uid&&(privateDirectory?(info.mode&0o077)===0:(info.mode&0o022)===0));
}
function uid(){requireValue(process.getuid&&process.getuid()!==0);return process.getuid();}
/** Parent-only bounded preparation, before any document is written or JVM starts.
 * Root-owned global assets remain unchanged; the JVM's Landlock grants NO writes.
 * DAC-writable private copies satisfy upstream Files.isWritable checks only.
 */
export async function prepareForeignVerifierConfig(binary:string,workDir:string):Promise<ForeignVerifierConfigEvidence>{
  requireValue(path.isAbsolute(binary)&&path.isAbsolute(workDir));const owner=uid();
  await directory(workDir,owner,true);requireValue((await readdir(workDir)).length===0);
  const distribution=path.dirname(await realpath(binary)),root=path.join(distribution,'foreign-runtime');
  for(const dir of [distribution,root,path.join(root,'templates'),path.join(root,'classes'),path.join(root,'classes/org'),path.join(root,'classes/org/verapdf'),path.join(root,'classes/org/verapdf/processor')])await directory(dir,0);
  const only=async(dir:string,names:readonly string[])=>requireValue((await readdir(dir)).sort().join(',')===[...names].sort().join(','));
  await only(root,['classes','manifest.json','templates']);await only(path.join(root,'templates'),FOREIGN_CONFIG_NAMES);
  for(const [parent,child]of [['classes','org'],['classes/org','verapdf'],['classes/org/verapdf','processor'],['classes/org/verapdf/processor','logging.properties']])await only(path.join(root,parent),[child]);
  const evidence=identity(JSON.parse((await bytes(path.join(root,'manifest.json'),MAX_MANIFEST,0)).toString('utf8')));
  const logging=await bytes(path.join(root,'classes/org/verapdf/processor/logging.properties'),MAX_TEMPLATE,0);
  requireValue(logging.toString('utf8')===FOREIGN_LOGGING_PROPERTIES&&digest(logging)===evidence.logging.sha256);
  const templates=[];
  for(const entry of evidence.templates){const value=await bytes(path.join(root,'templates',entry.name),MAX_TEMPLATE,0);requireValue(value.length===entry.bytes&&digest(value)===entry.sha256);templates.push(value);}
  await mkdir(path.join(workDir,'.verapdf'),{mode:0o700});await mkdir(path.join(workDir,'.verapdf/config'),{mode:0o700});
  for(const [index,entry]of evidence.templates.entries())await writeFile(path.join(workDir,'.verapdf/config',entry.name),templates[index],{flag:'wx',mode:0o600});
  await assertForeignVerifierConfigOnly(workDir,evidence);
  return evidence;
}
/** Synthetic no-document probe boundary, checked before AND after each launch.
 * No PDF, invoice XML, extra files or changed configuration may enter this stage.
 */
export async function assertForeignVerifierConfigOnly(workDir:string,evidence:ForeignVerifierConfigEvidence):Promise<void>{
  const expected=identity(evidence),owner=uid();
  for(const dir of [workDir,path.join(workDir,'.verapdf'),path.join(workDir,'.verapdf/config')])await directory(dir,owner,true);
  requireValue((await readdir(workDir)).sort().join(',')==='.verapdf');
  requireValue((await readdir(path.join(workDir,'.verapdf'))).sort().join(',')==='config');
  requireValue((await readdir(path.join(workDir,'.verapdf/config'))).sort().join(',')===FOREIGN_CONFIG_NAMES.join(','));
  for(const entry of expected.templates){const value=await bytes(path.join(workDir,'.verapdf/config',entry.name),MAX_TEMPLATE,owner,true);requireValue(value.length===entry.bytes&&digest(value)===entry.sha256);}
}
