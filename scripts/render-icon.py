#!/usr/bin/env python3
"""Rasterize build/icon.svg into the PNG sizes electron-builder expects, plus ICO and ICNS.

Stdlib only. The SVG is the source; this flattens its circles, ellipses, and
paths (M/L/H/V/C/Q/Z), applies translate() and clip-path, and paints them with
supersampling. Windows and macOS icons are packed from those PNGs.
"""

import math
import re
import shutil
import struct
import sys
import xml.etree.ElementTree as ET
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SVG_PATH = ROOT / "build" / "icon.svg"
ICON_DIR = ROOT / "build" / "icons"
TOKEN = re.compile(r"[MmLlHhVvCcQqSsTtAaZz]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?")


def clamp(value: float) -> int:
    return max(0, min(255, int(round(value))))


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def parse_color(value: str | None):
    if not value or value.strip() in {"none", "transparent"}:
        return None
    raw = value.strip()
    if not raw.startswith("#"):
        raise SystemExit(f"unsupported color {value}")
    hex_color = raw[1:]
    if len(hex_color) == 3:
        hex_color = "".join(ch * 2 for ch in hex_color)
    if len(hex_color) != 6:
        raise SystemExit(f"unsupported color {value}")
    return tuple(int(hex_color[i : i + 2], 16) / 255 for i in (0, 2, 4)) + (1.0,)


def curve_steps(points) -> int:
    length = 0.0
    for start, end in zip(points, points[1:]):
        length += math.hypot(end[0] - start[0], end[1] - start[1])
    # Short segments keep ear tips and the tail curl smooth at 512px.
    return max(12, min(48, int(length * 3) + 1))


def flatten_cubic(p0, p1, p2, p3, steps=0):
    count = steps or curve_steps((p0, p1, p2, p3))
    points = []
    for step in range(1, count + 1):
        t = step / count
        u = 1 - t
        points.append((
            u ** 3 * p0[0] + 3 * u ** 2 * t * p1[0] + 3 * u * t ** 2 * p2[0] + t ** 3 * p3[0],
            u ** 3 * p0[1] + 3 * u ** 2 * t * p1[1] + 3 * u * t ** 2 * p2[1] + t ** 3 * p3[1],
        ))
    return points


def flatten_quad(p0, p1, p2, steps=0):
    count = steps or curve_steps((p0, p1, p2))
    points = []
    for step in range(1, count + 1):
        t = step / count
        u = 1 - t
        points.append((
            u ** 2 * p0[0] + 2 * u * t * p1[0] + t ** 2 * p2[0],
            u ** 2 * p0[1] + 2 * u * t * p1[1] + t ** 2 * p2[1],
        ))
    return points


def path_contours(d: str):
    tokens = TOKEN.findall(d)
    index = 0
    cx = cy = 0.0
    sx = sy = 0.0
    command = ""
    contours = []
    current = []

    def start_contour(x, y):
        nonlocal current, sx, sy, cx, cy
        if current:
            contours.append(current)
        current = [(x, y)]
        sx, sy = x, y
        cx, cy = x, y

    while index < len(tokens):
        token = tokens[index]
        if token.isalpha():
            command = token
            index += 1
            if command in "Zz" and current:
                current.append((sx, sy))
                contours.append(current)
                current = []
                cx, cy = sx, sy
            continue
        relative = command.islower()
        cmd = command.upper()
        if cmd == "M":
            x, y = float(tokens[index]), float(tokens[index + 1])
            index += 2
            if relative:
                x += cx
                y += cy
            start_contour(x, y)
            command = "l" if relative else "L"
        elif cmd == "L":
            x, y = float(tokens[index]), float(tokens[index + 1])
            index += 2
            if relative:
                x += cx
                y += cy
            current.append((x, y))
            cx, cy = x, y
        elif cmd == "H":
            x = float(tokens[index]) + (cx if relative else 0)
            index += 1
            current.append((x, cy))
            cx = x
        elif cmd == "V":
            y = float(tokens[index]) + (cy if relative else 0)
            index += 1
            current.append((cx, y))
            cy = y
        elif cmd == "C":
            x1, y1, x2, y2, x, y = (float(tokens[index + i]) for i in range(6))
            index += 6
            if relative:
                x1 += cx
                y1 += cy
                x2 += cx
                y2 += cy
                x += cx
                y += cy
            current.extend(flatten_cubic((cx, cy), (x1, y1), (x2, y2), (x, y)))
            cx, cy = x, y
        elif cmd == "Q":
            x1, y1, x, y = (float(tokens[index + i]) for i in range(4))
            index += 4
            if relative:
                x1 += cx
                y1 += cy
                x += cx
                y += cy
            current.extend(flatten_quad((cx, cy), (x1, y1), (x, y)))
            cx, cy = x, y
        else:
            raise SystemExit(f"unsupported path command {command}")
    if current:
        contours.append(current)
    return contours


