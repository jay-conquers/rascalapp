#!/usr/bin/env python3
"""Draw Ember's launcher icon. Stdlib only, so the AppImage build can regenerate it."""

import math
import struct
import zlib
from pathlib import Path


def clamp(value: float) -> int:
    return max(0, min(255, int(round(value))))


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(4))


def inside_round_rect(u, v, radius):
    # u,v in 0..1. Keep a margin so the rounded tile sits inside the canvas.
    m = 0.06
    x = min(max(u, m), 1 - m)
    y = min(max(v, m), 1 - m)
    dx = abs(u - 0.5) - (0.5 - m - radius)
    dy = abs(v - 0.5) - (0.5 - m - radius)
    outside = (max(dx, 0) ** 2 + max(dy, 0) ** 2) ** 0.5
    return outside <= radius and m <= u <= 1 - m and m <= v <= 1 - m


def flame(u, v, scale, drop):
    """Teardrop that is pointed on top and rounded on the bottom."""
    top = 0.18 + drop
    bottom = 0.84
    if v < top or v > bottom:
        return False
    t = (v - top) / (bottom - top)
    grow = 1 - (1 - t) ** 1.55
    width = scale * (0.02 + 0.40 * grow)
    if t > 0.78:
        base = (t - 0.78) / 0.22
        width *= math.sqrt(max(0.0, 1 - base * base))
    cx = 0.51 + 0.045 * math.sin((t - 0.05) * 3.4)
    if abs(u - cx) > width * 0.5:
        return False
    # A bite out of the lower-left side so the silhouette reads as a flame.
    if scale > 0.7 and ellipse(u, v, 0.30, 0.66, 0.11, 0.18):
        return False
    return True


def ellipse(u, v, cx, cy, rx, ry):
    return ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2 <= 1


def scene(u, v):
    if not inside_round_rect(u, v, 0.20):
        return (0, 0, 0, 0)
    bg = mix((54, 26, 16, 255), (14, 9, 8, 255), v * 0.85)
    if flame(u, v, 1.0, 0.0):
        color = (255, 78, 28, 255)
        if flame(u, v, 0.62, 0.08):
            color = (255, 154, 48, 255)
        if flame(u, v, 0.30, 0.16):
            color = (255, 228, 156, 255)
        return color
    return bg


def render(size: int):
    samples = 4
    buf = bytearray(size * size * 4)
    for y in range(size):
        for x in range(size):
            acc = [0.0, 0.0, 0.0, 0.0]
            for sy in range(samples):
                for sx in range(samples):
                    u = (x + (sx + 0.5) / samples) / size
                    v = (y + (sy + 0.5) / samples) / size
                    pixel = scene(u, v)
                    for i in range(4):
                        acc[i] += pixel[i]
            offset = (y * size + x) * 4
            scale = samples * samples
            for i in range(4):
                buf[offset + i] = clamp(acc[i] / scale)
    return bytes(buf)


def write_png(path: Path, size: int, rgba: bytes) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + rgba[y * size * 4 : (y + 1) * size * 4] for y in range(size))
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def main() -> None:
    root = Path(__file__).resolve().parents[1] / "build" / "icons"
    root.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 64, 128, 256, 512):
        write_png(root / f"{size}x{size}.png", size, render(size))
        print(root / f"{size}x{size}.png")


if __name__ == "__main__":
    main()
