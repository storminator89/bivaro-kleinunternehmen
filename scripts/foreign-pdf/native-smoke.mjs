/** Mandatory genuine native gate in a fresh production container. No mocks,
 * unconfined fallback, alternate verifier, external service or host app data. */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const ORIGIN='http://127.0.0.1:3000';
const permittedPaths=new Set(['/api/auth/register','/api/auth/csrf','/api/auth/callback/credentials','/api/auth/session','/api/pdfa3','/api/purchase-documents']);
const FIXTURE='/tmp/foreign-pdf-test',EVIDENCE='/tmp/foreign-pdf-evidence';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const require=createRequire('/app/package.json'), inspectRequire=createRequire(`${FIXTURE}/fixture.cjs`);
const {createPdfA3Invoice}=inspectRequire('./lib/server/pdfa3-converter.js');
const {validatePdfA3}=inspectRequire('./lib/server/pdfa-validator.js');
const {PDFDocument,PDFArray,PDFDict,PDFName,PDFRawStream,decodePDFRawStream}=inspectRequire('pdf-lib');
const {PrismaClient}=require('@prisma/client');
const prisma=new PrismaClient({datasources:{db:{url:'file:/tmp/bivaro-foreign-compatibility.db'}},log:[]});
class CookieJar {
  #cookies = new Map();

