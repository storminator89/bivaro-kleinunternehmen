import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { createTestDatabase } from './helpers/database';
import { generateZugferdXml } from '@/lib/zugferd-generator';

const state = vi.hoisted(() => ({ client: null as unknown, userId: 'service-note-owner', writes: 0 }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => ({ requireUserId: async () => state.userId, UnauthorizedError: class extends Error {}, unauthorizedResponse: () => new Response(null, { status: 401 }) }));
vi.mock('@/lib/upload-path', () => ({ writeTenantFile: vi.fn(async () => `synthetic-note-${++state.writes}.xml`), deleteTenantFile: vi.fn(async () => {}) }));
import { createServiceBillingPlan, reviewServiceBillingPeriod } from '@/lib/service-billing-service';
import { GET as loadDraft, PATCH as saveDraft } from '@/app/api/service-billing/drafts/[id]/route';
import { POST as upload } from '@/app/api/invoices/upload/route';
import { readServiceBillingPlanInput } from '@/lib/service-billing';

let database: ReturnType<typeof createTestDatabase>; let customerId: number;
const item = { description: 'Synthetische Leistungsnotiz', quantity: 1, unitPrice: 100, unit: 'Stunde', taxRate: 19 };
async function draft() {
  const note=await database.client.billingNote.create({data:{userId:state.userId,customerId,serviceDate:new Date('2026-01-31T00:00:00Z'),description:item.description,quantity:1,unit:'Stunde'}});
  const made=await createServiceBillingPlan(state.userId,{name:'Synthetic note boundary',customerId,cadence:'MONTHLY',anchorDate:'2026-01-31',taxMode:'standard',items:[item]});
  const result=await reviewServiceBillingPeriod(state.userId,{planId:made.id,revision:1,periodIndex:0,action:'GENERATE',confirmed:true},'2026-10-21');
  const id=result.invoiceId!; const params={params:Promise.resolve({id:String(id)})};
  const seed=await (await loadDraft(new Request(`http://localhost/api/service-billing/drafts/${id}`),params)).json();
  return {id,note,params,seed};
}
beforeAll(async()=>{
  database=createTestDatabase();state.client=database.client;
  await database.client.user.create({data:{id:state.userId,email:'service-note@example.invalid',password:'unused'}});
  customerId=(await database.client.customer.create({data:{userId:state.userId,name:'Synthetic note customer'}})).id;
},40_000);
afterAll(async()=>database?.cleanup());

describe('bounded service planning never silently drops a billing-note claim',()=>{
  it('rejects associated service plan input rather than copying an unclaimed note as a manual service',()=>{
    expect(()=>readServiceBillingPlanInput({name:'Synthetic',customerId,cadence:'MONTHLY',anchorDate:'2026-01-31',taxMode:'standard',items:[{...item,billingNoteId:1}]})).toThrow(/Leistungsnotizen/);
  });
  it('rejects claim metadata on no-file save instead of stripping it across save/reload',async()=>{
    const {id,note,params,seed}=await draft();const before=await database.client.invoice.findUniqueOrThrow({where:{id}});
    for(const metadata of [{items:[{...item,billingNoteId:note.id}]},{items:[item],billingNoteIds:[note.id]}]){
      const response=await saveDraft(new Request(`http://localhost/api/service-billing/drafts/${id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({draftToken:seed.draftToken,customerId,customerAddress:'Synthetic note customer',notes:'',taxMode:'standard',...metadata})}),params);
      expect(response.status).toBe(400);expect(await response.json()).toMatchObject({code:'UNSUPPORTED_SERVICE_BILLING_NOTES'});
      expect((await database.client.invoice.findUniqueOrThrow({where:{id}})).parsedData).toEqual(before.parsedData);
      expect((await database.client.billingNote.findUniqueOrThrow({where:{id:note.id}})).invoiceId).toBeNull();
    }
  });
  it('rejects service-draft render claims before file writes or note reservation',async()=>{
    const {id,note,seed}=await draft();const count=await database.client.invoice.count();const writes=state.writes;
    const xml=generateZugferdXml({invoiceNumber:`SYNTHETIC-NOTE-${id}`,date:new Date('2026-10-21T00:00:00Z'),dueDate:new Date('2026-11-21T00:00:00Z'),paymentMeansCode:'10',seller:{name:'Synthetic seller',address:'Testweg 1',countryCode:'DE',zipCode:'12345',city:'Teststadt',taxNumber:'synthetic'},buyer:{name:'Synthetic note customer',address:'Testweg 2',zipCode:'12345',city:'Teststadt',countryCode:'DE'},items:[{...item,total:100}],netAmount:100,taxAmount:19,currency:'EUR',taxMode:'standard'});
    const form=new FormData();form.append('file',new File([xml],'synthetic-note.xml',{type:'application/xml'}));form.append('generatedRequestId',randomUUID());form.append('serviceDraftId',String(id));form.append('serviceDraftToken',seed.draftToken);form.append('selectedCustomerId',String(customerId));form.append('billingNoteIds',JSON.stringify([note.id]));
    const response=await upload(new NextRequest('http://localhost/api/invoices/upload',{method:'POST',body:form}));
    expect(response.status).toBe(400);expect(await response.json()).toMatchObject({code:'UNSUPPORTED_SERVICE_BILLING_NOTES'});
    expect(state.writes).toBe(writes);expect(await database.client.invoice.count()).toBe(count);
    expect((await database.client.invoice.findUniqueOrThrow({where:{id}}))).toMatchObject({storedFileName:'',invoiceNumber:null,status:'DRAFT',issuanceState:'UNISSUED'});
    expect((await database.client.billingNote.findUniqueOrThrow({where:{id:note.id}})).invoiceId).toBeNull();
    expect(await database.client.income.count()).toBe(0);
  });
});
