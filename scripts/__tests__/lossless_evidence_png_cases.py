"""Synthetic codec cases; no browser, application database or external files."""
import hashlib
import importlib.util
import pathlib
import struct
import unittest
import zlib

spec = importlib.util.spec_from_file_location('evidence_png', pathlib.Path(__file__).parents[1] / 'lossless_evidence_png.py')
codec = importlib.util.module_from_spec(spec)
spec.loader.exec_module(codec)


def chunk(kind, payload):
    return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload) & 0xffffffff)


def png(pixels, width=3, channels=3, method=0, metadata=(), split=False):
    stride = width * channels
    height = len(pixels) // stride
    previous, filtered = bytes(stride), bytearray()
    for start in range(0, len(pixels), stride):
        row = pixels[start:start + stride]
        filtered.append(method)
        for column, value in enumerate(row):
            left = row[column - channels] if column >= channels else 0
            up = previous[column]
            corner = previous[column - channels] if column >= channels else 0
            if method == 0:
                prediction = 0
            elif method == 1:
                prediction = left
            elif method == 2:
                prediction = up
            elif method == 3:
                prediction = (left + up) // 2
            else:
                p = left + up - corner
                distances = [abs(p - left), abs(p - up), abs(p - corner)]
                prediction = [left, up, corner][distances.index(min(distances))]
            filtered.append((value - prediction) & 255)
        previous = row
    compressed = zlib.compress(bytes(filtered), 1)
    parts = [compressed[:len(compressed) // 2], compressed[len(compressed) // 2:]] if split else [compressed]
    header = struct.pack('>IIBBBBB', width, height, 8, 2 if channels == 3 else 6, 0, 0, 0)
    return codec.SIGNATURE + chunk(b'IHDR', header) + b''.join(metadata) + b''.join(chunk(b'IDAT', part) for part in parts) + chunk(b'IEND', b'')


class LosslessEvidencePng(unittest.TestCase):
    def test_every_standard_filter_decodes_every_rgb_pixel(self):
        pixels = bytes((index * 73 + index // 5) % 256 for index in range(27))
        for method in range(5):
            with self.subTest(method=method):
                source = png(pixels, method=method, split=True)
                result, proof = codec.recompress_png(source)
                self.assertEqual(codec._decode(source)[3], pixels)
                self.assertEqual(codec._decode(result)[3], pixels)
                self.assertEqual(proof['fullPixelSha256'], hashlib.sha256(pixels).hexdigest())
                self.assertLessEqual(len(result), len(source))

    def test_every_filter_preserves_all_rgba_channels_including_zero_and_partial_alpha(self):
        pixels = bytes([1, 20, 30, 0, 200, 120, 3, 127, 255, 254, 253, 255] * 3)
        for method in range(5):
            with self.subTest(method=method):
                source = png(pixels, channels=4, method=method)
                result, proof = codec.recompress_png(source)
                self.assertEqual(codec._decode(result)[3], pixels)
                self.assertEqual(proof['channels'], 4)
                self.assertEqual((proof['width'], proof['height']), (3, 3))

    def test_preserves_exact_color_profile_and_all_non_idat_bytes(self):
        profile = bytearray(132)
        profile[:4], profile[16:20], profile[36:40] = (132).to_bytes(4, 'big'), b'RGB ', b'acsp'
        metadata = [chunk(b'iCCP', b'Synthetic RGB\0\0' + zlib.compress(bytes(profile))),
                    chunk(b'gAMA', struct.pack('>I', 45455)), chunk(b'cHRM', bytes(32)),
                    chunk(b'sBIT', bytes([8, 8, 8])), chunk(b'pHYs', struct.pack('>IIB', 2835, 2835, 1))]
        source = png(bytes([12, 34, 56] * 900), metadata=metadata)
        result, proof = codec.recompress_png(source)
        self.assertEqual(codec._decode(source)[4], codec._decode(result)[4])
        self.assertEqual(codec._decode(source)[3], codec._decode(result)[3])
        self.assertEqual(proof['inputSha256'], hashlib.sha256(source).hexdigest())

    def test_preserves_standard_srgb_intent(self):
        source = png(bytes(range(27)), metadata=[chunk(b'sRGB', b'\x02')])
        result, _ = codec.recompress_png(source)
        self.assertEqual(codec._decode(result)[4], codec._decode(source)[4])

    def test_retains_original_when_candidate_does_not_improve_size(self):
        source = png(b'\x00' * 9, method=0)
        result, _ = codec.recompress_png(source)
        self.assertEqual(result, source)

    def test_rejects_bad_signature_crc_truncation_and_trailing_bytes(self):
        source = png(bytes(range(27)))
        damaged = bytearray(source)
        damaged[29] ^= 1
        for value in [b'bad', bytes(damaged), source[:-1], source + b'x']:
            with self.subTest(size=len(value)), self.assertRaises((ValueError, zlib.error)):
                codec.recompress_png(value)

    def test_rejects_unknown_chunk_or_alpha_semantics(self):
        for kind in [b'acTL', b'dSIG', b'tRNS', b'zzZZ']:
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                codec.recompress_png(png(bytes(range(27)), metadata=[chunk(kind, b'')]))

    def test_rejects_malformed_or_conflicting_profiles(self):
        header_only = bytearray(128)
        header_only[:4], header_only[16:20], header_only[36:40] = (128).to_bytes(4, 'big'), b'RGB ', b'acsp'
        missing_table = header_only + struct.pack('>I', 1)
        missing_table[:4] = (132).to_bytes(4, 'big')
        for metadata in [[chunk(b'iCCP', b'broken')], [chunk(b'iCCP', b'name\0\0bad')],
                         [chunk(b'iCCP', b'name\0\0' + zlib.compress(header_only))],
                         [chunk(b'iCCP', b'name\0\0' + zlib.compress(missing_table))],
                         [chunk(b'sRGB', b'\x04')], [chunk(b'gAMA', bytes(4))],
                         [chunk(b'sRGB', b'\0'), chunk(b'sRGB', b'\0')]]:
            with self.subTest(metadata=metadata), self.assertRaises((ValueError, zlib.error)):
                codec.recompress_png(png(bytes(range(27)), metadata=metadata))

    def test_rejects_unknown_filters_and_extra_deflate_data(self):
        header = chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0))
        for compressed in [zlib.compress(b'\x05\0\0\0'), zlib.compress(b'\0' * 20),
                           zlib.compress(b'\0' * 4) + b'garbage', zlib.compress(b'\0' * 4)[:-1]]:
            with self.subTest(compressed=compressed), self.assertRaises((ValueError, zlib.error)):
                codec.recompress_png(codec.SIGNATURE + header + chunk(b'IDAT', compressed) + chunk(b'IEND', b''))
        with self.assertRaisesRegex(ValueError, 'chunk count'):
            codec.recompress_png(codec.SIGNATURE + header + chunk(b'IDAT', b'') * 4097 + chunk(b'IEND', b''))

    def test_rejects_oversized_and_unsupported_headers_before_inflation(self):
        for width, height, depth, color, interlace in [(16384, 16384, 8, 6, 0), (0, 1, 8, 2, 0),
                                                     (1, 1, 16, 2, 0), (1, 1, 8, 3, 0), (1, 1, 8, 2, 1)]:
            header = chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, depth, color, 0, 0, interlace))
            with self.subTest(width=width, depth=depth, color=color), self.assertRaises(ValueError):
                codec.recompress_png(codec.SIGNATURE + header + chunk(b'IDAT', b'x') + chunk(b'IEND', b''))


if __name__ == '__main__':
    unittest.main()
