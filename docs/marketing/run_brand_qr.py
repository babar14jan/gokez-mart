"""
Branded (logo-backed) QR generator for the Gokez Mart print assets.

Encoding target: https://mart.gokez.com/?ch=qr

The chosen configuration
------------------------
    version 6, error correction LEVEL H  -> 30% of codewords recoverable
    49x49 module grid including the 4-module quiet zone
    11x7 module cutout with a 1-module white margin
    = 77 modules = 3.2% of the grid

3.2% obscured is a fraction of the 30% recovery budget, so the code is
essentially untouched, and the mark stays small. The cutout is centred and
grid-aligned, which keeps it clear of the three finder patterns, the timing
row/column, and the (34,34) alignment pattern -- verified in
verify_brand_qr.py, not assumed.

Why there is a 1-module white margin at all
-------------------------------------------
The wordmark is dark strokes on transparency. Placed straight onto modules, the
black letters fuse with adjacent dark modules and the white gaps between letters
expose whatever module sits behind, so the mark stops reading as a logo. One
module of margin is enough to separate every letter and small enough not to
look like a hole punched in the code. This size was picked by eye from
brand-options.png; scannability and legibility are different requirements and
only the first can be automated.

Two earlier attempts were wrong and are recorded so they are not repeated:
  * a 19x12 cutout on version 4 is 13.6% of the grid and did not decode at all.
    Size the cutout as a fraction of the grid, never as a raw module count.
  * size the mark on its own, not by cropping the cutout -- the 11x7 here is
    the mark plus its margin, not the plate alone.
"""
import base64
import io

import qrcode
from qrcode.constants import ERROR_CORRECT_H
from PIL import Image

URL = "https://mart.gokez.com/?ch=qr"
LOGO = "mart-user/public/mart_brand_new.png"
BORDER = 4
VERSION = 6
CUT_MODULES = (11, 7)      # the mark plus its 1-module margin
MARGIN_MODULES = 1

_SRC = None


def _logo():
    """Wordmark with the padded canvas cropped away."""
    global _SRC
    if _SRC is None:
        im = Image.open(LOGO).convert("RGBA")
        bb = im.getchannel("A").getbbox()
        _SRC = im.crop(bb) if bb else im
    return _SRC


def _placement(grid, box_size):
    cut_w, cut_h = CUT_MODULES[0] * box_size, CUT_MODULES[1] * box_size
    total = grid * box_size
    px, py = (total - cut_w) // 2, (total - cut_h) // 2
    pad = MARGIN_MODULES * box_size
    logo = _logo()
    s = min((cut_w - 2 * pad) / logo.width, (cut_h - 2 * pad) / logo.height)
    lg = logo.resize((max(1, int(logo.width * s)), max(1, int(logo.height * s))), Image.LANCZOS)
    return (px, py), lg, (px + (cut_w - lg.width) // 2, py + (cut_h - lg.height) // 2)


def _matrix():
    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_H, box_size=1, border=BORDER, version=VERSION)
    qr.add_data(URL)
    qr.make()
    return qr.get_matrix()


def build_png(box_size: int, path: str) -> Image.Image:
    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_H, box_size=box_size,
                       border=BORDER, version=VERSION)
    qr.add_data(URL)
    qr.make()
    img = qr.make_image(fill_color="black", back_color="white").convert("RGB")
    (px, py), lg, at = _placement(len(qr.get_matrix()), box_size)
    from PIL import ImageDraw
    ImageDraw.Draw(img).rectangle(
        [px, py, px + CUT_MODULES[0] * box_size - 1, py + CUT_MODULES[1] * box_size - 1],
        fill="white",
    )
    img.paste(lg, at, lg)
    img.save(path)
    return img


def build_svg(path: str, mm: int = 100):
    """Vector print master: modules as real paths, wordmark embedded as PNG."""
    m = _matrix()
    n = len(m)
    d = "".join(f"M{x} {y}h1v1h-1z" for y, row in enumerate(m) for x, on in enumerate(row) if on)
    (px, py), lg, at = _placement(n, 1)

    raw = io.BytesIO()
    _logo().save(raw, format="PNG")
    b64 = base64.b64encode(raw.getvalue()).decode()

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="{mm}mm" height="{mm}mm" viewBox="0 0 {n} {n}" shape-rendering="crispEdges">
  <rect width="{n}" height="{n}" fill="#ffffff"/>
  <path d="{d}" fill="#000000"/>
  <rect x="{px}" y="{py}" width="{CUT_MODULES[0]}" height="{CUT_MODULES[1]}" fill="#ffffff"/>
  <image x="{at[0]:.4f}" y="{at[1]:.4f}" width="{lg.width:.4f}" height="{lg.height:.4f}"
         preserveAspectRatio="xMidYMid meet" xlink:href="data:image/png;base64,{b64}"/>
</svg>
'''
    open(path, "w").write(svg)
    return svg


if __name__ == "__main__":
    for box, name in ((8, "gokez-qr-branded-328.png"), (16, "gokez-qr-branded-656.png"),
                      (32, "gokez-qr-branded-1312.png")):
        im = build_png(box, f"docs/marketing/{name}")
        print(f"  wrote docs/marketing/{name}  {im.size[0]}x{im.size[1]}")
    build_svg("docs/marketing/gokez-qr-branded.svg", mm=100)
    print("  wrote docs/marketing/gokez-qr-branded.svg  (vector, 100mm)")
