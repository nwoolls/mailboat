"""Shrinks the gallery's PNGs without changing a pixel.

The captures are RGBA with every pixel opaque, so the alpha channel goes, and
the rest is recompressed as hard as it will go. Each file is checked: it is
only replaced if every pixel decodes the same. The plain sRGB profile is
embedded, so a viewer doesn't have to guess. usage: python3 optimize.py <dir>
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops

PROFILE = Path("/System/Library/ColorSync/Profiles/sRGB Profile.icc")

folder = Path(sys.argv[1])
icc = PROFILE.read_bytes() if PROFILE.exists() else None
before = after = 0
for path in sorted(folder.glob("*.png")):
    original = Image.open(path)
    original.load()
    rgba = original.convert("RGBA")
    if rgba.getchannel("A").getextrema() != (255, 255):
        print(f"{path.name}: has see-through pixels, left as it is")
        continue
    rgb = rgba.convert("RGB")
    temp = path.with_suffix(".tmp.png")
    rgb.save(temp, optimize=True, compress_level=9, **({"icc_profile": icc} if icc else {}))
    check = Image.open(temp).convert("RGB")
    if ImageChops.difference(check, rgb).getbbox() is not None:
        temp.unlink()
        print(f"{path.name}: pixels differ after saving, left as it is")
        continue
    before += path.stat().st_size
    after += temp.stat().st_size
    temp.replace(path)
print(f"{before / 1e6:.1f} MB -> {after / 1e6:.1f} MB")
