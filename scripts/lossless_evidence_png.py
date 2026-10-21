"""Bounded PNG recompression for synthetic browser evidence, never image edits.

Only non-interlaced RGB/RGBA8 screenshots and known color metadata are accepted.
Every non-IDAT chunk is retained byte-for-byte. A candidate must decode to the
same complete pixel buffer before it can replace the original encoded bytes.
"""
import hashlib
import struct
import zlib

SIGNATURE = b'\x89PNG\r\n\x1a\n'
MAX_PNG_BYTES = 5 * 1024 * 1024
MAX_PIXEL_BYTES = 64 * 1024 * 1024
COLOR_CHUNKS = {b'sRGB', b'gAMA', b'cHRM', b'iCCP', b'sBIT', b'pHYs'}


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def _chunk(kind, payload):
    return (struct.pack('>I', len(payload)) + kind + payload
            + struct.pack('>I', zlib.crc32(kind + payload) & 0xffffffff))


def _decode(data):
    _require(isinstance(data, bytes) and 0 < len(data) <= MAX_PNG_BYTES
             and data.startswith(SIGNATURE), 'unsupported PNG input or size')
    chunks, compressed, metadata, seen = [], [], [], set()
    offset, previous, width, height, channels = 8, None, 0, 0, 0
    while offset < len(data):
        _require(len(chunks) < 4096, 'PNG chunk count exceeds bound')
        _require(offset + 12 <= len(data), 'truncated PNG chunk')
        size = struct.unpack_from('>I', data, offset)[0]
        end = offset + size + 12
        _require(size <= MAX_PNG_BYTES and end <= len(data), 'unsafe PNG chunk size')
        kind, payload = data[offset + 4:offset + 8], data[offset + 8:end - 4]
        raw = data[offset:end]
        crc = struct.unpack_from('>I', data, end - 4)[0]
        _require(zlib.crc32(kind + payload) & 0xffffffff == crc, 'PNG CRC mismatch')
        _require(kind in COLOR_CHUNKS | {b'IHDR', b'IDAT', b'IEND'}, 'unknown PNG chunk semantics')
        if not chunks:
            _require(kind == b'IHDR' and size == 13, 'missing PNG header')
            width, height, depth, color, compression, filtering, interlace = struct.unpack('>IIBBBBB', payload)
            channels = {2: 3, 6: 4}.get(color, 0)
            _require(0 < width <= 16384 and 0 < height <= 16384 and depth == 8
                     and channels and compression == filtering == interlace == 0,
                     'unsupported PNG pixel format')
            _require(height * (width * channels + 1) <= MAX_PIXEL_BYTES, 'PNG decode exceeds bound')
        elif kind == b'IHDR':
            raise ValueError('duplicate PNG header')
        if kind == b'IDAT':
            _require(previous in (b'IHDR', b'IDAT') or (not compressed and previous in COLOR_CHUNKS),
                     'non-consecutive PNG image data')
            compressed.append(payload)
        else:
            _require(kind not in seen, 'duplicate PNG metadata')
            seen.add(kind)
            if kind in COLOR_CHUNKS:
                _require(not compressed, 'late PNG color metadata')
                if kind == b'sRGB':
                    _require(size == 1 and payload[0] <= 3, 'invalid sRGB metadata')
                elif kind == b'gAMA':
                    _require(size == 4 and int.from_bytes(payload, 'big') > 0, 'invalid gamma metadata')
                elif kind == b'cHRM':
                    _require(size == 32, 'invalid chromaticity metadata')
                elif kind == b'pHYs':
                    _require(size == 9 and payload[-1] <= 1, 'invalid density metadata')
                elif kind == b'sBIT':
                    _require(size == channels and all(0 < value <= 8 for value in payload), 'invalid bit metadata')
                elif kind == b'iCCP':
                    separator = payload.find(b'\0')
                    _require(0 < separator <= 79 and size > separator + 2
                             and payload[separator + 1] == 0, 'invalid color-profile metadata')
                    profile_reader = zlib.decompressobj()
                    profile = profile_reader.decompress(payload[separator + 2:], 4 * 1024 * 1024 + 1)
                    _require(132 <= len(profile) <= 4 * 1024 * 1024 and profile_reader.eof
                             and not profile_reader.unused_data and not profile_reader.unconsumed_tail
                             and int.from_bytes(profile[:4], 'big') == len(profile)
                             and profile[16:20] == b'RGB ' and profile[36:40] == b'acsp',
                             'unsupported RGB color-profile header')
                    tags = int.from_bytes(profile[128:132], 'big')
                    table_end = 132 + tags * 12
                    _require(tags <= 4096 and table_end <= len(profile), 'invalid color-profile tag table')
                    for index in range(tags):
                        tag = profile[132 + index * 12:144 + index * 12]
                        start, length = int.from_bytes(tag[4:8], 'big'), int.from_bytes(tag[8:12], 'big')
                        _require(start >= table_end and start % 4 == 0 and length >= 8
                                 and start + length <= len(profile), 'invalid color-profile tag bounds')
            metadata.append(raw)
        chunks.append((kind, raw))
        offset, previous = end, kind
        if kind == b'IEND':
            _require(size == 0 and offset == len(data) and compressed, 'invalid PNG end')
            break
    _require(previous == b'IEND', 'missing PNG end')
    _require(not ({b'iCCP', b'sRGB'} <= seen), 'conflicting PNG color profiles')
    stride, expected = width * channels, height * (width * channels + 1)
    inflater = zlib.decompressobj()
    filtered = inflater.decompress(b''.join(compressed), expected + 1)
    _require(len(filtered) == expected and inflater.eof and not inflater.unused_data
             and not inflater.unconsumed_tail, 'invalid or oversized PNG deflate data')
    pixels, above = bytearray(), bytearray(stride)
    for index in range(height):
        start = index * (stride + 1)
        method, row = filtered[start], bytearray(filtered[start + 1:start + stride + 1])
        _require(method <= 4, 'unknown PNG row filter')
        if method == 1:
            for column in range(channels, stride):
                row[column] = (row[column] + row[column - channels]) & 255
        elif method == 2:
            row = bytearray((value + above[column]) & 255 for column, value in enumerate(row))
        elif method in (3, 4):
            for column in range(stride):
                left = row[column - channels] if column >= channels else 0
                up, upper_left = above[column], above[column - channels] if column >= channels else 0
                if method == 3:
                    prediction = (left + up) // 2
                else:
                    a, b, c = abs(up - upper_left), abs(left - upper_left), abs(left + up - 2 * upper_left)
                    prediction = left if a <= b and a <= c else up if b <= c else upper_left
                row[column] = (row[column] + prediction) & 255
        pixels.extend(row)
        above = row
    return width, height, channels, bytes(pixels), metadata, chunks


