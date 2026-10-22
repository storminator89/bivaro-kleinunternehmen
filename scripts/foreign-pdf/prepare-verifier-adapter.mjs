/** Build ONLY. Compiles one fixed trusted source, never PDF/document input. */
import { constants } from 'node:fs';
import { lstat,open,realpath,mkdtemp,mkdir,readdir,writeFile,rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {ADAPTER_MAIN,ADAPTER_CLASS,ADAPTER_SOURCE,ADAPTER_SOURCE_SHA256,OFFICIAL_CLI_SHA256,NEW_STREAM_MAX_BYTES,BUFFER_THRESHOLD_BYTES,COMPILER_FLAGS} from './adapter-identity.mjs';
const execute=promisify(execFile),sha=value=>createHash('sha256').update(value).digest('hex');
const unavailable=()=>{throw Error('Trusted verifier adapter build unavailable');};
async function bytes(file,max){
  if(await realpath(file)!==file)unavailable();const info=await lstat(file);
  if(!info.isFile()||info.isSymbolicLink()||info.uid!==0||info.nlink!==1||info.size<1||info.size>max||(info.mode&0o022))unavailable();
  const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const current=await handle.stat();if(!current.isFile()||current.uid!==0||(current.mode&0o022)||current.ino!==info.ino||current.dev!==info.dev||current.size!==info.size||current.nlink!==1)unavailable();const buffer=Buffer.alloc(info.size+1);let total=0;while(total<buffer.length){const {bytesRead}=await handle.read(buffer,total,buffer.length-total,total);if(!bytesRead)break;total+=bytesRead;}if(total!==info.size)unavailable();return buffer.subarray(0,total);}finally{await handle.close();}
}
async function moduleDigest(file){
  if(await realpath(file)!==file)unavailable();const info=await lstat(file);if(!info.isFile()||info.uid!==0||info.nlink!==1||info.size<1||info.size>512*1024*1024||(info.mode&0o022))unavailable();
  const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW),hash=createHash('sha256');
  try{const current=await handle.stat();if(!current.isFile()||current.uid!==0||current.nlink!==1||(current.mode&0o022)||current.ino!==info.ino||current.dev!==info.dev||current.size!==info.size)unavailable();let total=0;const buffer=Buffer.alloc(65536);for(;;){const {bytesRead}=await handle.read(buffer,0,buffer.length,null);if(!bytesRead)break;total+=bytesRead;if(total>info.size)unavailable();hash.update(buffer.subarray(0,bytesRead));}if(total!==info.size)unavailable();return hash.digest('hex');}finally{await handle.close();}
}
export async function prepareForeignVerifierAdapter(distribution){
  if(process.getuid?.()!==0||!path.isAbsolute(distribution)||await realpath(distribution)!==distribution)unavailable();
  const source=await bytes(fileURLToPath(new URL('./'+ADAPTER_SOURCE,import.meta.url)),8192);if(sha(source)!==ADAPTER_SOURCE_SHA256)unavailable();
  const jar=path.join(distribution,'bin/cli-1.30.3.jar');if(sha(await bytes(jar,64*1024*1024))!==OFFICIAL_CLI_SHA256)unavailable();
  const compiler=await realpath('/usr/bin/javac');if(!/^\/usr\/lib\/jvm\/java-21-openjdk-(?:amd64|arm64)\/bin\/javac$/u.test(compiler))unavailable();
  const compilerBytes=await bytes(compiler,1024*1024),modules=path.resolve(compiler,'../../lib/modules');
  let temporary;
  try{
    temporary=await mkdtemp(path.join(tmpdir(),'bivaro-verifier-compiler-'));
    const options={cwd:temporary,env:{PATH:'/usr/bin:/bin',HOME:temporary,TMPDIR:temporary,LANG:'C.UTF-8',TZ:'UTC'},timeout:30_000,maxBuffer:4096,killSignal:'SIGKILL',shell:false};
    const versionResult=await execute(compiler,['-version'],options),version=(versionResult.stdout+versionResult.stderr).trim();if(!/^javac 21(?:\.[0-9]+){0,3}(?:[+\-][A-Za-z0-9.+\-]+)?$/u.test(version))unavailable();
    const packageResult=await execute('/usr/bin/dpkg-query',['-W','-f=${Version}','openjdk-21-jdk-headless'],options),packageVersion=packageResult.stdout.trim();if(packageResult.stderr||!/^[0-9A-Za-z.+:~_\-]{1,128}$/u.test(packageVersion))unavailable();
    await mkdir(path.join(temporary,'classes'),{mode:0o700});await writeFile(path.join(temporary,ADAPTER_SOURCE),source,{flag:'wx',mode:0o600});
    await execute(compiler,[...COMPILER_FLAGS,'-classpath',jar,'-d',path.join(temporary,'classes'),path.join(temporary,ADAPTER_SOURCE)],options);
    for(const [parent,child]of [['classes','org'],['classes/org','bivaro'],['classes/org/bivaro','pdfa'],['classes/org/bivaro/pdfa','ForeignVerifierMain.class']])if((await readdir(path.join(temporary,parent))).join(',')!==child)unavailable();
    const compiled=await bytes(path.join(temporary,'classes',ADAPTER_CLASS),16384);if(compiled.readUInt32BE(0)!==0xcafebabe||compiled.readUInt16BE(4)!==0||compiled.readUInt16BE(6)!==65||!compiled.includes(Buffer.from(ADAPTER_MAIN.replaceAll('.','/'))))unavailable();
    const manifest={schema:1,purpose:'fixed-foreign-verifier-entry',mainClass:ADAPTER_MAIN,delegates:'org.verapdf.apps.GreenfieldCliWrapper',officialCliSha256:OFFICIAL_CLI_SHA256,source:{name:ADAPTER_SOURCE,bytes:source.length,sha256:sha(source)},compiled:{name:ADAPTER_CLASS,bytes:compiled.length,sha256:sha(compiled)},compiler:{package:'openjdk-21-jdk-headless',packageVersion,version,launcherSha256:sha(compilerBytes),moduleImageSha256:await moduleDigest(modules),flags:[...COMPILER_FLAGS]},limits:{newStreamMaxBytes:NEW_STREAM_MAX_BYTES,bufferThresholdBytes:BUFFER_THRESHOLD_BYTES}};
    const root=path.join(distribution,'foreign-runtime/adapter');await mkdir(root,{mode:0o755});await mkdir(path.join(root,'classes/org/bivaro/pdfa'),{recursive:true,mode:0o755});
    for(const [name,value]of [[ADAPTER_SOURCE,source],['classes/'+ADAPTER_CLASS,compiled],['manifest.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n')]])await writeFile(path.join(root,name),value,{flag:'wx',mode:0o444});
    console.log(JSON.stringify({event:'foreign-verifier-adapter-built',...manifest}));return manifest;
  }catch{unavailable();}finally{if(temporary)await rm(temporary,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await prepareForeignVerifierAdapter(process.argv[2]);
