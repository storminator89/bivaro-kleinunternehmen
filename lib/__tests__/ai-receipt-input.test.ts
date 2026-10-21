import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFile, access } from 'node:fs/promises';
import path from 'node:path';
const state=vi.hoisted(()=>({pages:2,fail:'',directory:'',args:[] as string[],options:{} as Record<string,unknown>}));
vi.mock('node:child_process',()=>({execFile:vi.fn((_file:string,args:string[],options:Record<string,unknown>,callback:(error:unknown,value?:unknown)=>void)=>{
  state.args=args;state.options=options;
  const output=args.find(arg=>arg.startsWith('-sOutputFile='))!.slice('-sOutputFile='.length);
  state.directory=path.dirname(output);
  void (async()=>{
    if(state.fail)return callback(Object.assign(new Error('private renderer exception'),{code:state.fail}));
    for(let page=1;page<=state.pages;page++)await writeFile(output.replace('%d',String(page)),Buffer.from([255,216,255,1]));
    callback(null,{stdout:'',stderr:''});
  })();
})}));
import { prepareAiReceiptImages, AI_MAX_INPUT_BYTES } from '@/lib/purchase-documents/ai-input';
beforeEach(()=>{state.pages=2;state.fail='';state.directory='';});
afterEach(()=>vi.unstubAllEnvs());
describe('bounded original input preparation',()=>{
  it('sends only original data URLs for a bounded image and no file/remote URL',async()=>{
    const result=await prepareAiReceiptImages('image/png',Buffer.from('synthetic'));
    expect(result[0].image_url.url).toBe('data:image/png;base64,c3ludGhldGlj');
    await expect(prepareAiReceiptImages('image/png',Buffer.alloc(AI_MAX_INPUT_BYTES+1))).rejects.toMatchObject({code:'AI_UNSUPPORTED_FILE'});
    await expect(prepareAiReceiptImages('application/xml',Buffer.from('<Invoice/>'))).rejects.toMatchObject({code:'AI_UNSUPPORTED_FILE'});
  });
  it('renders ordered complete pages in a resource-limited native child and removes private temp files',async()=>{
    vi.stubEnv('NODE_ENV','test');vi.stubEnv('BIVARO_AI_CHILD_SECRET','synthetic-never-inherited');
    const result=await prepareAiReceiptImages('application/pdf',Buffer.from('%PDF-synthetic'));
    expect(result).toHaveLength(2);
    expect(state.args).toEqual(expect.arrayContaining(['--as=536870912','--cpu=15','--fsize=2097152','-dSAFER','-dPDFSTOPONERROR','-dPDFSTOPONWARNING','-dLastPage=5','-g850x1100']));
    expect(state.options).toHaveProperty('signal');
    expect(state.options).toMatchObject({timeout:20000,killSignal:'SIGKILL',maxBuffer:65536});
    expect(state.options.env).toEqual({PATH:process.env.PATH,NODE_ENV:'test',LANG:'C',HOME:state.directory,TMPDIR:state.directory});
    expect(state.options.env).not.toHaveProperty('BIVARO_AI_CHILD_SECRET');
    await expect(access(state.directory)).rejects.toThrow();
  });
  it('defaults only the child mode to production when NODE_ENV is absent',async()=>{
    vi.stubEnv('NODE_ENV',undefined);
    await prepareAiReceiptImages('application/pdf',Buffer.from('%PDF-synthetic'));
    expect(state.options.env).toEqual({PATH:process.env.PATH,NODE_ENV:'production',LANG:'C',HOME:state.directory,TMPDIR:state.directory});
  });
  it.each([0,5])('rejects incomplete/over-four-page rendering (%s) rather than silently truncating',async pages=>{
    state.pages=pages;
    await expect(prepareAiReceiptImages('application/pdf',Buffer.from('%PDF-synthetic'))).rejects.toMatchObject({code:'AI_PDF_LIMIT'});
    await expect(access(state.directory)).rejects.toThrow();
  });
  it.each([['ENOENT','AI_RENDER_UNAVAILABLE'],['ETIMEDOUT','AI_RENDER_FAILED']])('fails closed for renderer error %s before paid dispatch',async(fail,code)=>{
    state.fail=fail;
    await expect(prepareAiReceiptImages('application/pdf',Buffer.from('%PDF-synthetic'))).rejects.toMatchObject({code});
    await expect(access(state.directory)).rejects.toThrow();
  });
  it('rejects an already-aborted overall deadline before native work',async()=>{
    const controller=new AbortController();controller.abort();
    await expect(prepareAiReceiptImages('application/pdf',Buffer.from('%PDF-synthetic'),controller.signal)).rejects.toMatchObject({code:'AI_REQUEST_INTERRUPTED'});
    expect(state.directory).toBe('');
  });
  it('rejects invalid PDF signatures and byte limits before native work',async()=>{
    await expect(prepareAiReceiptImages('application/pdf',Buffer.from('not PDF'))).rejects.toMatchObject({code:'AI_PDF_LIMIT'});
    await expect(prepareAiReceiptImages('application/pdf',Buffer.alloc(AI_MAX_INPUT_BYTES+1))).rejects.toMatchObject({code:'AI_PDF_LIMIT'});
    expect(state.directory).toBe('');
  });
});
