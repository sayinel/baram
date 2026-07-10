#!/usr/bin/env python3
"""Generate the "recent vault" menu icon used by the native File > Open Recent
submenu (§82). Renders a small safe/vault glyph (rounded-square door + dial ring
+ center dot) via supersampled SDF, and emits:

  - src-tauri/icons/recent-vault.rgba : raw 32x32 RGBA bytes, embedded in Rust
    via include_bytes! and loaded with tauri::image::Image::new (no cargo
    feature / no PNG decode needed; muda IconMenuItem custom icons are
    cross-platform: macOS / Windows / Linux).
  - <outdir>/recent-vault.png : a viewable preview (NOT bundled; for humans /
    visual QA only).

Pure Python stdlib (math, struct, zlib) — no PIL / external rasterizer needed.

Usage: python3 scripts/gen-recent-vault-icon.py [OUT_DIR_FOR_PNG]
"""
import math
import os
import struct
import sys
import zlib

SIZE = 32          # final icon edge (px)
SS = 8             # supersampling factor per axis
# Mid-tone gray-blue so the glyph reads on both light and dark native menus
# (muda does not render custom icons as auto-tinting templates).
GLYPH_RGB = (122, 124, 134)


def length(x, y):
    return math.hypot(x, y)


def sd_round_box(px, py, bx, by, r):
    qx = abs(px) - bx + r
    qy = abs(py) - by + r
    return length(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - r


def coverage(px, py):
    """Return True if the supersample point (px,py in 32px space, centered at
    16,16) is inside the glyph ink."""
    cx, cy = px - 16.0, py - 16.0
    # Outer rounded-square door outline
    d_box = sd_round_box(cx, cy, 12.0, 12.0, 3.5)
    if abs(d_box) <= 1.35:
        return True
    # Dial ring
    d_ring = length(cx, cy) - 6.3
    if abs(d_ring) <= 1.15:
        return True
    # Center hub dot
    if length(cx, cy) - 1.7 <= 0.0:
        return True
    return False


def render():
    rgba = bytearray(SIZE * SIZE * 4)
    gr, gg, gb = GLYPH_RGB
    for y in range(SIZE):
        for x in range(SIZE):
            hits = 0
            for sy in range(SS):
                for sx in range(SS):
                    px = x + (sx + 0.5) / SS
                    py = y + (sy + 0.5) / SS
                    if coverage(px, py):
                        hits += 1
            a = round(255 * hits / (SS * SS))
            i = (y * SIZE + x) * 4
            rgba[i] = gr
            rgba[i + 1] = gg
            rgba[i + 2] = gb
            rgba[i + 3] = a
    return rgba


def write_png(path, w, h, rgba):
    def chunk(typ, data):
        return (
            struct.pack(">I", len(data))
            + typ
            + data
            + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)
        )

    raw = bytearray()
    for y in range(h):
        raw.append(0)  # filter type 0 (none)
        raw += rgba[y * w * 4 : (y + 1) * w * 4]
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
        f.write(chunk(b"IEND", b""))


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    repo = os.path.dirname(here)
    rgba = render()

    rgba_path = os.path.join(repo, "src-tauri", "icons", "recent-vault.rgba")
    with open(rgba_path, "wb") as f:
        f.write(bytes(rgba))
    print(f"wrote {rgba_path} ({len(rgba)} bytes, {SIZE}x{SIZE} RGBA)")

    png_dir = sys.argv[1] if len(sys.argv) > 1 else here
    png_path = os.path.join(png_dir, "recent-vault.png")
    write_png(png_path, SIZE, SIZE, rgba)
    print(f"wrote {png_path} (preview)")


if __name__ == "__main__":
    main()
