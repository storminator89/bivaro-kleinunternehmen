/** Trusted synthetic fixture only: prebuilt REAL production app, real PDF.js
 * launcher and bounded loopback provider. No route/renderer interception.
 * Run only in the non-root production-derived image with network=none.
 */
import { createServer } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { e2eDatabasePath } from '../e2e-fixture.mjs';

assert.equal(process.env.BIVARO_AI_BROWSER_FIXTURE, '1');
assert.equal(process.platform, 'linux');
assert.notEqual(process.getuid(), 0);
assert.equal(process.cwd(), '/test-tools');
assert.equal(process.env.NODE_PATH, undefined);
assert.equal(process.env.NODE_OPTIONS, undefined);
const database = e2eDatabasePath();
await promisify(execFile)(process.execPath, ['scripts/prepare-e2e.mjs'], { env: { ...process.env, DATABASE_URL: `file:${database}` } });
const stats = { calls: 0, imageCounts: [], centers: [] };
const provider = createServer({ requestTimeout: 10_000, headersTimeout: 5_000, maxHeaderSize: 16 * 1024 }, async (request, response) => {
  const reply = (status, data) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(data)); };
  if (request.method === 'GET' && request.url === '/stats') return reply(200, stats);
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') return reply(404, {});
  stats.calls++; // Count every dispatch, even a subsequently rejected request.
  try {
    assert(stats.calls <= 4);
    assert.equal(request.headers.authorization, 'Bearer synthetic-ai-browser-key-not-a-real-credential');
    let size = 0; const chunks = [];
    for await (const chunk of request) {
      size += chunk.length; assert(size <= 12 * 1024 * 1024); chunks.push(chunk);
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.equal(payload.model, 'synthetic-browser-vision');
    assert.equal(payload.stream, false); assert.equal(payload.store, false);
    const images = payload.messages.flatMap(message => Array.isArray(message.content) ? message.content.filter(part => part.type === 'image_url') : []);
    assert(images.length >= 1 && images.length <= 4);
    const centers = [];
    for (const image of images) {
      assert.match(image.image_url.url, /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/u);
      const bytes = Buffer.from(image.image_url.url.split(',')[1], 'base64');
      assert(bytes.length > 500 && bytes.length <= 2 * 1024 * 1024);
      const metadata = await sharp(bytes, { limitInputPixels: 4_010_000 }).metadata();
      assert(metadata.width > 0 && metadata.height > 0 && metadata.width <= 2200 && metadata.height <= 2200);
      centers.push([...await sharp(bytes, { limitInputPixels: 4_010_000 }).extract({ left: Math.floor(metadata.width / 2), top: Math.floor(metadata.height / 2), width: 1, height: 1 }).removeAlpha().raw().toBuffer()]);
    }
    stats.imageCounts.push(images.length); stats.centers.push(centers);
    const receipt = { supplierName: 'Synthetic PDF Supplier', invoiceNumber: 'AI-NATIVE-4', invoiceDate: '2026-10-21', currency: 'EUR', documentType: 'INVOICE', grossAmount: '0.29', netAmount: null, taxAmount: null, lineItemsComplete: true, lineItems: [{ description: 'Synthetic PDF receipt', quantity: '1', unitPrice: '0.29', amount: '0.29', taxRate: null }] };
    reply(200, { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(receipt) } }] });
  } catch { reply(400, { error: 'Synthetic provider fixture rejected its bounded contract' }); }
});
provider.maxConnections = 8; provider.keepAliveTimeout = 1_000; provider.maxHeadersCount = 32;
await new Promise((resolve, reject) => { provider.once('error', reject); provider.listen(3200, '127.0.0.1', resolve); });
const child = spawn(process.execPath, ['/app/server.js'], { cwd: '/app', stdio: 'inherit', env: {
  PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', NODE_ENV: 'production',
  LANG: 'C.UTF-8', NEXT_TELEMETRY_DISABLED: '1', CHECKPOINT_DISABLE: '1',
  DATABASE_URL: `file:${database}`, HOSTNAME: '127.0.0.1', PORT: '3100',
  NEXTAUTH_URL: 'http://127.0.0.1:3100', NEXTAUTH_SECRET: 'synthetic-ai-browser-fixture-secret-not-for-production',
  BIVARO_AI_PRIVATE_BASE_URLS: '["http://127.0.0.1:3200/v1"]',
} });
const stop = signal => child.kill(signal);
const interrupt = () => stop('SIGINT'), terminate = () => stop('SIGTERM');
process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
try {
  const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
  process.exitCode = result.signal ? 1 : result.code ?? 1;
} finally {
  process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
  provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve));
}
