import { execFile } from 'child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { promisify } from 'util';
import { PDFDocument } from 'pdf-lib';
import { addFacturXPdfA3Metadata, getSrgbIccProfileBytes } from '@/lib/pdfa3';

import { withProcessingSlot } from '@/lib/processing-limit';
import { MAX_PDF_INPUT_BYTES, MAX_XML_INPUT_BYTES, MAX_PDF_XML_COMBINED_BYTES, RequestBodyLimitError } from '@/lib/resource-limits';

const execFileAsync = promisify(execFile);
const GHOSTSCRIPT_TIMEOUT_MS = 30_000;

export type CreatePdfA3InvoiceInput = {
  basePdfBytes: Uint8Array;
  xmlContent: string;
  invoiceNumber: string;
  userId?: string;
};

function escapePostScriptString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function buildPdfAPrefix(iccProfilePath: string): string {
  const escapedIccProfilePath = escapePostScriptString(iccProfilePath);

  return `%!
/ICCProfile (${escapedIccProfilePath}) def
[ /Title (Bivaro PDF/A-3 Invoice) /DOCINFO pdfmark
[/_objdef {icc_PDFA} /type /stream /OBJ pdfmark
[{icc_PDFA} << /N 3 >> /PUT pdfmark
[{icc_PDFA} ICCProfile (r) file /PUT pdfmark
[/_objdef {OutputIntent_PDFA} /type /dict /OBJ pdfmark
[{OutputIntent_PDFA} <<
  /Type /OutputIntent
  /S /GTS_PDFA1
  /DestOutputProfile {icc_PDFA}
  /OutputConditionIdentifier (sRGB IEC61966-2.1)
>> /PUT pdfmark
[{Catalog} << /OutputIntents [ {OutputIntent_PDFA} ] >> /PUT pdfmark
`;
}

async function normalizePdfWithGhostscript(inputPdfPath: string, outputPdfPath: string, prefixPath: string, iccProfilePath: string) {
  await execFileAsync('gs', [
    `--permit-file-read=${iccProfilePath}`,
    '-dPDFA=3',
    '-dBATCH',
    '-dNOPAUSE',
    '-dNOOUTERSAVE',
    '-sDEVICE=pdfwrite',
    '-sColorConversionStrategy=RGB',
    '-sProcessColorModel=DeviceRGB',
    `-sOutputFile=${outputPdfPath}`,
    prefixPath,
    inputPdfPath,
  ], {
    timeout: GHOSTSCRIPT_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  });
}

export async function createPdfA3Invoice({
  basePdfBytes,
  xmlContent,
  invoiceNumber,
  userId,
}: CreatePdfA3InvoiceInput): Promise<Uint8Array> {
  const xmlBytes = Buffer.byteLength(xmlContent, 'utf8');
  if (basePdfBytes.byteLength > MAX_PDF_INPUT_BYTES || xmlBytes > MAX_XML_INPUT_BYTES || basePdfBytes.byteLength + xmlBytes > MAX_PDF_XML_COMBINED_BYTES) {
    throw new RequestBodyLimitError('PDF oder XML ist zu groß');
  }
  return withProcessingSlot(userId, async () => {
    const workDir = await mkdtemp(path.join(tmpdir(), 'bivaro-pdfa3-'));

    try {
      const inputPdfPath = path.join(workDir, 'input.pdf');
      const normalizedPdfPath = path.join(workDir, 'normalized.pdf');
      const iccProfilePath = path.join(workDir, 'srgb.icc');
      const prefixPath = path.join(workDir, 'pdfa-prefix.ps');

      await writeFile(inputPdfPath, basePdfBytes);
      await writeFile(iccProfilePath, getSrgbIccProfileBytes());
      await writeFile(prefixPath, buildPdfAPrefix(iccProfilePath), 'utf8');

      await normalizePdfWithGhostscript(inputPdfPath, normalizedPdfPath, prefixPath, iccProfilePath);

      if ((await stat(normalizedPdfPath)).size > MAX_PDF_INPUT_BYTES * 2) throw new RequestBodyLimitError('Das konvertierte PDF ist zu groß');
      const normalizedPdfBytes = await readFile(normalizedPdfPath);
      const pdfDoc = await PDFDocument.load(normalizedPdfBytes);
      await addFacturXPdfA3Metadata(pdfDoc, xmlContent, { invoiceNumber });

      const result = await pdfDoc.save();
      if (result.byteLength > MAX_PDF_INPUT_BYTES * 2) throw new RequestBodyLimitError('Das konvertierte PDF ist zu groß');
      return result;
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
}
