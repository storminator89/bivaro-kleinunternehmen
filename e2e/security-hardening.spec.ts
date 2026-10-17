import { expect, test } from '@playwright/test';
import http from 'node:http';
import { PDFDocument } from 'pdf-lib';

test('blocks forged mutations and script injection while registration, login and tenant mutations work', async ({ page }) => {
  const origin = 'http://127.0.0.1:3101';
  const payload = { email: 'security-admin@example.test', name: 'Security fixture', password: 'SyntheticPass123!', setupToken: 'security-e2e-bootstrap-fixture-only' };
  const oversized = await page.request.post('/api/auth/register', { data: { ...payload, padding: 'x'.repeat(17 * 1024) }, headers: { origin } });
  expect(oversized.status()).toBe(413);
  const chunkedStatus = await new Promise<number>(resolve => {
    const req = http.request(`${origin}/api/auth/register`, { method: 'POST', headers: { origin, 'content-type': 'application/json' } }, response => {
      response.resume(); resolve(response.statusCode!);
    });
    req.write('{"padding":"' + 'x'.repeat(17 * 1024)); req.end('"}');
  });
  expect(chunkedStatus).toBe(413);
  expect((await page.request.post('/api/auth/register', { data: payload, headers: { origin } })).status()).toBe(201);

  const loginPage = await page.goto('/login');
  const policy = loginPage!.headers()['content-security-policy'];
  expect(policy).toContain("'strict-dynamic'");
  expect(policy).not.toContain("'unsafe-eval'");
  expect(policy.match(/script-src ([^;]+)/)?.[1]).not.toContain("'unsafe-inline'");
  expect(loginPage!.headers()['x-powered-by']).toBeUndefined();
  const nonce = await page.locator('script[nonce]').first().evaluate(script => (script as HTMLScriptElement).nonce);
  expect(nonce).toBeTruthy();
  expect(policy).toContain(`'nonce-${nonce}'`);

  await page.getByLabel('E-Mail').fill(payload.email);
  await page.getByLabel('Passwort', { exact: true }).fill(payload.password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('heading', { name: 'Buchhaltung', level: 1 })).toBeVisible();
  const adminCount = (await (await page.request.get('/api/users')).json()).length;

  for (const hostileOrigin of ['http://evil.localhost:3101', 'http://127.0.0.1:3999', 'null']) {
    const forged = await page.request.post('/api/users', {
      headers: { origin: hostileOrigin, 'sec-fetch-site': 'same-site', 'content-type': 'text/plain' },
      data: JSON.stringify({ email: 'forged@example.test', password: payload.password, role: 'ADMIN' }),
    });
    expect(forged.status()).toBe(403);
  }
  const multipart = await page.request.post('/api/backup/full/restore?confirmOverwrite=true', {
    headers: { origin: 'http://evil.localhost:3101', 'sec-fetch-site': 'same-site' },
    multipart: { file: { name: 'fake.zip', mimeType: 'application/zip', buffer: Buffer.from('untrusted') } },
  });
  expect(multipart.status()).toBe(403);
  expect((await (await page.request.get('/api/users')).json()).length).toBe(adminCount);

  const create = await page.request.post('/api/customers', { headers: { origin }, data: { name: 'Legitimate customer' } });
  expect(create.ok()).toBe(true);
  const customers = await page.request.get('/api/customers');
  expect(customers.headers()['cache-control']).toContain('no-store');
  expect(customers.headers()['content-security-policy']).toContain("script-src 'none'");
  expect((await customers.json()).some((customer: { name: string }) => customer.name === 'Legitimate customer')).toBe(true);

  const pdfDocument = await PDFDocument.create();
  pdfDocument.addPage().drawText('Synthetic preview fixture');
  const quoteResponse = await page.request.post('/api/quotes', { headers: { origin }, data: {
    fileName: 'preview.pdf', parsedData: {}, pdfBytes: Buffer.from(await pdfDocument.save()).toString('base64'),
  } });
  expect(quoteResponse.ok()).toBe(true);
  const quote = await quoteResponse.json();
  try {
    const pdf = await page.request.get(`/api/invoices/download?id=${quote.id}`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toBe('application/pdf');
    expect(pdf.headers()['content-disposition']).toContain('inline');
    expect(pdf.headers()['content-security-policy']).not.toContain('sandbox');
    expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  } finally {
    expect((await page.request.delete(`/api/quotes?id=${quote.id}`, { headers: { origin } })).ok()).toBe(true);
  }

  // Inject at the HTML parser boundary. DevTools-created scripts can inherit
  // trust under strict-dynamic and do not model an untrusted HTML injection.
  await page.route('**/dashboard', async route => {
    const response = await route.fetch();
    const responseNonce = response.headers()['content-security-policy'].match(/'nonce-([^']+)'/)![1];
    const body = (await response.text()).replace('</body>',
      `<script nonce="${responseNonce}">window.__trustedScriptExecuted = true</script>` +
      '<script>window.__untrustedScriptExecuted = true</script></body>');
    await route.fulfill({ response, body });
  });
  const nextPage = await page.reload();
  expect(await page.evaluate(() => '__trustedScriptExecuted' in window)).toBe(true);
  expect(await page.evaluate(() => '__untrustedScriptExecuted' in window)).toBe(false);
  expect(nextPage!.headers()['content-security-policy']).not.toContain(`'nonce-${nonce}'`);
  expect((await page.request.get('/uploads/legacy.pdf')).status()).toBe(404);
});
