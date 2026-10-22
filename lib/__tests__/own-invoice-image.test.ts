import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_LOGO_UPLOAD_BYTES } from '@/lib/resource-limits';

const imageMocks = vi.hoisted(() => ({
  sharp: vi.fn(),
  chain: {
    metadata: vi.fn(),
    rotate: vi.fn(),
    resize: vi.fn(),
    flatten: vi.fn(),
    toColourspace: vi.fn(),
    jpeg: vi.fn(),
    timeout: vi.fn(),
    toBuffer: vi.fn(),
  },
}));

vi.mock('sharp', () => ({ default: imageMocks.sharp }));

import { normalizeOwnInvoiceImage, OwnInvoiceImageError } from '@/lib/server/own-invoice-image';

// Ordinary synthetic signature fixtures, used only with the mocked decoder.
// These tests do not assert that an actual decoder accepted either fixture.
const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const inputFixture = new Uint8Array([...pngHeader, 1, 2, 3, 4]);
const encodedJpegFixture = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 5, 6, 7, 8, 0xff, 0xd9]);

function encodedResult() {
  return { data: encodedJpegFixture, info: { width: 640, height: 320, format: 'jpeg' } };
}

beforeEach(() => {
  vi.clearAllMocks();
  imageMocks.sharp.mockReturnValue(imageMocks.chain);
  imageMocks.chain.metadata.mockImplementation(() => { throw new Error('metadata-only decoding is forbidden'); });
  imageMocks.chain.rotate.mockReturnValue(imageMocks.chain);
  imageMocks.chain.resize.mockReturnValue(imageMocks.chain);
  imageMocks.chain.flatten.mockReturnValue(imageMocks.chain);
  imageMocks.chain.toColourspace.mockReturnValue(imageMocks.chain);
  imageMocks.chain.jpeg.mockReturnValue(imageMocks.chain);
  imageMocks.chain.timeout.mockReturnValue(imageMocks.chain);
  imageMocks.chain.toBuffer.mockResolvedValue(encodedResult());
});