def even_odd(x, y, contours) -> bool:
    inside = False
    for points in contours:
        count = len(points)
        j = count - 1
        for i in range(count):
            xi, yi = points[i]
            xj, yj = points[j]
            if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 0.0) + xi):
                inside = not inside
            j = i
    return inside


def segment_hit(x, y, x1, y1, x2, y2, radius, cap) -> bool:
    dx = x2 - x1
    dy = y2 - y1
    length_sq = dx * dx + dy * dy
    if length_sq == 0:
        return math.hypot(x - x1, y - y1) <= radius
    t = ((x - x1) * dx + (y - y1) * dy) / length_sq
    if cap == "butt" and (t < 0 or t > 1):
        return False
    t_clamped = min(1.0, max(0.0, t))
    qx = x1 + t_clamped * dx
    qy = y1 + t_clamped * dy
    return math.hypot(x - qx, y - qy) <= radius


def stroke_segments(contours, width, cap, dash):
    radius = width / 2
    segments = []
    pattern = None
    if dash:
        lengths = [float(part) for part in re.split(r"[\s,]+", dash.strip()) if part]
        if lengths:
            pattern = lengths
    for points in contours:
        if len(points) < 2:
            continue
        distance = 0.0
        for start, end in zip(points, points[1:]):
            length = math.hypot(end[0] - start[0], end[1] - start[1])
            if length == 0:
                continue
            if pattern is None:
                segments.append((start, end, radius, cap))
            else:
                cursor = 0.0
                while cursor < length - 1e-6:
                    cycle = sum(pattern) or length
                    pos = (distance + cursor) % cycle
                    walked = 0.0
                    on = True
                    span = pattern[0]
                    for index, part in enumerate(pattern):
                        if pos < walked + part:
                            on = index % 2 == 0
                            span = walked + part - pos
                            break
                        walked += part
                    step = min(span, length - cursor)
                    if on and step > 0:
                        a = cursor / length
                        b = (cursor + step) / length
                        p1 = (start[0] + (end[0] - start[0]) * a, start[1] + (end[1] - start[1]) * a)
                        p2 = (start[0] + (end[0] - start[0]) * b, start[1] + (end[1] - start[1]) * b)
                        segments.append((p1, p2, radius, cap))
                    cursor += step
            distance += length
    return segments


class Shape:
    def __init__(self, color, bounds, hit):
        self.color = color
        self.bounds = bounds
        self.hit = hit


def bounds_of(points, pad=0):
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return (min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad)


def contour_tester(contours):
    """Point-in-polygon using the same even-odd rule, with edges binned by y."""
    cell = 32.0
    buckets: dict[int, list] = {}
    for points in contours:
        if len(points) < 2:
            continue
        previous = len(points) - 1
        for index in range(len(points)):
            xi, yi = points[index]
            xj, yj = points[previous]
            previous = index
            y_lo = yi if yi < yj else yj
            y_hi = yj if yi < yj else yi
            if y_lo == y_hi:
                continue
            edge = (xi, yi, xj, yj)
            start = math.floor(y_lo / cell)
            stop = math.floor(y_hi / cell)
            for bucket in range(start, stop + 1):
                buckets.setdefault(bucket, []).append(edge)

    def contains(x, y):
        inside = False
        for xi, yi, xj, yj in buckets.get(math.floor(y / cell), ()):
            if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
                inside = not inside
        return inside

    return contains


def add_fill(shapes, contours, color, clip=None):
    if color is None or not contours:
        return
    points = [point for contour in contours for point in contour]
    box = bounds_of(points)
    contains = contour_tester(contours)

    def hit(x, y):
        if clip is not None and not clip(x, y):
            return False
        return contains(x, y)

    shapes.append(Shape(color, box, hit))


def add_stroke(shapes, contours, color, width, cap, dash, clip=None):
    if color is None or width <= 0:
        return
    segments = stroke_segments(contours, width, cap, dash)
    if not segments:
        return
    points = [point for start, end, _radius, _cap in segments for point in (start, end)]
    box = bounds_of(points, pad=width)
    # Bin segments so a detailed outline does not test every sample against every segment.
    cell = max(width * 2, 4.0)
    grid: dict[tuple[int, int], list] = {}
    for segment in segments:
        start, end, radius, _cap_name = segment
        min_x = min(start[0], end[0]) - radius
        max_x = max(start[0], end[0]) + radius
        min_y = min(start[1], end[1]) - radius
        max_y = max(start[1], end[1]) + radius
        for gx in range(math.floor(min_x / cell), math.floor(max_x / cell) + 1):
            for gy in range(math.floor(min_y / cell), math.floor(max_y / cell) + 1):
                grid.setdefault((gx, gy), []).append(segment)

    def hit(x, y):
        if clip is not None and not clip(x, y):
            return False
        bucket = grid.get((math.floor(x / cell), math.floor(y / cell)))
        if not bucket:
            return False
        return any(
            segment_hit(x, y, start[0], start[1], end[0], end[1], radius, cap_name)
            for start, end, radius, cap_name in bucket
        )

    shapes.append(Shape(color, box, hit))


