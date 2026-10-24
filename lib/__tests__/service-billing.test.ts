import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { createTestDatabase } from './helpers/database';
import { getServiceBillingPeriod, isUnrenderedServiceBillingDraft, readServiceBillingDraftSeed, readServiceBillingPlanInput, serviceBillingToday } from '@/lib/service-billing';

const state = vi.hoisted(() => ({ client: null as unknown, userId: 'service-owner', writes: 0 }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => { class UnauthorizedError extends Error {} return { requireUserId: async () => { if (!state.userId) throw new UnauthorizedError(); return state.userId; }, UnauthorizedError, unauthorizedResponse: () => new Response(null, { status: 401 }) }; });
vi.mock('@/lib/upload-path', () => ({ writeTenantFile: vi.fn(async () => `synthetic-${++state.writes}.xml`), deleteTenantFile: vi.fn(async () => {}) }));
import { createServiceBillingPlan, listServiceBillingPlans, reviewServiceBillingPeriod, updateServiceBillingPlan } from '@/lib/service-billing-service';
import { serviceBillingDraftToken } from '@/lib/server/service-billing-draft';
import { GET as loadDraft, PATCH as saveDraft } from '@/app/api/service-billing/drafts/[id]/route';
import { POST as upload } from '@/app/api/invoices/upload/route';
import { POST as cancel } from '@/app/api/invoices/cancel/route';
import { POST as createApi, GET as listApi } from '@/app/api/service-billing/route';
import { POST as periodApi } from '@/app/api/service-billing/period/route';
import { deleteInvoice, updateInvoiceStatus } from '@/lib/invoice-payments';
import { recordFullPayment } from '@/lib/payment-journal/service';
import { buildDocumentEmailDraft } from '@/lib/email';

let database: ReturnType<typeof createTestDatabase>;
let customerId: number; let otherCustomerId: number;
const input = (overrides: Record<string, unknown> = {}) => ({ name: 'IT Support', customerId, cadence: 'MONTHLY', anchorDate: '2026-01-31', taxMode: 'standard', items: [{ description: 'IT support', quantity: 1, unitPrice: 100, unit: 'Pauschale', taxRate: 19 }], ...overrides });
const request = (url: string, body: unknown, method = 'POST', origin?: string) => new Request(`http://localhost${url}`, { method, headers: { 'Content-Type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
async function create(overrides: Record<string, unknown> = {}) { return (await createServiceBillingPlan('service-owner', input(overrides))).id; }
async function plan(id: string) { return database.client.serviceBillingPlan.findUniqueOrThrow({ where: { id } }); }
async function generate(id: string) { const row = await plan(id); return reviewServiceBillingPeriod('service-owner', { planId: id, revision: row.revision, periodIndex: row.nextPeriod, action: 'GENERATE', confirmed: true }, '2026-10-21'); }
async function counts() { return { invoices: await database.client.invoice.count(), incomes: await database.client.income.count(), payments: await database.client.paymentJournalEvent.count(), counters: await database.client.invoiceNumberCounter.count(), receipts: await database.client.serviceBillingPeriod.count(), plans: await database.client.serviceBillingPlan.count() }; }

beforeAll(async () => {
  database = createTestDatabase(); state.client = database.client;
  await database.client.user.createMany({ data: [{ id: 'service-owner', email: 'service-owner@example.invalid', password: 'unused' }, { id: 'service-other', email: 'service-other@example.invalid', password: 'unused' }] });
  customerId = (await database.client.customer.create({ data: { userId: 'service-owner', name: 'Synthetic IT customer', address: 'Teststraße 1', zipCode: '12345', city: 'Teststadt' } })).id;
  otherCustomerId = (await database.client.customer.create({ data: { userId: 'service-other', name: 'Other tenant' } })).id;
  await database.client.settings.create({ data: { userId: 'service-owner', companyName: 'Synthetic service', email: 'synthetic@example.invalid' } });
}, 40_000);
afterAll(async () => database?.cleanup());

describe('anchored calendar, exact native money and explicit tax decision', () => {
  it('clamps end-of-month without cumulative drift and keeps leap-year anchor', () => {
    expect(getServiceBillingPeriod('2026-01-31','MONTHLY',0)).toEqual({ periodStart: '2026-01-31', periodEnd: '2026-02-27', nextDue: '2026-02-28' });
    expect(getServiceBillingPeriod('2026-01-31','MONTHLY',1)).toEqual({ periodStart: '2026-02-28', periodEnd: '2026-03-30', nextDue: '2026-03-31' });
    expect(getServiceBillingPeriod('2026-01-31','QUARTERLY',1).periodStart).toBe('2026-04-30');
    expect(getServiceBillingPeriod('2028-02-29','YEARLY',1).periodStart).toBe('2029-02-28');
    expect(getServiceBillingPeriod('2028-02-29','YEARLY',4).periodStart).toBe('2032-02-29');
  });
  it('uses explicit Europe/Berlin business day through DST boundary', () => {
    expect(serviceBillingToday(new Date('2026-10-25T22:59:59Z'))).toBe('2026-10-25');
    expect(serviceBillingToday(new Date('2026-10-25T23:00:00Z'))).toBe('2026-10-26');
  });
  it.each([{ anchorDate: '2026-02-30' }, { cadence: 'DAILY' }, { customerId: true }, { taxMode: 'INFER' }, { items: [] }, { items: [{ description:'x',quantity:1,unitPrice:0.001,unit:'x',taxRate:19 }] }, { items: [{ description:'x',quantity:1,unitPrice:10,unit:'x',taxRate:0 }] }, { taxMode:'small-business' }])('rejects unsupported plan data %j', override => expect(() => readServiceBillingPlanInput(input(override))).toThrow());
  it('preserves exact native line rounding and selected tax mode without settings writes', async () => {
    const id = await create({ taxMode: 'small-business', items: [{ description: 'Support', quantity: 0.5, unitPrice: 0.01, unit: 'Pauschale', taxRate: 0 }] });
    const made = await generate(id); const row = await database.client.invoice.findUniqueOrThrow({ where: { id: made.invoiceId! } });
    expect(row.totalAmount).toBe(0.01); expect(readServiceBillingDraftSeed(row.parsedData)?.taxMode).toBe('small-business');
    expect((await database.client.settings.findUniqueOrThrow({ where: { userId: 'service-owner' } })).fiscalTaxRegime).toBe('UNSET');
  });
});

describe('single-period planning, tenant/CAS boundaries and no financial side effects', () => {
  it('GET and previews are passive; create retry has one stable identity', async () => {
    const key = randomUUID(); const first = await createServiceBillingPlan('service-owner', input({ requestId: key }));
    const before = await counts(); const repeat = await createServiceBillingPlan('service-owner', input({ requestId: key }));
    expect(repeat).toEqual({ id: first.id, idempotent: true });
    const list = await listServiceBillingPlans('service-owner'); expect(list.plans.find(value => value.id === first.id)).toMatchObject({ nextPeriod: 0, due: true, missed: true });
    expect(await listApi()).toHaveProperty('status',200); expect(await counts()).toEqual(before);
    await expect(createServiceBillingPlan('service-owner', input({ requestId: key, name: 'Changed' }))).rejects.toMatchObject({ status: 409 });
  });
  it('concurrent repeated generation is one ordinary editable no-file unnumbered DRAFT', async () => {
    const id = await create(); const before = await counts(); const body = { planId:id, revision:1,periodIndex:0,action:'GENERATE',confirmed:true };
    const [first, repeat] = await Promise.all([reviewServiceBillingPeriod('service-owner',body,'2026-10-21'),reviewServiceBillingPeriod('service-owner',body,'2026-10-21')]);
    expect(first.invoiceId).toBe(repeat.invoiceId); expect(repeat.idempotent).toBe(true);
    const row = await database.client.invoice.findUniqueOrThrow({ where: { id: first.invoiceId! } });
    expect(isUnrenderedServiceBillingDraft(row)).toBe(true);
    expect(isUnrenderedServiceBillingDraft({ ...row, quoteCreateReceipts: [] })).toBe(true);
    expect(isUnrenderedServiceBillingDraft({ ...row, quoteCreateRequestId: randomUUID() })).toBe(false);
    expect(isUnrenderedServiceBillingDraft({ ...row, quoteCreateFingerprint: 'a'.repeat(64) })).toBe(false);
    expect(isUnrenderedServiceBillingDraft({ ...row, quoteCreateReceipts: [{}] })).toBe(false);
    expect(row).toMatchObject({ invoiceNumber:null,invoiceDate:null,dueDate:null,storedFileName:'',status:'DRAFT',issuanceState:'UNISSUED',totalAmount:119 });
    expect(await counts()).toEqual({ ...before,invoices:before.invoices+1,receipts:before.receipts+1 });
    expect(await plan(id)).toMatchObject({nextPeriod:1,revision:2});
    await expect(reviewServiceBillingPeriod('service-owner',{...body,action:'SKIP'},'2026-10-21')).rejects.toMatchObject({status:409});
  });
  it('missed periods never catch up automatically; explicit skip moves exactly once', async () => {
    const id = await create(); const before = await counts();
    await reviewServiceBillingPeriod('service-owner',{planId:id,revision:1,periodIndex:0,action:'SKIP',confirmed:true},'2026-10-21');
    expect(await plan(id)).toMatchObject({nextPeriod:1,revision:2});
    expect(await counts()).toEqual({...before,receipts:before.receipts+1});
    await listServiceBillingPlans('service-owner'); expect(await plan(id)).toMatchObject({nextPeriod:1});
  });
  it('pause/resume never advances or books; stale edits and schedule mutation fail closed', async () => {
    const id = await create(); const before = await counts();
    await updateServiceBillingPlan('service-owner',{id,revision:1,status:'PAUSED'});
    await expect(generate(id)).rejects.toMatchObject({status:409});
    await expect(updateServiceBillingPlan('service-owner',{id,revision:1,name:'Stale'})).rejects.toMatchObject({status:409});
    await expect(updateServiceBillingPlan('service-owner',{id,revision:2,anchorDate:'2026-01-01'})).rejects.toThrow(/Startdatum/);
    await updateServiceBillingPlan('service-owner',{id,revision:2,status:'ACTIVE'});
    expect(await plan(id)).toMatchObject({nextPeriod:0,revision:3}); expect(await counts()).toEqual(before);
  });
  it('rejects tenant escape, future generation, unconfirmed and out-of-order periods', async () => {
    const id = await create({anchorDate:'2027-01-31'}); const before=await counts();
    await expect(createServiceBillingPlan('service-owner',input({customerId:otherCustomerId}))).rejects.toMatchObject({status:404});
    await expect(reviewServiceBillingPeriod('service-other',{planId:id,revision:1,periodIndex:0,action:'GENERATE',confirmed:true},'2026-10-21')).rejects.toMatchObject({status:404});
    await expect(generate(id)).rejects.toMatchObject({status:409});
    await expect(reviewServiceBillingPeriod('service-owner',{planId:id,revision:1,periodIndex:0,action:'GENERATE'},'2028-01-01')).rejects.toThrow(/bestätigen/);
    await expect(reviewServiceBillingPeriod('service-owner',{planId:id,revision:1,periodIndex:1,action:'GENERATE',confirmed:true},'2028-01-01')).rejects.toMatchObject({status:409});
    expect(await counts()).toEqual(before);
  });
  it('retains receipt after deleting draft and never regenerates the same period', async () => {
    const id=await create(); const first=await generate(id); await deleteInvoice('service-owner',first.invoiceId!); const before=await counts();
    const repeat=await reviewServiceBillingPeriod('service-owner',{planId:id,revision:1,periodIndex:0,action:'GENERATE',confirmed:true},'2026-10-21');
    expect(repeat).toMatchObject({invoiceId:null,idempotent:true}); expect(await counts()).toEqual(before);
  });
  it('rejects an overlong native customer address without consuming a period or corrupting backup eligibility', async () => {
    const customer = await database.client.customer.create({data:{userId:'service-owner',name:'Long native customer',address:'x'.repeat(2000),zipCode:'y'.repeat(2000),city:'z'.repeat(2000)}});
    const id=await create({customerId:customer.id}); const before=await counts();
    await expect(generate(id)).rejects.toMatchObject({status:409});
    expect(await counts()).toEqual(before); expect(await plan(id)).toMatchObject({nextPeriod:0,revision:1});
  });
  it('rolls back draft, cursor and period receipt when mandatory audit insert fails', async () => {
    const id=await create(); const before=await counts();
    await database.client.$executeRawUnsafe(`CREATE TRIGGER "service_audit_failure" BEFORE INSERT ON "AuditLog" BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;`);
    try { await expect(generate(id)).rejects.toThrow(); } finally { await database.client.$executeRawUnsafe('DROP TRIGGER "service_audit_failure"'); }
    expect(await counts()).toEqual(before); expect(await plan(id)).toMatchObject({nextPeriod:0,revision:1});
  });
  it('recognizes native no-file drafts independent of JSON object key order', async () => {
    const made=await generate(await create()); const row=await database.client.invoice.findUniqueOrThrow({where:{id:made.invoiceId!}});
    const reorder=(value:unknown):unknown => Array.isArray(value) ? value.map(reorder) : value && typeof value==='object' ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>b.localeCompare(a)).map(([key,item])=>[key,reorder(item)])) : value;
    expect(isUnrenderedServiceBillingDraft({...row,parsedData:reorder(row.parsedData)})).toBe(true);
  });
  it('blocks issuance, payment, SMTP and cancellation of an unrendered draft', async () => {
    const id=await create(); const made=await generate(id); const before=await counts();
    await expect(updateInvoiceStatus('service-owner',made.invoiceId!,'SENT')).rejects.toMatchObject({status:409});
    await expect(recordFullPayment('service-owner',made.invoiceId!,{amount:119,currency:'EUR',paidAt:'2026-10-21',source:'MANUAL',reference:'synthetic',idempotencyKey:randomUUID()})).rejects.toThrow(/Serviceentwurf/);
    await expect(buildDocumentEmailDraft('service-owner',{documentType:'invoice',id:made.invoiceId!})).rejects.toThrow(/Serviceentwurf/);
    const response=await cancel(request('/api/invoices/cancel',{invoiceId:made.invoiceId,cancellationReason:'Synthetic review'})); expect(response.status).toBe(422);
    expect(await counts()).toEqual(before);
  });
  it('blocks payment and issuance for legacy JSON-string planning markers without rewriting them', async () => {
    const made=await generate(await create()); const id=made.invoiceId!;
    const row=await database.client.invoice.findUniqueOrThrow({where:{id}});
    const parsedData=JSON.stringify(row.parsedData);
    await database.client.invoice.update({where:{id},data:{parsedData}}); const before=await counts();
    await expect(updateInvoiceStatus('service-owner',id,'SENT')).rejects.toMatchObject({status:409});
    await expect(recordFullPayment('service-owner',id,{amount:119,currency:'EUR',paidAt:'2026-10-21',source:'MANUAL',reference:'synthetic legacy marker',idempotencyKey:randomUUID()})).rejects.toThrow(/Serviceentwurf/);
    await expect(buildDocumentEmailDraft('service-owner',{documentType:'invoice',id})).rejects.toThrow(/Serviceentwurf/);
    expect(await counts()).toEqual(before);
    expect((await database.client.invoice.findUniqueOrThrow({where:{id}})).parsedData).toBe(parsedData);
  });
  it('requires authenticated native identity on list, create, review and draft read', async () => {
    const before=await counts(); state.userId='';
    try {
      expect((await listApi()).status).toBe(401);
      expect((await createApi(request('/api/service-billing',input()))).status).toBe(401);
      expect((await periodApi(request('/api/service-billing/period',{}))).status).toBe(401);
      expect((await loadDraft(new Request('http://localhost/api/service-billing/drafts/1'),{params:Promise.resolve({id:'1'})})).status).toBe(401);
    } finally { state.userId='service-owner'; }
    expect(await counts()).toEqual(before);
  });
  it('enforces mutation origin and bounded body at new endpoints', async () => {
    const before=await counts();
    expect((await createApi(request('/api/service-billing',input(),'POST','https://foreign.example.invalid'))).status).toBe(403);
    expect((await periodApi(request('/api/service-billing/period',{padding:'x'.repeat(4097)}))).status).toBe(413);
    expect(await counts()).toEqual(before);
  });
});

describe('same native invoice editor draft lifecycle', () => {
  it('saves edits with CAS, blocks stale and foreign edits and retains no-number/no-file draft', async () => {
    const made=await generate(await create()); const id=made.invoiceId!; const params={params:Promise.resolve({id:String(id)})};
    const loaded=await loadDraft(new Request(`http://localhost/api/service-billing/drafts/${id}`),params); expect(loaded.status).toBe(200); const body=await loaded.json();
    const edit={draftToken:body.draftToken,customerId,customerAddress:body.parsedData.customerAddress,notes:'My reviewed note',taxMode:'standard',items:[{description:'Reviewed support',quantity:2,unitPrice:100,unit:'Stunde',taxRate:19}]};
    const saved=await saveDraft(request(`/api/service-billing/drafts/${id}`,edit,'PATCH'),params); expect(saved.status).toBe(200);
    expect((await saveDraft(request(`/api/service-billing/drafts/${id}`,edit,'PATCH'),params)).status).toBe(409);
    const row=await database.client.invoice.findUniqueOrThrow({where:{id}}); expect(row.totalAmount).toBe(238); expect(isUnrenderedServiceBillingDraft(row)).toBe(true); expect(readServiceBillingDraftSeed(row.parsedData)?.notes).toBe('My reviewed note');
    state.userId='service-other'; expect((await loadDraft(new Request(`http://localhost/api/service-billing/drafts/${id}`),params)).status).toBe(404); state.userId='service-owner';
    expect(await database.client.income.count()).toBe(0); expect(await database.client.paymentJournalEvent.count()).toBe(0);
  });
  it('explicit file generation replaces SAME draft, retries once and leaves issuance/payment untouched', async () => {
    const made=await generate(await create()); const id=made.invoiceId!; const row=await database.client.invoice.findUniqueOrThrow({where:{id}}); const token=serviceBillingDraftToken(row.parsedData,row.customerId); const key=randomUUID();
    const xml='<Invoice><ID>SERVICE-EXPLICIT-1</ID><IssueDate>2026-10-21</IssueDate><DocumentCurrencyCode>EUR</DocumentCurrencyCode><AccountingCustomerParty><Party><PartyName><Name>Synthetic IT customer</Name></PartyName></Party></AccountingCustomerParty><LegalMonetaryTotal><TaxInclusiveAmount currencyID="EUR">119</TaxInclusiveAmount><PayableAmount currencyID="EUR">119</PayableAmount></LegalMonetaryTotal></Invoice>';
    function fileRequest(requestId=key,draftToken=token) { const form=new FormData(); form.append('file',new File([xml],'reviewed.xml',{type:'application/xml'})); form.append('generatedRequestId',requestId);form.append('serviceDraftId',String(id));form.append('serviceDraftToken',draftToken);form.append('selectedCustomerId',String(customerId));return new NextRequest('http://localhost/api/invoices/upload',{method:'POST',body:form}); }
    const before=await counts(); const first=await upload(fileRequest()); expect(first.status).toBe(200);expect(await first.json()).toMatchObject({id,status:'DRAFT',issuanceState:'UNKNOWN'});
    const repeat=await upload(fileRequest());expect(repeat.status).toBe(200);expect(await repeat.json()).toMatchObject({id,idempotent:true});
    expect(await counts()).toEqual(before); const saved=await database.client.invoice.findUniqueOrThrow({where:{id},include:{serviceBillingPeriod:true}});
    expect(saved).toMatchObject({invoiceNumber:'SERVICE-EXPLICIT-1',status:'DRAFT',paidAt:null});expect(saved.serviceBillingPeriod?.invoiceId).toBe(id);expect(readServiceBillingDraftSeed(saved.parsedData)).toBeNull();
    expect((await upload(fileRequest(randomUUID()))).status).toBe(409);
  });
});
