#!/usr/bin/env node
/**
 * Mounted read-only into a fresh non-root, --network=none production container.
 * Run only after container-runtime-smoke.sh has migrated the exact /tmp fixture
 * and started the actual standalone server. No mocks, financial upload/issuance,
 * external requests, provider configuration, or alternative verifier are used.
 * Missing prerequisites and every unexpected response fail; nothing is skipped.
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, mkdir, open, readFile, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const ORIGIN = 'http://127.0.0.1:3000';
const DATABASE_URL = 'file:/tmp/bivaro-container-smoke.db';
const DATABASE_PATH = '/tmp/bivaro-container-smoke.db';
const EVIDENCE_DIRECTORY = '/tmp/bivaro-own-invoice-container-smoke';
const SYNTHETIC_BOOTSTRAP = 'synthetic-container-smoke-bootstrap-117';
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const platform = { platform: process.platform, architecture: process.arch, node: process.version };
const permittedPaths = new Set([
  '/api/auth/register', '/api/auth/csrf', '/api/auth/callback/credentials',
  '/api/auth/session', '/api/settings', '/api/settings/upload-logo',
  '/api/files/logo', '/api/invoices/render',
]);
let stage = 'prerequisites';
let prisma;
let evidenceCreated = false;
let before;

// Cookie values live in memory only. Handle NextAuth's chunked session cookies
// without following redirects or ever serializing/logging authentication data.
class CookieJar {
  #cookies = new Map();

  receive(headers) {
    assert(typeof headers.getSetCookie === 'function', 'Separate Set-Cookie headers are required.');
    const lines = headers.getSetCookie();
    assert(lines.length <= 32, 'Too many response cookies.');
    for (const line of lines) {
      assert(line.length <= 16_384, 'A response cookie exceeded its bound.');
      const [pair, ...attributes] = line.split(';');
      const separator = pair.indexOf('=');
      assert(separator > 0, 'Malformed response cookie.');
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      assert(/^[A-Za-z0-9_.-]+$/u.test(name), 'Unexpected cookie name.');
      assert(/^[\x21-\x3a\x3c-\x7e]*$/u.test(value), 'Unexpected cookie value.');
      let path = '/';
      let expires = Infinity;
      let maxAge;
      for (const attribute of attributes) {
        const index = attribute.indexOf('=');
        const key = (index < 0 ? attribute : attribute.slice(0, index)).trim().toLowerCase();
        const candidate = index < 0 ? '' : attribute.slice(index + 1).trim();
        if (key === 'domain') assert(candidate === '127.0.0.1', 'A cookie escaped loopback.');
        if (key === 'secure') assert.fail('Secure cookies cannot authenticate the HTTP fixture.');
        if (key === 'path') {
          assert(candidate.startsWith('/') && !candidate.includes(';'), 'Invalid cookie path.');
          path = candidate;
        }
        if (key === 'expires') {
          expires = Date.parse(candidate);
          assert(Number.isFinite(expires), 'Invalid cookie expiration.');
        }
        if (key === 'max-age') {
          assert(/^-?\d+$/u.test(candidate), 'Invalid cookie lifetime.');
          maxAge = Number(candidate);
          assert(Number.isSafeInteger(maxAge), 'Invalid cookie lifetime.');
        }
      }
      if (maxAge !== undefined) expires = maxAge <= 0 ? 0 : Date.now() + maxAge * 1000;
      const key = `${path}\n${name}`;
      if (!value || expires <= Date.now()) this.#cookies.delete(key);
      else this.#cookies.set(key, { name, value, path, expires });
    }
    assert(this.#cookies.size <= 32, 'The cookie jar exceeded its bound.');
  }

  header(pathname) {
    return [...this.#cookies.values()]
      .filter(cookie => cookie.expires > Date.now() && (cookie.path === '/'
        || pathname === cookie.path || pathname.startsWith(`${cookie.path.replace(/\/$/u, '')}/`)))
      .sort((left, right) => right.path.length - left.path.length)
      .map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
  }

  clear() { this.#cookies.clear(); }
}

const cookies = new CookieJar();
const deadline = AbortSignal.timeout(180_000);

async function localRequest(path, { method = 'GET', body, contentType, maxBytes = 64 * 1024, timeout = 15_000 } = {}) {
  const url = new URL(path, ORIGIN);
  assert(url.origin === ORIGIN && !url.username && !url.password && !url.hash, 'Only loopback requests are allowed.');
  assert(permittedPaths.has(url.pathname), 'The route is outside the smoke contract.');
  assert(method === 'GET' || method === 'POST', 'Unsupported smoke request method.');
  assert(url.pathname === '/api/files/logo' || !url.search, 'Unexpected query parameters.');
  if (typeof body === 'string') assert(Buffer.byteLength(body) <= 512 * 1024, 'Request exceeded its bound.');
  const headers = { Accept: '*/*', Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin' };
  const cookie = cookies.header(url.pathname);
  if (cookie) headers.Cookie = cookie;
  if (contentType) headers['Content-Type'] = contentType;
  const response = await fetch(url, {
    method, headers, body, redirect: 'error', cache: 'no-store',
    signal: AbortSignal.any([deadline, AbortSignal.timeout(timeout)]),
  });
  assert(response.url === url.href, 'An unexpected redirect occurred.');
  cookies.receive(response.headers);
  const declared = response.headers.get('content-length');
  if (declared !== null) assert(/^\d+$/u.test(declared) && Number(declared) <= maxBytes, 'Response exceeded its bound.');
  assert(response.body, 'The response body is missing.');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    assert(size <= maxBytes, 'Response exceeded its bound.');
    chunks.push(Buffer.from(chunk));
  }
  return { status: response.status, headers: response.headers, bytes: Buffer.concat(chunks, size) };
}

