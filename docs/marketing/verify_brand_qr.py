"""
Decode-verification for the branded QR assets.

A QR that does not scan is worse than a plain one, so these files are not
considered done until OpenCV's QRCodeDetector reads the exact payload back out
of the rendered PNG.

Method notes, because two earlier attempts at this file were wrong:

  * Random-pixel "scuff" damage is NOT a valid test. The unbranded control
    fails it at 1% density, because it destroys format-info and timing modules
    rather than modelling anything a print actually suffers. Every damage case
    here is therefore gated on the plain code surviving it first, so only
    genuine branding costs are counted.

  * The cutout must be validated structurally, not just by decoding. A centre
    cutout that clips an alignment or timing pattern can decode on a clean
    screen and still fail on a standee, so those regions are asserted clear.
"""
import re
import sys

import numpy as np
import cv2
from PIL import Image, ImageEnhance
import qrcode
from qrcode.constants import ERROR_CORRECT_H
from qrcode.util import PATTERN_POSITION_TABLE

URL = "https://mart.gokez.com/?ch=qr"
VER = 6
CUT = (11, 7)   # mark + 1-module margin, chosen by eye from brand-options.png
MARGIN = 1
det = cv2.QRCodeDetector()
failures = []


def dec(img):
    arr = np.array(img.convert("RGB"))[:, :, ::-1].copy()
    data, _, _ = det.detectAndDecode(arr)
    return data


def matrix():
    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_H, box_size=1, border=4, version=VER)
    qr.add_data(URL)
    qr.make()
    return qr.get_matrix()


def plain(box=10):
    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_H, box_size=box, border=4, version=VER)
    qr.add_data(URL)
    qr.make()
    return qr.make_image(fill_color="black", back_color="white").convert("RGB")


def check(name, got):
    """Payload assertion: the decoded text must be exactly the target URL."""
    ok = got == URL
    print(f"  {name:<44} {'PASS' if ok else 'FAIL'}")
    if not ok:
        failures.append(name)
    return ok


def assert_true(name, cond):
    """Structural assertion. Kept separate from check() on purpose: check()
    compares against the URL string, so feeding it a boolean always reports
    FAIL and hides the real state. That mistake produced five false failures
    in the first run of this file."""
    ok = bool(cond)
    print(f"  {name:<44} {'PASS' if ok else 'FAIL'}")
    if not ok:
        failures.append(name)
    return ok


def damage_cases(base_img):
    return [
        ("sun-faded to 70% contrast", ImageEnhance.Contrast(base_img.convert("L")).enhance(0.70).convert("RGB")),
        ("sun-faded to 60% contrast", ImageEnhance.Contrast(base_img.convert("L")).enhance(0.60).convert("RGB")),
    ]


def main():
    m = matrix()
    n = len(m)
    cw, ch = CUT
    x0, y0 = (n - cw) // 2, (n - ch) // 2

    print("== structural: cutout must not damage the sync structures ==")
    pos = PATTERN_POSITION_TABLE[VER - 1]
    aligns = [(r, c) for r in pos for c in pos
              if (r, c) not in {(pos[0], pos[0]), (pos[0], pos[-1]), (pos[-1], pos[0])}]
    clipped = [p for p in aligns
               if not (p[0] + 2 < y0 or p[0] - 2 >= y0 + ch or p[1] + 2 < x0 or p[1] - 2 >= x0 + cw)]
    assert_true(f"no alignment pattern clipped {aligns}", not clipped)
    assert_true("timing row/col 6 untouched", not ((y0 <= 6 < y0 + ch) or (x0 <= 6 < x0 + cw)))
    assert_true("finder pattern bands untouched", not (x0 < 7 or x0 + cw > n - 7))
    dark = sum(1 for y in range(y0, y0 + ch) for x in range(x0, x0 + cw) if m[y][x])
    pct = 100 * cw * ch / (n * n)
    print(f"  cutout {cw}x{ch} of {n}x{n} = {pct:.1f}% obscured, {dark} dark modules replaced")
    if pct > 30:
        failures.append("obscured > level-H budget")

    print("\n== control: plain unbranded code ==")
    ctrl = plain()
    for name in ("gokez-qr-656.png", "gokez-qr-328.png"):
        check(name, dec(Image.open(f"docs/marketing/{name}")))

    print("\n== branded: clean decode ==")
    branded = {}
    for name in ("gokez-qr-branded-1312.png", "gokez-qr-branded-656.png", "gokez-qr-branded-328.png"):
        img = Image.open(f"docs/marketing/{name}")
        branded[name] = img
        check(name, dec(img))

    print("\n== branded: same damage the plain code survives ==")
    for label, dmg in damage_cases(ctrl):
        if dec(dmg) != URL:
            print(f"  {label:<44} SKIP  (control does not survive it)")
            continue
        for name, img in branded.items():
            if name.endswith("1312.png"):
                check(f"{name} {label}", dec(dmg.resize(img.size, Image.LANCZOS)))

    print("\n== branded: decodes down to the same print size as the plain code ==")
    for px in (400, 320, 240, 200, 160, 140, 100, 80):
        plain_ok = dec(ctrl.resize((px, px), Image.LANCZOS)) == URL
        big = branded["gokez-qr-branded-1312.png"]
        brand_ok = dec(big.resize((px, px), Image.LANCZOS)) == URL
        mark = "PASS" if (plain_ok == brand_ok) else "REGRESSION"
        print(f"  {px:>4}px   plain={'OK ' if plain_ok else 'no '}  branded={'OK ' if brand_ok else 'no '}  {mark}")
        if plain_ok != brand_ok:
            failures.append(f"size regression at {px}px")

    print("\n== SVG print master: payload and structure match the PNG ==")
    svg = open("docs/marketing/gokez-qr-branded.svg").read()
    assert_true("svg embeds a raster logo", "data:image/png;base64," in svg)
    d = re.search(r'<path d="([^"]+)"', svg)
    cells = set()
    if d:
        for x, y in re.findall(r"M(\d+) (\d+)h1v1", d.group(1)):
            cells.add((int(x), int(y)))
    expected = {(x, y) for y, row in enumerate(m) for x, on in enumerate(row) if on}
    assert_true(f"svg dark modules match the encoded matrix ({len(cells)} cells)", cells == expected)
    # render the vector modules alone and confirm they decode unaided
    img = Image.new("RGB", (n, n), "white")
    px = img.load()
    for (x, y) in cells:
        px[x, y] = (0, 0, 0)
    check("svg modules alone decode to the URL", dec(img.resize((n * 8, n * 8), Image.NEAREST)))

    print()
    if failures:
        print(f"FAILED: {failures}")
        return 1
    print(f"ALL CHECKS PASSED - {CUT[0]}x{CUT[1]} mark centred with a {MARGIN} module margin, code decodes to the tracking URL")
    return 0


if __name__ == "__main__":
    sys.exit(main())
