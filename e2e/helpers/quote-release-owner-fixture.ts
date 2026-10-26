import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, type Page, type TestInfo } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { hashPassword } from '../../lib/password';
import { quoteCreateFingerprintForInvoice } from '../../lib/quote-create-request';
import { e2eDatabasePath } from '../../scripts/e2e-fixture.mjs';

export const OWNER_DEFAULT_ORIGIN = 'http://127.0.0.1:3100';
export const OWNER_ENABLED_ORIGIN = 'http://127.0.0.1:3101';
const PASSWORD = 'SyntheticOwnerVersions456!';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** No client, files, server or database action occurs during test discovery. */
function ownedRunner(info: TestInfo) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'This bounded fixture requires the existing isolated CI runner');
  assert.equal(process.env.CI, 'true'); assert.equal(process.platform, 'linux');
  assert.equal(info.config.workers, 1); assert.equal(info.retry, 0);
  assert.equal(info.project.use.baseURL, OWNER_DEFAULT_ORIGIN);
  assert.equal(process.env.BIVARO_INTERNAL_QUOTE_CAPTURE, undefined, 'Default server must not inherit an enabled flag');
  assert.equal(realpathSync(process.cwd()), realpathSync(process.env.GITHUB_WORKSPACE!));
  const database = e2eDatabasePath();
  assert.equal(process.env.DATABASE_URL, `file:${database}`);
  assert(lstatSync(database).isFile() && !lstatSync(database).isSymbolicLink());
  const directory = path.resolve('.next/standalone');
  assert.equal(realpathSync(directory), directory);
  const server = path.join(directory, 'server.js');
  assert(lstatSync(server).isFile() && !lstatSync(server).isSymbolicLink());
  const buildId = readFileSync('.next/BUILD_ID', 'utf8').trim();
  assert(buildId.length > 0 && buildId.length < 200);
  assert.equal(readFileSync(path.join(directory, '.next/BUILD_ID'), 'utf8').trim(), buildId);
  // This is the completed build already started by Playwright, not an alternative
  // build or existing server. No ambient application env files may be inherited.
  for (const root of [process.cwd(), directory]) for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
    try { lstatSync(path.join(root, name)); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    throw new Error('Unexpected application env file in the isolated browser fixture');
  }
  return { database, directory, server, buildId, serverSha: sha(readFileSync(server)) };
}

