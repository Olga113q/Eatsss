"""Собирает data/recipes.js для сайта из SQL-дампа рецептов eda.ru.

Источник: https://github.com/Maximilyanus29/recipes
(файл docker/docker-entrypoint-initdb.d/recipes.sql, таблица recipe_temp).

Запуск:
    python3 tools/build_data.py путь/к/recipes.sql
"""
import collections
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from normalize import CATEGORY_ORDER, DEFAULT_PANTRY, IGNORE, canonical  # noqa: E402
from sqldump import iter_rows  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), "..", "data", "recipes.js")
OPTIONAL_VALUES = ("по вкусу", "для подачи", "для украшения", "для смазывания", "для жарки", "для обсыпки")


def parse_minutes(s):
    if not s:
        return None
    h = re.search(r"(\d+)\s*(час|ч\b)", s)
    m = re.search(r"(\d+)\s*мин", s)
    d = re.search(r"(\d+)\s*(дн|сут)", s)
    total = (int(h.group(1)) * 60 if h else 0) + (int(m.group(1)) if m else 0) + (int(d.group(1)) * 1440 if d else 0)
    return total or None


def main(path):
    rows = list(iter_rows(path, "recipe_temp"))
    seen = set()
    recipes = []
    product_ids = {}
    products = []  # [name, category, recipe_count]

    def pid(name, cat):
        if name not in product_ids:
            product_ids[name] = len(products)
            products.append([name, cat, 0])
        return product_ids[name]

    for r in rows:
        title = (r["h1"] or "").strip()
        ings = json.loads(r["ingredients"] or "[]")
        if not title or not ings:
            continue
        key = r["link"] or title
        sig = (title.lower(), tuple(sorted(i["title"].strip().lower() for i in ings)))
        if key in seen or sig in seen:
            continue
        seen.add(key)
        seen.add(sig)

        items = []
        used = set()
        for i in ings:
            raw = i["title"].strip()
            qty = (i.get("value") or "").strip()
            name, cat = canonical(raw)
            p = pid(name, cat)
            optional = name in IGNORE or any(v in qty.lower() for v in OPTIONAL_VALUES)
            items.append([p, raw, qty, 1 if optional else 0])
            used.add(p)
        for p in used:
            products[p][2] += 1

        steps = [s.get("values", "").strip() for s in json.loads(r["instruction"] or "[]")]
        cats = [c for c in json.loads(r["categories"] or "[]") if c != "Главная"]
        recipes.append({
            "t": title,
            "c": cats,
            "i": items,
            "s": [s for s in steps if s],
            "k": r["ccal"],
            "n": r["portion"],
            "m": parse_minutes(r["time"]),
            "tm": re.sub(r"\s+", " ", r["time"] or "").strip(),
            "u": ("https://eda.ru" + r["link"]) if r["link"] and r["link"].startswith("/") else r["link"],
        })

    data = {
        "categories": CATEGORY_ORDER,
        "pantry": DEFAULT_PANTRY,
        "ignore": sorted(IGNORE),
        "products": products,
        "recipes": recipes,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("window.RECIPE_DATA=")
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print(f"рецептов: {len(recipes)}, продуктов: {len(products)}, файл: {os.path.getsize(OUT) / 1e6:.1f} МБ")
    by_cat = collections.Counter(p[1] for p in products)
    print(dict(by_cat))


if __name__ == "__main__":
    main(sys.argv[1])
