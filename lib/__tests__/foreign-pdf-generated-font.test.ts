import { describe,expect,it,vi } from 'vitest';
import { describeGeneratedVectorFont } from '../../scripts/foreign-pdf/generated-font-descriptor.mjs';

// Writer-object doubles only: no PDFKit/fontkit, font files, PDF bytes or parsers.
const PRIVATE='PRIVATE_FONT_NAME_CUSTOMER_TEXT_NEVER_EMIT';
const MESSAGE='Trusted generated font descriptor unavailable';
type Fields=Record<string,unknown>;
type WriterFont={dictionary:unknown;name?:string};
function fixture(){
  const program={data:{Filter:'FlateDecode',Length:8000} as Fields,uncompressedLength:20000 as unknown};
  const descriptor:Fields={Type:'FontDescriptor',FontFile2:program,FontName:PRIVATE};
  const cid:Fields={Type:'Font',Subtype:'CIDFontType2',FontDescriptor:{data:descriptor},BaseFont:PRIVATE};
  const type0:Fields={Type:'Font',Subtype:'Type0',DescendantFonts:[{data:cid}],BaseFont:PRIVATE};
  const font:WriterFont={dictionary:{data:type0},name:PRIVATE};
  const unused:WriterFont={dictionary:null,name:PRIVATE};
  const document={_fontFamilies:{default:unused,fixture:font,alias:font} as Record<string,WriterFont>,_font:font,text:PRIVATE};
  return {document,font,unused,type0,cid,descriptor,program};
}
type Fixture=ReturnType<typeof fixture>;
function safeFailure(document:unknown){
  try{describeGeneratedVectorFont(document);throw Error('Expected closed descriptor failure');}catch(error){
    expect(error).toBeInstanceOf(Error);expect((error as Error).message).toBe(MESSAGE);
    expect(String(error)).not.toContain(PRIVATE);expect(JSON.stringify(error)).not.toContain(PRIVATE);
  }
}

