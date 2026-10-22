import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
const source = (name: string) => readFileSync(path.join(process.cwd(), name), 'utf8');

describe('real PDF browser gate packaging contract (static, not native evidence)', () => {
  it('isolates test dependencies from the exact production module closure', () => {
    const docker = source('Dockerfile.ai-browser');
    expect(docker).toContain('ARG BIVARO_RUNTIME_IMAGE=bivaro-runtime-smoke');
    expect(docker).toContain('FROM ${BIVARO_RUNTIME_IMAGE}');
    expect(docker.indexOf('WORKDIR /test-tools')).toBeLessThan(docker.indexOf('npm ci'));
    expect(docker).toContain('npm ci --include=dev --ignore-scripts');
    expect(docker).toContain('npx prisma generate --schema=./prisma/schema.prisma');
    expect(docker).toContain('RUN node runtime-manifest.mjs capture');
    expect(docker).toContain('node runtime-manifest.mjs verify');
    expect(docker).not.toMatch(/COPY[^\n]*\/app|WORKDIR \/app|ENV NODE_PATH/);
    expect(docker).toContain('USER nextjs');
    expect(docker).toContain('lib/password.ts lib/password-policy.ts lib/prisma.ts ./lib/');
    expect(source('Dockerfile.ai-browser.dockerignore')).toBe(`${source('.dockerignore')}\n# Only the synthetic test entry is added to this test-only image context.\n!e2e/ai-receipt-native.spec.ts\n`);
  });
  it('starts the prebuilt app without tool-directory module or loader fallbacks', () => {
    const fixture = source('scripts/ai-pdf/browser-server.mjs');
    const app = fixture.slice(fixture.indexOf('const child ='));
    expect(app).toContain("['/app/server.js']");
    expect(app).toContain("cwd: '/app'");
    expect(app).not.toContain('...process.env');
    expect(app).not.toContain('NODE_PATH'); expect(app).not.toContain('NODE_OPTIONS');
    expect(fixture).toContain("assert.notEqual(process.getuid(), 0)");
    expect(fixture).toContain("BIVARO_AI_PRIVATE_BASE_URLS: '[\"http://127.0.0.1:3200/v1\"]'");
    expect(fixture).toContain('stats.calls++; // Count every dispatch');
    expect(fixture).toContain('size <= 12 * 1024 * 1024');
  });
  it('cannot silently run or skip the real PDF test on the ordinary Ubuntu app', () => {
    const ordinary = source('playwright.config.ts'), dedicated = source('playwright.ai-pdf.config.ts');
    expect(ordinary.match(/ai-receipt-native\.spec\.ts/g)).toHaveLength(2);
    expect(dedicated).toContain("testMatch: '**/ai-receipt-native.spec.ts'");
    expect(dedicated).toContain("process.env.BIVARO_AI_BROWSER_FIXTURE !== '1'");
    expect(dedicated).toContain('reuseExistingServer: false');
    expect(dedicated).not.toContain('test.skip');
  });
  it('keeps the exact native base gate before ordinary-profile browser execution', () => {
    const workflow = source('.github/workflows/container-runtime.yml');
    expect(workflow.indexOf('bivaro-runtime-smoke /tmp/container-runtime-smoke.sh')).toBeLessThan(workflow.indexOf('docker build --file Dockerfile.ai-browser'));
    expect(workflow).toContain('docker run --rm --network=none --shm-size=256m bivaro-ai-browser');
    for (const unsafe of ['--privileged', '--security-opt', '--network=host', '--ipc=host', 'upload-artifact']) expect(workflow).not.toContain(unsafe);
    expect(workflow).toContain('ubuntu-24.04-arm');
  });
  it('exercises real APIs, consent, ordered images and rejection without mocks or evidence uploads', () => {
    const browser = source('e2e/ai-receipt-native.spec.ts');
    for (const prohibited of ['page.route(', 'vi.mock(', 'test.skip(', '.screenshot(']) expect(browser).not.toContain(prohibited);
    for (const required of ['acknowledgeCost: false', "result.extraction.status).toBe('completed')", 'sent.imageCounts).toEqual([4])', 'sent.centers[0][index][channel]', "'AI_PDF_LIMIT'", "'AI_RENDER_FAILED'", 'digest(await original', 'prisma.expense.count', 'prisma.income.count', 'prisma.cashTransaction.count']) expect(browser).toContain(required);
  });
});
