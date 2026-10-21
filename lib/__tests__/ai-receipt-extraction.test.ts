import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { NextRequest } from 'next/server';
import type { PrismaClient } from '@prisma/client';
import { createTestDatabase } from './helpers/database';
import { AiProviderError } from '@/lib/ai-provider/errors';
import { EMPTY_REVIEW_DRAFT } from '@/lib/purchase-documents/review-draft';
const state=vi.hoisted(()=>({client:null as PrismaClient|null,userId:'ai-owner',enabled:true,auto:false,version:1,revision:'11111111-1111-4111-8111-111111111111',calls:0,handler:null as null|((signal?:AbortSignal)=>Promise<string>)}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/prisma',()=>({get prisma(){return state.client;}}));
vi.mock('@/lib/get-user-id',()=>({requireUserId:async()=>state.userId,UnauthorizedError:class extends Error{},unauthorizedResponse:()=>new Response(null,{status:401})}));
vi.mock('@/lib/ai-provider/settings',()=>({
  getAiProviderSettings:async()=>({enabled:state.enabled,configured:true,autoAnalyzeNewUploads:state.auto,version:state.version,configurationRevision:state.revision}),
  resolveAiProviderConfiguration:async(_user:string,version?:number)=>{
    if(!state.enabled)throw new AiProviderError('AI_DISABLED','Disabled',409);
    if(version!==undefined&&version!==state.version)throw new AiProviderError('CONFIG_CONFLICT','Changed',409);
    return {baseUrl:'https://synthetic.invalid/v1',model:'synthetic',apiKey:'synthetic-unused',version:state.version,configurationRevision:state.revision,autoAnalyzeNewUploads:state.auto};
  }
}));
vi.mock('@/lib/ai-provider/transport',()=>({requestAiCompletion:async(_config:unknown,_input:unknown,signal?:AbortSignal)=>{state.calls++;return state.handler!(signal);}}));
let database:ReturnType<typeof createTestDatabase>,root:string;
let extraction:typeof import('@/lib/purchase-documents/ai-extraction');
let service:typeof import('@/lib/purchase-documents/service');
let storage:typeof import('@/lib/upload-path');
let route:typeof import('@/app/api/purchase-documents/[id]/ai-extraction/route');
let save:typeof import('@/lib/purchase-documents/save-review-draft');
const raw={supplierName:'Synthetic Supplier',invoiceNumber:'SYN-1',invoiceDate:'2026-10-21',currency:'EUR',documentType:'INVOICE',grossAmount:'0.29',netAmount:'0.24',taxAmount:'0.05',lineItems:[],lineItemsComplete:true};
const options=()=>({expectedConfigVersion:state.version,expectedConfigRevision:state.revision,retry:false});
async function source(mediaType='image/png',parseStatus='FAILED'){
  const bytes=Buffer.from(`synthetic original ${randomUUID()}`);
  const {originalHash}=await import('@/lib/purchase-documents/original');
  const file=await storage.writeTenantFile('ai-owner',mediaType==='application/pdf'?'original.pdf':'original.png',bytes);
  return database.client.purchaseDocument.create({data:{userId:'ai-owner',originalFileName:'synthetic.png',storedFileName:file,originalSha256:originalHash(bytes),originalByteCount:bytes.length,mediaType,uploadRequestId:randomUUID(),parseStatus,parseErrorCode:parseStatus==='FAILED'?'PHOTO_MANUAL_REVIEW':null,revision:1}});
}
beforeAll(async()=>{
  database=createTestDatabase();state.client=database.client;
  await database.client.user.createMany({data:['ai-owner','ai-other'].map(id=>({id,email:`${id}@synthetic.invalid`,password:'unused'}))});
  root=await mkdtemp(path.join(tmpdir(),'bivaro-ai-fixture-'));
  const cwd=vi.spyOn(process,'cwd').mockReturnValue(root);
  try{storage=await import('@/lib/upload-path');extraction=await import('@/lib/purchase-documents/ai-extraction');service=await import('@/lib/purchase-documents/service');route=await import('@/app/api/purchase-documents/[id]/ai-extraction/route');save=await import('@/lib/purchase-documents/save-review-draft');}finally{cwd.mockRestore();}
},40000);
beforeEach(()=>{state.enabled=true;state.auto=false;state.calls=0;state.version=1;state.revision='11111111-1111-4111-8111-111111111111';state.userId='ai-owner';state.handler=async()=>JSON.stringify(raw);});
afterEach(async()=>{vi.useRealTimers();const counts=await Promise.all([database.client.expense.count(),database.client.income.count(),database.client.cashTransaction.count(),database.client.invoice.count(),database.client.paymentJournalEvent.count()]);for(const count of counts)expect(count).toBe(0);});
afterAll(async()=>{await database?.cleanup();if(root)await rm(root,{recursive:true,force:true});});
describe('durable optional AI draft capture',()=>{
  it('captures exact suggestions only once per original and opaque config; never financial rows',async()=>{
    const doc=await source();
    const result=await extraction.runPurchaseAiExtraction('ai-owner',doc.id,1,options());
    expect(result.extraction).toMatchObject({status:'completed',draftApplied:true,configRevision:state.revision});
    expect(result.document.reviewDraft).toMatchObject({supplierName:'Synthetic Supplier',amount:'0.29',paymentDate:'',note:''});
    expect(result.document.aiDraftProvenance?.provenance).toBe('AI_UNREVIEWED');
    await extraction.runPurchaseAiExtraction('ai-owner',doc.id,result.document.revision,options());expect(state.calls).toBe(1);
    const bytes=await (await import('@/lib/purchase-documents/original')).readPurchaseOriginal(await service.requirePurchaseDocument('ai-owner',doc.id));expect(bytes.length).toBe(doc.originalByteCount);
    // Same numeric version, genuinely new opaque identity must not reuse previous config's evidence.
    state.revision=randomUUID();
    await extraction.runPurchaseAiExtraction('ai-owner',doc.id,result.document.revision,options());expect(state.calls).toBe(2);
  });
  it('single-flights repeated requests and preserves a concurrently manually edited draft',async()=>{
    const doc=await source();let release!:(content:string)=>void;let entered!:()=>void;
    const started=new Promise<void>(resolve=>{entered=resolve;});
    state.handler=()=>{entered();return new Promise(resolve=>{release=resolve;});};
    const first=extraction.runPurchaseAiExtraction('ai-owner',doc.id,1,options());await started;
    const repeat=await extraction.runPurchaseAiExtraction('ai-owner',doc.id,1,options());expect(repeat.extraction?.status).toBe('running');expect(state.calls).toBe(1);
    await save.savePurchaseReviewDraft('ai-owner',doc.id,1,{...EMPTY_REVIEW_DRAFT,supplierName:'User value',amount:'1.23'});
    release(JSON.stringify(raw));const completed=await first;
    expect(completed.extraction).toMatchObject({status:'completed',draftApplied:false});expect(completed.document.reviewDraft?.supplierName).toBe('User value');
    const applied=await extraction.applyPurchaseAiSuggestions('ai-owner',doc.id,completed.document.revision,completed.extraction!.id);
    expect(applied.document.reviewDraft).toMatchObject({supplierName:'User value',amount:'1.23',invoiceNumber:'SYN-1',paymentDate:''});
    expect(state.calls).toBe(1);
  });
  it('retains completed suggestions but never changes dismissed sources during an in-flight analysis',async()=>{
    const doc=await source();let release!:(content:string)=>void;let entered!:()=>void;const started=new Promise<void>(r=>{entered=r;});
    state.handler=()=>{entered();return new Promise(r=>{release=r;});};
    const pending=extraction.runPurchaseAiExtraction('ai-owner',doc.id,1,options());await started;
    await service.changePurchaseReview('ai-owner',doc.id,1,'dismiss','Synthetic reason');release(JSON.stringify(raw));const result=await pending;
    expect(result.document.reviewStatus).toBe('DISMISSED');expect(result.document.reviewDraft).toBeNull();expect(result.extraction?.draftApplied).toBe(false);
    await expect(extraction.applyPurchaseAiSuggestions('ai-owner',doc.id,result.document.revision,result.extraction!.id)).rejects.toMatchObject({code:'STATE_CONFLICT'});
  });
  it('requires explicit retry for failed and unknown outcomes; malformed replies and timeouts never loop',async()=>{
    const doc=await source();state.handler=async()=>'{"instructions":"execute"}';
    const failed=await extraction.runPurchaseAiExtraction('ai-owner',doc.id,1,options());expect(failed.extraction).toMatchObject({status:'failed',errorCode:'AI_INVALID_RESULT'});
    await extraction.runPurchaseAiExtraction('ai-owner',doc.id,1,options());expect(state.calls).toBe(1);
    state.handler=async()=>{throw new AiProviderError('TIMEOUT','Static redacted',504,true);};
    const unknown=await extraction.runPurchaseAiExtraction('ai-owner',doc.id,1,{...options(),retry:true});expect(unknown.extraction?.status).toBe('unknown');expect(state.calls).toBe(2);
    await extraction.runPurchaseAiExtraction('ai-owner',doc.id,1,options());expect(state.calls).toBe(2);
  });
  it('derives interrupted state honestly on read without launching paid work; cancel also stays unknown',async()=>{
    const doc=await source();let release!:(content:string)=>void;let entered!:()=>void;const started=new Promise<void>(r=>{entered=r;});
    state.handler=()=>{entered();return new Promise(r=>{release=r;});};
    const pending=extraction.runPurchaseAiExtraction('ai-owner',doc.id,1,options());await started;
    await extraction.cancelPurchaseAiExtraction('ai-owner',doc.id,1);release(JSON.stringify(raw));await pending;
    expect(await extraction.getPurchaseAiExtraction('ai-owner',doc.id)).toMatchObject({status:'unknown',errorCode:'AI_CANCELLED'});expect(state.calls).toBe(1);
    const row=await database.client.purchaseDocument.findUniqueOrThrow({where:{id:doc.id}});const evidence=row.aiExtraction as unknown as {version:1;jobs:Array<Record<string,unknown>>};
    evidence.jobs[0]={...evidence.jobs[0],status:'running',finishedAt:null,errorCode:null,deadlineAt:'2000-01-01T00:00:00.000Z'};
    await database.client.purchaseDocument.update({where:{id:doc.id},data:{aiExtraction:evidence}});
    expect(await extraction.getPurchaseAiExtraction('ai-owner',doc.id)).toMatchObject({status:'unknown',errorCode:'AI_REQUEST_INTERRUPTED'});expect(state.calls).toBe(1);
  });
  it('persists polled expiry as terminal unknown and rejects the late reply without filling an absent draft',async()=>{
    const doc=await source();let release!:(content:string)=>void;let entered!:()=>void;
    const started=new Promise<void>(resolve=>{entered=resolve;});
    state.handler=()=>{entered();return new Promise(resolve=>{release=resolve;});};
    const pending=extraction.runPurchaseAiExtraction('ai-owner',doc.id,1,options());await started;
    const running=await extraction.getPurchaseAiExtraction('ai-owner',doc.id);
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(running!.deadlineAt).getTime()+1);
    expect(await extraction.getPurchaseAiExtraction('ai-owner',doc.id)).toMatchObject({status:'unknown',errorCode:'AI_REQUEST_INTERRUPTED'});
    const expired=await database.client.purchaseDocument.findUniqueOrThrow({where:{id:doc.id}});
    expect(expired.aiExtraction).toMatchObject({jobs:[{status:'unknown',result:null,draftApplied:false}]});
    expect(expired.reviewDraft).toBeNull();
    release(JSON.stringify(raw));const response=await pending;
    expect(response.extraction).toMatchObject({status:'unknown',result:null,draftApplied:false});
    expect(response.document.reviewDraft).toBeNull();expect(response.document.revision).toBe(1);expect(state.calls).toBe(1);
    await extraction.runPurchaseAiExtraction('ai-owner',doc.id,1,options());expect(state.calls).toBe(1);
  });
  it('rejects completion after the persisted deadline even when no status poll occurred',async()=>{
    const doc=await source();let release!:(content:string)=>void;let entered!:()=>void;
    const started=new Promise<void>(resolve=>{entered=resolve;});
    state.handler=()=>{entered();return new Promise(resolve=>{release=resolve;});};
    const pending=extraction.runPurchaseAiExtraction('ai-owner',doc.id,1,options());await started;
    const row=await database.client.purchaseDocument.findUniqueOrThrow({where:{id:doc.id}});
    const jobs=(row.aiExtraction as unknown as {jobs:Array<{deadlineAt:string}>}).jobs;
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(jobs[0].deadlineAt).getTime()+1);
    release(JSON.stringify(raw));const response=await pending;
    expect(response.extraction).toMatchObject({status:'unknown',errorCode:'AI_REQUEST_INTERRUPTED',result:null,draftApplied:false});
    const stored=await database.client.purchaseDocument.findUniqueOrThrow({where:{id:doc.id}});
    expect(stored.aiExtraction).toMatchObject({jobs:[{status:'unknown',result:null}]});expect(stored.reviewDraft).toBeNull();expect(stored.revision).toBe(1);
  });
  it('cannot let an expired old reply overwrite a completed explicit retry from another processing replica',async()=>{
    const doc=await source();let release!:(content:string)=>void;let entered!:()=>void;
    const started=new Promise<void>(resolve=>{entered=resolve;});
    state.handler=()=>{entered();return new Promise(resolve=>{release=resolve;});};
    const pending=extraction.runPurchaseAiExtraction('ai-owner',doc.id,1,options());await started;
    const running=await extraction.getPurchaseAiExtraction('ai-owner',doc.id);
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(running!.deadlineAt).getTime()+1);
    await extraction.getPurchaseAiExtraction('ai-owner',doc.id);
    // A second replica has a separate in-process slot; the database CAS remains real.
    const slots=await import('@/lib/processing-limit');const otherReplica=vi.spyOn(slots,'withProcessingSlot').mockImplementation(async(_user,work)=>work());
    try {
      state.handler=async()=>JSON.stringify({...raw,invoiceNumber:'RETRY-NEW'});
      const retried=await extraction.runPurchaseAiExtraction('ai-owner',doc.id,1,{...options(),retry:true});
      expect(retried.extraction).toMatchObject({status:'completed',draftApplied:true});expect(retried.document.reviewDraft?.invoiceNumber).toBe('RETRY-NEW');
      await save.savePurchaseReviewDraft('ai-owner',doc.id,retried.document.revision,{...retried.document.reviewDraft!,note:'Manual note after retry'});
      release(JSON.stringify({...raw,invoiceNumber:'EXPIRED-OLD'}));await pending;
      const stored=await service.purchaseDocumentDetail('ai-owner',doc.id);
      expect(stored.reviewDraft).toMatchObject({invoiceNumber:'RETRY-NEW',note:'Manual note after retry'});
      const latest=await extraction.getPurchaseAiExtraction('ai-owner',doc.id);expect(latest?.id).toBe(retried.extraction!.id);expect(state.calls).toBe(2);
      const persisted=await database.client.purchaseDocument.findUniqueOrThrow({where:{id:doc.id}});
      expect(persisted.aiExtraction).toMatchObject({jobs:[{id:running!.id,status:'unknown',result:null}, {id:retried.extraction!.id,status:'completed'}]});
    }finally{otherReplica.mockRestore();}
  });
  it('enforces the overall deadline signal and settles a provider that ignores cancellation without unhandled late rejection',async()=>{
    const doc=await source();let release!:(error:Error)=>void;let entered!:()=>void;let signal:AbortSignal|undefined;
    const started=new Promise<void>(resolve=>{entered=resolve;});
    state.handler=received=>{signal=received;entered();return new Promise((_resolve,reject)=>{release=reject;});};
    vi.useFakeTimers({toFake:['Date','setTimeout','clearTimeout']});
    const pending=extraction.runPurchaseAiExtraction('ai-owner',doc.id,1,options());await started;
    await vi.advanceTimersByTimeAsync(90_001);
    const response=await pending;
    expect(signal?.aborted).toBe(true);expect(response.extraction).toMatchObject({status:'unknown',errorCode:'AI_REQUEST_INTERRUPTED',result:null});expect(response.document.reviewDraft).toBeNull();
    release(new Error('Synthetic late provider rejection'));await Promise.resolve();await Promise.resolve();
    expect(state.calls).toBe(1);
  });
  it('does not dispatch if preparation consumes the remaining total job deadline',async()=>{
    const doc=await source();const input=await import('@/lib/purchase-documents/ai-input');const original=input.prepareAiReceiptImages;
    vi.useFakeTimers({toFake:['Date']});
    const preparation=vi.spyOn(input,'prepareAiReceiptImages').mockImplementation(async(...args)=>{const images=await original(...args);vi.setSystemTime(Date.now()+90_001);return images;});
    try{const result=await extraction.runPurchaseAiExtraction('ai-owner',doc.id,1,options());expect(result.extraction).toMatchObject({status:'unknown',errorCode:'AI_REQUEST_INTERRUPTED'});expect(state.calls).toBe(0);expect(result.document.reviewDraft).toBeNull();}finally{preparation.mockRestore();}
  });
  it('checks tenant, source revision, deterministic preference and BOTH configuration preconditions before dispatch',async()=>{
    const doc=await source();
    await expect(extraction.runPurchaseAiExtraction('ai-other',doc.id,1,options())).rejects.toMatchObject({code:'NOT_FOUND'});
    await expect(extraction.runPurchaseAiExtraction('ai-owner',doc.id,0,options())).rejects.toMatchObject({code:'REVISION_CONFLICT'});
    await expect(extraction.runPurchaseAiExtraction('ai-owner',doc.id,1,{...options(),expectedConfigVersion:2})).rejects.toMatchObject({code:'CONFIG_CONFLICT'});
    await expect(extraction.runPurchaseAiExtraction('ai-owner',doc.id,1,{...options(),expectedConfigRevision:randomUUID()})).rejects.toMatchObject({code:'AI_CONFIG_CHANGED'});
    const xml=await source('application/xml');await expect(extraction.runPurchaseAiExtraction('ai-owner',xml.id,1,options())).rejects.toMatchObject({code:'AI_STRUCTURED_SOURCE'});expect(state.calls).toBe(0);
  });
  it('supports free owned exact-job apply even after provider disabled and marks later human edits',async()=>{
    const doc=await source();await save.savePurchaseReviewDraft('ai-owner',doc.id,1,EMPTY_REVIEW_DRAFT);
    const result=await extraction.runPurchaseAiExtraction('ai-owner',doc.id,2,options());state.enabled=false;
    const applied=await extraction.applyPurchaseAiSuggestions('ai-owner',doc.id,2,result.extraction!.id);expect(applied.document.reviewDraft?.amount).toBe('0.29');
    const edited=await save.savePurchaseReviewDraft('ai-owner',doc.id,applied.document.revision,{...applied.document.reviewDraft!,note:'User purpose'});expect(edited.aiDraftProvenance?.provenance).toBe('AI_USER_EDITED');expect(state.calls).toBe(1);
  });
  it('never makes paid requests on malformed/CSRF API bodies',async()=>{
    const doc=await source();const context={params:Promise.resolve({id:String(doc.id)})};
    const url=`http://localhost/api/purchase-documents/${doc.id}/ai-extraction`;
    const invalid=await route.POST(new NextRequest(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:1,expectedConfigVersion:1,acknowledgeCost:true})}),context);expect(invalid.status).toBe(400);
    const csrf=await route.POST(new NextRequest(url,{method:'POST',headers:{origin:'https://evil.invalid','content-type':'application/json'},body:JSON.stringify({expectedRevision:1,expectedConfigVersion:1,expectedConfigRevision:state.revision,acknowledgeCost:true})}),context);expect(csrf.status).toBe(403);expect(state.calls).toBe(0);
  });
  it('automatic extraction requires NEW intake + explicit opt-in, and upload replay never spends again',async()=>{
    const sharp=(await import('sharp')).default;
    const bytes=await sharp({create:{width:20,height:20,channels:3,background:'#fff'}}).png().toBuffer();const requestId=randomUUID();
    const input={userId:'ai-owner',requestId,originalFileName:'synthetic-auto.png',mediaType:'image/png' as const,bytes};
    state.auto=false;const inactive=await service.intakePurchaseDocument(input);expect(inactive.replayed).toBe(false);expect(state.calls).toBe(0);
    state.auto=true;await service.intakePurchaseDocument(input);expect(state.calls).toBe(0);
    const nextBytes=await sharp({create:{width:21,height:20,channels:3,background:'#fff'}}).png().toBuffer();
    const next={...input,requestId:randomUUID(),bytes:nextBytes};const captured=await service.intakePurchaseDocument(next);expect(captured.document.reviewDraft?.amount).toBe('0.29');expect(state.calls).toBe(1);
    await service.intakePurchaseDocument(next);expect(state.calls).toBe(1);
  });
});
