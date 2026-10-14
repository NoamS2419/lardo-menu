#!/usr/bin/env python3
"""Merge tools/wolt_snapshot.tsv + tools/staff_overlay.json -> data/products.json.

Run from anywhere: python3 tools/build.py [--strict]
Prints a warning for every overlay entry that no longer matches the snapshot
(e.g. Wolt changed a product id), so staff tags never drop silently.
--strict exits non-zero when there are warnings.
"""
import csv, json, re, sys, datetime, hashlib, pathlib

TOOLS = pathlib.Path(__file__).resolve().parent
DATA = TOOLS.parent / "data"
IMAGES = DATA / "images"
# Site categories, in display order. Wolt names map to these; anything else is hidden.
CATEGORIES = ["מאפים", "פטיסרי", "עוגות", "טארטים", "כריכים", "פיצות", "עוגיות", "לחמים", "סלטים", "מארזים", "שתייה"]
CATEGORY_IDS = {"מאפים": "pastries", "פטיסרי": "patisserie", "עוגות": "cakes", "טארטים": "tarts", "כריכים": "sandwiches", "פיצות": "pizzas",
                "עוגיות": "cookies", "לחמים": "breads", "סלטים": "salads", "מארזים": "boxes", "שתייה": "drinks"}
WOLT_TO_SITE = {"שתייה קלה": "שתייה"}
OVERLAY_KEYS = {"_doc", "_size_note", "move_to_category", "products", "counter_only", "customer_faq", "sales_tips"}
PRODUCT_KEYS = {"name", "aliases", "description", "staff_description", "sizes", "tags", "notes"}


def shekel(agorot):
    return agorot // 100 if agorot % 100 == 0 else agorot / 100


def ingredients(text):
    """Rough split of a description into a short ingredient list (for the "ממה זה עשוי?" game)."""
    out = []
    for chunk in re.split(r"[,|]", text or ""):
        # split "X וY" on the conjunction, but not words that start with ו (וניל)
        for part in re.split(r"\s+ו(?!ני)(?=\S)", chunk):
            part = part.strip(" .")
            if part:
                out.append(part)
    return out


def image_file(pid, url):
    """Local photo path relative to data/. Keyed by the Wolt URL too, so a replaced photo gets a new file."""
    return f"images/{pid}-{hashlib.sha1(url.encode()).hexdigest()[:8]}.webp"


def local_image(pid, url):
    """The downloaded photo (fetch_wolt.py --images), if there is one."""
    path = image_file(pid, url) if url else None
    return path if path and (DATA / path).exists() else None


def clean_name(name):
    # "מילפיי | אישי" -> name "מילפיי", size note "אישי"
    if " | " in name:
        base, extra = name.split(" | ", 1)
        return base.strip(), extra.strip()
    return name.strip(), None


def check_overlay(overlay, snapshot_ids, warn):
    for key in overlay.keys() - OVERLAY_KEYS:
        warn(f"unknown top-level key in staff_overlay.json: {key}")
    for pid, target in overlay.get("move_to_category", {}).items():
        if pid not in snapshot_ids:
            warn(f"move_to_category: id {pid} is not in the Wolt snapshot")
        if target not in CATEGORIES:
            warn(f"move_to_category: {pid} -> unknown category {target!r}")
    for pid, fields in overlay.get("products", {}).items():
        if pid not in snapshot_ids:
            hint = fields.get("name") or ", ".join(fields.get("aliases", [])) or ", ".join(fields.get("tags", []))
            warn(f"products: id {pid} ({hint}) is not in the Wolt snapshot; its staff notes are NOT applied")
        for key in fields.keys() - PRODUCT_KEYS:
            warn(f"products: {pid} has unknown key {key!r}")
    for c in overlay.get("counter_only", []):
        if c.get("category") not in CATEGORIES:
            warn(f"counter_only: {c.get('id')} has unknown category {c.get('category')!r}")


def apply_sales_tips(tips, products, warn):
    """Per-product "sales" (pairings + pitch line) and the top-level situation tips.

    Every product id in the tips must exist; unknown ids are warned about and dropped.
    """
    by_id = {p["id"]: p for p in products}
    draft = bool(tips.get("draft"))

    def refs(ids, where):
        out = []
        for pid in ids:
            if pid in by_id:
                out.append({"id": pid, "name": by_id[pid]["name"]})
            else:
                warn(f"sales_tips: {where} refers to unknown product id {pid}")
        return out

    per_product = tips.get("products", {})
    for pid in per_product.keys() - by_id.keys():
        warn(f"sales_tips: tip for unknown product id {pid}")
    for p in products:
        t = per_product.get(p["id"])
        p["sales"] = {"pair_with": refs(t.get("pair", []), p["name"]), "pitch": t.get("pitch") or None,
                      "draft": draft} if t else None
    return {"draft": draft, "items": [
        {"id": s["id"], "title": s["title"], "tip": s["tip"], "products": refs(s.get("products", []), s["title"])}
        for s in tips.get("situations", [])]}


