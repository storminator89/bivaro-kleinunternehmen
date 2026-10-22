/** Trusted generator objects only. Never parses a PDF or exports font names. */
const unavailable=()=>{throw Error('Trusted generated font descriptor unavailable');};
const length=value=>Number.isSafeInteger(value)&&value>0&&value<=20*1024*1024;
export function describeGeneratedVectorFont(document){
  try{
    const fonts=[...new Set(Object.values(document._fontFamilies))];
    if(fonts.length<1||fonts.length>8)unavailable();
    const referenced=fonts.filter(font=>font.dictionary!=null);
    const standards=referenced.filter(font=>font.dictionary.data.Subtype==='Type1'&&!font.dictionary.data.FontDescriptor).length;
    const type0=document._font.dictionary.data;
    if(type0.Type!=='Font'||type0.Subtype!=='Type0'||!Array.isArray(type0.DescendantFonts)||type0.DescendantFonts.length!==1)unavailable();
    const cid=type0.DescendantFonts[0].data,descriptor=cid.FontDescriptor.data,program=descriptor.FontFile2;
    if(cid.Type!=='Font'||cid.Subtype!=='CIDFontType2'||descriptor.Type!=='FontDescriptor'||descriptor.FontFile||descriptor.FontFile3||!program||program.data.Filter!=='FlateDecode'||!length(program.uncompressedLength)||!length(program.data.Length))unavailable();
    return {schema:1,createdFontObjects:fonts.length,referencedFontObjects:referenced.length,referencedStandardFonts:standards,fontSubtype:'Type0',descendantSubtype:'CIDFontType2',fontProgram:'FontFile2',filter:'FlateDecode',encodedBytes:program.data.Length,decodedBytes:program.uncompressedLength,defaultParserBufferBytes:10240,decodedExceedsDefaultBuffer:program.uncompressedLength>10240};
  }catch{unavailable();}
}
