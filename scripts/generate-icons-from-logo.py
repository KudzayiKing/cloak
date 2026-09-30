#!/usr/bin/env python3
"""
Generate the Cloak PWA icon set from the user-created cloak logo.

The uploaded SVG wraps a single raster PNG (base64-embedded). We decode it
directly — no SVG renderer involved — compose it onto the SVG's own canvas
using the <use> offset, and then produce:

  public/icons/icon-192.png           transparent bg, artwork fit ~82%
  public/icons/icon-512.png           transparent bg, artwork fit ~82%
  public/icons/icon-maskable-512.png  solid brand bg, artwork in safe zone
  public/icons/apple-touch-icon.png   solid brand bg, 180x180

Centring: the mark is a ring with its opening on the right, so its alpha
bounding box is NOT symmetric — the left edge is the ring, the right edge is
the tip of an arm that stops well short of the ring's rightmost point.
Centring that bbox (what this script used to do) pushes the visible mark to the
right, which is exactly the "the C is not centred" bug. We instead centre the
mark's own geometry: the minimal enclosing circle of the ink, which for this
artwork is the ring's outer circle.

If the artwork has no alpha (opaque rectangle) we center-crop it to a square
and use full-bleed backgrounds instead.
"""

import base64
import io
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SVG_PATH = ROOT / "public" / "cloak-logo.svg"
OUT_DIR = ROOT / "public" / "icons"

BRAND_BG = (11, 11, 12, 255)  # #0B0B0C — manifest background_color

svg = SVG_PATH.read_text(encoding="utf-8")

match = re.search(r"base64,([A-Za-z0-9+/=]+)", svg)
if not match:
    raise SystemExit("no embedded base64 image found in the logo svg")

raw = base64.b64decode(match.group(1))
logo = Image.open(io.BytesIO(raw)).convert("RGBA")
print(f"embedded image: {logo.size[0]}x{logo.size[1]}")

# The SVG's own canvas and <use> offset. Reading them (rather than assuming)
# keeps the icons in step with the asset the app actually renders.
vb = re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', svg)
use = re.search(r'<use[^>]*\bx="(-?[\d.]+)"[^>]*\by="(-?[\d.]+)"', svg)
if not vb or not use:
    raise SystemExit("could not read the viewBox / <use> offset from the logo svg")
vb_w, vb_h = float(vb.group(1)), float(vb.group(2))
use_x, use_y = float(use.group(1)), float(use.group(2))
print(f"canvas {vb_w:g}x{vb_h:g}, <use> offset ({use_x:g}, {use_y:g})")

alpha = logo.getchannel("A")
alpha_min, alpha_max = alpha.getextrema()
has_alpha = alpha_min < 250
print(f"alpha extrema: ({alpha_min}, {alpha_max})")

# Compose the artwork onto the SVG canvas at the <use> offset: this is the
# frame the browser paints, and therefore the frame the icons must agree with.
canvas = Image.new("RGBA", (round(vb_w), round(vb_h)), (0, 0, 0, 0))
canvas.alpha_composite(logo, (round(use_x), round(use_y)))


# --------------------------------------------------------------------------
# Geometry: minimal enclosing circle of the ink
# --------------------------------------------------------------------------
def _convex_hull(points: np.ndarray) -> np.ndarray:
    """Andrew's monotone chain. `points` is (n, 2) float."""
    pts = np.unique(points, axis=0)
    if len(pts) <= 2:
        return pts
    pts = pts[np.lexsort((pts[:, 1], pts[:, 0]))]

    def half(seq: np.ndarray) -> list:
        out: list = []
        for p in seq:
            while len(out) >= 2:
                (ax, ay), (bx, by) = out[-2], out[-1]
                if (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax) <= 0:
                    out.pop()
                else:
                    break
            out.append((p[0], p[1]))
        return out

    lower = half(pts)
    upper = half(pts[::-1])
    return np.array(lower[:-1] + upper[:-1], dtype=float)


def _circle_from_two(a, b):
    cx, cy = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    return cx, cy, float(np.hypot(a[0] - b[0], a[1] - b[1]) / 2)


def _circle_from_three(a, b, c):
    ax, ay = a
    bx, by = b
    cx_, cy_ = c
    d = 2 * (ax * (by - cy_) + bx * (cy_ - ay) + cx_ * (ay - by))
    if abs(d) < 1e-12:
        # Collinear: fall back to the widest of the three pairwise circles.
        best = None
        for p, q in ((a, b), (a, c), (b, c)):
            cand = _circle_from_two(p, q)
            if best is None or cand[2] > best[2]:
                best = cand
        return best
    ux = ((ax**2 + ay**2) * (by - cy_) + (bx**2 + by**2) * (cy_ - ay) + (cx_**2 + cy_**2) * (ay - by)) / d
    uy = ((ax**2 + ay**2) * (cx_ - bx) + (bx**2 + by**2) * (ax - cx_) + (cx_**2 + cy_**2) * (bx - ax)) / d
    return ux, uy, float(np.hypot(ax - ux, ay - uy))