def main():
    warnings = []

    def warn(msg):
        warnings.append(msg)
        print("WARNING:", msg, file=sys.stderr)

    overlay = json.loads((TOOLS / "staff_overlay.json").read_text(encoding="utf-8"))
    moves = overlay.get("move_to_category", {})
    extra = overlay.get("products", {})
    with open(TOOLS / "wolt_snapshot.tsv", encoding="utf-8") as f:
        rows = list(csv.DictReader(f, delimiter="\t"))
    check_overlay(overlay, {r["id"] for r in rows}, warn)

    products = []
    for row in rows:
        cat = moves.get(row["id"]) or WOLT_TO_SITE.get(row["wolt_category"], row["wolt_category"])
        if cat not in CATEGORIES:
            continue  # seasonal / cutlery
        name, unit = clean_name(row["name"])
        choices, wolt_sizes = [], []
        for opt in filter(None, row["options"].split(";")):
            if ":" in opt:  # size option with price delta in agorot
                label, delta = opt.rsplit(":", 1)
                wolt_sizes.append({"label": label, "price": shekel(int(row["price_agorot"]) + int(delta))})
            else:
                choices.append(opt)
        p = {
            "id": row["id"],
            "category": cat,
            "name": name,
            "unit": unit,
            "aliases": [],
            "description": row["description"],
            "staff_description": None,
            "price": shekel(int(row["price_agorot"])),
            "sizes": [],
            "choices": choices,
            "image": local_image(row["id"], row["image"]) or row["image"] or None,
            "tags": [],
            "notes": [],
            "source": "wolt",
            "wolt": {"name": row["name"], "description": row["description"], "price": shekel(int(row["price_agorot"])), "sizes": wolt_sizes},
        }
        o = extra.get(row["id"])
        if o:
            p.update(o)
            p["source"] = "wolt+staff"
        if p["sizes"]:
            p["price"] = p["sizes"][0]["price"]
        elif wolt_sizes:
            p["sizes"] = wolt_sizes
        products.append(p)
    for c in overlay.get("counter_only", []):
        p = {"unit": None, "aliases": [], "staff_description": None, "price": None, "sizes": [], "choices": [],
             "image": None, "tags": [], "notes": [], "source": "staff", "wolt": None, **c}
        if p["sizes"] and p["price"] is None:
            p["price"] = p["sizes"][0]["price"]
        products.append(p)
    for p in products:
        p["category_name"] = p["category"]
        p["category"] = CATEGORY_IDS[p["category"]]
        p["ingredients"] = [] if p["category"] == "drinks" else ingredients(p["description"] or p["staff_description"])
        p["is_wolt"] = p["source"] != "staff"
    order = {CATEGORY_IDS[c]: i for i, c in enumerate(CATEGORIES)}
    products.sort(key=lambda p: order[p["category"]])  # stable: keeps Wolt order inside a category
    situations = apply_sales_tips(overlay.get("sales_tips", {}), products, warn)

    out_path = DATA / "products.json"
    previous = json.loads(out_path.read_text(encoding="utf-8")) if out_path.exists() else None
    if previous:
        gone = {(p["id"], p["name"]) for p in previous["products"]} - {(p["id"], p["name"]) for p in products}
        for pid, name in sorted(gone):
            print(f"note: {name} ({pid}) was renamed or left the menu since the last build", file=sys.stderr)
    out = {
        "updated": datetime.date.today().isoformat(),
        "source": "https://wolt.com/he/isr/hasharon/restaurant/lart-du-pain-r + staff notes",
        "categories": [{"id": CATEGORY_IDS[c], "name": c, "count": sum(p["category_name"] == c for p in products)} for c in CATEGORIES],
        "products": products,
        "customer_faq": overlay.get("customer_faq", []),
        "sales_situations": situations,
    }
    # Bump "updated" only when the content changed, so it can serve as a cache version.
    if previous and {**previous, "updated": None} == {**out, "updated": None}:
        out["updated"] = previous["updated"]
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(products)} products -> data/products.json (updated {out['updated']})")
    if warnings and "--strict" in sys.argv:
        sys.exit(1)


if __name__ == "__main__":
    main()