describe('bounded own-invoice logo normalization (mocked decoder)', () => {
  it('awaits a full decode/re-encode rather than trusting metadata or returning the uploaded bytes', async () => {
    const input = Uint8Array.from(inputFixture);
    const result = await normalizeOwnInvoiceImage(input);

    expect(imageMocks.chain.metadata).not.toHaveBeenCalled();
    expect(imageMocks.chain.toBuffer).toHaveBeenCalledExactlyOnceWith({ resolveWithObject: true });
    expect(result).toEqual({ bytes: encodedJpegFixture, width: 640, height: 320 });
    expect(result.bytes).toBe(encodedJpegFixture);
    expect(result.bytes).not.toBe(input);
    expect(result.bytes).not.toEqual(Buffer.from(input));
    expect(input).toEqual(inputFixture);

    const decoderInput = imageMocks.sharp.mock.calls[0][0];
    expect(Buffer.isBuffer(decoderInput)).toBe(true);
    expect(decoderInput).toEqual(Buffer.from(input));
    expect(decoderInput).not.toBe(input);
  });

  it('uses fixed input-pixel/channel/page budgets and bounded fresh sRGB JPEG output', async () => {
    await normalizeOwnInvoiceImage(inputFixture);

    expect(imageMocks.sharp).toHaveBeenCalledExactlyOnceWith(Buffer.from(inputFixture), {
      failOn: 'warning',
      limitInputPixels: 16_000_000,
      limitInputChannels: 4,
      sequentialRead: true,
      animated: false,
      pages: 1,
    });
    expect(imageMocks.chain.rotate).toHaveBeenCalledExactlyOnceWith();
    expect(imageMocks.chain.resize).toHaveBeenCalledExactlyOnceWith({
      width: 1_600, height: 1_600, fit: 'inside', withoutEnlargement: true,
    });
    expect(imageMocks.chain.flatten).toHaveBeenCalledExactlyOnceWith({ background: '#ffffff' });
    expect(imageMocks.chain.toColourspace).toHaveBeenCalledExactlyOnceWith('srgb');
    expect(imageMocks.chain.jpeg).toHaveBeenCalledExactlyOnceWith({ quality: 95, chromaSubsampling: '4:4:4' });
    expect(imageMocks.chain.timeout).toHaveBeenCalledExactlyOnceWith({ seconds: 10 });
    expect(imageMocks.chain.metadata).not.toHaveBeenCalled();
  });

  it('handles asynchronous full-decode rejection as a safe typed failure', async () => {
    const decoderFailure = new Error('synthetic decoder failure');
    imageMocks.chain.toBuffer.mockRejectedValue(decoderFailure);

    await expect(normalizeOwnInvoiceImage(inputFixture)).rejects.toMatchObject({
      name: 'OwnInvoiceImageError',
      status: 422,
      message: 'Das Firmenlogo ist ungültig oder zu groß. Bitte ein gültiges PNG- oder JPEG-Logo hinterlegen.',
      cause: decoderFailure,
    });
    expect(imageMocks.chain.toBuffer).toHaveBeenCalledTimes(1);
    expect(imageMocks.chain.metadata).not.toHaveBeenCalled();
  });

  it('does not mistake a recognized but header-only PNG for a completed decode', async () => {
    imageMocks.chain.toBuffer.mockRejectedValue(new Error('ordinary incomplete image fixture'));

    await expect(normalizeOwnInvoiceImage(pngHeader)).rejects.toBeInstanceOf(OwnInvoiceImageError);
    expect(imageMocks.sharp).toHaveBeenCalledTimes(1);
    expect(imageMocks.chain.toBuffer).toHaveBeenCalledTimes(1);
    expect(imageMocks.chain.metadata).not.toHaveBeenCalled();
  });

  it.each([
    new Uint8Array(),
    new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]),
    new Uint8Array([0xff, 0xd8]),
    new Uint8Array([71, 73, 70, 56, 57, 97]),
  ])('rejects empty, malformed signatures or other formats before invoking the decoder (%j)', async input => {
    await expect(normalizeOwnInvoiceImage(input)).rejects.toBeInstanceOf(OwnInvoiceImageError);
    expect(imageMocks.sharp).not.toHaveBeenCalled();
    expect(imageMocks.chain.toBuffer).not.toHaveBeenCalled();
  });

  it('rejects input exceeding the existing logo-byte budget before invoking the decoder', async () => {
    const oversized = new Uint8Array(MAX_LOGO_UPLOAD_BYTES + 1);
    oversized.set(pngHeader);

    await expect(normalizeOwnInvoiceImage(oversized)).rejects.toBeInstanceOf(OwnInvoiceImageError);
    expect(imageMocks.sharp).not.toHaveBeenCalled();
  });

  it.each([
    ['zero width', { width: 0, height: 320, format: 'jpeg' }],
    ['zero height', { width: 640, height: 0, format: 'jpeg' }],
    ['negative width', { width: -1, height: 320, format: 'jpeg' }],
    ['fractional height', { width: 640, height: 1.5, format: 'jpeg' }],
    ['width above bound', { width: 1_601, height: 320, format: 'jpeg' }],
    ['height above bound', { width: 640, height: 1_601, format: 'jpeg' }],
    ['wrong output format', { width: 640, height: 320, format: 'png' }],
  ] satisfies Array<[string, { width: number; height: number; format: string }]>)('rejects unacceptable normalized output: %s', async (_name, info) => {
    imageMocks.chain.toBuffer.mockResolvedValue({ data: encodedJpegFixture, info });

    await expect(normalizeOwnInvoiceImage(inputFixture)).rejects.toBeInstanceOf(OwnInvoiceImageError);
    expect(imageMocks.chain.toBuffer).toHaveBeenCalledTimes(1);
    expect(imageMocks.chain.metadata).not.toHaveBeenCalled();
  });

  it('rejects output exceeding the separate normalized-byte budget', async () => {
    imageMocks.chain.toBuffer.mockResolvedValue({ ...encodedResult(), data: Buffer.alloc(2 * 1024 * 1024 + 1) });

    await expect(normalizeOwnInvoiceImage(inputFixture)).rejects.toBeInstanceOf(OwnInvoiceImageError);
  });

  it('rejects an empty normalized output', async () => {
    imageMocks.chain.toBuffer.mockResolvedValue({ ...encodedResult(), data: Buffer.alloc(0) });
    await expect(normalizeOwnInvoiceImage(inputFixture)).rejects.toBeInstanceOf(OwnInvoiceImageError);
  });

  it('handles synchronous constructor/decoder errors with the same typed error', async () => {
    imageMocks.sharp.mockImplementation(() => { throw new Error('ordinary constructor rejection'); });

    await expect(normalizeOwnInvoiceImage(inputFixture)).rejects.toBeInstanceOf(OwnInvoiceImageError);
    expect(imageMocks.chain.metadata).not.toHaveBeenCalled();
    expect(imageMocks.chain.toBuffer).not.toHaveBeenCalled();
  });
});
