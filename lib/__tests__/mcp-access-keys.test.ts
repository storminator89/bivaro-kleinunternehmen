import { beforeAll, beforeEach, afterAll, afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { PrismaClient } from '@prisma/client';
import { createTestDatabase } from './helpers/database';
import { POST, PUT, DELETE } from '@/app/api/api-keys/route';
import { validateApiKey } from '@/lib/api-auth';

const state=vi.hoisted(()=>({client:null as PrismaClient|null,userId:'mcp-key-owner' as string|null}));
vi.mock('@/lib/prisma',()=>({get prisma(){return state.client;}}));
vi.mock('@/lib/get-user-id',()=>{
  class UnauthorizedError extends Error {}
  return {UnauthorizedError,unauthorizedResponse:()=>new Response(null,{status:401}),requireUserId:async()=>{if(!state.userId)throw new UnauthorizedError();return state.userId;}};
});
let database:ReturnType<typeof createTestDatabase>;
const url='http://127.0.0.1:3197/api/api-keys';
const request=(body:unknown,origin='http://127.0.0.1:3197')=>new NextRequest(url,{method:'POST',headers:{'Content-Type':'application/json',origin},body:JSON.stringify(body)});
beforeAll(async()=>{database=createTestDatabase();state.client=database.client;await database.client.user.create({data:{id:'mcp-key-owner',email:'mcp-key-owner@example.test',password:'synthetic-no-login'}});},40_000);
beforeEach(()=>{vi.stubEnv('NEXTAUTH_URL','http://127.0.0.1:3197');vi.stubEnv('BIVARO_MCP_ALLOW_WRITES','0');state.userId='mcp-key-owner';});
afterEach(()=>vi.unstubAllEnvs());afterAll(async()=>database?.cleanup());
it('issues explicit expiring MCP read scopes and never silently includes REST/write scopes',async()=>{
  const response=await POST(request({name:'Synthetic MCP reader',scopes:['mcp:read'],expiresInDays:90}));expect(response.status).toBe(201);
  const body=await response.json();expect(body.scopes).toEqual(['mcp:read']);expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  expect((await validateApiKey(body.key)).scopes).toEqual(['mcp:read']);
  expect(await database.client.auditLog.count({where:{entityName:'MCP_ACCESS_CREATED'}})).toBe(1);
  await PUT(request({id:body.id,isActive:false}));expect((await validateApiKey(body.key)).valid).toBe(false);
});
it('rejects mixed scopes, write-only MCP grants and unbounded key lifetime',async()=>{
  for(const scopes of [['mcp:read','*'],['mcp:read','read'],['mcp:write']])expect((await POST(request({name:'Denied',scopes,expiresInDays:90}))).status).toBe(400);
  for(const expiresInDays of [undefined,0,-1,366,1.5,'90'])expect((await POST(request({name:'Denied',scopes:['mcp:read'],expiresInDays}))).status).toBe(400);
});
it('requires explicit server write enablement and retains the exact requested rights',async()=>{
  const payload={name:'Synthetic writer',scopes:['mcp:read','mcp:write'],expiresInDays:1};expect((await POST(request(payload))).status).toBe(403);
  vi.stubEnv('BIVARO_MCP_ALLOW_WRITES','1');const response=await POST(request(payload));expect(response.status).toBe(201);expect((await response.json()).scopes).toEqual(payload.scopes);
});
it('keeps cookie mutation CSRF and authentication boundaries',async()=>{
  expect((await POST(request({name:'Denied',scopes:['mcp:read'],expiresInDays:1},'https://attacker.test'))).status).toBe(403);
  state.userId=null;expect((await POST(request({name:'Denied',scopes:['mcp:read'],expiresInDays:1}))).status).toBe(401);
});
it('does not change existing REST creation behavior',async()=>{
  const response=await POST(request({name:'Synthetic REST'}));expect(response.status).toBe(201);expect((await response.json()).scopes).toEqual(['read','write']);
});

it('rejects malformed key state and ID inputs without reactivating or deleting a disabled key',async()=>{
  const created=await POST(request({name:'State validation fixture'}));
  const key=await created.json();
  expect((await PUT(request({id:key.id,isActive:false}))).status).toBe(200);
  for(const isActive of ['false','true',0,1,null,[],{}]) {
    expect((await PUT(request({id:key.id,isActive}))).status).toBe(400);
    expect((await validateApiKey(key.key)).valid).toBe(false);
  }
  for(const id of [`${key.id}junk`,`${key.id}.5`,0,-1,Number.MAX_SAFE_INTEGER+1]) {
    expect((await PUT(request({id,isActive:true}))).status).toBe(400);
    expect((await DELETE(new NextRequest(`${url}?id=${id}`,{method:'DELETE'}))).status).toBe(400);
  }
  expect((await PUT(request({id:String(key.id),isActive:true,name:' Renamed '}))).status).toBe(200);
  expect((await validateApiKey(key.key)).valid).toBe(true);
  const row=await database.client.apiKey.findUniqueOrThrow({where:{id:key.id}});
  expect(row.name).toBe('Renamed');
  expect((await DELETE(new NextRequest(`${url}?id=${key.id}`,{method:'DELETE'}))).status).toBe(200);
});

it('rejects malformed objects, names, scopes and expiration instead of issuing an unintended unlimited key',async()=>{
  for(const body of [null,[],{name:'Expiry fixture',expiresInDays:'90'},{name:'Expiry fixture',expiresInDays:0},
    {name:'Expiry fixture',expiresInDays:-1},{name:'Expiry fixture',expiresInDays:1.5},{name:'Expiry fixture',expiresInDays:1e20},
    {name:'Scope fixture',scopes:false},{name:'Scope fixture',scopes:null},{name:' '.repeat(5)},{name:'x'.repeat(256)}]) {
    expect((await POST(request(body))).status).toBe(400);
  }
  for(const body of [null,[],{id:1,name:42},{id:1,name:' '},{id:1,name:'x'.repeat(256)}]) {
    expect((await PUT(request(body))).status).toBe(400);
  }
  const response=await POST(request({name:'Unlimited REST fixture',expiresInDays:null}));
  expect(response.status).toBe(201);expect((await response.json()).expiresAt).toBeNull();
});
