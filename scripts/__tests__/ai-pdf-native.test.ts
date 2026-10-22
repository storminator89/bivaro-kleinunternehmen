import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createHash } from 'node:crypto';
import { prepareAiReceiptImages } from '../../lib/purchase-documents/ai-input';

// Opt in only after native dependencies and architecture-specific policy have
// been built. Mocks are deliberately forbidden in this compatibility suite.
const native = describe.runIf(process.env.BIVARO_AI_PDF_NATIVE_TEST === '1');
async function receipt(pages: number, blank = false) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let number = 1; number <= pages; number++) {
    const page = pdf.addPage([595, 842]);
    if (!blank) {
      page.drawText(`SYNTHETIC RECEIPT PAGE ${number} OF ${pages}`, { x: 42, y: 760, size: 20, font });
      page.drawText(`Invoice TEST-${number}; amount EUR 123.45`, { x: 42, y: 700, size: 14, font });
      page.drawRectangle({ x: 42, y: 600 - number * 40, width: 70 + number * 20, height: 25, color: rgb(number / (pages + 1), 0.2, 0.4) });
    }
  }
  return Buffer.from(await pdf.save());
}

native('genuine isolated PDF.js native compatibility (no provider)', () => {
  it.each([1, 2, 4])('renders all %s pages as distinct bounded JPEGs without modifying original bytes', async pages => {
    const pdf = await receipt(pages), before = createHash('sha256').update(pdf).digest('hex');
    const images = await prepareAiReceiptImages('application/pdf', pdf);
    expect(images).toHaveLength(pages);
    expect(new Set(images.map(image => image.image_url.url)).size).toBe(pages);
    for (const image of images) {
      expect(image.image_url.url).toMatch(/^data:image\/jpeg;base64,/);
      const bytes = Buffer.from(image.image_url.url.split(',')[1], 'base64');
      expect(bytes.length).toBeGreaterThan(500);
      expect(bytes.length).toBeLessThanOrEqual(2 * 1024 * 1024);
      expect(bytes.subarray(0, 3)).toEqual(Buffer.from([255, 216, 255]));
      expect(bytes.subarray(-2)).toEqual(Buffer.from([255, 217]));
    }
    expect(createHash('sha256').update(pdf).digest('hex')).toBe(before);
  }, 30_000);
  it('explicitly rejects five pages instead of sending the first four', async () => {
    await expect(prepareAiReceiptImages('application/pdf', await receipt(5))).rejects.toMatchObject({ code: 'AI_PDF_LIMIT' });
  }, 30_000);
  it('rejects an intentionally blank page instead of accepting recovered empty content', async () => {
    await expect(prepareAiReceiptImages('application/pdf', await receipt(1, true))).rejects.toMatchObject({ code: 'AI_RENDER_FAILED' });
  }, 30_000);
  it('rejects malformed and truncated PDFs', async () => {
    const pdf = await receipt(1);
    for (const malformed of [Buffer.from('%PDF-1.7\nnot a valid document'), pdf.subarray(0, Math.floor(pdf.length / 2))]) await expect(prepareAiReceiptImages('application/pdf', malformed)).rejects.toMatchObject({ code: 'AI_RENDER_FAILED' });
  }, 30_000);
});