async function jsonRequest(path, body) {
  const response = await localRequest(path, body === undefined ? {} : {
    method: 'POST', body: JSON.stringify(body), contentType: 'application/json',
  });
  assert(response.headers.get('content-type')?.split(';')[0] === 'application/json', 'Expected a JSON response.');
  return { ...response, json: JSON.parse(response.bytes.toString('utf8')) };
}

async function financialSnapshot(userId) {
  const where = userId === undefined ? {} : { userId };
  const queries = {
    invoices: prisma.invoice.count({ where }),
    counters: prisma.invoiceNumberCounter.count({ where }),
    incomes: prisma.income.count({ where }),
    expenses: prisma.expense.count({ where }),
    payments: prisma.paymentJournalEvent.count({ where }),
    paymentAdjustments: prisma.paymentAdjustment.count({ where }),
    paymentOperations: prisma.paymentOperation.count({ where }),
    cash: prisma.cashTransaction.count({ where }),
    cashBooks: prisma.cashBook.count({ where }),
    outbox: prisma.emailOutbox.count({ where }),
    outboxAttempts: prisma.emailOutboxAttempt.count({ where: { outbox: where } }),
    customers: prisma.customer.count({ where }),
    purchaseDocuments: prisma.purchaseDocument.count({ where }),
  };
  const counts = await prisma.$transaction(Object.values(queries));
  return Object.fromEntries(Object.keys(queries).map((key, index) => [key, counts[index]]));
}

