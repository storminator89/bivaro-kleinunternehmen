import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createTestDatabase } from './helpers/database';
import { generateApiKey } from '@/lib/api-auth';
import { POST, GET, DELETE } from '@/app/api/mcp/route';
import { GET as metadata } from '@/app/.well-known/oauth-protected-resource/api/mcp/route';
import { mcpConfig, mcpOriginAllowed } from '@/lib/mcp/config';
import { MCP_COLLECTIONS } from '@/lib/mcp/catalog';
import { readMcpCollection } from '@/lib/mcp/read';
import { saveMcpCustomer } from '@/lib/mcp/write';
import { readInvoicePaymentJournal } from '@/lib/payment-journal/service';

const state = vi.hoisted(() => ({ client: null as PrismaClient | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
let database: ReturnType<typeof createTestDatabase>;
const url = 'http://127.0.0.1:3100/api/mcp';
const clients: Client[] = [];
const seedInvoice = (userId = 'mcp-owner', status = 'SENT') => database.client.invoice.create({ data: { userId, fileName: 'synthetic.pdf', storedFileName: 'synthetic.pdf', invoiceNumber: 'SYNTHETIC-'+Math.random(), parsedData: {}, totalAmount: 10, status, issuanceState: 'ISSUED' } });
async function access(scopes = ['mcp:read'], userId = 'mcp-owner') {
  const { key, keyHash, keyPrefix } = generateApiKey();
  const row = await database.client.apiKey.create({ data: { name: 'Synthetic MCP', userId, keyHash, keyPrefix, scopes: JSON.stringify(scopes) } });
  const client = new Client({ name: 'synthetic-auditor', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${key}` } }, fetch: async (input, init) => {
    const request = new Request(input, init); request.headers.set('host', '127.0.0.1:3100');
    return request.method === 'POST' ? POST(request) : request.method === 'DELETE' ? DELETE() : GET();
  } }));
  clients.push(client);
  return { client, key, row };
}
function data(result: Awaited<ReturnType<Client['callTool']>>) { return JSON.parse((result.content as { text: string }[])[0].text); }
const raw = (key?: string, overrides: Record<string, string> = {}) => new Request(url, { method: 'POST', headers: { host: '127.0.0.1:3100', ...(key ? { Authorization: `Bearer ${key}` } : {}), ...overrides }, body: '{}' });
beforeAll(async () => {
  database = createTestDatabase(); state.client = database.client;
  await database.client.user.createMany({ data: ['mcp-owner', 'mcp-other'].map(id => ({ id, email: id+'@example.test', password: 'synthetic-no-login' })) });
}, 40_000);
beforeEach(() => { vi.stubEnv('BIVARO_MCP_ENABLED', '1'); vi.stubEnv('BIVARO_MCP_URL', url); vi.stubEnv('BIVARO_MCP_ALLOW_INSECURE_LAN', '1'); vi.stubEnv('BIVARO_MCP_ALLOW_WRITES', '0'); vi.stubEnv('BIVARO_MCP_OAUTH_ISSUER', ''); vi.stubEnv('BIVARO_MCP_OAUTH_JWKS_URL', ''); });
afterEach(async () => { for (const client of clients.splice(0)) await client.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(async () => { await database?.cleanup(); });

describe('closed MCP projections and network boundary', () => {
  it('declares only existing tenant-owned scalar business fields, never credentials or relations', () => {
    for (const spec of Object.values(MCP_COLLECTIONS)) {
      const model = Prisma.dmmf.datamodel.models.find(model => model.name[0].toLowerCase()+model.name.slice(1) === spec.model)!;
      expect(model.fields.some(field => field.name === 'userId')).toBe(true);
      for (const name of spec.fields.split(' ')) {
        expect(model.fields.some(field => field.name === name && field.kind !== 'object'), `${spec.model}.${name}`).toBe(true);
        expect(name).not.toMatch(/password|ciphertext|keyHash|keyIv|keyTag|storedFileName|secret/i);
      }
    }
  });
  it('is disabled by default, rejects public cleartext, validates host/origin exactly', async () => {
    vi.stubEnv('BIVARO_MCP_ENABLED','0'); expect((await POST(raw())).status).toBe(404);
    vi.stubEnv('BIVARO_MCP_ENABLED','1'); vi.stubEnv('BIVARO_MCP_URL','http://example.com/api/mcp'); expect(() => mcpConfig()).toThrow();
    vi.stubEnv('BIVARO_MCP_URL',url); const config=mcpConfig()!;
    expect(mcpOriginAllowed(raw(undefined,{origin:'null'}),config)).toBe(false);
    expect(mcpOriginAllowed(raw(undefined,{origin:'https://attacker.test'}),config)).toBe(false);
    expect(mcpOriginAllowed(raw(undefined,{host:'attacker.test','x-forwarded-host':'127.0.0.1:3100'}),config)).toBe(false);
    expect((await POST(raw(undefined,{origin:'https://attacker.test'}))).status).toBe(403);
    expect((await POST(raw())).status).toBe(401);
    expect((await GET()).status).toBe(405); expect((await metadata()).status).toBe(404);
  });
  it('cannot authenticate cookies, query tokens, legacy REST scopes or wildcard scopes', async () => {
    for (const scopes of [['read','write'],['*']]) {
      const generated=generateApiKey(); await database.client.apiKey.create({data:{name:'Synthetic REST',userId:'mcp-owner',keyHash:generated.keyHash,keyPrefix:generated.keyPrefix,scopes:JSON.stringify(scopes)}});
      expect((await POST(raw(generated.key))).status).toBe(401);
      expect((await POST(raw(undefined,{cookie:`next-auth.session-token=${generated.key}`}))).status).toBe(401);
    }
  });
});

describe('real MCP SDK messages against isolated database', () => {
  it('initializes, lists read-only tools/resources and never exposes a forged write', async () => {
    const {client}=await access();
    const tools=await client.listTools(); expect(tools.tools).toHaveLength(5); expect(tools.tools.every(tool=>tool.annotations?.readOnlyHint)).toBe(true);
    expect((await client.listResources()).resources[0].uri).toBe('bivaro://capabilities');
    const result=await client.callTool({name:'bivaro_customer_save',arguments:{name:'MUST NOT EXIST'}}); expect(result.isError).toBe(true);
    expect(await database.client.customer.count({where:{name:'MUST NOT EXIST'}})).toBe(0);
    const capability=data(await client.callTool({name:'bivaro_capabilities',arguments:{}})); expect(capability.writeEnabled).toBe(false);
  });
  it('enforces per-tenant reads, valid pagination and every collection query', async () => {
    const own=await database.client.customer.create({data:{userId:'mcp-owner',name:'Own contact'}});
    const other=await database.client.customer.create({data:{userId:'mcp-other',name:'Hidden contact'}});
    for(const collection of Object.keys(MCP_COLLECTIONS) as (keyof typeof MCP_COLLECTIONS)[]) await expect(readMcpCollection('mcp-owner',{collection})).resolves.toBeDefined();
    const {client}=await access();
    const first=data(await client.callTool({name:'bivaro_read',arguments:{collection:'customers',limit:1}})); expect(first.items[0].id).toBe(own.id); expect(first.items[0]._version).toMatch(/^[a-f0-9]{64}$/);
    const hidden=data(await client.callTool({name:'bivaro_read',arguments:{collection:'customers',id:other.id}})); expect(hidden.items).toEqual([]);
    for(const arguments_ of [{collection:'user'}, {collection:'customers',userId:'mcp-other'}, {collection:'customers',limit:10000}]) expect((await client.callTool({name:'bivaro_read',arguments:arguments_})).isError).toBe(true);
    const invoice=await seedInvoice('mcp-other'); expect((await client.callTool({name:'bivaro_original',arguments:{kind:'invoice',id:invoice.id}})).isError).toBe(true);
    expect((await client.callTool({name:'bivaro_payment_journal',arguments:{invoiceId:invoice.id}})).isError).toBe(true);
  });
  it('revalidates key deactivation, expiry, and user deactivation on every request', async () => {
    const {client,row,key}=await access();
    await database.client.apiKey.update({where:{id:row.id},data:{isActive:false}});
    expect((await POST(raw(key))).status).toBe(401);
    await expect(client.listTools()).rejects.toThrow();
    await database.client.apiKey.update({where:{id:row.id},data:{isActive:true,expiresAt:new Date(0)}}); expect((await POST(raw(key))).status).toBe(401);
    await database.client.apiKey.update({where:{id:row.id},data:{expiresAt:null}});await database.client.user.update({where:{id:'mcp-owner'},data:{deactivatedAt:new Date()}});
    expect((await POST(raw(key))).status).toBe(401);await database.client.user.update({where:{id:'mcp-owner'},data:{deactivatedAt:null}});
  });
  it('rejects oversized transport messages without executing their tool', async () => {
    const {key}=await access();const request=raw(key,{'content-type':'application/json',accept:'application/json, text/event-stream'});
    const response=await POST(new Request(request,{body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'bivaro_read',arguments:{collection:'customers',search:'x'.repeat(270000)}}})})); expect(response.status).toBe(413);
  });
});

describe('explicit write authority and existing accounting protections', () => {
  it('needs server and key opt-in and honors the server kill switch on an existing client', async () => {
    const read=await access(['mcp:read','mcp:write']); expect((await read.client.listTools()).tools).toHaveLength(5);
    vi.stubEnv('BIVARO_MCP_ALLOW_WRITES','1'); const write=await access(['mcp:read','mcp:write']); expect((await write.client.listTools()).tools).toHaveLength(10);
    const readOnly=await access(); expect((await readOnly.client.listTools()).tools).toHaveLength(5);
    vi.stubEnv('BIVARO_MCP_ALLOW_WRITES','0');expect((await write.client.callTool({name:'bivaro_customer_save',arguments:{name:'Denied'}})).isError).toBe(true);
    await expect(saveMcpCustomer({userId:'mcp-owner',accessId:'synthetic',canWrite:true},{name:'Denied'})).rejects.toThrow();
  });
  it('audits customer saves, rejects stale/foreign updates and rolls back if audit fails', async () => {
    vi.stubEnv('BIVARO_MCP_ALLOW_WRITES','1');const principal={userId:'mcp-owner',accessId:'synthetic',canWrite:true};
    const created=await saveMcpCustomer(principal,{name:'Audited contact'});
    const first=await readMcpCollection('mcp-owner',{collection:'customers',id:created.id}); const version=first.items[0]._version;
    expect(typeof version).toBe('string');await saveMcpCustomer(principal,{id:created.id,name:'Updated contact',expectedVersion:version as string});
    await expect(saveMcpCustomer(principal,{id:created.id,name:'Stale overwrite',expectedVersion:version as string})).rejects.toThrow();
    await expect(saveMcpCustomer({...principal,userId:'mcp-other'},{id:created.id,name:'Foreign overwrite',expectedVersion:version as string})).rejects.toThrow();
    await database.client.$executeRawUnsafe("CREATE TRIGGER mcp_fixture_audit_failure BEFORE INSERT ON AuditLog WHEN NEW.entityName = 'Audit must roll back' BEGIN SELECT RAISE(ABORT, 'Synthetic audit failure'); END");
    await expect(saveMcpCustomer(principal,{name:'Audit must roll back'})).rejects.toThrow();await database.client.$executeRawUnsafe('DROP TRIGGER mcp_fixture_audit_failure');expect(await database.client.customer.count({where:{name:'Audit must roll back'}})).toBe(0);
  });
  it('records a payment once, derives list balances, preserves retries and refuses overpayment', async () => {
    vi.stubEnv('BIVARO_MCP_ALLOW_WRITES','1');const {client}=await access(['mcp:read','mcp:write']);const source=await seedInvoice();
    const journal=await readInvoicePaymentJournal('mcp-owner',source.id,3);
    const args={invoiceId:source.id,amount:'10.00',paidAt:'2026-10-20',reference:'Synthetic actual receipt',idempotencyKey:'mcp-synthetic-payment',expectedPaidCents:'0',expectedLedgerVersion:journal.ledgerVersion};
    const result=await client.callTool({name:'bivaro_payment_record',arguments:args}); expect(result.isError).not.toBe(true);expect(data(result).summary.paid).toBe(true);
    expect(data(await client.callTool({name:'bivaro_payment_record',arguments:args})).replayed).toBe(true);
    expect(await database.client.income.count({where:{invoiceId:source.id}})).toBe(1);
    const list=data(await client.callTool({name:'bivaro_read',arguments:{collection:'invoices',id:source.id}}));expect(list.items[0].paymentSummary.openCents).toBe('0');expect(list.items[0].paymentReviewRequired).toBe(false);expect(list.items[0]).not.toHaveProperty('storedFileName');expect(list.items[0]).not.toHaveProperty('userId');expect(list.hasMore).toBe(false);
    expect((await client.callTool({name:'bivaro_payment_record',arguments:{...args,idempotencyKey:'overpayment',expectedPaidCents:'1000'}})).isError).toBe(true);
  });
  it('rejects an entire JSON-RPC batch before any write executes', async () => {
    vi.stubEnv('BIVARO_MCP_ALLOW_WRITES','1');const {key}=await access(['mcp:read','mcp:write']);
    const response=await POST(new Request(raw(key,{'content-type':'application/json',accept:'application/json, text/event-stream'}),{body:JSON.stringify([{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'bivaro_customer_save',arguments:{name:'Batch must not execute'}}}])}));
    expect(response.status).toBe(400);expect(await database.client.customer.count({where:{name:'Batch must not execute'}})).toBe(0);
  });
  it('retains fiscal review gates after a real MCP correction while payment journal stays readable',async()=>{
    await database.client.user.create({data:{id:'mcp-fiscal',email:'mcp-fiscal@example.test',password:'synthetic-only'}});
    vi.stubEnv('BIVARO_MCP_ALLOW_WRITES','1');const {client}=await access(['mcp:read','mcp:write'],'mcp-fiscal');
    const source=await database.client.invoice.create({data:{userId:'mcp-fiscal',fileName:'synthetic.pdf',storedFileName:'synthetic.pdf',parsedData:{currency:'EUR',taxMode:'small-business',taxAmount:0},totalAmount:10,status:'SENT',issuanceState:'ISSUED'}});
    const initial=await readInvoicePaymentJournal('mcp-fiscal',source.id,3);
    const paid=data(await client.callTool({name:'bivaro_payment_record',arguments:{invoiceId:source.id,amount:'10.00',paidAt:'2026-10-20',reference:'Synthetic receipt',idempotencyKey:'fiscal-original',expectedPaidCents:'0',expectedLedgerVersion:initial.ledgerVersion}}));
    const journal=await readInvoicePaymentJournal('mcp-fiscal',source.id,3);
    const adjusted=await client.callTool({name:'bivaro_payment_adjustment',arguments:{invoiceId:source.id,kind:'PAYMENT_CORRECTION',originalPaymentId:paid.event.id,amount:'2.00',actionDate:'2026-10-21',reason:'Synthetic portion never arrived',reference:'synthetic correction',idempotencyKey:'fiscal-correction',expectedLedgerVersion:journal.ledgerVersion,declarationNeverReceived:true}});
    expect(adjusted.isError).not.toBe(true);
    expect((await client.callTool({name:'bivaro_read',arguments:{collection:'incomes'}})).isError).toBe(true);
    expect((await client.callTool({name:'bivaro_read',arguments:{collection:'expenses'}})).isError).toBe(true);
    const state=data(await client.callTool({name:'bivaro_payment_journal',arguments:{invoiceId:source.id}}));expect(state.summary.openCents).toBe('200');
  });
  it('adopts legacy evidence without a duplicate Income or invented date', async () => {
    vi.stubEnv('BIVARO_MCP_ALLOW_WRITES','1');const {client}=await access(['mcp:read','mcp:write']);const source=await seedInvoice('mcp-owner','PAID');
    const result=data(await client.callTool({name:'bivaro_legacy_payment_adopt',arguments:{invoiceId:source.id}})); expect(result.event.dateCertainty).toBe('UNKNOWN');expect(result.event.paidAt).toBeNull();expect(await database.client.income.count({where:{invoiceId:source.id}})).toBe(0);
  });
});
