import sharp from 'sharp';
import { MAX_LOGO_UPLOAD_BYTES } from '@/lib/resource-limits';

const MAX_LOGO_PIXELS = 16_000_000;
const MAX_NORMALIZED_EDGE = 1_600;
const MAX_NORMALIZED_BYTES = 2 * 1024 * 1024;

export type NormalizedInvoiceImage = {
  bytes: Buffer;
  width: number;
  height: number;
};

export class OwnInvoiceImageError extends Error {
  readonly status = 422;
  constructor(options?: ErrorOptions) {
    super('Das Firmenlogo ist ungültig oder zu groß. Bitte ein gültiges PNG- oder JPEG-Logo hinterlegen.', options);
    this.name = 'OwnInvoiceImageError';
  }
}

function isPngOrJpeg(bytes: Uint8Array): boolean {
  return (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e
    && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a)
    || (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff);
}

/**
 * Do not pass uploaded image bytes to PDFKit, even after metadata() succeeds.
 * Sharp must complete a bounded decode and fresh JPEG encode first. JPEG output
 * also avoids PDFKit's asynchronous PNG decoder on all untrusted input.
 * The existing invoice places the logo exclusively on a white card. Flatten
 * onto that same white here, preserving transparent-logo background appearance
 * without sending alpha/PNG input to PDFKit. This is not a general-purpose
 * image converter for arbitrary backgrounds.
 * No paths, SVG, remote URLs, metadata or animation are forwarded.
 */
export async function normalizeOwnInvoiceImage(input: Uint8Array): Promise<NormalizedInvoiceImage> {
  if (input.byteLength === 0 || input.byteLength > MAX_LOGO_UPLOAD_BYTES || !isPngOrJpeg(input)) {
    throw new OwnInvoiceImageError();
  }
  try {
    const { data, info } = await sharp(Buffer.from(input), {
      failOn: 'warning',
      limitInputPixels: MAX_LOGO_PIXELS,
      limitInputChannels: 4,
      sequentialRead: true,
      animated: false,
      pages: 1,
    })
      .rotate()
      .resize({ width: MAX_NORMALIZED_EDGE, height: MAX_NORMALIZED_EDGE, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .toColourspace('srgb')
      .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
      .timeout({ seconds: 10 })
      .toBuffer({ resolveWithObject: true });
    if (!Number.isSafeInteger(info.width) || !Number.isSafeInteger(info.height) || info.width <= 0 || info.height <= 0
      || info.width > MAX_NORMALIZED_EDGE || info.height > MAX_NORMALIZED_EDGE
      || data.byteLength === 0 || data.byteLength > MAX_NORMALIZED_BYTES || info.format !== 'jpeg') {
      throw new OwnInvoiceImageError();
    }
    return { bytes: data, width: info.width, height: info.height };
  } catch (error) {
    if (error instanceof OwnInvoiceImageError) throw error;
    throw new OwnInvoiceImageError({ cause: error });
  }
}
