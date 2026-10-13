#!/usr/bin/env python3
"""Re-pull the Wolt menu into tools/wolt_snapshot.tsv, then rebuild data/products.json.

Needs a machine that can reach consumer-api.wolt.com (a normal computer or the
"Refresh from Wolt" GitHub Action; the Claude cloud container is blocked).
Usage: python3 tools/fetch_wolt.py [--images]
  --images  also download missing product photos to data/images/<id>.webp
            (500px wide; needs Pillow: pip install pillow)
"""
import csv, io, json, pathlib, re, subprocess, sys, urllib.parse, urllib.request

SLUG = "lart-du-pain-r"
API = f"https://consumer-api.wolt.com/consumer-api/consumer-assortment/v1/venues/slug/{SLUG}/assortment"
TOOLS = pathlib.Path(__file__).resolve().parent
IMAGES = TOOLS.parent / "data" / "images"
IMAGE_WIDTH = 500
IMAGE_HOSTS = ("imageproxy.wolt.com", "wolt-menu-images-cdn.wolt.com")
MIN_KEEP = 0.8  # refuse a snapshot with fewer rows than this share of the previous one

sys.path.insert(0, str(TOOLS))
from build import DATA, image_file  # noqa: E402
FIELDS = ["wolt_category", "id", "name", "price_agorot", "description", "image", "options"]
SKIP_DESCRIPTIONS = {"בחרו טעם"}


def fetch(url, accept="application/json"):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": accept})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def get(url):
    return json.loads(fetch(url))


def download_images(rows):
    """Download missing photos; delete photos no product uses any more. A failed photo is skipped."""
    from PIL import Image  # only needed for --images

    IMAGES.mkdir(parents=True, exist_ok=True)
    wanted = set()
    for r in rows:
        if not r["image"]:
            continue
        # The id becomes a file name and the URL is fetched: accept only what Wolt really sends.
        url = urllib.parse.urlsplit(r["image"])
        if not re.fullmatch(r"[0-9a-f]{24}", r["id"]) or url.scheme != "https" or url.hostname not in IMAGE_HOSTS:
            print(f"skipping image for {r['id']!r}: unexpected id or URL {r['image']!r}", file=sys.stderr)
            continue
        target = DATA / image_file(r["id"], r["image"])
        wanted.add(target.name)
        if target.exists():
            continue
        try:
            img = Image.open(io.BytesIO(fetch(f"{r['image']}?w={IMAGE_WIDTH * 2}", "image/*"))).convert("RGB")
            if img.width > IMAGE_WIDTH:
                img = img.resize((IMAGE_WIDTH, round(img.height * IMAGE_WIDTH / img.width)), Image.LANCZOS)
            img.save(target, "WEBP", quality=78, method=6)
            print(f"image {target.name} {target.stat().st_size // 1024}KB")
        except Exception as e:  # one bad photo must not stop the refresh; the site falls back to Wolt's URL
            print(f"WARNING: image for {r['name']} ({r['id']}) failed: {e}", file=sys.stderr)
            target.unlink(missing_ok=True)
    for old in IMAGES.glob("*.webp"):
        if old.name not in wanted:
            old.unlink()
            print(f"removed old image {old.name}")


def one_line(text):
    return " ".join((text or "").split())


def main():
    root = get(API + "?language=he")
    rows, seen = [], set()
    for cat in root["categories"]:
        page = get(f"{API}/categories/slug/{cat['slug']}?language=he")
        options = {o["id"]: o for o in page.get("options", [])}
        items = {i["id"]: i for i in page.get("items", [])}
        # Keep Wolt's order: the category's item_ids list, then anything else on the page.
        ordered = [items[i] for i in cat.get("item_ids", []) if i in items]
        ordered += [i for i in page.get("items", []) if i not in ordered]
        for item in ordered:
            if item["id"] in seen:
                continue
            seen.add(item["id"])
            opts = []
            for ref in item.get("options", []):
                opt = options.get(ref.get("option_id") or ref.get("id"), {})
                for v in opt.get("values", []):
                    # Price deltas are kept only for size choices ("קוטר", "גודל").
                    if any(w in opt.get("name", "") for w in ("גודל",)) or v["name"].startswith(("קוטר", "גודל")):
                        opts.append(f"{one_line(v['name'])}:{v.get('price', 0)}")
                    else:
                        opts.append(one_line(v["name"]))
            desc = one_line(item.get("description"))
            images = item.get("images") or []
            rows.append({
                "wolt_category": cat["name"],
                "id": item["id"],
                "name": one_line(item["name"]),
                "price_agorot": item["price"],
                "description": "" if desc in SKIP_DESCRIPTIONS else desc,
                "image": images[0]["url"].split("?")[0] if images else "",
                "options": ";".join(opts),
            })
    snapshot = TOOLS / "wolt_snapshot.tsv"
    if snapshot.exists():
        before = sum(1 for _ in open(snapshot, encoding="utf-8")) - 1
        if len(rows) < MIN_KEEP * before:
            sys.exit(f"Wolt returned {len(rows)} items, the last snapshot had {before}. "
                     "Looks like a partial response; nothing was changed.")
    with open(snapshot, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, FIELDS, delimiter="\t", lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    print(f"{len(rows)} Wolt items -> wolt_snapshot.tsv")
    if "--images" in sys.argv:
        download_images(rows)
    subprocess.run([sys.executable, str(TOOLS / "build.py")], check=True)


if __name__ == "__main__":
    main()
