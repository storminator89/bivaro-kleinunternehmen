/** Trusted synthetic fixture generation and compilation only. Does not invoke
 * an unconfined parser on foreign data, renderer, verifier or kernel probe.
 * Run in the hosted native gate before mounting this output read-only.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import PDFKitDocument from 'pdfkit';
import sharp from 'sharp';
import { PDFDocument, PDFName, PDFDict, PDFString } from 'pdf-lib';
const destination=process.argv[2];
if(!destination||!path.isAbsolute(destination))throw new Error('Absolute fresh fixture output required');
await mkdir(destination,{recursive:false,mode:0o700});
await writeFile(path.join(destination,'package.json'),JSON.stringify({type:'commonjs'}),{flag:'wx'});
for(const file of ['lib/server/pdfa3-converter.ts','lib/server/pdfa-validator.ts','lib/server/foreign-pdf-validator-confinement.ts','lib/processing-limit.ts','lib/resource-limits.ts']){
  const input=await readFile(file,'utf8');
  const resolved=input.replace(/from (['"])@\/([^'"]+)\1/g,(_match,quote,alias)=>{
    let relative=path.relative(path.dirname(file),alias).split(path.sep).join('/');if(!relative.startsWith('.'))relative=`./${relative}`;
    return `from ${quote}${relative}${quote}`;
  });
  const compiled=ts.transpileModule(resolved,{fileName:file,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}});
  if(compiled.diagnostics?.some(d=>d.category===ts.DiagnosticCategory.Error))throw new Error('Exact launcher compilation failed');
  const output=path.join(destination,file.replace(/\.ts$/,'.js'));await mkdir(path.dirname(output),{recursive:true});await writeFile(output,compiled.outputText,{flag:'wx'});
}
const xml=await readFile('lib/__tests__/fixtures/incoming-validation/valid-cii.xml','utf8');
const normalized=xml.replaceAll('urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0','urn:cen.eu:en16931:2017');
await writeFile(path.join(destination,'invoice.xml'),normalized,{flag:'wx'});
const font=await readFile('public/fonts/invoice/BivaroSans-Regular.ttf');
async function generated(name,{subset='PDF/A-3b',scan=false,transparent=false,password=false}={}){
  const doc=new PDFKitDocument({autoFirstPage:false,bufferPages:true,pdfVersion:'1.7',...(subset?{subset}:{}),...(password?{userPassword:'synthetic-only',ownerPassword:'synthetic-owner-only'}:{}),info:{Title:'Synthetic foreign PDF',Author:'Bivaro synthetic compatibility fixture',Creator:'Bivaro fixture',Producer:'Bivaro fixture'}});
  const chunks=[];const output=new Promise((resolve,reject)=>{doc.on('data',c=>chunks.push(c));doc.once('error',reject);doc.once('end',()=>resolve(Buffer.concat(chunks)));});
  doc.registerFont('fixture',font);
  const image=scan?await sharp({create:{width:500,height:300,channels:3,background:{r:30,g:90,b:150}}}).jpeg().toBuffer():null;
  for(let i=0;i<2;i++){
    doc.addPage({size:[400,500]});
    if(image)doc.image(image,20,30,{width:360,height:216});
    else {doc.font('fixture').fontSize(14).fillColor('black').text(`SEARCHABLE SYNTHETIC PAGE ${i+1}`,25,30);doc.text('Ä Ö Ü ß € – Original text/vector content',25,65);}
    if(transparent){doc.save().fillOpacity(0.35).fillColor('#ff3040').rect(30,180,120,70).fill();doc.restore();}
  }
  doc.end();const bytes=await output;await writeFile(path.join(destination,`${name}.pdf`),bytes,{flag:'wx'});return bytes;
}
const base=await generated('vector-text');await generated('transparency',{transparent:true});await generated('scan',{scan:true});
await generated('encrypted',{subset:null,password:true});await generated('wrong-part',{subset:'PDF/A-2b'});
for(const name of ['signature-dictionary','form','attachment','missing-font']){
  const doc=await PDFDocument.load(base,{updateMetadata:false});
  if(name==='signature-dictionary')doc.catalog.set(PDFName.of('Perms'),doc.context.obj({DocMDP:{Type:'Sig',ByteRange:[0,10,20,30],Contents:PDFString.of('synthetic-only-not-a-real-signature')}}));
  if(name==='form')doc.getForm().createTextField('synthetic-field');
  if(name==='attachment')await doc.attach(new TextEncoder().encode('Existing attachment bytes must not be removed'),'original-note.txt');
  if(name==='missing-font')for(const [,object]of doc.context.enumerateIndirectObjects())if(object instanceof PDFDict&&object.lookupMaybe(PDFName.of('Type'),PDFName)?.decodeText()==='FontDescriptor')for(const key of ['FontFile','FontFile2','FontFile3'])object.delete(PDFName.of(key));
  await writeFile(path.join(destination,`${name}.pdf`),await doc.save(),{flag:'wx'});
}
await writeFile(path.join(destination,'malformed.pdf'),'%PDF-1.7\ninvalid synthetic source\n%%EOF',{flag:'wx'});
await writeFile(path.join(destination,'cases.json'),JSON.stringify({positive:['vector-text','transparency','scan'],negative:{encrypted:'PDF_INVALID_OR_ENCRYPTED','signature-dictionary':'PDF_SIGNED',form:'PDF_FORMS_UNSUPPORTED',attachment:'PDF_ATTACHMENTS_UNSUPPORTED','missing-font':'PDF_REQUIRES_NORMALIZATION','wrong-part':'PDF_REQUIRES_NORMALIZATION',malformed:['PDF_INVALID_OR_ENCRYPTED','PDF_INVALID_STRUCTURE']}},null,2),{flag:'wx'});
