import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

// Export the full original canvas. Never crop, threshold, recolor or flatten it.
const root = process.cwd();
const manifest = JSON.parse(await readFile(path.join(root, 'docs/design/icon-generation-sidebar-flat-2026-10-24.json'), 'utf8'));
const exports = [];
for (const asset of manifest.assets) {
  const original = path.join(root, asset.original);
  const web = path.join(root, asset.web);
  const input = await readFile(original);
  const metadata = await sharp(input).metadata();
  const originalStats = await sharp(input).stats();
  if (!metadata.hasAlpha || metadata.width !== metadata.height || originalStats.channels[3].min !== 0 || originalStats.channels[3].max < 250) {
    throw new Error(`Expected a square transparent original with solid interior: ${asset.name}`);
  }
  const dimension = asset.name === 'bivaro-sidebar' ? 192 : 128;
  await mkdir(path.dirname(web), { recursive: true });
  await sharp(input).resize(dimension, dimension).webp({ lossless: true, effort: 6 }).toFile(web);
  const output = await readFile(web);
  const stats = await sharp(output).stats();
  const outputMetadata = await sharp(output).metadata();
  if (!outputMetadata.hasAlpha || stats.channels[3].min !== 0 || stats.channels[3].max < 250) {
    throw new Error(`Web export lost transparency or solid interior: ${asset.name}`);
  }
  exports.push({
    name: asset.name,
    original: asset.original,
    originalDimensions: [metadata.width, metadata.height],
    originalSha256: createHash('sha256').update(input).digest('hex'),
    web: asset.web,
    webDimensions: [dimension, dimension],
    webSha256: createHash('sha256').update(output).digest('hex'),
    webBytes: output.length,
    alphaRange: [stats.channels[3].min, stats.channels[3].max],
  });
}

function luminance(hex) {
  const rgb = hex.match(/[\da-f]{2}/gi).map(channel => parseInt(channel, 16) / 255);
  const linear = rgb.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
}
const contrast = [
  ['inactive', '#BDCFCA', '#06251F'],
  ['hover', '#C6D8D4', '#123A31'],
  ['active', '#06251F', '#79E1AB'],
].map(([state, ink, surface]) => {
  const values = [luminance(ink), luminance(surface)].sort((a, b) => a - b);
  return { state, ink, surface, ratio: Number(((values[1] + .05) / (values[0] + .05)).toFixed(2)) };
});
await writeFile(path.join(root, 'docs/design/icon-assets-sidebar-flat-2026-10-24.json'), JSON.stringify({
  count: exports.length,
  webBytes: exports.reduce((sum, asset) => sum + asset.webBytes, 0),
  operation: 'Full-canvas uniform resize and lossless WebP conversion; no crop, alpha threshold, recoloring or flattening.',
  sidebarPaletteSharedByLightAndDark: true,
  solidInkContrast: contrast,
  functionalTestsExecuted: false,
  assets: exports,
}, null, 2) + '\n');
console.log(`Exported ${exports.length} generated sidebar masks with alpha intact.`);
