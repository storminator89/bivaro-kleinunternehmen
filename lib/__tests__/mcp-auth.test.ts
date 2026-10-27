import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JSONWebKeySet } from 'jose';
import { authenticateMcp } from '@/lib/mcp/auth';
import { mcpConfig } from '@/lib/mcp/config';
import { GET as metadata } from '@/app/.well-known/oauth-protected-resource/api/mcp/route';

const state = vi.hoisted(() => ({ jwks: null as JSONWebKeySet | null, user: vi.fn(), apiKey: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: state.user } } }));
vi.mock('@/lib/api-auth', () => ({ validateApiKey: state.apiKey }));
vi.mock('jose', async original => ({ ...await original<typeof import('jose')>(), createRemoteJWKSet: () => createLocalJWKSet(state.jwks!) }));
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
const issuer='https://auth.synthetic.test/tenant/';
const resource='https://bivaro.synthetic.test/api/mcp';
async function token(claims: Record<string, unknown> = {}, typ='at+jwt', signing=keys.privateKey) {
  const now=Math.floor(Date.now()/1000);
  return new SignJWT({ sub:'provider-sub',scope:'mcp:read mcp:write',client_id:'allowed-agent',iss:issuer,aud:resource,iat:now,exp:now+300,...claims }).setProtectedHeader({alg:'RS256',typ,kid:'synthetic-key'}).sign(signing);
}
const request = (value: string) => new Request(resource,{headers:{authorization:'Bearer '+value}});
beforeAll(async()=>{keys=await generateKeyPair('RS256'); state.jwks={keys:[{...await exportJWK(keys.publicKey),kid:'synthetic-key',alg:'RS256'}]};});
beforeEach(()=>{
  vi.stubEnv('BIVARO_MCP_ENABLED','1');vi.stubEnv('BIVARO_MCP_URL',resource);vi.stubEnv('BIVARO_MCP_ALLOW_WRITES','1');vi.stubEnv('BIVARO_MCP_OAUTH_ISSUER',issuer);vi.stubEnv('BIVARO_MCP_OAUTH_JWKS_URL',issuer+'jwks');vi.stubEnv('BIVARO_MCP_OAUTH_CLIENT_IDS','allowed-agent');vi.stubEnv('BIVARO_MCP_OAUTH_SUBJECTS',JSON.stringify({'provider-sub':{userId:'owned-user',write:false}}));state.user.mockResolvedValue({role:'USER',deactivatedAt:null});state.apiKey.mockReset();
});
afterEach(()=>vi.unstubAllEnvs());
describe('OAuth resource-server contract with real JWT signatures',()=>{
  it('validates signed access tokens and caps provider scope by explicit subject binding',async()=>{
    expect(await authenticateMcp(request(await token()),mcpConfig()!)).toEqual({userId:'owned-user',accessId:'oauth:allowed-agent:provider-sub',canWrite:false});
    vi.stubEnv('BIVARO_MCP_OAUTH_SUBJECTS',JSON.stringify({'provider-sub':{userId:'owned-user',write:true}}));expect((await authenticateMcp(request(await token()),mcpConfig()!))?.canWrite).toBe(true);
    vi.stubEnv('BIVARO_MCP_ALLOW_WRITES','0');expect((await authenticateMcp(request(await token()),mcpConfig()!))?.canWrite).toBe(false);
  });
  it.each([{iss:'https://attacker.test'},{aud:'https://other-api.test'},{sub:'unknown-sub'},{client_id:'unapproved-client'},{scope:'read write *'},{exp:0},{iat:1,exp:2},{exp:Math.floor(Date.now()/1000)+7200},{sub:'__proto__'}])('rejects unsupported or misbound claims %j',async claims=>{
    expect(await authenticateMcp(request(await token(claims)),mcpConfig()!)).toBeNull();
  });
  it('rejects ID tokens, another signature, missing expiry and inactive owners',async()=>{
    expect(await authenticateMcp(request(await token({},'JWT')),mcpConfig()!)).toBeNull();
    const bad=await generateKeyPair('RS256');expect(await authenticateMcp(request(await token({},'at+jwt',bad.privateKey)),mcpConfig()!)).toBeNull();
    expect(await authenticateMcp(request(await token({exp:undefined})),mcpConfig()!)).toBeNull();
    state.user.mockResolvedValue({role:'USER',deactivatedAt:new Date()});expect(await authenticateMcp(request(await token()),mcpConfig()!)).toBeNull();
  });
  it('advertises exact resource/issuer and never advertises unconfigured OAuth',async()=>{
    const response=await metadata();expect(response.status).toBe(200);expect(await response.json()).toMatchObject({resource,authorization_servers:[issuer],scopes_supported:['mcp:read','mcp:write']});
    vi.stubEnv('BIVARO_MCP_OAUTH_ISSUER','');vi.stubEnv('BIVARO_MCP_OAUTH_JWKS_URL','');expect((await metadata()).status).toBe(404);
  });
  it('does not allow OAuth on plain LAN HTTP or with no explicit client allowlist',()=>{
    vi.stubEnv('BIVARO_MCP_URL','http://192.168.0.126:7689/api/mcp');vi.stubEnv('BIVARO_MCP_ALLOW_INSECURE_LAN','1');expect(()=>mcpConfig()).toThrow();
    vi.stubEnv('BIVARO_MCP_URL',resource);vi.stubEnv('BIVARO_MCP_OAUTH_CLIENT_IDS','');expect(()=>mcpConfig()).toThrow();
  });
  it('accepts explicit MCP key rights alongside OAuth and never expands REST rights',async()=>{
    state.apiKey.mockResolvedValue({valid:true,userId:'owned-user',apiKeyId:9,scopes:['*']});expect(await authenticateMcp(request('biv_sk_synthetic'),mcpConfig()!)).toBeNull();
    state.apiKey.mockResolvedValue({valid:true,userId:'owned-user',apiKeyId:9,scopes:['mcp:read']});expect((await authenticateMcp(request('biv_sk_synthetic'),mcpConfig()!))?.canWrite).toBe(false);
  });
});