// BEGIN isolated runtime-notice inspection (unit tests extract only this function).
export async function inspectRuntimeNotices(appRoot, veraRoot, expected = {
  pdfkit: '5f0d5197d2b5d91f41de43143b0be42fb55515bc2b894f2a9b62de9f7056c0f8',
  font: 'f32df582a2aab128c07b2f7e36e7b928dc5f6bd82657b905c04f91459f9e5cf9',
  cli: '19f6edd5c92841a38d9b3b018a555b7ba173b13e4e0d29edecc232e5ba6c1d70',
  applicationLicense: 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
  supplemental: '71796ff2cb5d48582356a0020a1f7cb4de100e20c020e67827611819ac081553',
}) {
  // Expected digests are injectable only for synthetic unit files. The actual
  // container invocation below passes fixed image roots and no overrides.
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const roots = [appRoot, veraRoot].map(root => path.resolve(root));
  for (const root of roots) {
    assert((await lstat(root)).isDirectory() && await realpath(root) === root, 'Unsafe notice root.');
  }
  async function read(root, relative, maximum = 512 * 1024) {
    assert(typeof relative === 'string' && relative.length <= 1024 && !path.isAbsolute(relative)
      && !relative.includes('\\') && !relative.includes('\0')
      && relative.split('/').every(part => part && part !== '.' && part !== '..'), 'Unsafe notice path.');
    let target = root;
    const parts = relative.split('/');
    for (const [index, part] of parts.entries()) {
      target = path.join(target, part);
      const info = await lstat(target);
      assert(!info.isSymbolicLink(), 'Notice symlink traversal is forbidden.');
      assert(index === parts.length - 1 ? info.isFile() : info.isDirectory(), 'Notice path is not regular.');
    }
    assert(await realpath(target) === target && target.startsWith(root + path.sep), 'Notice escaped its root.');
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      assert(info.isFile() && info.size > 0 && info.size <= maximum, 'Notice file exceeded its bound.');
      const bytes = Buffer.alloc(info.size + 1);
      let length = 0;
      while (length < bytes.length) {
        const result = await handle.read(bytes, length, bytes.length - length, null);
        if (!result.bytesRead) break;
        length += result.bytesRead;
      }
      assert(length === info.size, 'Notice file changed while reading.');
      return bytes.subarray(0, length);
    } finally { await handle.close(); }
  }
  const [app, vera] = roots;
  const appSources = await read(app, 'THIRD_PARTY_SOURCES.json');
  const appNotice = await read(app, 'THIRD_PARTY_NOTICES.txt');
  const npm = JSON.parse(appSources);
  assert(npm.schemaVersion === 1 && npm.roots.pdfkit === '0.20.2' && npm.roots.fontkit === '2.0.4'
    && npm.roots['pdfjs-dist'] === '6.4.299', 'Wrong PDF notice versions.');
  const applicationLicense = await read(app, 'LICENSE');
  assert(npm.application?.declaredLicense === 'Apache-2.0' && npm.application.file === 'LICENSE'
    && npm.application.sha256 === expected.applicationLicense && hash(applicationLicense) === expected.applicationLicense, 'Application license changed or missing.');
  assert(npm.supplemental?.file === 'licenses/third-party-sources.json' && npm.supplemental.sha256 === expected.supplemental, 'Wrong recovered-notice manifest.');
  const recoveredBytes = await read(app, npm.supplemental.file);
  assert(hash(recoveredBytes) === expected.supplemental, 'Recovered-notice manifest changed.');
  const recovered = JSON.parse(recoveredBytes);
  assert(recovered.schemaVersion === 1 && Array.isArray(recovered.files) && recovered.files.length > 0 && recovered.files.length <= 128
    && Array.isArray(recovered.verifiedRuntimeFiles) && recovered.verifiedRuntimeFiles.length <= 32
    && Array.isArray(recovered.limitations) && recovered.limitations.length > 0, 'Invalid recovered-notice inventory.');
  const recoveredPaths = new Set();
  for (const item of [...recovered.files, ...recovered.verifiedRuntimeFiles]) {
    const prefix = recovered.files.includes(item) ? 'licenses/' : 'node_modules/';
    assert(typeof item.file === 'string' && item.file.startsWith(prefix) && !recoveredPaths.has(item.file), 'Unsafe recovered-notice path.');
    assert(/^[a-f0-9]{64}$/u.test(item.sha256) && hash(await read(app, item.file, 2 * 1024 * 1024)) === item.sha256, 'Recovered-notice/runtime hash mismatch.');
    recoveredPaths.add(item.file);
  }
  assert(npm.supplemental.noticeFiles === recovered.files.length && npm.supplemental.verifiedRuntimeFiles === recovered.verifiedRuntimeFiles.length, 'Recovered-notice counts mismatch.');
  assert(Array.isArray(npm.packages) && npm.packages.length > 0 && npm.packages.length <= 128, 'Invalid npm notice inventory.');
  let npmNoticeFiles = 0;
  for (const item of npm.packages) {
    assert(typeof item.metadata === 'string' && item.metadata.startsWith('licenses/npm/'), 'Unsafe npm metadata path.');
    const metadata = JSON.parse(await read(app, item.metadata));
    assert(metadata.name === item.name && metadata.version === item.version, 'Copied npm metadata mismatch.');
    assert(Array.isArray(item.notices) && item.notices.length <= 32, 'Invalid npm notice list.');
    for (const notice of item.notices) {
      assert(typeof notice.file === 'string' && notice.file.startsWith('licenses/npm/'), 'Unsafe npm notice path.');
      assert(/^[a-f0-9]{64}$/u.test(notice.sha256) && hash(await read(app, notice.file)) === notice.sha256, 'Recorded npm notice hash mismatch.');
      npmNoticeFiles++;
    }
  }
  assert(hash(await read(app, 'licenses/npm/pdfkit/LICENSE')) === expected.pdfkit, 'PDFKit license changed.');
  const pdfjsPackages = npm.packages.filter(item => item.name === 'pdfjs-dist' && item.version === '6.4.299');
  const pdfjsNotices = ['LICENSE', 'cmaps/LICENSE', 'iccs/LICENSE', 'standard_fonts/LICENSE_FOXIT', 'standard_fonts/LICENSE_LIBERATION',
    ...['JBIG2', 'OPENJPEG', 'PDFJS_JBIG2', 'PDFJS_OPENJPEG', 'PDFJS_QCMS', 'QCMS'].map(name => `wasm/LICENSE_${name}`)]
    .map(file => `licenses/npm/pdfjs-dist/${file}`).sort();
  assert(pdfjsPackages.length === 1 && pdfjsPackages[0].metadata === 'licenses/npm/pdfjs-dist/package.json', 'Missing PDF.js notice package.');
  assert.deepEqual(pdfjsPackages[0].notices.map(item => item.file).sort(), pdfjsNotices, 'Incomplete PDF.js separate-resource notices.');
  const fontkit = npm.packages.find(item => item.name === 'fontkit' && item.version === '2.0.4');
  const fontkitMetadata = JSON.parse(await read(app, 'licenses/npm/fontkit/package.json'));
  assert(fontkit && fontkitMetadata.license === 'MIT' && fontkit.notices.length === 0 && fontkit.limitations.length > 0
    && appNotice.toString('utf8').includes('attribution remains unresolved'), 'Missing fontkit attribution limit.');
  const font = await read(app, 'licenses/invoice-fonts/FONT-LICENSE.txt');
  assert(hash(font) === expected.font && hash(await read(app, 'public/fonts/invoice/FONT-LICENSE.txt')) === expected.font, 'Original OFL notice changed.');
  const veraSources = await read(vera, 'THIRD_PARTY_SOURCES.json');
  const veraNotice = await read(vera, 'THIRD-PARTY-NOTICES.txt');
  const verifier = JSON.parse(veraSources);
  assert(verifier.schemaVersion === 1 && verifier.veraPDF.version === '1.30.3'
    && verifier.veraPDF.binary === 'bin/cli-1.30.3.jar' && verifier.veraPDF.binarySha256 === expected.cli
    && verifier.veraPDF.selectedLicense === 'MPL-2.0 for dual-licensed veraPDF components, not the entire shaded JAR'
    && verifier.veraPDF.license === 'licenses/MPL-2.0.txt', 'Wrong veraPDF notice/version selection.');
  const cliHash = hash(await read(vera, verifier.veraPDF.binary, 64 * 1024 * 1024));
  assert(cliHash === expected.cli, 'Pinned veraPDF CLI hash mismatch.');
  assert(Array.isArray(verifier.copiedFiles) && verifier.copiedFiles.length > 0 && verifier.copiedFiles.length <= 256, 'Invalid embedded notice inventory.');
  for (const file of verifier.copiedFiles) {
    assert(typeof file.file === 'string' && file.file.startsWith('licenses/'), 'Unsafe embedded notice path.');
    assert(/^[a-f0-9]{64}$/u.test(file.sha256) && hash(await read(vera, file.file)) === file.sha256, 'Embedded notice hash mismatch.');
  }
  assert(['licenses/MPL-2.0.txt', 'licenses/GPL-3.0.txt'].every(file => verifier.copiedFiles.some(item => item.file === file)), 'Missing upstream license texts.');
  const modules = ['org.verapdf.apps:apps', 'org.verapdf.apps:cli', ...['core', 'feature-reporting', 'metadata-fixer', 'parser', 'pdf-model', 'validation-model', 'verapdf-xmp-core'].map(name => `org.verapdf:${name}`)].sort();
  assert(Array.isArray(verifier.artifacts) && verifier.artifacts.length <= 128, 'Invalid Maven inventory.');
  const sources = verifier.artifacts.filter(item => item.sourceArtifact);
  assert.deepEqual(sources.map(item => `${item.groupId}:${item.artifactId}`).sort(), modules, 'Incomplete veraPDF source mappings.');
  for (const item of sources) {
    assert(item.version === '1.30.3' && item.sourceArtifact === `https://repo.maven.apache.org/maven2/${item.groupId.replaceAll('.', '/')}/${item.artifactId}/1.30.3/${item.artifactId}-1.30.3-sources.jar`
      && item.selectedLicense === (item.artifactId === 'verapdf-xmp-core' ? null : 'MPL-2.0'), 'Wrong module source/license mapping.');
  }
  assert(verifier.artifacts.filter(item => !item.sourceArtifact).every(item => item.selectedLicense === null), 'MPL must not be applied to separate dependencies.');
  assert(npm.scope.includes('not an application/container SBOM') && npm.limitations.length > 0
    && verifier.scope.includes('incomplete inventory') && verifier.limitations.length > 0, 'Audit limits were omitted.');
  return { status: 'passed', npmPackages: npm.packages.length, npmNoticeFiles, recoveredNoticeFiles: recovered.files.length,
    verifiedRuntimeFiles: recovered.verifiedRuntimeFiles.length, supplementalSha256: hash(recoveredBytes), applicationLicenseSha256: hash(applicationLicense), veraCopiedFiles: verifier.copiedFiles.length,
    veraSourceModules: sources.length, appSourcesSha256: hash(appSources), appNoticeSha256: hash(appNotice),
    veraSourcesSha256: hash(veraSources), veraNoticeSha256: hash(veraNotice), originalFontNoticeSha256: hash(font),
    cliSha256: cliHash, explicitAuditLimitsRetained: true };
}
// END isolated runtime-notice inspection.

