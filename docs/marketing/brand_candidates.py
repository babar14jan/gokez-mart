"""
Small-mark branded QR candidates for visual selection.

Design goal: the Gokez Mart wordmark must be *complete and legible* while
occupying as little of the code as possible.

Why a small mark needs a tight white margin at all
--------------------------------------------------
The wordmark is dark strokes on a transparent background. Dropped straight onto
modules, its black letters fuse with neighbouring dark modules and the white
gaps between letters expose whatever module sits behind, so the mark stops
reading as a logo. The fix is not a big plate -- it is a margin only slightly
larger than the mark itself, so every letter is fully separated from the module
field while the white area stays small.

The margin is one module by default. Anything tighter and anti-aliased letter
edges touch live modules; anything larger starts looking like a hole again.

Candidates are generated small, and the contact sheet exists so the choice is
made by eye, because scannability and legibility are different requirements:
decode-verification can only prove the first.

Usage:
    python3 docs/marketing/brand_candidates.py
"""
import qrcode
from qrcode.constants import ERROR_CORRECT_H
from PIL import Image, ImageDraw, ImageFont

URL = "https://mart.gokez.com/?ch=qr"
LOGO = "mart-user/public/mart_brand_new.png"
BORDER = 4
VERSION = 6
OUT = "docs/marketing"


def _qr(box=1, version=VERSION):
    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_H, box_size=box,
                       border=BORDER, version=version)
    qr.add_data(URL)
    qr.make()
    return qr


def _logo():
    im = Image.open(LOGO).convert("RGBA")
    bb = im.getchannel("A").getbbox()
    return im.crop(bb) if bb else im


def render(cut_w, cut_h, margin_modules, box=10, plate="tight", version=VERSION):
    """margin_modules: white breathing room around the mark, in modules.
    plate: 'tight' hugs the mark, 'round' rounds the corners, 'none' no plate."""
    qr = _qr(box, version)
    img = qr.make_image(fill_color="black", back_color="white").convert("RGB")
    grid = len(qr.get_matrix())
    total = grid * box
    d = ImageDraw.Draw(img)

    pad = margin_modules * box
    plate_w, plate_h = cut_w * box, cut_h * box
    px, py = (total - plate_w) // 2, (total - plate_h) // 2
    if plate == "round":
        d.rounded_rectangle([px, py, px + plate_w - 1, py + plate_h - 1],
                            radius=max(2, box // 2), fill="white")
    elif plate == "tight":
        d.rectangle([px, py, px + plate_w - 1, py + plate_h - 1], fill="white")

    logo = _logo()
    inner_w, inner_h = plate_w - 2 * pad, plate_h - 2 * pad
    s = min(inner_w / logo.width, inner_h / logo.height)
    lg = logo.resize((max(1, int(logo.width * s)), max(1, int(logo.height * s))), Image.LANCZOS)
    img.paste(lg, (px + (plate_w - lg.width) // 2, py + (plate_h - lg.height) // 2), lg)
    return img, grid, lg.size


CANDIDATES = [
    ("9x6", 9, 6, 1),
    ("11x7", 11, 7, 1),
    ("13x9", 13, 9, 1),
    ("15x10", 15, 10, 1),
    ("13x9-noPlate", 13, 9, 0),
    ("11x7-noPlate", 11, 7, 0),
]


def main():
    import numpy as np
    import cv2
    det = cv2.QRCodeDetector()

    def dec(im):
        d, _, _ = det.detectAndDecode(np.array(im.convert("RGB"))[:, :, ::-1].copy())
        return d

    print("  candidate      mark px   %obsc  clean  200px  140px  100px")
    print("  " + "-" * 58)
    tiles = []
    for label, cw, ch, mg in CANDIDATES:
        plate = "none" if "noPlate" in label else "tight"
        img, grid, mark = render(cw, ch, mg, box=10, plate=plate)
        pct = 100 * cw * ch / (grid * grid)
        r = [dec(img) == URL]
        for px in (200, 140, 100):
            r.append(dec(img.resize((px, px), Image.LANCZOS)) == URL)
        yn = lambda b: "OK " if b else "-- "
        print("  %-14s %-9s %-6.1f %s%s%s%s" % (label, f"{mark[0]}x{mark[1]}", pct, *(yn(x) for x in r)))
        tiles.append((label, img, f"{label}  {pct:.1f}%"))

    # contact sheet so the choice can be made by eye
    cell = 250
    pad = 26
    sheet = Image.new("RGB", (cell * 3 + 40, (cell + pad) * 3 + 20), "white")
    dr = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 15)
    except Exception:
        font = ImageFont.load_default()
    for i, (label, img, cap) in enumerate(tiles):
        cx = 10 + (i % 3) * (cell + 10)
        cy = 10 + (i // 3) * (cell + pad)
        sheet.paste(img.resize((cell, cell), Image.LANCZOS), (cx, cy))
        dr.text((cx, cy + cell + 5), cap, fill="black", font=font)
    path = f"{OUT}/brand-options.png"
    sheet.save(path)
    print(f"\n  contact sheet -> {path}")


if __name__ == "__main__":
    main()
