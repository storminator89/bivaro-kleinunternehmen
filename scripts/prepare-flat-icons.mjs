import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

// Preserve the generated originals; export only web-sized transparent copies.
const root = process.cwd();
const manifest = JSON.parse(await readFile(path.join(root, 'docs/design/icon-generation-flat-2026-10-17.json'), 'utf8'));
const exports = [];
for (const asset of manifest.assets) {
  const original = path.join(root, asset.original);
  const web = path.join(root, asset.web);
  await mkdir(path.dirname(original), { recursive: true });
  await mkdir(path.dirname(web), { recursive: true });
  if (process.argv.includes('--import-generated')) await copyFile(asset.source, original);
  const metadata = await sharp(original).metadata();
  const stats = await sharp(original).stats();
  if (!metadata.hasAlpha || stats.channels[3].min !== 0 || stats.channels[3].max !== 255) throw new Error(`Missing transparency: ${asset.name}`);
  await sharp(original).resize(asset.name === 'bivaro-sidebar-flat' ? 192 : 128).webp({ quality: 90, alphaQuality: 100 }).toFile(web);
  if (!(await sharp(web).metadata()).hasAlpha) throw new Error(`Export lost alpha: ${asset.name}`);
  exports.push({ name: asset.name, file: asset.web, bytes: (await readFile(web)).length, alpha: true });
}
await writeFile(path.join(root, 'docs/design/icon-assets-flat-2026-10-17.json'), JSON.stringify({ count: exports.length, webBytes: exports.reduce((sum, asset) => sum + asset.bytes, 0), assets: exports }, null, 2) + '\n');
console.log(`Prepared ${exports.length} transparent flat assets.`);