def ellipse_contours(cx, cy, rx, ry, steps=48):
    points = []
    for step in range(steps):
        angle = (step / steps) * math.tau
        points.append((cx + math.cos(angle) * rx, cy + math.sin(angle) * ry))
    points.append(points[0])
    return [points]


TRANSLATE = re.compile(r"translate\(\s*([-+0-9.eE]+)(?:[\s,]+([-+0-9.eE]+))?\s*\)")


def parse_translate(value: str | None):
    if not value:
        return 0.0, 0.0
    match = TRANSLATE.fullmatch(value.strip())
    if not match:
        raise SystemExit(f"unsupported transform {value}")
    return float(match.group(1)), float(match.group(2) or 0)


def shift(contours, tx, ty):
    if tx == 0 and ty == 0:
        return contours
    return [[(x + tx, y + ty) for x, y in contour] for contour in contours]


def clip_reference(value: str | None):
    if not value:
        return None
    match = re.fullmatch(r"url\(#([^)]+)\)", value.strip())
    if not match:
        raise SystemExit(f"unsupported clip-path {value}")
    return match.group(1)


def element_contours(element, tx, ty):
    kind = local(element.tag)
    ox, oy = parse_translate(element.attrib.get("transform"))
    tx += ox
    ty += oy
    if kind == "path":
        return shift(path_contours(element.attrib.get("d", "")), tx, ty)
    if kind == "circle":
        cx = float(element.attrib.get("cx", "0"))
        cy = float(element.attrib.get("cy", "0"))
        radius = float(element.attrib.get("r", "0"))
        return shift(ellipse_contours(cx, cy, radius, radius), tx, ty)
    if kind == "ellipse":
        cx = float(element.attrib.get("cx", "0"))
        cy = float(element.attrib.get("cy", "0"))
        rx = float(element.attrib.get("rx", "0"))
        ry = float(element.attrib.get("ry", "0"))
        return shift(ellipse_contours(cx, cy, rx, ry), tx, ty)
    return []


def collect_clips(element, clips):
    for child in list(element):
        kind = local(child.tag)
        if kind == "clipPath" and child.attrib.get("id"):
            contours = []
            for node in list(child):
                contours.extend(element_contours(node, 0.0, 0.0))
            clips[child.attrib["id"]] = contour_tester(contours)
        elif kind in {"defs", "g", "svg"}:
            collect_clips(child, clips)


def paint_element(element, shapes, tx, ty, clip, clips):
    kind = local(element.tag)
    if kind in {"defs", "clipPath", "style", "title", "desc", "metadata"}:
        return
    ox, oy = parse_translate(element.attrib.get("transform"))
    tx += ox
    ty += oy
    active = clip
    reference = clip_reference(element.attrib.get("clip-path"))
    if reference:
        active = clips[reference]
    if kind == "g":
        for child in list(element):
            paint_element(child, shapes, tx, ty, active, clips)
        return
    if kind == "svg":
        for child in list(element):
            paint_element(child, shapes, tx, ty, active, clips)
        return
    contours = element_contours(element, tx - ox, ty - oy)
    if kind in {"circle", "ellipse", "path"}:
        add_fill(shapes, contours, parse_color(element.attrib.get("fill")), active)
    if kind == "path":
        cap = element.attrib.get("stroke-linecap", "butt")
        add_stroke(
            shapes,
            contours,
            parse_color(element.attrib.get("stroke")),
            float(element.attrib.get("stroke-width", "1")),
            cap,
            element.attrib.get("stroke-dasharray"),
            active,
        )


def load_shapes(path: Path):
    tree = ET.parse(path)
    root = tree.getroot()
    view = root.attrib.get("viewBox", "0 0 32 32").split()
    vb_x, vb_y, vb_w, vb_h = (float(part) for part in view)
    clips = {}
    collect_clips(root, clips)
    shapes = []
    paint_element(root, shapes, 0.0, 0.0, None, clips)
    return (vb_x, vb_y, vb_w, vb_h), shapes