async function main() {
  assert(process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() !== 0,
    'A non-root Linux container is mandatory.');
  assert(process.env.DATABASE_URL === DATABASE_URL, 'The exact temporary database must be explicit.');
  assert(process.env.NEXTAUTH_URL === ORIGIN && process.env.NODE_ENV === 'production', 'The production loopback fixture is required.');
  assert(process.env.BIVARO_SETUP_TOKEN === SYNTHETIC_BOOTSTRAP, 'The isolated bootstrap prerequisite is missing.');
  assert(!process.env.BIVARO_VERAPDF_BIN || process.env.BIVARO_VERAPDF_BIN === '/opt/verapdf/verapdf', 'An alternative verifier is forbidden.');
  const databaseStat = await lstat(DATABASE_PATH);
  assert(databaseStat.isFile() && !databaseStat.isSymbolicLink() && databaseStat.uid === process.getuid(),
    'The migrated fixture must be an owned regular file.');
  assert(await realpath(DATABASE_PATH) === DATABASE_PATH, 'The fixture must not resolve elsewhere.');
  await access('/opt/verapdf/verapdf', constants.X_OK);
  for (const font of ['BivaroSans-Regular.ttf', 'BivaroSans-Bold.ttf']) {
    assert((await readFile(`/app/public/fonts/invoice/${font}`)).length > 100_000, 'A production invoice font is missing.');
  }
  await mkdir(EVIDENCE_DIRECTORY, { mode: 0o700 });
  evidenceCreated = true;

  stage = 'read-only-image-notices';
  const runtimeNotices = await inspectRuntimeNotices('/app', '/opt/verapdf');

  // Native decoder, authentication and database packages come from production.
  // Next bundles pdf-lib/qrcode; independent inspection uses the separately
  // mounted, locked read-only test dependencies without changing NODE_PATH or
  // substituting any dependency used by the actual standalone server.
  const require = createRequire('/app/package.json');
  const inspectionRequire = createRequire('/tmp/own-invoice-test/fixture.cjs');
  const { PrismaClient } = require('@prisma/client');
  const bcrypt = require('bcrypt');
  assert(typeof bcrypt.hash === 'function' && typeof bcrypt.compare === 'function', 'The traced bcrypt package is absent.');
  // All password operations remain centralized in lib/password.ts through the
  // ordinary registration/login handlers; this script never calls bcrypt.
  const sharp = require('sharp');
  const QRCode = inspectionRequire('qrcode');
  const { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFString } = inspectionRequire('pdf-lib');
  prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } }, log: [] });
  assert(await prisma.user.count() === 0 && await prisma.settings.count() === 0, 'Only a fresh empty-user fixture is allowed.');
  const empty = await financialSnapshot(undefined);
  assert(Object.values(empty).every(count => count === 0), 'Existing business data is forbidden.');

  stage = 'ordinary-registration-and-login';
  const email = `synthetic-container-${randomUUID()}@example.test`;
  const password = `Synthetic117-${randomBytes(18).toString('hex')}!`;
  const registration = await jsonRequest('/api/auth/register', {
    email, password, name: 'Synthetic container issuer', setupToken: process.env.BIVARO_SETUP_TOKEN,
  });
  assert(registration.status === 201 && typeof registration.json?.user?.id === 'string', 'Ordinary registration failed.');
  const userId = registration.json.user.id;
  const ownedUser = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true } });
  assert(ownedUser?.id === userId && ownedUser.role === 'ADMIN', 'Registration did not use the same fresh fixture.');
  assert(await prisma.user.count() === 1, 'The fixture must contain only its synthetic account.');
  const csrf = await jsonRequest('/api/auth/csrf');
  assert(csrf.status === 200 && typeof csrf.json?.csrfToken === 'string' && /^[a-f0-9]{64}$/u.test(csrf.json.csrfToken),
    'The ordinary NextAuth CSRF exchange failed.');
  const login = await localRequest('/api/auth/callback/credentials', {
    method: 'POST', contentType: 'application/x-www-form-urlencoded',
    body: new URLSearchParams({ csrfToken: csrf.json.csrfToken, email, password, callbackUrl: `${ORIGIN}/dashboard`, json: 'true' }).toString(),
  });
  assert(login.status === 200 && login.headers.get('content-type')?.split(';')[0] === 'application/json', 'Ordinary credentials login failed.');
  const loginUrl = new URL(JSON.parse(login.bytes.toString('utf8')).url);
  assert(loginUrl.origin === ORIGIN && loginUrl.pathname === '/dashboard' && !loginUrl.search, 'Credentials login was not successful.');
  const session = await jsonRequest('/api/auth/session');
  assert(session.status === 200 && session.json?.user?.id === userId && session.json.user.role === ownedUser.role,
    'A normal authenticated session is required.');

  stage = 'owned-settings-and-alpha-logo';
  const settings = {
    companyName: 'Synthetic container issuer', companyAddress: 'Synthetic Road 1\n10115 Berlin',
    taxNumber: '123/456/78901', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX',
    bankName: 'Synthetic bank', footerText: 'Only isolated synthetic container data',
    email: 'issuer@example.test', telephone: '+49 000 000',
  };
  const savedSettings = await jsonRequest('/api/settings', {
    ...settings, fiscalTaxRegime: 'STANDARD', fiscalEffectiveFrom: '2020-01-01',
  });
  assert(savedSettings.status === 200 && savedSettings.json?.userId === userId
    && savedSettings.json.fiscalTaxRegime === 'STANDARD'
    && savedSettings.json.fiscalEffectiveFrom === '2020-01-01'
    && Number.isFinite(Date.parse(savedSettings.json.fiscalConfirmedAt)), 'Confirmed STANDARD fixture settings are required.');
  assert(Object.entries(settings).every(([key, value]) => savedSettings.json[key] === value),
    'The complete synthetic company/bank profile was not persisted.');
  const alphaLogo = await sharp({ create: {
    width: 96, height: 48, channels: 4, background: { r: 30, g: 90, b: 150, alpha: 0.5 },
  } }).png().toBuffer();
  assert(alphaLogo.length > 0 && alphaLogo.length < 64 * 1024 && (await sharp(alphaLogo).metadata()).hasAlpha,
    'A fresh ordinary alpha PNG is required.');
  const form = new FormData();
  form.append('file', new Blob([alphaLogo], { type: 'image/png' }), 'synthetic-alpha.png');
  const upload = await localRequest('/api/settings/upload-logo', { method: 'POST', body: form });
  assert(upload.status === 200 && upload.headers.get('content-type')?.split(';')[0] === 'application/json', 'The tenant logo upload failed.');
  const logoUrl = JSON.parse(upload.bytes.toString('utf8')).url;
  assert(typeof logoUrl === 'string' && /^\/api\/files\/logo\?file=[a-f0-9-]{36}\.png$/u.test(logoUrl), 'Unexpected tenant logo reference.');
  const linkedLogo = await jsonRequest('/api/settings', { logoUrl });
  assert(linkedLogo.status === 200 && linkedLogo.json?.userId === userId && linkedLogo.json.logoUrl === logoUrl
    && linkedLogo.json.fiscalTaxRegime === 'STANDARD', 'Only the owned fixture logo may be linked.');
  assert(Object.entries(settings).every(([key, value]) => linkedLogo.json[key] === value)
    && linkedLogo.json.fiscalConfirmedAt === savedSettings.json.fiscalConfirmedAt,
    'Linking the owned logo must not change the company or fiscal profile.');
  const originalLogo = await localRequest(logoUrl, { maxBytes: 64 * 1024 });
  assert(originalLogo.status === 200 && originalLogo.headers.get('content-type') === 'image/png'
    && sha256(originalLogo.bytes) === sha256(alphaLogo), 'The original logo GET must preserve uploaded bytes.');

  stage = 'authenticated-preview-and-final';
  const invoiceNumber = `CONTAINER117-${randomUUID().slice(0, 8)}`;
  /** @type {import('../../lib/own-invoice-source').OwnInvoiceSource} */
  const source = {
    version: 1, invoiceNumber, date: '2026-10-22', dueDate: '2026-11-05', deliveryDate: '2026-10-21',
    customerAddress: 'Synthetic container buyer\nBuyer Road 2\n10115 Berlin', customerId: 'SYNTHETIC-117',
    buyerReference: 'SYNTHETIC-CONTAINER-117', buyerCountry: 'DE', buyerPostcode: '', buyerCity: '', buyerEmail: 'buyer@example.test',
    sellerCountry: 'DE', sellerPostcode: '', sellerCity: '', taxMode: 'standard', settings,
    items: Array.from({ length: 30 }, (_, index) => ({
      description: `Synthetic line ${index + 1}: complete searchable description with Ä Ö Ü ß and €. `
        + 'Only isolated invoice rendering data; no issued financial record. '.repeat(2),
      quantity: 1, unitPrice: 10, unit: 'Stück', taxRate: index % 2 === 0 ? 19 : 7, taxCategory: 'S',
    })),
    notes: Array.from({ length: 30 }, (_, index) => `Synthetic continuation ${index + 1}: complete notes with Ä Ö Ü ß and €.`).join('\n'),
    includeQRCode: true, paymentMeansCode: '30',
  };
  // The endpoint applies current lib/own-invoice-source.ts's strict parser.
  // This deliberately contains source data only, no assets/paths/PDF programs.
  const sourceJson = JSON.stringify(source);
  assert(Buffer.byteLength(sourceJson) < 512 * 1024 && source.items.length === 30, 'Unexpected source fixture.');
  before = await financialSnapshot(userId);
  assert(Object.values(before).every(count => count === 0), 'The synthetic tenant must have no financial records.');
  const render = async preview => {
    const response = await localRequest('/api/invoices/render', {
      method: 'POST', contentType: 'application/json', body: JSON.stringify({ source, preview }),
      maxBytes: MAX_PDF_BYTES, timeout: 90_000,
    });
    assert(response.status === 200 && response.headers.get('content-type') === 'application/pdf', 'Actual invoice rendering did not return a PDF.');
    assert(response.headers.get('cache-control')?.includes('no-store') && response.bytes.subarray(0, 5).toString('ascii') === '%PDF-', 'Invalid PDF response contract.');
    return response.bytes;
  };
  const previewBytes = await render(true);
  assert.deepEqual(await financialSnapshot(userId), before, 'Preview changed financial state.');
  // Final 200 is impossible without production's mandatory official, pinned
  // veraPDF 1.30.3 gate over these exact post-attachment response bytes.
  const finalBytes = await render(false);
  await writeFile(`${EVIDENCE_DIRECTORY}/final.pdf`, finalBytes, { flag: 'wx', mode: 0o600 });
  const after = await financialSnapshot(userId);
  assert.deepEqual(after, before, 'Final rendering changed financial state.');
  assert(JSON.stringify(source) === sourceJson, 'Source data changed.');

  stage = 'maintained-library-final-byte-inspection';
  const previewPdf = await PDFDocument.load(previewBytes, { updateMetadata: false });
  const finalPdf = await PDFDocument.load(finalBytes, { updateMetadata: false });
  const rawStream = value => {
    assert(value instanceof PDFRawStream, 'A required PDF stream is missing.');
    return value;
  };
  const pageContent = pdf => pdf.getPages().map(page => {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map(ref => rawStream(pdf.context.lookup(ref)))
      : contents instanceof PDFRawStream ? [contents] : [];
    assert(streams.length > 0, 'A page has no readable content stream.');
    return streams.map(stream => sha256(decodePDFRawStream(stream).decode()));
  });
  assert(finalPdf.getPageCount() > 2 && finalPdf.getPageCount() === previewPdf.getPageCount(), 'The fixture must remain multipage.');
  assert.deepEqual(pageContent(finalPdf), pageContent(previewPdf), 'Preview and final page streams differ.');
  assert(!previewPdf.catalog.has(PDFName.of('AF')), 'Preview unexpectedly attached invoice XML.');
  assert(finalPdf.getTitle() === `Rechnung ${invoiceNumber}`, 'The final invoice number is missing.');
  const associated = finalPdf.catalog.lookup(PDFName.of('AF'), PDFArray);
  assert(associated.size() === 1, 'Exactly one associated XML file is required.');
  const file = associated.lookup(0, PDFDict);
  assert(file.lookup(PDFName.of('AFRelationship'), PDFName).toString() === '/Alternative', 'Unexpected attachment relationship.');
  assert(file.lookup(PDFName.of('F'), PDFString).decodeText() === 'factur-x.xml', 'The invoice XML attachment is missing.');
  const xmlBytes = Buffer.from(decodePDFRawStream(rawStream(file.lookup(PDFName.of('EF'), PDFDict).lookup(PDFName.of('F')))).decode());
  const xml = xmlBytes.toString('utf8');
  assert(xmlBytes.length > 0 && xmlBytes.length <= 512 * 1024 && !/<!DOCTYPE|<!ENTITY/iu.test(xml), 'Invalid generated XML.');
  assert(xml.includes(`<rsm:ExchangedDocument><ram:ID>${invoiceNumber}</ram:ID>`)
    && (xml.match(/<ram:IncludedSupplyChainTradeLineItem>/gu) ?? []).length === 30
    && xml.includes('<ram:GrandTotalAmount>339.00</ram:GrandTotalAmount>'), 'The attached XML does not match the synthetic invoice.');
  assert(finalPdf.catalog.lookup(PDFName.of('OutputIntents'), PDFArray).size() === 1, 'The output intent is missing.');
  const metadata = Buffer.from(decodePDFRawStream(rawStream(finalPdf.catalog.lookup(PDFName.of('Metadata')))).decode()).toString('utf8');
  assert(metadata.includes('<pdfaid:part>3</pdfaid:part>') && metadata.includes('<pdfaid:conformance>B</pdfaid:conformance>'), 'Final PDF/A metadata is missing.');
  const objects = finalPdf.context.enumerateIndirectObjects().map(([, value]) => value);
  const descriptors = objects.filter(value => value instanceof PDFDict
    && value.lookupMaybe(PDFName.of('Type'), PDFName)?.toString() === '/FontDescriptor');
  assert(descriptors.length >= 2 && descriptors.every(font => font.has(PDFName.of('FontFile2'))
    && decodePDFRawStream(rawStream(font.lookup(PDFName.of('FontFile2')))).decode().length > 100), 'Both production fonts must be embedded.');
  const jpegHashes = pdf => pdf.context.enumerateIndirectObjects().map(([, value]) => value)
    .filter(value => value instanceof PDFRawStream
      && value.dict.lookupMaybe(PDFName.of('Subtype'), PDFName)?.toString() === '/Image'
      && value.dict.lookupMaybe(PDFName.of('Filter'), PDFName)?.toString() === '/DCTDecode')
    .map(value => sha256(value.getContents())).sort();
  const finalImages = jpegHashes(finalPdf);
  assert.deepEqual(finalImages, jpegHashes(previewPdf), 'Preview and final image resources differ.');
  const normalizedJpeg = bytes => sharp(bytes, {
    failOn: 'warning', limitInputPixels: 16_000_000, limitInputChannels: 4, sequentialRead: true, animated: false, pages: 1,
  }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' }).toColourspace('srgb').jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
    .timeout({ seconds: 10 }).toBuffer();
  const normalizedLogoSha256 = sha256(await normalizedJpeg(alphaLogo));
  // Fifteen EUR 10.00 rows at each rate: EUR 300.00 + 28.50 + 10.50.
  // Hash the independently generated standard GiroCode image, not a PDF claim.
  const qr = await QRCode.toBuffer([
    'BCD', '002', '1', 'SCT', settings.bic, settings.companyName, settings.iban,
    'EUR339.00', '', '', invoiceNumber,
  ].join('\n'), { errorCorrectionLevel: 'M', type: 'png', margin: 4 });
  const normalizedQrSha256 = sha256(await normalizedJpeg(qr));
  assert(finalImages.includes(normalizedLogoSha256) && finalImages.includes(normalizedQrSha256), 'The actual normalized logo and valid GiroCode must be embedded.');
  const unchangedLogo = await localRequest(logoUrl, { maxBytes: 64 * 1024 });
  assert(unchangedLogo.status === 200 && sha256(unchangedLogo.bytes) === sha256(originalLogo.bytes)
    && sha256(unchangedLogo.bytes) === sha256(alphaLogo), 'Rendering modified the original logo.');
  assert.deepEqual(await financialSnapshot(userId), before, 'The smoke changed financial state.');
  assert(await prisma.user.count() === 1 && await prisma.settings.count() === 1, 'The fixture ownership boundary changed.');
  const finalSha256 = sha256(finalBytes);
  assert(sha256(await readFile(`${EVIDENCE_DIRECTORY}/final.pdf`)) === finalSha256, 'Retained final bytes changed.');
  stage = 'disconnect-and-retain-manifest';
  await prisma.$disconnect();
  prisma = undefined;
  await writeFile(`${EVIDENCE_DIRECTORY}/manifest.json`, `${JSON.stringify({
    status: 'passed', syntheticIsolatedFixture: true, ...platform, runtimeNotices, pages: finalPdf.getPageCount(),
    finalSha256, previewSha256: sha256(previewBytes), sourceSha256: sha256(sourceJson), xmlSha256: sha256(xmlBytes),
    originalLogoSha256: sha256(alphaLogo), normalizedLogoSha256, normalizedQrSha256,
    finalByteCount: finalBytes.length, previewAndFinalPageStreamsEqual: true,
    originalLogoPreserved: true, before, after, financialStateUnchanged: true,
    backendFinalByteGate: 'Mandatory official pinned veraPDF 1.30.3; actual final HTTP 200',
    limitations: 'HTTP/container smoke only; retained PDF pixel review and native cross-architecture execution are separate gates.',
  }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  // Deliberately no cookies, tokens, passwords, addresses, source XML or IDs.
  console.log(JSON.stringify({ sha256: finalSha256, pages: finalPdf.getPageCount(), ...platform }));
}

try {
  await main();
} catch (error) {
  if (evidenceCreated) {
    try {
      await writeFile(`${EVIDENCE_DIRECTORY}/manifest.json`, `${JSON.stringify({
        status: 'failed', stage, syntheticIsolatedFixture: true, ...platform,
        ...(before ? { before } : {}),
      }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    } catch { /* Never replace an existing evidence manifest or log diagnostics. */ }
  }
  const reason = error instanceof assert.AssertionError ? `: ${error.message.slice(0, 240).replace(/[\r\n]/gu, ' ')}` : '';
  console.error(`Own-invoice container smoke failed at ${stage}${reason}`);
  process.exitCode = 1;
} finally {
  cookies.clear();
  if (prisma) {
    try { await prisma.$disconnect(); }
    catch { process.exitCode = 1; }
  }
}
