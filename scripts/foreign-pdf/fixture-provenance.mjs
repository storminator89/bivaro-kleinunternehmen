/** Trusted hosted fixture provenance only. No API/document input is accepted. */
import { createHash } from 'node:crypto';
export const VECTOR_NAME='vector-text.pdf';
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
export function createFixtureProvenance({sourceCheckout,vector,generator,font,lock,pdfkit,pdfkitVersion}){
  const result={schema:1,purpose:'fixed-synthetic-vector-validation',sourceCheckout,fixture:{name:VECTOR_NAME,bytes:vector.length,sha256:digest(vector)},generatorSha256:digest(generator),fontSha256:digest(font),lockSha256:digest(lock),pdfkit:{version:pdfkitVersion,sha256:digest(pdfkit)}};
  assertFixtureProvenance(result,result);return result;
}
export function assertFixtureProvenance(value,expected){
  if(!exact(value,['schema','purpose','sourceCheckout','fixture','generatorSha256','fontSha256','lockSha256','pdfkit'])||value.schema!==1||value.purpose!=='fixed-synthetic-vector-validation'||typeof value.sourceCheckout!=='string'||!/^[a-f0-9]{40}$/u.test(value.sourceCheckout)||value.sourceCheckout!==expected.sourceCheckout||!exact(value.fixture,['name','bytes','sha256'])||value.fixture.name!==VECTOR_NAME||!Number.isSafeInteger(value.fixture.bytes)||value.fixture.bytes<1||value.fixture.bytes>20*1024*1024||!sha(value.fixture.sha256)||!exact(value.pdfkit,['version','sha256'])||value.pdfkit.version!=='0.20.2'||!sha(value.pdfkit.sha256))throw Error('Trusted fixture provenance unavailable');
  for(const name of ['generatorSha256','fontSha256','lockSha256'])if(!sha(value[name])||value[name]!==expected[name])throw Error('Trusted fixture provenance unavailable');
  if(value.pdfkit.sha256!==expected.pdfkit.sha256||value.pdfkit.version!==expected.pdfkit.version||value.fixture.bytes!==expected.fixture.bytes||value.fixture.sha256!==expected.fixture.sha256)throw Error('Trusted fixture provenance unavailable');
}
