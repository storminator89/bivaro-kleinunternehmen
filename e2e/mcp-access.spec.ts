import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';

// Only the guarded runner fixture; real browser, real keys, real HTTP MCP SDK.
test.afterAll(async()=>prisma.$disconnect());
test('LAN agent access defaults to read-only, scopes writes explicitly and revokes immediately',async({page,baseURL},testInfo)=>{
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  expect(baseURL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  await isolateSyntheticLoginIpBudget();
  const password='SyntheticMcpOnly123!';
  const user=await prisma.user.create({data:{email:`mcp-${randomUUID()}@example.test`,name:'Synthetic MCP owner',password:await hashPassword(password)}});
  await page.goto('/login');await page.getByLabel('E-Mail').fill(user.email);await page.getByLabel('Passwort',{exact:true}).fill(password);await page.getByRole('main').getByRole('button',{name:'Anmelden',exact:true}).click();await expect(page).toHaveURL(/\/dashboard/);
  await page.goto('/settings');await page.getByRole('link',{name:'MCP verwalten',exact:true}).click();await expect(page.getByRole('heading',{name:'Agent-Zugang',exact:true})).toBeVisible();
  const write=page.getByRole('checkbox',{name:'Schreiben erlauben'});await expect(write).not.toBeChecked();
  await page.getByLabel('Agent-Name').fill('Synthetic reader');await page.getByRole('button',{name:'Zugang erstellen',exact:true}).click();
  const key=await page.getByRole('status').locator('code').innerText();expect(key).toMatch(/^biv_sk_/);
  const client=new Client({name:'synthetic-network-agent',version:'1'});
  await client.connect(new StreamableHTTPClientTransport(new URL(baseURL+'/api/mcp'),{requestInit:{headers:{Authorization:`Bearer ${key}`}}}));
  const tools=await client.listTools();expect(tools.tools).toHaveLength(5);expect(tools.tools.every(tool=>tool.annotations?.readOnlyHint)).toBe(true);
  expect((await client.callTool({name:'bivaro_customer_save',arguments:{name:'Forbidden customer'}})).isError).toBe(true);
  await page.getByRole('button',{name:'Ausblenden',exact:true}).click();
  await page.getByRole('button',{name:'Deaktivieren',exact:true}).click();await expect(page.getByRole('button',{name:'Aktivieren',exact:true})).toBeVisible();await expect(client.listTools()).rejects.toThrow();await client.close();
  await page.getByLabel('Agent-Name').fill('Synthetic writer');await write.check();await page.getByRole('button',{name:'Zugang erstellen',exact:true}).click();
  const writeKey=await page.getByRole('status').locator('code').innerText();await page.getByRole('button',{name:'Ausblenden',exact:true}).click();
  const writer=new Client({name:'synthetic-network-writer',version:'1'});
  await writer.connect(new StreamableHTTPClientTransport(new URL(baseURL+'/api/mcp'),{requestInit:{headers:{Authorization:`Bearer ${writeKey}`}}}));
  expect((await writer.listTools()).tools).toHaveLength(10);
  const saved=await writer.callTool({name:'bivaro_customer_save',arguments:{name:'Synthetic MCP customer'}});expect(saved.isError).not.toBe(true);expect(await prisma.customer.count({where:{userId:user.id,name:'Synthetic MCP customer'}})).toBe(1);await writer.close();
  expect(await prisma.invoice.count({where:{userId:user.id}})).toBe(0);expect(await prisma.income.count({where:{userId:user.id}})).toBe(0);expect(await prisma.expense.count({where:{userId:user.id}})).toBe(0);
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:950});await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await expect(page.getByRole('heading',{name:'Agent-Zugang',exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath(`mcp-access-${width}.png`),fullPage:true});
  }
});