def _contains(circle, p, eps=1e-9) -> bool:
    cx, cy, r = circle
    return np.hypot(p[0] - cx, p[1] - cy) <= r + eps


def minimal_enclosing_circle(points: np.ndarray):
    """Welzl. Deterministic: the points arrive in hull order."""
    sys.setrecursionlimit(10000)

    def welzl(pts, boundary):
        if not len(pts) or len(boundary) == 3:
            if len(boundary) == 0:
                return (0.0, 0.0, -1.0)
            if len(boundary) == 1:
                return (boundary[0][0], boundary[0][1], 0.0)
            if len(boundary) == 2:
                return _circle_from_two(*boundary)
            return _circle_from_three(*boundary)
        p = pts[0]
        rest = pts[1:]
        circle = welzl(rest, boundary)
        if _contains(circle, p):
            return circle
        return welzl(rest, boundary + [p])

    return welzl(list(points), [])


def mark_circle(frame: Image.Image):
    """The mark's outer circle, measured on the frame's ink."""
    a = np.asarray(frame)[..., 3]
    mask = a > 128
    if not mask.any():
        raise SystemExit("no ink found in the artwork")

    # Only boundary pixels are needed: the hull of a mask is the hull of its
    # boundary, and this keeps the point set small.
    inner = mask.copy()
    inner[1:, :] &= mask[:-1, :]
    inner[:-1, :] &= mask[1:, :]
    inner[:, 1:] &= mask[:, :-1]
    inner[:, :-1] &= mask[:, 1:]
    boundary = mask & ~inner

    ys, xs = np.nonzero(boundary)
    pts = np.column_stack([xs, ys]).astype(float)
    hull = _convex_hull(pts)
    cx, cy, r = minimal_enclosing_circle(hull)
    return cx, cy, r


if has_alpha:
    cx, cy, r = mark_circle(canvas)
    print(f"mark circle in the canvas frame: centre=({cx:.1f}, {cy:.1f}) radius={r:.1f}")
    print(
        f"  canvas centre is ({vb_w / 2:.1f}, {vb_h / 2:.1f}) -> "
        f"offset dx={cx - vb_w / 2:+.1f} dy={cy - vb_h / 2:+.1f}"
    )

    # Crop the mark's own square frame: the ring centred, nothing else.
    side = int(round(2 * r))
    artwork = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    artwork.alpha_composite(canvas, (int(round(side / 2 - cx)), int(round(side / 2 - cy))))
    print(f"artwork frame: {artwork.size[0]}x{artwork.size[1]} (mark centred)")

    # A centred mark must land on the frame centre; fail loudly if it does not.
    acx, acy, ar = mark_circle(artwork)
    drift = max(abs(acx - side / 2), abs(acy - side / 2))
    print(f"  check: mark centre ({acx:.1f}, {acy:.1f}) vs frame centre ({side / 2}, {side / 2})")
    if drift > 1.0:
        raise SystemExit(f"mark is still off-centre by {drift:.1f}px — refusing to write icons")
else:
    artwork = logo
    print(f"opaque artwork: {artwork.size[0]}x{artwork.size[1]} (centre-cropped per icon)")


def fit(art: Image.Image, box: int) -> Image.Image:
    # Round the box to an even number of pixels: an even-sided artwork inside an
    # even-sided canvas splits the leftover margin exactly, so the paste lands
    # on the pixel grid instead of half a pixel off it.
    box = max(2, int(round(box / 2)) * 2)
    w, h = art.size
    scale = box / max(w, h)
    return art.resize(
        (max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS
    )


def paste_center(bg: Image.Image, art: Image.Image) -> Image.Image:
    x = (bg.width - art.width) // 2
    y = (bg.height - art.height) // 2
    bg.alpha_composite(art, (x, y))
    return bg


def glyph_icon(size: int, fill: float) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    return paste_center(canvas, fit(artwork, round(size * fill)))


def solid_icon(size: int, fill: float) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), BRAND_BG)
    return paste_center(canvas, fit(artwork, round(size * fill)))


def cover_icon(size: int) -> Image.Image:
    """Opaque artwork: center-crop to square, full bleed."""
    w, h = artwork.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    sq = artwork.crop((left, top, left + side, top + side))
    return sq.resize((size, size), Image.LANCZOS)


def save(img: Image.Image, name: str) -> None:
    out = OUT_DIR / name
    img.save(out, "PNG", optimize=True)
    print(f"wrote {out.relative_to(ROOT)} {img.size[0]}x{img.size[1]} {out.stat().st_size}B")


if has_alpha:
    save(glyph_icon(192, 0.82), "icon-192.png")
    save(glyph_icon(512, 0.82), "icon-512.png")
    save(solid_icon(512, 0.72), "icon-maskable-512.png")
    save(solid_icon(180, 0.80), "apple-touch-icon.png")
else:
    save(cover_icon(192), "icon-192.png")
    save(cover_icon(512), "icon-512.png")
    save(solid_icon(512, 0.60), "icon-maskable-512.png")
    save(cover_icon(180), "apple-touch-icon.png")

print("done")
