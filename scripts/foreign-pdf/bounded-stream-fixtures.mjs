/** Trusted generated vector ONLY; not a production transformation or validator.
 * Retain the same font bytes and append zero padding solely to exercise the
 * supported materialization boundary. No new font/visual coverage is claimed.
 */
import {createHash} from 'node:crypto';
import {PDFDocument,PDFDict,PDFName,PDFRawStream,PDFRef,decodePDFRawStream} from 'pdf-lib';
import {NEW_STREAM_MAX_BYTES} from './adapter-identity.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function buildBoundedStreamFixture(base,decodedBytes){
  try{
    if(!(base instanceof Uint8Array)||!base.length||base.length>20*1024*1024||(decodedBytes!==NEW_STREAM_MAX_BYTES&&decodedBytes!==NEW_STREAM_MAX_BYTES+2048))throw Error();
    const doc=await PDFDocument.load(base,{updateMetadata:false});let descriptor,count=0;
    for(const [,object]of doc.context.enumerateIndirectObjects())if(object instanceof PDFDict&&object.lookupMaybe(PDFName.of('Type'),PDFName)?.decodeText()==='FontDescriptor'){count++;descriptor=object;}
    if(count!==1||!descriptor)throw Error();
    const reference=descriptor.get(PDFName.of('FontFile2'));
    if(!(reference instanceof PDFRef)||descriptor.has(PDFName.of('FontFile'))||descriptor.has(PDFName.of('FontFile3')))throw Error();
    const original=decodePDFRawStream(doc.context.lookup(reference,PDFRawStream)).decode();
    if(!(original instanceof Uint8Array)||!original.length||original.length>=NEW_STREAM_MAX_BYTES)throw Error();
    const padded=new Uint8Array(decodedBytes);padded.set(original);
    const stream=doc.context.flateStream(padded,{Length1:padded.length});doc.context.assign(reference,stream);
    const bytes=await doc.save({useObjectStreams:false}),encoded=stream.getContents();
    if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>20*1024*1024||!(encoded instanceof Uint8Array)||!encoded.length||encoded.length>20*1024*1024)throw Error();
    return {bytes,descriptor:{decodedBytes,encodedBytes:encoded.length,originalFontBytes:original.length,originalFontSha256:sha(original),retainedFontPrefixSha256:sha(padded.subarray(0,original.length)),zeroPaddingBytes:decodedBytes-original.length}};
  }catch{throw Error('Trusted bounded stream fixture unavailable');}
}