describe('trusted generated vector font descriptor (pure writer-object doubles)',()=>{
  it('reports the exact Type0 → CIDFontType2 → FlateDecode FontFile2 shape without names or document text',()=>{
    const f=fixture();const result=describeGeneratedVectorFont(f.document);
    expect(result).toEqual({schema:1,createdFontObjects:2,referencedFontObjects:1,referencedStandardFonts:0,fontSubtype:'Type0',descendantSubtype:'CIDFontType2',fontProgram:'FontFile2',filter:'FlateDecode',encodedBytes:8000,decodedBytes:20000,defaultParserBufferBytes:10240,decodedExceedsDefaultBuffer:true});
    expect(JSON.stringify(result)).not.toContain(PRIVATE);expect(result).not.toHaveProperty('FontName');expect(result).not.toHaveProperty('text');
  });
  it('counts an unused default font as created but not referenced and deduplicates aliases by object identity',()=>{
    const f=fixture();f.document._fontFamilies.extraAlias=f.font;f.document._fontFamilies.unusedAlias=f.unused;
    expect(describeGeneratedVectorFont(f.document)).toMatchObject({createdFontObjects:2,referencedFontObjects:1,referencedStandardFonts:0});
  });
  it('counts an actually referenced standard Type1 font separately',()=>{
    const f=fixture();f.unused.dictionary={data:{Type:'Font',Subtype:'Type1',BaseFont:PRIVATE}};
    expect(describeGeneratedVectorFont(f.document)).toMatchObject({createdFontObjects:2,referencedFontObjects:2,referencedStandardFonts:1});
  });
  it('does not count descriptor-bearing Type1 fonts as referenced standard fonts',()=>{
    const f=fixture();f.unused.dictionary={data:{Type:'Font',Subtype:'Type1',FontDescriptor:{data:{Type:'FontDescriptor'}}}};
    expect(describeGeneratedVectorFont(f.document)).toMatchObject({referencedFontObjects:2,referencedStandardFonts:0});
  });
  it.each([1,10239,10240,10241,20*1024*1024])('uses an exact closed decoded-length boundary at %i bytes',bytes=>{
    const f=fixture();f.program.uncompressedLength=bytes;f.program.data.Length=bytes;
    expect(describeGeneratedVectorFont(f.document)).toMatchObject({encodedBytes:bytes,decodedBytes:bytes,decodedExceedsDefaultBuffer:bytes>10240});
  });
  it('accepts eight distinct trusted writer font objects but not nine',()=>{
    const f=fixture();for(let i=0;i<6;i++)f.document._fontFamilies[`unused${i}`]={dictionary:null};
    expect(describeGeneratedVectorFont(f.document)).toMatchObject({createdFontObjects:8});
    f.document._fontFamilies.extra={dictionary:null};safeFailure(f.document);
  });
  it.each([undefined,null,true,42,PRIVATE,[],{}])('rejects absent or invalid writer documents without echoing input (%s)',document=>{safeFailure(document);});
  it.each([
    ['missing-families',(f:Fixture)=>{Object.assign(f.document,{_fontFamilies:undefined});}],
    ['null-families',(f:Fixture)=>{Object.assign(f.document,{_fontFamilies:null});}],
    ['empty-families',(f:Fixture)=>{f.document._fontFamilies={};}],
    ['null-family-font',(f:Fixture)=>{Object.assign(f.document._fontFamilies,{bad:null});}],
    ['missing-current-font',(f:Fixture)=>{Object.assign(f.document,{_font:undefined});}],
    ['missing-current-dictionary',(f:Fixture)=>{f.font.dictionary=undefined;}],
    ['missing-current-data',(f:Fixture)=>{f.font.dictionary={};}],
    ['wrong-type',(f:Fixture)=>{f.type0.Type='NotFont';}],
    ['wrong-subtype',(f:Fixture)=>{f.type0.Subtype='Type1';}],
    ['missing-descendants',(f:Fixture)=>{delete f.type0.DescendantFonts;}],
    ['non-array-descendants',(f:Fixture)=>{f.type0.DescendantFonts={data:f.cid};}],
    ['empty-descendants',(f:Fixture)=>{f.type0.DescendantFonts=[];}],
    ['ambiguous-descendants',(f:Fixture)=>{f.type0.DescendantFonts=[{data:f.cid},{data:f.cid}];}],
    ['null-descendant',(f:Fixture)=>{f.type0.DescendantFonts=[null];}],
    ['missing-descendant-data',(f:Fixture)=>{f.type0.DescendantFonts=[{}];}],
    ['wrong-cid-type',(f:Fixture)=>{f.cid.Type='NotFont';}],
    ['wrong-cid-subtype',(f:Fixture)=>{f.cid.Subtype='CIDFontType0';}],
    ['missing-descriptor',(f:Fixture)=>{delete f.cid.FontDescriptor;}],
    ['null-descriptor',(f:Fixture)=>{f.cid.FontDescriptor=null;}],
    ['missing-descriptor-data',(f:Fixture)=>{f.cid.FontDescriptor={};}],
    ['wrong-descriptor-type',(f:Fixture)=>{f.descriptor.Type='NotDescriptor';}],
    ['alternative-fontfile',(f:Fixture)=>{f.descriptor.FontFile={data:{}};}],
    ['alternative-fontfile3',(f:Fixture)=>{f.descriptor.FontFile3={data:{}};}],
    ['missing-fontfile2',(f:Fixture)=>{delete f.descriptor.FontFile2;}],
    ['null-fontfile2',(f:Fixture)=>{f.descriptor.FontFile2=null;}],
    ['missing-font-program-data',(f:Fixture)=>{f.descriptor.FontFile2={uncompressedLength:20000};}],
    ['missing-filter',(f:Fixture)=>{delete f.program.data.Filter;}],
    ['wrong-filter',(f:Fixture)=>{f.program.data.Filter='ASCII85Decode';}],
    ['array-filter',(f:Fixture)=>{f.program.data.Filter=['FlateDecode'];}],
    ['multiple-filters',(f:Fixture)=>{f.program.data.Filter=['FlateDecode','ASCII85Decode'];}],
  ])('fails closed for %s',(_name,mutate)=>{const f=fixture();mutate(f);safeFailure(f.document);});
  it.each([undefined,null,0,-1,0.5,NaN,Infinity,-Infinity,Number.MAX_SAFE_INTEGER,20*1024*1024+1,'20000',true,{},[]])('rejects invalid decoded font-program length (%s)',value=>{
    const f=fixture();f.program.uncompressedLength=value;safeFailure(f.document);
  });
  it.each([undefined,null,0,-1,0.5,NaN,Infinity,-Infinity,Number.MAX_SAFE_INTEGER,20*1024*1024+1,'8000',true,{},[]])('rejects invalid encoded font-program length (%s)',value=>{
    const f=fixture();f.program.data.Length=value;safeFailure(f.document);
  });
  it.each(['families','current-font','family-dictionary','type0-subtype','descendants','cid-descriptor','descriptor-program','filter','encoded-length','decoded-length'])('contains hostile getter exceptions at %s',location=>{
    const f=fixture();const fail=vi.fn(()=>{throw Error(PRIVATE);});
    const targets:Record<string,[object,string]>={families:[f.document,'_fontFamilies'],'current-font':[f.document,'_font'],'family-dictionary':[f.unused,'dictionary'],'type0-subtype':[f.type0,'Subtype'],descendants:[f.type0,'DescendantFonts'],'cid-descriptor':[f.cid,'FontDescriptor'],'descriptor-program':[f.descriptor,'FontFile2'],filter:[f.program.data,'Filter'],'encoded-length':[f.program.data,'Length'],'decoded-length':[f.program,'uncompressedLength']};
    const [target,key]=targets[location];Object.defineProperty(target,key,{get:fail});safeFailure(f.document);expect(fail).toHaveBeenCalled();
  });
  it('does not inspect or stringify ignored font names, document text or unrelated fields',()=>{
    const f=fixture();const inspect=vi.fn(()=>{throw Error(PRIVATE);});
    for(const target of [f.font,f.unused,f.document,f.program,f.descriptor])for(const key of ['privateName','privateText','toString','toJSON'])Object.defineProperty(target,key,{get:inspect});
    Object.defineProperty(f.font,'name',{get:inspect});Object.defineProperty(f.document,'text',{get:inspect});Object.defineProperty(f.descriptor,'FontName',{get:inspect});
    const result=describeGeneratedVectorFont(f.document);expect(JSON.stringify(result)).not.toContain(PRIVATE);expect(inspect).not.toHaveBeenCalled();
  });
});
