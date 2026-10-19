"""Produce a deterministic 256px ICO from an embedded PNG (Python stdlib only)."""
import struct
import zlib
from pathlib import Path

size = 256
pixels = bytearray()
for y in range(size):
    pixels.append(0)
    for x in range(size):
        # Rounded blue tile, pale document page and two ink rules.
        tile = 14 < x < 242 and 14 < y < 242 and not ((x < 42 or x > 214) and (y < 42 or y > 214))
        page = 70 < x < 185 and 50 < y < 208
        rule = 90 < x < 166 and (112 < y < 119 or 137 < y < 144 or 162 < y < 169)
        pixels.extend((32, 45, 64, 255) if rule else (255, 255, 255, 255) if page else (49, 93, 204, 255) if tile else (0, 0, 0, 0))


def chunk(tag: bytes, body: bytes) -> bytes:
    return struct.pack('>I', len(body)) + tag + body + struct.pack('>I', zlib.crc32(tag + body))

png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(bytes(pixels))) + chunk(b'IEND', b''))
ico = struct.pack('<HHH', 0, 1, 1) + struct.pack('<BBBBHHII', 0, 0, 0, 0, 1, 32, len(png), 22) + png
Path(__file__).with_name('icon.ico').write_bytes(ico)
