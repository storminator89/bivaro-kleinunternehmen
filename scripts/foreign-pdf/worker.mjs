/** Fixed, bounded protocol. No document strings/errors in diagnostics. */
import { readFile, writeFile } from 'node:fs/promises';
import { writeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { attachToEligiblePdf, UnsupportedPdfError } from './document.mjs';
const [input, xmlInput, output] = process.argv.slice(2);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  if(process.argv.length !== 5) throw new Error('Worker contract');
  const [bytes, xmlBytes] = await Promise.all([readFile(input),readFile(xmlInput)]);
  if(!bytes.length || bytes.length > 20*1024*1024 || bytes.subarray(0,5).toString('ascii') !== '%PDF-' || xmlBytes.length > 8*1024*1024) throw new UnsupportedPdfError('PDF_INPUT_INVALID');
  let xml;
  try { xml=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(xmlBytes); }
  catch { throw new UnsupportedPdfError('PDF_XML_INVALID'); }
  if(!xml || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new UnsupportedPdfError('PDF_XML_INVALID');
  const candidate = await attachToEligiblePdf(bytes,xml);
  if(candidate.length > 40*1024*1024) throw new UnsupportedPdfError('PDF_OUTPUT_LIMIT');
  await writeFile(output,candidate,{flag:'r+'});
  writeSync(1,JSON.stringify({status:'candidate',sourceSha256:hash(bytes),xmlSha256:hash(xmlBytes),sha256:hash(candidate),bytes:candidate.length})+'\n');
} catch(error) {
  writeSync(1,JSON.stringify({status:error instanceof UnsupportedPdfError ? 'unsupported':'failed',code:error instanceof UnsupportedPdfError ? error.code:'PDF_WORKER_FAILED'})+'\n');
  process.exitCode=error instanceof UnsupportedPdfError ? 22:70;
}
