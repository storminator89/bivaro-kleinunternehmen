import { beforeEach, describe, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({session:{user:{id:'foreign-owner',role:'USER'}} as {user:{id:string;role:string}}|null,convert:vi.fn(),writes:vi.fn(),protected:vi.fn()}));
vi.mock('next-auth',()=>({getServerSession:vi.fn(async()=>state.session)}));
vi.mock('@/lib/auth',()=>({authOptions:{}}));
vi.mock('@/lib/request-security',()=>({protectMutation:(handler:unknown)=>{state.protected(handler);return handler;}}));
vi.mock('@/lib/prisma',()=>({prisma:{$transaction:state.writes,invoice:{create:state.writes,update:state.writes}}}));
vi.mock('@/lib/server/pdfa3-converter',()=>({createPdfA3Invoice:state.convert,ForeignPdfError:class ForeignPdfError extends Error{readonly status:number;constructor(readonly code:string){super('synthetic safe public failure');this.status=code==='PDF_PROCESSING_UNAVAILABLE'?503:422;}}}));
import { POST } from '@/app/api/pdfa3/route';
import { ForeignPdfError } from '@/lib/server/pdfa3-converter';
import { ProcessingCapacityError } from '@/lib/processing-limit';
import { MAX_PDF_INPUT_BYTES, RequestBodyLimitError } from '@/lib/resource-limits';
const source=new TextEncoder().encode('%PDF-synthetic-handler-fixture'), output=new TextEncoder().encode('%PDF-synthetic-verified-output');
function request(options:{pdf?:Uint8Array;xml?:Uint8Array;number?:string}={}){
  const form=new FormData();form.set('pdf',new Blob([options.pdf??source],{type:'application/pdf'}),'foreign.pdf');
  form.set('xml',new Blob([options.xml??new TextEncoder().encode('\uFEFF<synthetic/>')],{type:'text/xml'}),'invoice.xml');
  form.set('invoiceNumber',options.number??'FOREIGN-1');
  return new Request('http://localhost/api/pdfa3',{method:'POST',body:form});
}
beforeEach(()=>{vi.clearAllMocks();state.session={user:{id:'foreign-owner',role:'USER'}};state.convert.mockResolvedValue(output);});
describe('stateless narrowed /api/pdfa3 route',()=>{
  it('returns only verified final bytes without persistence and preserves UTF-8 BOM in XML',async()=>{
    const response=await POST(request());expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(output);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(state.convert).toHaveBeenCalledExactlyOnceWith({basePdfBytes:source,xmlContent:'\uFEFF<synthetic/>',invoiceNumber:'FOREIGN-1',userId:'foreign-owner'});
    expect(state.writes).not.toHaveBeenCalled();
  });
  it.each([null,{user:{id:'foreign-owner',role:'VIEWER'}}])('requires existing session/role',async session=>{
    state.session=session;expect((await POST(request())).status).toBe(401);expect(state.convert).not.toHaveBeenCalled();
  });
  it.each(['PDF_SIGNED','PDF_ATTACHMENTS_UNSUPPORTED','PDF_REQUIRES_NORMALIZATION'])('returns explicit unsupported code %s without fallback',async code=>{
    state.convert.mockRejectedValue(new ForeignPdfError(code));const response=await POST(request());
    expect(response.status).toBe(422);expect((await response.json()).code).toBe(code);expect(state.writes).not.toHaveBeenCalled();
  });
  it('maps unavailable processing to retryable503, not a claim the PDF is wrong',async()=>{
    state.convert.mockRejectedValue(new ForeignPdfError('PDF_PROCESSING_UNAVAILABLE'));const response=await POST(request());
    expect(response.status).toBe(503);expect((await response.json()).code).toBe('PDF_PROCESSING_UNAVAILABLE');
  });
  it('does not disclose unknown errors, paths, reports or content',async()=>{
    state.convert.mockRejectedValue(new Error('synthetic-secret /private/source.pdf'));const response=await POST(request());
    expect(response.status).toBe(503);expect(await response.text()).not.toContain('synthetic-secret');
  });
  it('rejects invalid UTF-8 before conversion',async()=>{
    const response=await POST(request({xml:new Uint8Array([0xff,0xfe,0xc0])}));expect(response.status).toBe(422);
    expect((await response.json()).code).toBe('PDF_XML_INVALID');expect(state.convert).not.toHaveBeenCalled();
  });
  it('retains capacity and body-limit errors',async()=>{
    state.convert.mockRejectedValue(new ProcessingCapacityError());let response=await POST(request());expect(response.status).toBe(429);expect(response.headers.get('Retry-After')).toBe('1');
    state.convert.mockRejectedValue(new RequestBodyLimitError('synthetic size limit'));response=await POST(request());expect(response.status).toBe(413);
  });
  it('rejects oversized PDF before conversion',async()=>{
    const response=await POST(request({pdf:new Uint8Array(MAX_PDF_INPUT_BYTES+1)}));expect(response.status).toBe(413);expect(state.convert).not.toHaveBeenCalled();
  });
  it('rejects unbounded invoice number',async()=>{
    expect((await POST(request({number:'x'.repeat(201)}))).status).toBe(400);expect(state.convert).not.toHaveBeenCalled();
  });
});
