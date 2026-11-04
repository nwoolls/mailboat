"""Finds a wide accent-blue button (the writing assistant's Replace) in a picture.

usage: python3 find_button.py picture.png left top
Prints "x,y" (the button's centre, in screen points: the picture's own pixels
plus left,top) or nothing if there is none. A button is a run of accent-blue
pixels about 50 to 100 wide and 16 to 30 tall; the round send arrow and the
Send button are told apart by their size and place (they are not that wide
and flat, or are further left).
"""
import sys
from PIL import Image

path, left, top = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
im = Image.open(path).convert("RGB")
w, h = im.size
px = im.load()


def blue(p):
    r, g, b = p
    return b > 190 and r < 120 and 80 < g < 150


# a coarse mask, every 2nd pixel
mask = {(x, y) for y in range(0, h, 2) for x in range(0, w, 2) if blue(px[x, y])}
seen = set()
best = None
for start in sorted(mask):
    if start in seen:
        continue
    stack, comp = [start], []
    seen.add(start)
    while stack:
        x, y = stack.pop()
        comp.append((x, y))
        for dx, dy in ((2, 0), (-2, 0), (0, 2), (0, -2)):
            n = (x + dx, y + dy)
            if n in mask and n not in seen:
                seen.add(n)
                stack.append(n)
    xs = [c[0] for c in comp]
    ys = [c[1] for c in comp]
    bw, bh = max(xs) - min(xs) + 2, max(ys) - min(ys) + 2
    if 50 <= bw <= 100 and 14 <= bh <= 32 and bw >= 2 * bh:
        centre = (left + (min(xs) + max(xs)) // 2, top + (min(ys) + max(ys)) // 2)
        if best is None or len(comp) > best[0]:
            best = (len(comp), centre)
if best:
    print(f"{best[1][0]},{best[1][1]}")
