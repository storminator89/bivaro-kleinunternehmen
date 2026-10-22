import { beforeEach,describe,expect,it,vi } from 'vitest';
import { createHash } from 'node:crypto';

// Entire pdf-lib surface is replaced. These are writer-object/byte-array doubles,
// not PDF parsing, compression, font processing, generation or conformance tests.
const m=vi.hoisted(()=>{
  class Name{constructor(readonly value:string){}static of(value:string){return new Name(value);}decodeText(){return this.value;}}
  class Ref{constructor(readonly number:number){}}
  class Dict{
    fields=new Map<string,unknown>();
    lookupMaybe=vi.fn((key:Name,type:typeof Name)=>{const value=this.fields.get(key.value);if(value===undefined)return undefined;if(!(value instanceof type))throw Error('PRIVATE_PDF_TEXT_NEVER_EMIT');return value;});
    get=vi.fn((key:Name)=>this.fields.get(key.value));has=vi.fn((key:Name)=>this.fields.has(key.value));
    set=vi.fn(()=>{throw Error('Forbidden arbitrary dictionary rewrite');});
  }
  class RawStream{constructor(readonly contents:Uint8Array){}getContents=vi.fn(()=>this.contents);}
  return {Name,Ref,Dict,RawStream,load:vi.fn(),enumerate:vi.fn(),lookup:vi.fn(),decode:vi.fn(),decoder:vi.fn(),flateStream:vi.fn(),assign:vi.fn(),save:vi.fn(),objects:[] as [unknown,unknown][],descriptor:new Dict(),reference:new Ref(7),font:new RawStream(new Uint8Array([5,6])),output:new RawStream(new Uint8Array([8,9,10])),document:{} as {context:{enumerateIndirectObjects:typeof vi.fn;lookup:typeof vi.fn;flateStream:typeof vi.fn;assign:typeof vi.fn};save:typeof vi.fn}};
});
vi.mock('pdf-lib',()=>({PDFDocument:{load:m.load},PDFDict:m.Dict,PDFName:m.Name,PDFRawStream:m.RawStream,PDFRef:m.Ref,decodePDFRawStream:m.decoder}));
import { buildBoundedStreamFixture } from '../../scripts/foreign-pdf/bounded-stream-fixtures.mjs';
import { NEW_STREAM_MAX_BYTES as N } from '../../scripts/foreign-pdf/adapter-identity.mjs';
const PRIVATE='PRIVATE_PDF_TEXT_NEVER_EMIT',MESSAGE='Trusted bounded stream fixture unavailable';
const BASE=new Uint8Array([11,12,13]),SAVED=new Uint8Array([21,22,23]),ORIGINAL=new Uint8Array([0,255,17,99]);
const sha=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
function descriptor(){const value=new m.Dict();value.fields.set('Type',m.Name.of('FontDescriptor'));value.fields.set('FontFile2',m.reference);return value;}
async function unavailable(size:unknown=N){
  let error:unknown;try{await buildBoundedStreamFixture(BASE,size);}catch(value){error=value;}
  expect(error).toBeInstanceOf(Error);expect((error as Error).message).toBe(MESSAGE);expect(String(error)).not.toContain(PRIVATE);expect(JSON.stringify(error)).not.toContain(PRIVATE);
}
beforeEach(()=>{
  vi.clearAllMocks();m.reference=new m.Ref(7);m.descriptor=descriptor();m.font=new m.RawStream(new Uint8Array([5,6]));m.output=new m.RawStream(new Uint8Array([8,9,10]));m.objects=[[new m.Ref(1),m.descriptor]];
  m.document={context:{enumerateIndirectObjects:m.enumerate,lookup:m.lookup,flateStream:m.flateStream,assign:m.assign},save:m.save};
  m.load.mockResolvedValue(m.document);m.enumerate.mockImplementation(()=>m.objects);
  m.lookup.mockImplementation((reference:unknown,type:unknown)=>{expect(reference).toBe(m.reference);expect(type).toBe(m.RawStream);return m.font;});
  m.decoder.mockImplementation((stream:unknown)=>{if(!(stream instanceof m.RawStream))throw Error(PRIVATE);return {decode:m.decode};});m.decode.mockReturnValue(ORIGINAL);
  m.flateStream.mockReturnValue(m.output);m.assign.mockReturnValue(undefined);m.save.mockResolvedValue(SAVED);
});