async function privateDirectory(directory: string) {
  try { await mkdir(directory, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  assert(lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink());
  assert.equal(realpathSync(directory), directory);
}

export async function startOwnerVersionFixture(info: TestInfo) {
  const owned = ownedRunner(info);
  // Follow the repository's existing E2E singleton policy, but do not even load
  // it until the inherited datasource is proven to be this fresh runner fixture.
  const { prisma: client } = await import('../../lib/prisma');
  assert.equal(process.env.DATABASE_URL, `file:${owned.database}`);
  // No spread of process.env: no production mail/AI/auth/database credentials,
  // upload settings, NODE_OPTIONS or proxy trust may reach this child.
  const child = spawn(process.execPath, [owned.server], {
    cwd: owned.directory, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, NODE_ENV: 'production',
      HOSTNAME: '127.0.0.1', PORT: '3101', NEXTAUTH_URL: OWNER_ENABLED_ORIGIN,
      NEXTAUTH_SECRET: 'e2e-secret-for-local-tests-only',
      BIVARO_SETUP_TOKEN: 'e2e-bootstrap-token-for-isolated-fixtures-only',
      DATABASE_URL: `file:${owned.database}`, NEXT_TELEMETRY_DISABLED: '1',
      BIVARO_INTERNAL_QUOTE_CAPTURE: '1',
    },
  });
  let exited = false, childError: Error | null = null;
  const finished = new Promise<void>(resolve => child.once('close', () => { exited = true; resolve(); }));
  child.on('error', error => { childError = error; });
  child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
  async function stop() {
    try {
      if (!exited) {
        child.kill('SIGTERM');
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([finished, new Promise<void>(resolve => { timer = setTimeout(resolve, 5_000); })]);
        if (timer) clearTimeout(timer);
        if (!exited) {
          child.kill('SIGKILL');
          let hardTimer: ReturnType<typeof setTimeout> | undefined;
          try { await Promise.race([finished, new Promise<never>((_, reject) => { hardTimer = setTimeout(() => reject(new Error('Owned child did not close after SIGKILL')), 2_000); })]); }
          finally { if (hardTimer) clearTimeout(hardTimer); }
        }
      }
    } finally { await client.$disconnect(); }
  }
  try {
    await new Promise<void>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => done(new Error('Owned enabled child did not become ready')), 40_000);
      const onExit = () => done(new Error('Owned enabled child exited before readiness; never reuse another listener'));
      const onError = (error: Error) => done(error);
      const onData = (chunk: Buffer) => {
        output = (output + chunk.toString('utf8')).slice(-8192);
        if (/Ready in\s+\d/u.test(output)) done();
      };
      function done(error?: Error) {
        clearTimeout(timer); child.stdout.off('data', onData); child.off('exit', onExit); child.off('error', onError);
        if (error) reject(error); else resolve();
      }
      child.stdout.on('data', onData); child.once('exit', onExit); child.once('error', onError);
      if (exited || childError) done(childError ?? new Error('Owned child already exited'));
    });
    assert.equal((await fetch(`${OWNER_ENABLED_ORIGIN}/login`, { redirect: 'error' })).status, 200);
  } catch (error) { await stop(); throw error; }
  function alive() {
    assert(!exited && !childError, 'The fixture-owned child must still own its listener');
    assert.equal(sha(readFileSync(owned.server)), owned.serverSha);
    assert.equal(readFileSync('.next/BUILD_ID', 'utf8').trim(), owned.buildId);
    assert.equal(process.env.DATABASE_URL, `file:${e2eDatabasePath()}`);
  }

  async function seed(label: string) {
    alive();
    const user = await client.user.create({ data: { email: `owner-version-${randomUUID()}@example.test`, name: 'Synthetic owner version', password: await hashPassword(PASSWORD), role: 'USER' } });
    const customer = await client.customer.create({ data: { userId: user.id, name: 'Synthetic frozen quote customer' } });
    const requestId = randomUUID(), storedFileName = `${randomUUID()}.pdf`;
    const data = { userId: user.id, customerId: customer.id, type: 'QUOTE', status: 'SENT', fileName: 'synthetic-owned-quote.pdf', storedFileName,
      invoiceNumber: label, invoiceDate: new Date('2026-10-01T00:00:00.000Z'), validUntil: new Date('2099-01-01T00:00:00.000Z'), totalAmount: 119,
      parsedData: { company: { name: 'Synthetic fixture seller' }, customer: { name: customer.name }, currency: 'EUR', items: [{ description: 'Synthetic fixture service', quantity: 1, unitPrice: 100, taxRate: 19 }] }, quoteCreateRequestId: requestId };
    // A genuine parseable PDF, not a header-only identity stub. The fixture, not
    // the production renderer, authors this synthetic modern quote/receipt graph.
    const pdf = await PDFDocument.create(); const page = pdf.addPage([595, 842]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (const [index, text] of [label, 'Synthetic fixture seller', customer.name, '2026-10-01', 'Synthetic fixture service: 1 x EUR 100.00 + 19% VAT', 'Total EUR 119.00', 'Valid until 2099-01-01'].entries()) page.drawText(text, { x: 45, y: 790 - index * 25, font, size: 12 });
    const bytes = await pdf.save(); assert(bytes.length > 500); assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
    await privateDirectory(path.join(owned.directory, 'data')); await privateDirectory(path.join(owned.directory, 'data/uploads'));
    const tenant = path.join(owned.directory, 'data/uploads', user.id); await mkdir(tenant, { mode: 0o700 }); assert.equal(realpathSync(tenant), tenant);
    const source = path.join(tenant, storedFileName);
    const file = await open(source, 'wx', 0o400); try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    const directory = await open(tenant, 'r'); try { await directory.sync(); } finally { await directory.close(); }
    const fingerprint = quoteCreateFingerprintForInvoice(data);
    const invoice = await client.$transaction(async tx => {
      const quote = await tx.invoice.create({ data: { ...data, quoteCreateFingerprint: fingerprint } });
      await tx.quoteCreateReceipt.create({ data: { userId: user.id, requestId, fingerprint, pdfSha256: sha(bytes), invoiceUserId: user.id, invoiceId: quote.id } });
      return quote;
    });
    const receipt = await client.quoteCreateReceipt.findUniqueOrThrow({ where: { userId_requestId: { userId: user.id, requestId } } });
    return { user, quote: invoice, customer, receipt, source, tenant, pdfSha: sha(bytes), password: PASSWORD };
  }
  type Seed = Awaited<ReturnType<typeof seed>>;
  async function unchangedSource(seed: Seed) {
    alive(); assert.deepEqual(await client.invoice.findUniqueOrThrow({ where: { id: seed.quote.id } }), seed.quote);
    assert.deepEqual(await client.customer.findUniqueOrThrow({ where: { id: seed.customer.id } }), seed.customer);
    assert.deepEqual(await client.quoteCreateReceipt.findUniqueOrThrow({ where: { userId_requestId: { userId: seed.user.id, requestId: seed.receipt.requestId } } }), seed.receipt);
    assert.equal(sha(await readFile(seed.source)), seed.pdfSha); assert.equal(lstatSync(seed.source).mode & 0o777, 0o400);
    assert.equal((await PDFDocument.load(await readFile(seed.source))).getPageCount(), 1);
  }
  async function financialCounts(userId: string) {
    alive(); const where = { userId };
    return Promise.all([client.income.count({ where }), client.expense.count({ where }), client.cashBook.count({ where }), client.cashTransaction.count({ where }),
      client.paymentJournalEvent.count({ where }), client.paymentAdjustment.count({ where }), client.paymentOperation.count({ where }),
      client.bankPaymentBinding.count({ where }), client.paymentAllocationChange.count({ where }), client.emailOutbox.count({ where }),
      client.emailOutboxAttempt.count({ where: { outbox: where } }), client.manualFinancialRecordEvent.count({ where }), client.invoiceNumberCounter.count({ where })]);
  }
  async function captureEvidence(seed: Seed) {
    alive();
    return { authorities: await client.quoteReleaseAuthority.findMany({ where: { userId: seed.user.id } }),
      releases: await client.quoteRelease.findMany({ where: { userId: seed.user.id }, orderBy: { generation: 'asc' } }),
      responses: await client.quoteElectronicResponse.findMany({ where: { userId: seed.user.id } }),
      audits: await client.auditLog.findMany({ where: { userId: seed.user.id, entityType: 'Quote' }, orderBy: { id: 'asc' } }) };
  }
  async function login(page: Page, seed: Seed, origin: string) {
    alive(); assert([OWNER_DEFAULT_ORIGIN, OWNER_ENABLED_ORIGIN].includes(origin));
    // Existing synthetic-fixture convention, scoped to this explicit fixture
    // client only. Production limiter/authentication code remains unchanged.
    const key = createHash('sha256').update('login:ip:untrusted-proxy').digest('hex');
    await client.rateLimitBucket.deleteMany({ where: { key } });
    await page.goto(`${origin}/login`);
    await page.getByLabel('E-Mail').fill(seed.user.email); await page.getByLabel('Passwort', { exact: true }).fill(seed.password);
    const session = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/session' && new URL(page.url()).pathname === '/dashboard');
    await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
    expect((await (await session).json()).user).toMatchObject({ id: seed.user.id, role: 'USER', sessionVersion: seed.user.sessionVersion });
    await page.goto(`${origin}/dashboard?tab=quotes`);
    await expect(page.getByRole('heading', { name: 'Ihre Angebote' })).toBeVisible();
  }
  return { client, alive, seed, login, unchangedSource, financialCounts, captureEvidence, stop };
}

export type OwnerVersionFixture = Awaited<ReturnType<typeof startOwnerVersionFixture>>;
export type OwnerVersionSeed = Awaited<ReturnType<OwnerVersionFixture['seed']>>;