def recompress_png(data):
    width, height, channels, pixels, metadata, chunks = _decode(data)
    stride = width * channels
    # Filter 0 often compresses flat UI screenshots better than adaptive rows.
    # Neither candidate changes pixel values, color profiles, alpha or geometry.
    filtered = b''.join(b'\0' + pixels[start:start + stride] for start in range(0, len(pixels), stride))
    encoded = _chunk(b'IDAT', zlib.compress(filtered, 9))
    output, inserted = bytearray(SIGNATURE), False
    for kind, raw in chunks:
        if kind == b'IDAT':
            if not inserted:
                output.extend(encoded)
                inserted = True
        else:
            output.extend(raw)
    candidate = bytes(output)
    if len(candidate) > MAX_PNG_BYTES:
        candidate = data
    decoded = _decode(candidate)
    _require(decoded[:3] == (width, height, channels) and decoded[3] == pixels
             and decoded[4] == metadata, 'lossless PNG equivalence failed')
    result = candidate if len(candidate) < len(data) else data
    return result, {
        'width': width, 'height': height, 'channels': channels,
        'inputBytes': len(data), 'outputBytes': len(result),
        'inputSha256': hashlib.sha256(data).hexdigest(),
        'outputSha256': hashlib.sha256(result).hexdigest(),
        'fullPixelSha256': hashlib.sha256(pixels).hexdigest(),
        'nonIdatSha256': hashlib.sha256(b''.join(metadata)).hexdigest(),
    }
