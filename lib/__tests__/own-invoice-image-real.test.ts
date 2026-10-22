import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { normalizeOwnInvoiceImage, OwnInvoiceImageError } from '@/lib/server/own-invoice-image';

/** Ordinary isolated synthetic images; no service, uploaded file or user data. */
describe('own-invoice logo normalization with the real decoder', () => {
  it.each([
    { red: 20, green: 40, blue: 60, alpha: 0 },
    { red: 40, green: 100, blue: 200, alpha: 128 },
    { red: 20, green: 40, blue: 60, alpha: 255 },
  ])('composites alpha $alpha on the same white background as the existing invoice logo card', async ({ red, green, blue, alpha }) => {
    const rgba = Buffer.alloc(16 * 16 * 4);
    for (let offset = 0; offset < rgba.length; offset += 4) {
      rgba.set([red, green, blue, alpha], offset);
    }
    const input = await sharp(rgba, { raw: { width: 16, height: 16, channels: 4 } }).png().toBuffer();
    const original = Buffer.from(input);
    const normalized = await normalizeOwnInvoiceImage(input);
    const decoded = await sharp(normalized.bytes).raw().toBuffer({ resolveWithObject: true });
    expect(normalized.width).toBe(16);
    expect(normalized.height).toBe(16);
    expect(decoded.info.channels).toBe(3);
    const expected = [red, green, blue].map(channel => Math.round(channel * alpha / 255 + 255 - alpha));
    for (let offset = 0; offset < decoded.data.length; offset += 3) {
      for (let channel = 0; channel < 3; channel++) {
        // Fresh JPEG is intentionally lossy; alpha compositing uses the exact
        // existing white card and should differ only by tiny encoding rounding.
        expect(Math.abs(decoded.data[offset + channel] - expected[channel])).toBeLessThanOrEqual(3);
      }
    }
    expect(input).toEqual(original);
  });

  it('rejects an ordinary incomplete PNG through the awaited decoder boundary', async () => {
    const valid = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#33669980' } }).png().toBuffer();
    await expect(normalizeOwnInvoiceImage(valid.subarray(0, 16))).rejects.toBeInstanceOf(OwnInvoiceImageError);
  });
});