  receive(headers) {
    assert(typeof headers.getSetCookie === 'function', 'Separate Set-Cookie headers are required.');
    const lines = headers.getSetCookie();
    assert(lines.length <= 32, 'Too many response cookies.');
    for (const line of lines) {
      assert(line.length <= 16_384, 'A response cookie exceeded its bound.');
      const [pair, ...attributes] = line.split(';');
      const separator = pair.indexOf('=');
      assert(separator > 0, 'Malformed response cookie.');
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      assert(/^[A-Za-z0-9_.-]+$/u.test(name), 'Unexpected cookie name.');
      assert(/^[\x21-\x3a\x3c-\x7e]*$/u.test(value), 'Unexpected cookie value.');
      let path = '/';
      let expires = Infinity;
      let maxAge;
      for (const attribute of attributes) {
        const index = attribute.indexOf('=');
        const key = (index < 0 ? attribute : attribute.slice(0, index)).trim().toLowerCase();
        const candidate = index < 0 ? '' : attribute.slice(index + 1).trim();
        if (key === 'domain') assert(candidate === '127.0.0.1', 'A cookie escaped loopback.');
        if (key === 'secure') assert.fail('Secure cookies cannot authenticate the HTTP fixture.');
        if (key === 'path') {
          assert(candidate.startsWith('/') && !candidate.includes(';'), 'Invalid cookie path.');
          path = candidate;
        }
        if (key === 'expires') {
          expires = Date.parse(candidate);
          assert(Number.isFinite(expires), 'Invalid cookie expiration.');
        }
        if (key === 'max-age') {
          assert(/^-?\d+$/u.test(candidate), 'Invalid cookie lifetime.');
          maxAge = Number(candidate);
          assert(Number.isSafeInteger(maxAge), 'Invalid cookie lifetime.');
        }
      }
      if (maxAge !== undefined) expires = maxAge <= 0 ? 0 : Date.now() + maxAge * 1000;
      const key = `${path}\n${name}`;
      if (!value || expires <= Date.now()) this.#cookies.delete(key);
      else this.#cookies.set(key, { name, value, path, expires });
    }
    assert(this.#cookies.size <= 32, 'The cookie jar exceeded its bound.');
  }

  header(pathname) {
    return [...this.#cookies.values()]
      .filter(cookie => cookie.expires > Date.now() && (cookie.path === '/'
        || pathname === cookie.path || pathname.startsWith(`${cookie.path.replace(/\/$/u, '')}/`)))
      .sort((left, right) => right.path.length - left.path.length)
      .map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
  }

  clear() { this.#cookies.clear(); }
}

const cookies = new CookieJar();
const deadline = AbortSignal.timeout(600_000);

async function localRequest(path, { method = 'GET', body, contentType, maxBytes = 64 * 1024, timeout = 120_000 } = {}) {
  const url = new URL(path, ORIGIN);
  assert(url.origin === ORIGIN && !url.username && !url.password && !url.hash, 'Only loopback requests are allowed.');
  assert(permittedPaths.has(url.pathname) || /^\/api\/purchase-documents\/[1-9]\d*\/original$/.test(url.pathname), 'The route is outside the smoke contract.');
  assert(method === 'GET' || method === 'POST', 'Unsupported smoke request method.');
  assert(url.pathname === '/api/files/logo' || !url.search, 'Unexpected query parameters.');
  if (typeof body === 'string') assert(Buffer.byteLength(body) <= 512 * 1024, 'Request exceeded its bound.');
  const headers = { Accept: '*/*', Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin' };
  const cookie = cookies.header(url.pathname);
  if (cookie) headers.Cookie = cookie;
  if (contentType) headers['Content-Type'] = contentType;
  const response = await fetch(url, {
    method, headers, body, redirect: 'error', cache: 'no-store',
    signal: AbortSignal.any([deadline, AbortSignal.timeout(timeout)]),
  });
  assert(response.url === url.href, 'An unexpected redirect occurred.');
  cookies.receive(response.headers);
  const declared = response.headers.get('content-length');
  if (declared !== null) assert(/^\d+$/u.test(declared) && Number(declared) <= maxBytes, 'Response exceeded its bound.');
  assert(response.body, 'The response body is missing.');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    assert(size <= maxBytes, 'Response exceeded its bound.');
    chunks.push(Buffer.from(chunk));
  }
  return { status: response.status, headers: response.headers, bytes: Buffer.concat(chunks, size) };
}

async function jsonRequest(path, body) {
  const response = await localRequest(path, body === undefined ? {} : {
    method: 'POST', body: JSON.stringify(body), contentType: 'application/json',
  });
  assert(response.headers.get('content-type')?.split(';')[0] === 'application/json', 'Expected a JSON response.');
  return { ...response, json: JSON.parse(response.bytes.toString('utf8')) };
}

const allCases=JSON.parse(await readFile(`${FIXTURE}/cases.json`,'utf8'));
const original=async name=>readFile(`${FIXTURE}/${name}.pdf`);
function raw(value){assert(value instanceof PDFRawStream);return value;}
async function invariant(bytes){
  const pdf=await PDFDocument.load(bytes,{updateMetadata:false});
  const streamHashes=pdf.context.enumerateIndirectObjects().map(([,o])=>o).filter(o=>o instanceof PDFRawStream&&!['Metadata','EmbeddedFile','ObjStm','XRef'].includes(o.dict.lookupMaybe(PDFName.of('Type'),PDFName)?.decodeText())).map(o=>sha(o.getContents())).sort();
  const intents=pdf.catalog.lookup(PDFName.of('OutputIntents'),PDFArray);
  return {pages:pdf.getPages().map(p=>({size:p.getSize(),rotation:p.getRotation().angle})),streamHashes,intents:intents.asArray().map(ref=>{
    const d=pdf.context.lookup(ref,PDFDict);return {s:d.lookup(PDFName.of('S'),PDFName).decodeText(),profile:sha(raw(d.lookup(PDFName.of('DestOutputProfile'))).getContents())};
  })};
}
async function exactXml(bytes){const doc=await PDFDocument.load(bytes,{updateMetadata:false}),af=doc.catalog.lookup(PDFName.of('AF'),PDFArray);assert.equal(af.size(),1);const spec=af.lookup(0,PDFDict);assert.equal(spec.lookup(PDFName.of('AFRelationship'),PDFName).decodeText(),'Alternative');return decodePDFRawStream(raw(spec.lookup(PDFName.of('EF'),PDFDict).lookup(PDFName.of('F')))).decode();}
const snapshot=()=>prisma.$transaction([prisma.invoice.count(),prisma.expense.count(),prisma.income.count(),prisma.invoiceNumberCounter.count(),prisma.purchaseDocument.count(),prisma.emailOutbox.count()]);
let stage='prerequisites';
try{
  assert.equal(process.platform,'linux');assert(['x64','arm64'].includes(process.arch));assert.notEqual(process.getuid(),0);
  assert.equal(process.version,'v22.23.4');assert.equal(process.env.DATABASE_URL,'file:/tmp/bivaro-foreign-compatibility.db');
  assert(!process.env.BIVARO_VERAPDF_BIN||process.env.BIVARO_VERAPDF_BIN==='/opt/verapdf/verapdf');
  assert.equal(await prisma.user.count(),0);await mkdir(EVIDENCE,{mode:0o700});
  const xmlBytes=await readFile(`${FIXTURE}/invoice.xml`),xml=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(xmlBytes);
  const inputHashes=new Map();for(const name of [...allCases.positive,...Object.keys(allCases.negative)])inputHashes.set(name,sha(await original(name)));
  stage='ordinary-authentication';
  const email=`synthetic-foreign-${randomUUID()}@example.test`,password=`Synthetic118-${randomBytes(18).toString('hex')}!`;
  const registration=await jsonRequest('/api/auth/register',{email,password,name:'Synthetic foreign compatibility',setupToken:process.env.BIVARO_SETUP_TOKEN});assert.equal(registration.status,201);
  const csrf=await jsonRequest('/api/auth/csrf');assert.equal(csrf.status,200);
  const login=await localRequest('/api/auth/callback/credentials',{method:'POST',contentType:'application/x-www-form-urlencoded',body:new URLSearchParams({csrfToken:csrf.json.csrfToken,email,password,callbackUrl:`${ORIGIN}/dashboard`,json:'true'}).toString()});assert.equal(login.status,200);
  assert.equal(new URL(JSON.parse(login.bytes.toString('utf8')).url).pathname,'/dashboard');
  const session=await jsonRequest('/api/auth/session');assert.equal(session.json?.user?.id,registration.json?.user?.id);
  stage='original-archive-baseline';
  const archived=[];
  for(const name of ['vector-text','attachment']){
    const bytes=await original(name),form=new FormData();form.set('file',new Blob([bytes],{type:'application/pdf'}),`${name}.pdf`);form.set('uploadRequestId',randomUUID());form.set('analysisMode','manual');
    const uploaded=await localRequest('/api/purchase-documents',{method:'POST',body:form,maxBytes:1024*1024});assert.equal(uploaded.status,201);
    const id=JSON.parse(uploaded.bytes.toString('utf8')).document.id;assert(Number.isSafeInteger(id));
    const downloaded=await localRequest(`/api/purchase-documents/${id}/original`,{maxBytes:20*1024*1024});assert.equal(downloaded.status,200);assert.equal(sha(downloaded.bytes),sha(bytes));archived.push({id,name});
  }
  const before=await snapshot(),cases=[];
  for(const name of allCases.positive){
    stage=`positive-${name}`;const bytes=await original(name);
    // Both exact compiled parent and actual standalone route must traverse the
    // production kernel sandbox and pinned independent validator twice.
    const direct=await createPdfA3Invoice({basePdfBytes:bytes,xmlContent:xml,invoiceNumber:'SYNTHETIC-118',userId:'native-direct-gate'});
    await validatePdfA3(direct,{maxBytes:40*1024*1024,confined:true});
    assert.deepEqual(await invariant(direct),await invariant(bytes));assert.equal(sha(await exactXml(direct)),sha(xmlBytes));
    const form=new FormData();form.set('pdf',new Blob([bytes],{type:'application/pdf'}),`${name}.pdf`);form.set('xml',new Blob([xmlBytes],{type:'text/xml'}),'invoice.xml');form.set('invoiceNumber','SYNTHETIC-118');
    const response=await localRequest('/api/pdfa3',{method:'POST',body:form,maxBytes:40*1024*1024});assert.equal(response.status,200);
    await validatePdfA3(response.bytes,{maxBytes:40*1024*1024,confined:true});
    assert.deepEqual(await invariant(response.bytes),await invariant(bytes));assert.equal(sha(await exactXml(response.bytes)),sha(xmlBytes));
    await writeFile(`${EVIDENCE}/${name}-source.pdf`,bytes,{flag:'wx',mode:0o600});await writeFile(`${EVIDENCE}/${name}-final.pdf`,response.bytes,{flag:'wx',mode:0o600});
    cases.push({name,pages:(await invariant(bytes)).pages.length,sourceSha256:sha(bytes),finalSha256:sha(response.bytes),xmlSha256:sha(xmlBytes),pageResourcesAndGeometryPreserved:true});
  }
  const rejected=[];
  for(const [name,expected]of Object.entries(allCases.negative)){
    stage=`negative-${name}`;const bytes=await original(name),allowed=Array.isArray(expected)?expected:[expected];
    await assert.rejects(createPdfA3Invoice({basePdfBytes:bytes,xmlContent:xml,invoiceNumber:'SYNTHETIC-118',userId:'native-direct-gate'}),e=>e.status===422&&allowed.includes(e.code));
    const form=new FormData();form.set('pdf',new Blob([bytes],{type:'application/pdf'}),`${name}.pdf`);form.set('xml',new Blob([xmlBytes],{type:'text/xml'}),'invoice.xml');form.set('invoiceNumber','SYNTHETIC-118');
    const response=await localRequest('/api/pdfa3',{method:'POST',body:form});assert.equal(response.status,422);const error=JSON.parse(response.bytes.toString('utf8'));assert(allowed.includes(error.code));rejected.push({name,code:error.code});
  }
  stage='archive-and-state-preservation';
  for(const {id,name}of archived){const response=await localRequest(`/api/purchase-documents/${id}/original`,{maxBytes:20*1024*1024});assert.equal(response.status,200);assert.equal(sha(response.bytes),inputHashes.get(name));}
  for(const [name,beforeHash]of inputHashes)assert.equal(sha(await original(name)),beforeHash);
  assert.deepEqual(await snapshot(),before);
  await writeFile(`${EVIDENCE}/manifest.json`,JSON.stringify({status:'passed',syntheticOnly:true,platform:process.platform,architecture:process.arch,node:process.version,verifier:'1.30.3',cases,rejected,originalFilesPreserved:true,archivedOriginalAndAttachmentPreserved:true,statelessFinancialCountsBefore:before,statelessFinancialCountsAfter:await snapshot(),limits:'No claim of cryptographic signature validation or full XML/business-rule conformance; synthetic signature dictionary is a conservative rejection fixture.'},null,2),{flag:'wx',mode:0o600});
  console.log(`Genuine foreign PDF compatibility gate passed (${process.arch}).`);
}catch(error){
  console.error(`Foreign PDF compatibility failed at ${stage}${error instanceof assert.AssertionError?`: ${error.message.slice(0,180).replace(/[\r\n]/g,' ')}`:''}`);
  process.exitCode=1;
}finally{cookies.clear();await prisma.$disconnect();}
