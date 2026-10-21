import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readdir, readFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PurchaseDocumentError } from './errors';
const run = promisify(execFile);
export const AI_MAX_PDF_PAGES = 4;
export const AI_MAX_INPUT_BYTES = 6 * 1024 * 1024;
export type AiReceiptImage = { type: 'image_url'; image_url: { url: string; detail: 'high' } };
function inputError(code: string, message: string): never { throw new PurchaseDocumentError(message, 422, code); }
/** Native PDF execution is isolated from the app heap and has hard OS resource limits.
 * Render a fifth page only to detect overflow. Never send an incomplete/truncated PDF.
 * `prlimit` and `gs` are explicit official Debian runtime dependencies.
 */
export async function prepareAiReceiptImages(mediaType: string, bytes: Buffer, signal?: AbortSignal): Promise<AiReceiptImage[]> {
  if (signal?.aborted) return inputError('AI_REQUEST_INTERRUPTED', 'KI-Gesamtzeitlimit oder Abbruch vor Eingabeaufbereitung.');
  if (mediaType === 'image/jpeg' || mediaType === 'image/png') {
    if (bytes.length > AI_MAX_INPUT_BYTES) return inputError('AI_UNSUPPORTED_FILE', 'Foto überschreitet das KI-Limit von 6 MiB. Das archivierte Original bleibt unverändert.');
    return [{ type: 'image_url', image_url: { url: `data:${mediaType};base64,${bytes.toString('base64')}`, detail: 'high' } }];
  }
  if (mediaType !== 'application/pdf') return inputError('AI_UNSUPPORTED_FILE', 'Für strukturierte XML-Belege wird die deterministische Extraktion verwendet.');
  if (!bytes.length || bytes.length > AI_MAX_INPUT_BYTES || bytes.subarray(0,5).toString('ascii') !== '%PDF-') return inputError('AI_PDF_LIMIT', 'KI-PDFs sind auf 6 MiB und vier vollständig gerenderte Seiten begrenzt.');
  const directory = await mkdtemp(path.join(tmpdir(), 'bivaro-ai-pdf-'));
  await chmod(directory, 0o700);
  try {
    const input = path.join(directory, 'original.pdf');
    await writeFile(input, bytes, { mode: 0o600, flag: 'wx' });
    try {
      await run('prlimit', ['--as=536870912', '--cpu=15', '--fsize=2097152', '--nofile=64', '--', 'gs',
        '-q','-dPDFSTOPONERROR','-dPDFSTOPONWARNING','-dSAFER','-dBATCH','-dNOPAUSE','-dNumRenderingThreads=1','-dMaxBitmap=16777216','-dBufferSpace=16777216',
        '-sDEVICE=jpeg','-dJPEGQ=80','-r100','-g850x1100','-dFIXEDMEDIA','-dPDFFitPage','-dFirstPage=1',`-dLastPage=${AI_MAX_PDF_PAGES + 1}`,
        `-sOutputFile=${path.join(directory, 'page-%d.jpg')}`, input], { signal, timeout: 20_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024, windowsHide: true, env: { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV ?? 'production', LANG: 'C', HOME: directory, TMPDIR: directory } });
    } catch (error) {
      if (signal?.aborted) return inputError('AI_REQUEST_INTERRUPTED', 'KI-Eingabeaufbereitung wurde durch Gesamtzeitlimit oder Abbruch beendet.');
      if ((error as { code?: string }).code === 'ENOENT') return inputError('AI_RENDER_UNAVAILABLE', 'Isolierter PDF-Renderer fehlt. Das Original bleibt archiviert; keine KI-Anfrage wurde gesendet.');
      return inputError('AI_RENDER_FAILED', 'PDF konnte innerhalb der sicheren Ressourcenlimits nicht vollständig gerendert werden. Keine KI-Anfrage wurde gesendet.');
    }
    const pages = (await readdir(directory)).filter(name => /^page-\d+\.jpg$/.test(name)).sort((a,b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    if (!pages.length || pages.length > AI_MAX_PDF_PAGES || pages.some((name,index) => name !== `page-${index + 1}.jpg`)) return inputError('AI_PDF_LIMIT', 'Nur PDFs mit ein bis vier vollständig gerenderten Seiten werden an KI gesendet.');
    const buffers = await Promise.all(pages.map(name => readFile(path.join(directory,name))));
    if (buffers.some(image => image.length < 3 || image.length > 2 * 1024 * 1024 || image[0] !== 255 || image[1] !== 216 || image[2] !== 255) || buffers.reduce((sum,image) => sum + image.length,0) > AI_MAX_INPUT_BYTES) return inputError('AI_PDF_LIMIT', 'Gerenderte PDF-Seiten überschreiten das KI-Größenlimit. Keine KI-Anfrage wurde gesendet.');
    return buffers.map(image => ({type:'image_url',image_url:{url:`data:image/jpeg;base64,${image.toString('base64')}`,detail:'high'}}));
  } finally { await rm(directory, { recursive: true, force: true }); }
}
