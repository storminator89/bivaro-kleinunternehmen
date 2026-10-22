import { createHash } from 'node:crypto';
import { expect, test, type Response } from '@playwright/test';
import manifest from '../public/fonts/ui/manifest.json';

test('loads the original UI font payloads and all faces from the application origin', async ({ page }) => {
  const externalFontRequests: string[] = [];
  const responses = new Map<string, Response>();
  page.on('request', (request) => {
    if (/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(request.url())) externalFontRequests.push(request.url());
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/fonts/ui/') && url.pathname.endsWith('.woff2')) responses.set(url.pathname, response);
  });

  await page.goto('/login');
  const loadedFaces = await page.evaluate(async () => {
    const families = new Set(['Inter', 'Geist Mono', 'Newsreader']);
    const faces = [...document.fonts].filter((face) => families.has(face.family.replace(/["']/g, '')));
    await Promise.all(faces.map((face) => face.load()));
    return faces.map((face) => ({ family: face.family.replace(/["']/g, ''), status: face.status, style: face.style, weight: face.weight }));
  });
  expect(loadedFaces).toHaveLength(19);
  expect(loadedFaces.filter((face) => face.family === 'Inter')).toHaveLength(7);
  expect(loadedFaces.filter((face) => face.family === 'Geist Mono')).toHaveLength(6);
  expect(loadedFaces.filter((face) => face.family === 'Newsreader')).toHaveLength(6);
  for (const face of loadedFaces) {
    expect(face.status).toBe('loaded');
    expect(face.style).toBe('normal');
    if (face.family === 'Newsreader') expect(face.weight).toMatch(/^(500|600)$/);
    else expect(face.weight).toBe('100 900');
  }
  const expectedPaths = manifest.fonts.map((font) => `/fonts/ui/${font.path}`).sort();
  await expect.poll(() => [...responses.keys()].sort()).toEqual(expectedPaths);
  for (const font of manifest.fonts) {
    const response = responses.get(`/fonts/ui/${font.path}`)!;
    expect(response.status()).toBe(200);
    expect(new URL(response.url()).origin).toBe(new URL(page.url()).origin);
    const bytes = await response.body();
    expect(bytes.length).toBe(font.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(font.sha256);
  }
  expect(externalFontRequests).toEqual([]);
});