describe('fixed synthetic bounded-font stream fixtures (fully mocked pdf-lib)',()=>{
  it.each([N,N+2048])('retains the exact font prefix and appends only zero bytes to the fixed %i-byte target',async decodedBytes=>{
    const result=await buildBoundedStreamFixture(BASE,decodedBytes),padded=m.flateStream.mock.calls[0][0] as Uint8Array;
    expect(m.load).toHaveBeenCalledExactlyOnceWith(BASE,{updateMetadata:false});expect(m.enumerate).toHaveBeenCalledOnce();
    expect(m.lookup).toHaveBeenCalledExactlyOnceWith(m.reference,m.RawStream);expect(m.decoder).toHaveBeenCalledExactlyOnceWith(m.font);expect(m.decode).toHaveBeenCalledOnce();
    expect(padded instanceof Uint8Array).toBe(true);expect(padded.length).toBe(decodedBytes);expect(padded.subarray(0,ORIGINAL.length)).toEqual(ORIGINAL);expect(padded.subarray(ORIGINAL.length).every(byte=>byte===0)).toBe(true);expect(ORIGINAL).toEqual(new Uint8Array([0,255,17,99]));
    expect(m.flateStream).toHaveBeenCalledTimes(1);expect(m.flateStream.mock.calls[0][0]).toBe(padded);expect(m.flateStream.mock.calls[0][1]).toEqual({Length1:decodedBytes});expect(m.assign).toHaveBeenCalledExactlyOnceWith(m.reference,m.output);expect(m.descriptor.set).not.toHaveBeenCalled();
    expect(m.save).toHaveBeenCalledExactlyOnceWith({useObjectStreams:false});expect(result.bytes).toBe(SAVED);
    expect(result.descriptor).toEqual({decodedBytes,encodedBytes:3,originalFontBytes:ORIGINAL.length,originalFontSha256:sha(ORIGINAL),retainedFontPrefixSha256:sha(ORIGINAL),zeroPaddingBytes:decodedBytes-ORIGINAL.length});
    expect(JSON.stringify(result.descriptor)).not.toContain(PRIVATE);expect(Object.keys(result)).toEqual(['bytes','descriptor']);
  });
  it.each([1,N-1])('accepts only a nonempty original shorter than the supported limit: %i bytes',async length=>{
    const original=new Uint8Array(length).fill(19);m.decode.mockReturnValue(original);const result=await buildBoundedStreamFixture(BASE,N);
    expect(result.descriptor).toMatchObject({originalFontBytes:length,originalFontSha256:sha(original),retainedFontPrefixSha256:sha(original),zeroPaddingBytes:N-length});
    expect((m.flateStream.mock.calls[0][0] as Uint8Array).subarray(length).every(byte=>byte===0)).toBe(true);
  });
  it.each([undefined,null,0,1,N-1,N+1,N+2047,N+2049,NaN,Infinity,String(N),true,{},[]])('refuses every other requested size before any PDF operation (%s)',async size=>{
    // Explicit undefined must not take this test helper's default argument.
    if(size===undefined){await expect(buildBoundedStreamFixture(BASE,undefined)).rejects.toThrow(MESSAGE);}else await unavailable(size);
    expect(m.load).not.toHaveBeenCalled();expect(m.decode).not.toHaveBeenCalled();expect(m.assign).not.toHaveBeenCalled();expect(m.save).not.toHaveBeenCalled();
  });
  it('ignores non-dictionaries and unrelated indirect objects rather than rewriting them',async()=>{
    const other=new m.Dict();other.fields.set('Type',m.Name.of('Page'));m.objects.unshift([new m.Ref(2),other],[new m.Ref(3),PRIVATE],[new m.Ref(4),null]);
    await buildBoundedStreamFixture(BASE,N);expect(m.assign).toHaveBeenCalledExactlyOnceWith(m.reference,m.output);expect(other.set).not.toHaveBeenCalled();expect(m.descriptor.set).not.toHaveBeenCalled();
  });
  it.each(['none','two','same-descriptor-twice'])('requires exactly one FontDescriptor (%s)',async kind=>{
    m.objects=kind==='none'?[]:[[new m.Ref(1),m.descriptor],[new m.Ref(2),kind==='two'?descriptor():m.descriptor]];
    await unavailable();expect(m.decoder).not.toHaveBeenCalled();expect(m.flateStream).not.toHaveBeenCalled();expect(m.save).not.toHaveBeenCalled();
  });
  it.each([undefined,null,PRIVATE,7,{},new Uint8Array([1]),new m.RawStream(new Uint8Array([1])),new m.Dict()])('requires FontFile2 to be an indirect PDFRef (%s)',async reference=>{
    m.descriptor.fields.set('FontFile2',reference);await unavailable();expect(m.lookup).not.toHaveBeenCalled();expect(m.decoder).not.toHaveBeenCalled();expect(m.save).not.toHaveBeenCalled();
  });
  it.each(['FontFile','FontFile3'])('rejects an alternative %s key even when its value is null',async name=>{
    m.descriptor.fields.set(name,null);await unavailable();expect(m.lookup).not.toHaveBeenCalled();expect(m.decoder).not.toHaveBeenCalled();expect(m.save).not.toHaveBeenCalled();
  });
  it.each([0,N,N+2048])('rejects original decoded font length %i before replacement or saving',async length=>{
    m.decode.mockReturnValue(new Uint8Array(length));await unavailable();expect(m.flateStream).not.toHaveBeenCalled();expect(m.assign).not.toHaveBeenCalled();expect(m.save).not.toHaveBeenCalled();
  });
  it.each([undefined,null,PRIVATE,{},[],new Uint16Array([1,2])])('fails closed on an invalid decoder return type (%s)',async value=>{
    m.decode.mockReturnValue(value);await unavailable();expect(m.flateStream).not.toHaveBeenCalled();expect(m.assign).not.toHaveBeenCalled();expect(m.save).not.toHaveBeenCalled();
  });
  it.each([
    ['missing',undefined],['null',null],['string',PRIVATE],['object',{}],['array',[]],['wrong-typed-array',new Uint16Array([1])],['empty',new Uint8Array()],['oversized',new Uint8Array(20*1024*1024+1)],
  ])('rejects invalid input bytes before any PDF operation: %s',async(_name,base)=>{
    await expect(buildBoundedStreamFixture(base,N)).rejects.toThrow(MESSAGE);expect(m.load).not.toHaveBeenCalled();expect(m.assign).not.toHaveBeenCalled();expect(m.save).not.toHaveBeenCalled();
  });
  it.each([
    ['missing',undefined],['null',null],['string',PRIVATE],['object',{}],['array',[]],['wrong-typed-array',new Uint16Array([1])],['empty',new Uint8Array()],['oversized',new Uint8Array(20*1024*1024+1)],
  ])('fails closed on invalid serialized fixture bytes: %s',async(_name,bytes)=>{
    m.save.mockResolvedValue(bytes);await unavailable();
  });
  it.each([
    ['missing',undefined],['null',null],['string',PRIVATE],['object',{}],['array',[]],['wrong-typed-array',new Uint16Array([1])],['empty',new Uint8Array()],['oversized',new Uint8Array(20*1024*1024+1)],
  ])('fails closed on invalid encoded Flate stream contents: %s',async(_name,bytes)=>{
    m.output.getContents.mockReturnValue(bytes as Uint8Array);await unavailable();
  });
  it('accepts Buffer subclasses while retaining the original prefix and correct digest',async()=>{
    const original=Buffer.from(ORIGINAL);m.decode.mockReturnValue(original);const result=await buildBoundedStreamFixture(Buffer.from(BASE),N);expect(result.descriptor).toMatchObject({originalFontBytes:original.length,originalFontSha256:sha(original),retainedFontPrefixSha256:sha(original)});
  });
  it('does not accept a direct dictionary or a plain object as the indirect font stream',async()=>{
    m.lookup.mockReturnValue({contents:PRIVATE});await unavailable();expect(m.assign).not.toHaveBeenCalled();expect(m.save).not.toHaveBeenCalled();
  });
  it.each([undefined,null,PRIVATE,{},new m.Ref(4)])('rejects a descriptor Type with the wrong PDFName representation (%s)',async value=>{
    m.descriptor.fields.set('Type',value);await unavailable();expect(m.decoder).not.toHaveBeenCalled();expect(m.assign).not.toHaveBeenCalled();
  });
  it('does not export private font names, PDF object text or unrelated dictionary properties',async()=>{
    const inspect=vi.fn(()=>{throw Error(PRIVATE);});for(const name of ['FontName','FontFamily','PrivateText'])m.descriptor.fields.set(name,{get message(){return inspect();},toString:inspect});
    const result=await buildBoundedStreamFixture(BASE,N);expect(inspect).not.toHaveBeenCalled();expect(Object.keys(result.descriptor)).toEqual(['decodedBytes','encodedBytes','originalFontBytes','originalFontSha256','retainedFontPrefixSha256','zeroPaddingBytes']);expect(JSON.stringify(result.descriptor)).not.toContain(PRIVATE);
  });
  it.each(['load','enumerate','lookup','decoder','decode','flateStream','assign','save','contents'])('contains private failures from %s in one fixed error message',async stage=>{
    const fail=()=>{throw Error(PRIVATE);};if(stage==='load')m.load.mockRejectedValue(Error(PRIVATE));else if(stage==='save')m.save.mockRejectedValue(Error(PRIVATE));else if(stage==='contents')m.output.getContents.mockImplementation(fail);else m[stage as 'enumerate'|'lookup'|'decoder'|'decode'|'flateStream'|'assign'].mockImplementation(fail);
    await unavailable();
  });
  it.each(['lookupMaybe','get','has'])('contains throwing dictionary %s access without exposing object data',async method=>{
    m.descriptor[method as 'lookupMaybe'|'get'|'has'].mockImplementation(()=>{throw Error(PRIVATE);});await unavailable();expect(m.assign).not.toHaveBeenCalled();expect(m.save).not.toHaveBeenCalled();
  });
  it('contains a throwing descriptor Type name accessor',async()=>{
    const name=m.Name.of('FontDescriptor');vi.spyOn(name,'decodeText').mockImplementation(()=>{throw Error(PRIVATE);});m.descriptor.fields.set('Type',name);await unavailable();expect(m.assign).not.toHaveBeenCalled();
  });
});
