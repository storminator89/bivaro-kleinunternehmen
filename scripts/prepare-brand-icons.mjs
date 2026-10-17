import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

// Format/size exports only. Artwork comes from the individual image_gen calls.
const root = process.cwd();
const manifest = JSON.parse(await readFile(path.join(root, 'docs/design/icon-generation-2026-10-17.json'), 'utf8'));
const assets = [];
for (const asset of manifest.assets) {
  const original = path.join(root, asset.original);
  const web = path.join(root, asset.web);
  await mkdir(path.dirname(original), { recursive: true });
  await mkdir(path.dirname(web), { recursive: true });
  if (process.argv.includes('--import-generated')) await copyFile(asset.source, original);
  const metadata = await sharp(original).metadata();
  const stats = await sharp(original).stats();
  if (!metadata.hasAlpha || stats.channels[3].min !== 0 || stats.channels[3].max !== 255) {
    throw new Error(`Missing genuine transparency: ${asset.name}`);
  }
  await sharp(original).resize(asset.name === 'bivaro-app' ? 192 : 128).webp({ quality: 90, alphaQuality: 100 }).toFile(web);
  const exported = await sharp(web).metadata();
  if (!exported.hasAlpha) throw new Error(`Alpha lost during export: ${asset.name}`);
  assets.push({ name: asset.name, original: asset.original, web: asset.web, width: exported.width, height: exported.height, bytes: (await readFile(web)).length, alpha: true });
}

const brand = path.join(root, 'assets/brand/bivaro-icons/bivaro-app.png');
await sharp(brand).resize(512).png().toFile(path.join(root, 'app/icon.png'));
await sharp(brand).resize(180).png().toFile(path.join(root, 'app/apple-icon.png'));

// ICO directory containing individually sized PNG frames, preserving RGBA.
const sizes = [16, 32, 48, 64, 128, 256];
const frames = await Promise.all(sizes.map(size => sharp(brand).resize(size).png().toBuffer()));
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (const [index, size] of sizes.entries()) {
  const entry = 6 + index * 16;
  header[entry] = size === 256 ? 0 : size;
  header[entry + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(frames[index].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += frames[index].length;
}
await writeFile(path.join(root, 'app/favicon.ico'), Buffer.concat([header, ...frames]));
await writeFile(path.join(root, 'docs/design/icon-assets-2026-10-17.json'), JSON.stringify({ tool: manifest.tool, count: assets.length, totalWebBytes: assets.reduce((total, asset) => total + asset.bytes, 0), faviconSizes: sizes, assets }, null, 2) + '\n');
console.log(`Prepared ${assets.length} transparent icons and favicon/touch exports.`);