def composite(dst, src):
    sr, sg, sb, sa = src
    dr, dg, db, da = dst
    out_a = sa + da * (1 - sa)
    if out_a <= 0:
        return (0.0, 0.0, 0.0, 0.0)
    return (
        (sr * sa + dr * da * (1 - sa)) / out_a,
        (sg * sa + dg * da * (1 - sa)) / out_a,
        (sb * sa + db * da * (1 - sa)) / out_a,
        out_a,
    )


def render(size: int, view, shapes, samples: int) -> bytes:
    vb_x, vb_y, vb_w, vb_h = view
    buf = bytearray(size * size * 4)
    for y in range(size):
        for x in range(size):
            acc = [0.0, 0.0, 0.0, 0.0]
            for sy in range(samples):
                for sx in range(samples):
                    px = vb_x + ((x + (sx + 0.5) / samples) / size) * vb_w
                    py = vb_y + ((y + (sy + 0.5) / samples) / size) * vb_h
                    color = (0.0, 0.0, 0.0, 0.0)
                    for shape in shapes:
                        left, top, right, bottom = shape.bounds
                        if px < left or px > right or py < top or py > bottom:
                            continue
                        if shape.hit(px, py):
                            color = composite(color, shape.color)
                    for channel in range(4):
                        acc[channel] += color[channel]
            offset = (y * size + x) * 4
            scale = samples * samples
            alpha = acc[3] / scale
            if alpha <= 0:
                continue
            for channel in range(3):
                buf[offset + channel] = clamp((acc[channel] / scale) * 255)
            buf[offset + 3] = clamp(alpha * 255)
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


def samples_for(size: int) -> int:
    if size <= 32:
        return 6
    if size <= 64:
        return 4
    if size <= 128:
        return 3
    return 2


def write_ico(path: Path, pngs: list[tuple[int, bytes]]) -> None:
    count = len(pngs)
    header = struct.pack("<HHH", 0, 1, count)
    offset = 6 + 16 * count
    entries = b""
    blobs = b""
    for size, data in pngs:
        width = 0 if size >= 256 else size
        height = 0 if size >= 256 else size
        entries += struct.pack("<BBBBHHII", width, height, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
        blobs += data
    path.write_bytes(header + entries + blobs)


def write_icns(path: Path, pngs: dict[int, bytes]) -> None:
    kinds = [
        (16, b"icp4"),
        (32, b"icp5"),
        (32, b"ic11"),
        (64, b"icp6"),
        (64, b"ic12"),
        (128, b"ic07"),
        (256, b"ic08"),
        (256, b"ic13"),
        (512, b"ic09"),
        (512, b"ic14"),
    ]
    chunks = b""
    for size, tag in kinds:
        data = pngs.get(size)
        if data is None:
            continue
        chunks += tag + struct.pack(">I", len(data) + 8) + data
    path.write_bytes(b"icns" + struct.pack(">I", len(chunks) + 8) + chunks)


def probe(size: int, view, shapes) -> None:
    rgba = render(size, view, shapes, 2)
    import json

    def pixel(x, y):
        index = (y * size + x) * 4
        return list(rgba[index : index + 4])

    print(json.dumps({
        "center": pixel(size // 2, size // 2),
        "corner": pixel(0, 0),
        "mid": pixel(size // 2, size // 3),
    }))


def main() -> None:
    view, shapes = load_shapes(SVG_PATH)
    args = sys.argv[1:]
    if "--probe" in args:
        size = int(args[args.index("--size") + 1]) if "--size" in args else 32
        probe(size, view, shapes)
        return
    if "--size" in args:
        size = int(args[args.index("--size") + 1])
        out = Path(args[args.index("--out") + 1]) if "--out" in args else ICON_DIR / f"{size}x{size}.png"
        out.parent.mkdir(parents=True, exist_ok=True)
        write_png(out, size, render(size, view, shapes, samples_for(size)))
        print(out)
        return
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    rendered = {}
    for size in (16, 32, 48, 64, 128, 256, 512):
        rgba = render(size, view, shapes, samples_for(size))
        rendered[size] = rgba
        destination = ICON_DIR / f"{size}x{size}.png"
        write_png(destination, size, rgba)
        print(destination)
    packaging = ROOT / "packaging" / "rascal.png"
    write_png(packaging, 256, rendered[256])
    print(packaging)
    shutil.copyfile(ICON_DIR / "256x256.png", ROOT / "build" / "icon.png")
    encoded = {size: (ICON_DIR / f"{size}x{size}.png").read_bytes() for size in rendered}
    ico = ROOT / "build" / "icon.ico"
    icns = ROOT / "build" / "icon.icns"
    write_ico(ico, [(size, encoded[size]) for size in (16, 32, 48, 64, 128, 256) if size in encoded])
    write_icns(icns, encoded)
    print(ico)
    print(icns)


if __name__ == "__main__":
    main()
