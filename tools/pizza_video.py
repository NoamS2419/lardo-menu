"""Render a short video of a pizza tray being cut into 6 triangular slices.

Usage: python3 tools/pizza_video.py [out.mp4]
Needs Pillow, numpy and ffmpeg on PATH.
"""
import math
import random
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = sys.argv[1] if len(sys.argv) > 1 else "data/videos/pizza-6-slices.mp4"
SIZE = 720          # output resolution (square)
SS = 2              # supersampling factor for smooth edges
W = SIZE * SS
FPS = 30
C = W / 2           # pizza centre
R = W * 0.34        # pizza radius (crust outer edge)
TRAY_R = W * 0.43

# Three diameters -> six 60° wedges.
CUT_ANGLES = [90, 30, 150]          # degrees, direction of each cut line
CUT_FRAMES = int(1.3 * FPS)         # duration of each cut
GAP_FRAMES = int(0.35 * FPS)        # cutter repositioning between cuts
INTRO = int(1.0 * FPS)
SPREAD = int(1.0 * FPS)
LABELS = int(1.8 * FPS)
OUTRO = int(1.5 * FPS)

BG = (244, 236, 222)
CUT_COLOR = (92, 52, 28)


def ease(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def P(angle_deg, dist):
    a = math.radians(angle_deg)
    return (C + dist * math.cos(a), C - dist * math.sin(a))


# ---------- static layers ----------

def make_background():
    img = Image.new("RGB", (W, W), BG)
    d = ImageDraw.Draw(img)
    # wooden-table stripes
    for y in range(0, W, 46 * SS):
        d.rectangle([0, y, W, y + 2 * SS], fill=(232, 220, 200))
    # tray shadow
    sh = Image.new("L", (W, W), 0)
    ImageDraw.Draw(sh).ellipse([C - TRAY_R + 14 * SS, C - TRAY_R + 22 * SS,
                                C + TRAY_R + 14 * SS, C + TRAY_R + 22 * SS], fill=110)
    sh = sh.filter(ImageFilter.GaussianBlur(18 * SS))
    img.paste((70, 50, 30), (0, 0), sh)
    # metal tray with a rim
    d = ImageDraw.Draw(img)
    d.ellipse([C - TRAY_R, C - TRAY_R, C + TRAY_R, C + TRAY_R], fill=(170, 172, 176))
    r2 = TRAY_R - 16 * SS
    d.ellipse([C - r2, C - r2, C + r2, C + r2], fill=(205, 207, 211))
    for k in range(6):
        rr = r2 - k * 3 * SS
        d.ellipse([C - rr, C - rr, C + rr, C + rr], outline=(198, 200, 204), width=SS)
    return img


def make_pizza():
    rnd = random.Random(7)
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # crust
    d.ellipse([C - R, C - R, C + R, C + R], fill=(214, 150, 72))
    rc = R - 7 * SS
    d.ellipse([C - rc, C - rc, C + rc, C + rc], fill=(228, 170, 90))
    # burnt spots on crust
    for _ in range(60):
        a = rnd.uniform(0, 360)
        x, y = P(a, rnd.uniform(R - 22 * SS, R - 6 * SS))
        s = rnd.uniform(2, 5) * SS
        d.ellipse([x - s, y - s, x + s, y + s], fill=(176, 106, 46))
    # sauce
    rs = R - 26 * SS
    d.ellipse([C - rs, C - rs, C + rs, C + rs], fill=(196, 48, 30))
    # cheese blobs
    for _ in range(140):
        a = rnd.uniform(0, 360)
        dist = math.sqrt(rnd.random()) * (rs - 14 * SS)
        x, y = P(a, dist)
        s = rnd.uniform(14, 30) * SS
        d.ellipse([x - s, y - s * 0.8, x + s, y + s * 0.8], fill=(250, 222, 140))
    for _ in range(60):
        a = rnd.uniform(0, 360)
        x, y = P(a, math.sqrt(rnd.random()) * (rs - 20 * SS))
        s = rnd.uniform(5, 11) * SS
        d.ellipse([x - s, y - s, x + s, y + s], fill=(255, 238, 180))
    # pepperoni
    spots = []
    while len(spots) < 16:
        a = rnd.uniform(0, 360)
        dist = math.sqrt(rnd.random()) * (rs - 34 * SS)
        x, y = P(a, dist)
        if all(math.hypot(x - u, y - v) > 62 * SS for u, v in spots):
            spots.append((x, y))
    for x, y in spots:
        s = 26 * SS
        d.ellipse([x - s, y - s, x + s, y + s], fill=(150, 30, 26))
        s2 = 22 * SS
        d.ellipse([x - s2, y - s2, x + s2, y + s2], fill=(178, 44, 34))
        for _ in range(4):
            ox, oy = rnd.uniform(-12, 12) * SS, rnd.uniform(-12, 12) * SS
            d.ellipse([x + ox - 3 * SS, y + oy - 3 * SS, x + ox + 3 * SS, y + oy + 3 * SS],
                      fill=(140, 26, 22))
    # basil leaves
    for _ in range(9):
        a = rnd.uniform(0, 360)
        x, y = P(a, math.sqrt(rnd.random()) * (rs - 30 * SS))
        leaf = Image.new("RGBA", (60 * SS, 30 * SS), (0, 0, 0, 0))
        ld = ImageDraw.Draw(leaf)
        ld.ellipse([0, 0, 60 * SS - 1, 30 * SS - 1], fill=(48, 120, 52))
        ld.line([6 * SS, 15 * SS, 54 * SS, 15 * SS], fill=(80, 156, 80), width=2 * SS)
        leaf = leaf.rotate(rnd.uniform(0, 180), expand=True, resample=Image.BICUBIC)
        img.alpha_composite(leaf, (int(x - leaf.width / 2), int(y - leaf.height / 2)))
    # clip to pizza disc
    mask = Image.new("L", (W, W), 0)
    ImageDraw.Draw(mask).ellipse([C - R, C - R, C + R, C + R], fill=255)
    img.putalpha(Image.composite(img.getchannel("A"), mask, mask))
    return img


def wedge_mask(i):
    """Mask for slice i (0..5), centred on angle 60*i (between cuts)."""
    mid = 60 * i
    pts = [(C, C)] + [P(mid - 30 + k * 2, R * 1.2) for k in range(31)]
    m = Image.new("L", (W, W), 0)
    ImageDraw.Draw(m).polygon(pts, fill=255)
    return m


def blurred_shadow(mask, pizza):
    sh = Image.new("L", (W, W), 0)
    sh.paste(mask, (0, 0), pizza.getchannel("A"))
    return sh.filter(ImageFilter.GaussianBlur(6 * SS)).point(lambda v: int(v * 0.45))


def wedge_shadow(sh, dx, dy):
    out = Image.new("L", (W, W), 0)
    out.paste(sh, (int(dx + 4 * SS), int(dy + 8 * SS)))
    return out


# ---------- cutter ----------

def draw_cutter(img, x, y, direction_deg, roll):
    """Pizza wheel at (x, y), handle pointing back along the cut direction."""
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    wr = 44 * SS
    back = math.radians(direction_deg + 180 + 35)
    hx, hy = x + math.cos(back) * 150 * SS, y - math.sin(back) * 150 * SS
    mx, my = x + math.cos(back) * 40 * SS, y - math.sin(back) * 40 * SS
    # shadow
    d.ellipse([x - wr + 8 * SS, y - wr + 12 * SS, x + wr + 8 * SS, y + wr + 12 * SS],
              fill=(0, 0, 0, 50))
    # fork + handle
    d.line([x, y, mx, my], fill=(120, 124, 130), width=12 * SS)
    d.line([mx, my, hx, hy], fill=(34, 34, 38), width=24 * SS)
    d.ellipse([hx - 12 * SS, hy - 12 * SS, hx + 12 * SS, hy + 12 * SS], fill=(34, 34, 38))
    # wheel
    d.ellipse([x - wr, y - wr, x + wr, y + wr], fill=(200, 204, 210), outline=(120, 124, 130),
              width=3 * SS)
    for k in range(4):
        a = roll + k * math.pi / 2
        d.line([x, y, x + math.cos(a) * (wr - 8 * SS), y + math.sin(a) * (wr - 8 * SS)],
               fill=(160, 164, 170), width=3 * SS)
    d.ellipse([x - 8 * SS, y - 8 * SS, x + 8 * SS, y + 8 * SS], fill=(90, 94, 100))
    img.alpha_composite(layer)


# ---------- timeline ----------

def main():
    bg = make_background()
    pizza = make_pizza()
    masks = [wedge_mask(i) for i in range(6)]
    shadows = [blurred_shadow(m, pizza) for m in masks]
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 34 * SS)
    except OSError:
        font = ImageFont.load_default()

    cut_start = INTRO
    cut_spans = []
    t = cut_start
    for _ in CUT_ANGLES:
        cut_spans.append((t, t + CUT_FRAMES))
        t += CUT_FRAMES + GAP_FRAMES
    spread_start = t
    labels_start = spread_start + SPREAD
    total = labels_start + LABELS + OUTRO

    L = R + 30 * SS  # cut line runs a little past the crust on both sides

    ff = subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
         "-s", f"{SIZE}x{SIZE}", "-r", str(FPS), "-i", "-",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", OUT],
        stdin=subprocess.PIPE)

    for f in range(total):
        frame = bg.copy().convert("RGBA")
        spread = ease((f - spread_start) / SPREAD) if f >= spread_start else 0.0

        if spread == 0:
            frame.alpha_composite(pizza)
        else:
            off = spread * 22 * SS
            for i, m in enumerate(masks):
                dx, dy = P(60 * i, off)
                dx, dy = dx - C, dy - C
                frame.paste((60, 40, 20), (0, 0), wedge_shadow(shadows[i], dx, dy))
                piece = Image.new("RGBA", (W, W), (0, 0, 0, 0))
                piece.paste(pizza, (0, 0), m)
                frame.alpha_composite(piece, (int(dx), int(dy)))

        overlay = Image.new("RGBA", (W, W), (0, 0, 0, 0))
        od = ImageDraw.Draw(overlay)

        # cut lines (fade out as slices separate — the gaps take over)
        cutter = None
        for (s, e), ang in zip(cut_spans, CUT_ANGLES):
            if f < s:
                continue
            prog = ease((f - s) / (e - s))
            x0, y0 = P(ang, L)
            x1, y1 = P(ang + 180, L)
            cx, cy = x0 + (x1 - x0) * prog, y0 + (y1 - y0) * prog
            alpha = int(255 * (1 - spread))
            if alpha > 0:
                # clip the visible line to the pizza disc
                ax, ay = P(ang, R)
                t_end = min(prog * 2 * L, L + R) - (L - R)
                if t_end > 0:
                    bx = ax + (x1 - x0) / (2 * L) * t_end
                    by = ay + (y1 - y0) / (2 * L) * t_end
                    od.line([ax, ay, bx, by], fill=CUT_COLOR + (alpha,), width=5 * SS)
            if f <= e:
                cutter = (cx, cy, ang + 180, prog * 2 * L / (44 * SS))
        # cutter enters before the first cut and leaves after the last
        if f < cut_spans[0][0]:
            k = ease(f / INTRO)
            sx, sy = P(CUT_ANGLES[0], L)
            cutter = (sx + (1 - k) * 260 * SS, sy - (1 - k) * 200 * SS, CUT_ANGLES[0] + 180, 0)
        for j in range(len(cut_spans) - 1):
            e, s2 = cut_spans[j][1], cut_spans[j + 1][0]
            if e < f < s2:
                k = ease((f - e) / (s2 - e))
                ex, ey = P(CUT_ANGLES[j] + 180, L)
                nx, ny = P(CUT_ANGLES[j + 1], L)
                # lift the cutter around the pizza instead of across it
                mx = ex + (nx - ex) * k
                my = ey + (ny - ey) * k
                vx, vy = mx - C, my - C
                n = math.hypot(vx, vy) or 1
                push = max(0, L - n)
                cutter = (mx + vx / n * push, my + vy / n * push, CUT_ANGLES[j + 1] + 180, 0)
        last_e = cut_spans[-1][1]
        if last_e < f < last_e + GAP_FRAMES * 2:
            k = ease((f - last_e) / (GAP_FRAMES * 2))
            ex, ey = P(CUT_ANGLES[-1] + 180, L)
            cutter = (ex - k * 300 * SS, ey + k * 260 * SS, CUT_ANGLES[-1] + 180, 0)

        # slice numbers 1..6 pop in one after another
        if f >= labels_start:
            per = LABELS / 6
            for i in range(6):
                k = (f - labels_start - i * per) / (per * 0.8)
                if k <= 0:
                    continue
                k = ease(k)
                off = 22 * SS
                lx, ly = P(60 * i, R * 0.58 + off)
                rr = 30 * SS * (0.6 + 0.4 * k)
                a = int(235 * k)
                od.ellipse([lx - rr, ly - rr, lx + rr, ly + rr], fill=(255, 255, 255, a),
                           outline=(92, 52, 28, a), width=3 * SS)
                od.text((lx, ly), str(i + 1), font=font, fill=(92, 52, 28, a), anchor="mm")

        frame.alpha_composite(overlay)
        if cutter:
            draw_cutter(frame, *cutter)

        out = frame.convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)
        ff.stdin.write(out.tobytes())

    ff.stdin.close()
    ff.wait()
    print(f"wrote {OUT} ({total} frames, {total / FPS:.1f}s)")


if __name__ == "__main__":
    main()
