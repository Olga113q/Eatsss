"""Разбор сохранённых ответов каталога Ozon Fresh в recipes-app/data/prices/ozon_fresh.json.

Ozon отдаёт каталог через JSON (entrypoint-api, виджет tileGridDesktop),
а не готовым HTML. Сохранённые ответы лежат в
prices/pages/ozon_fresh/<категория>.json — это список {"url", "widget"}, где
widget — JSON-строка виджета с плитками товаров. Запуск из корня проекта:

    python prices/scripts/parse_ozon_fresh.py [YYYY-MM-DD]
"""
import json
import os
import re
import sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # корень репозитория
PAGES = os.path.join(ROOT, "prices", "pages", "ozon_fresh")
OUT = os.path.join(ROOT, "recipes-app", "data", "prices", "ozon_fresh.json")
LIMIT = 100


FLOUR = re.compile(r"мук[аи]|разрыхлит|дрожж|крахмал|смесь для выпечки|смесь для (хлеба|блин|оладий|торт|пирог|кекс)", re.I)
PASTA = re.compile(r"^(макарон|лапш|спагетти|паста|вермишель)", re.I)


def is_flour(name):
    return bool(FLOUR.search(name)) and not PASTA.search(name)


OIL = re.compile(r"^масло|масло (подсолнечное|оливковое|растительное|кукурузное|льняное|кунжутное|рапсовое|кокосовое)", re.I)

# раздел -> [(файл категории, название на сайте, фильтр по названию или None)]
SECTIONS = [
    ("Мясо и птица", [("steyki-92912000", "Мясо и птица", None)]),
    ("Рыба", [("supermarket-ryba-moreprodukty-9317000", "Рыба и морепродукты", None)]),
    ("Овощи", [("ovoshchi-i-zelen-92011000", "Овощи и зелень", None)]),
    ("Фрукты", [("frukty-i-yagody-92012000", "Фрукты и ягоды", None)]),
    ("Молочные продукты и яйца", [("moloko-maslo-i-yaytsa-92776000", "Молоко, масло и яйца", None),
                                  ("kefir-tvorog-smetana-92844000", "Кефир, творог и сметана", None)]),
    ("Сыр", [("supermarket-syr-i-syrnye-produkty-9289000", "Сыры", None)]),
    ("Крупы и макароны", [("makarony-i-krupy-30705000", "Макароны, крупы, мука", lambda n: not is_flour(n))]),
    ("Мука и выпечка", [("makarony-i-krupy-30705000", "Макароны, крупы, мука", lambda n: is_flour(n))]),
    ("Масло", [("maslo-sousy-ketchupy-30708000", "Масло, соусы и кетчупы", lambda n: bool(OIL.search(n)))]),
    ("Консервы и соусы", [("konservy-30709000", "Консервы", None),
                          ("maslo-sousy-ketchupy-30708000", "Масло, соусы и кетчупы", lambda n: not OIL.search(n))]),
    # «Выпекаем сами» на Ozon Fresh — это готовый хлеб из их пекарни, а не мука
    ("Хлеб", [("hleb-94622000", "Хлеб", None), ("kraftovyy-hleb-i-vypechka-94624000", "Выпекаем сами", None)]),
    ("Замороженные полуфабрикаты", [("pelmeni-i-vareniki-94391000", "Пельмени, вареники и блины", None),
                                    ("polufabrikaty-94398000", "Полуфабрикаты", None)]),
    ("Специи", [("sahar-sol-i-spetsii-30707000", "Сахар, соль и специи", None)]),
]

QTY_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(кг|г|гр|мл|л|шт)\.?(?![а-яё])", re.I)


def to_num(s):
    s = re.sub(r"[^\d,.]", "", s).replace(",", ".")
    return float(s) if s else None


def norm_qty(value, unit):
    v, u = float(value.replace(",", ".")), unit.lower()
    if u == "гр":
        u = "г"
    if u == "кг":
        v, u = v * 1000, "г"
    elif u == "л":
        v, u = v * 1000, "мл"
    v = round(v, 1)
    return (int(v) if v == int(v) else v), u


def parse_amount(name, labels):
    for src in [name] + labels:
        found = QTY_RE.findall(src)
        mass = [f for f in found if f[1].lower() != "шт"]
        if mass:
            return norm_qty(*mass[-1])
        if found:
            return norm_qty(*found[-1])
    return None, None


def parse_item(it):
    name, price, old, card, labels = None, None, None, False, []
    for st in it.get("mainState", []):
        t = st.get("type")
        if t == "textDS" and st.get("id") == "name":
            name = re.sub(r"\s+", " ", st["textDS"]["text"].replace("\xa0", " ")).strip()
        elif t == "priceV2":
            pv = st["priceV2"]
            for p in pv.get("price", []):
                if p.get("textStyle") == "PRICE":
                    price = to_num(p["text"])
                elif p.get("textStyle") == "ORIGINAL_PRICE":
                    old = to_num(p["text"])
            card = (pv.get("priceStyle") or {}).get("styleType") == "CARD_PRICE"
        elif t == "labelListV2":
            labels += [x["text"]["text"] for x in st["labelListV2"].get("items", []) if x.get("type") == "text"]
    if not name or price is None:
        return None
    amount, unit = parse_amount(name, labels)
    link = (it.get("action") or {}).get("link", "")
    return {
        "sku": it.get("sku"),
        "name": name,
        "price": price,
        "old_price": old if old and old > price else None,
        "amount": amount,
        "unit": unit,
        "card_price": card,
        "url": "https://www.ozon.ru" + link.split("?")[0] if link else None,
    }


def load(cat):
    path = os.path.join(PAGES, cat + ".json")
    if not os.path.exists(path):
        return []
    items, seen = [], set()
    for page in json.load(open(path, encoding="utf-8")):
        for raw in json.loads(page["widget"]).get("items", []):
            it = parse_item(raw)
            if it and it["sku"] not in seen:
                seen.add(it["sku"])
                items.append(it)
    return items


def main():
    collected = sys.argv[1] if len(sys.argv) > 1 else date.today().isoformat()
    cache, out, used = {}, [], set()
    for section, cats in SECTIONS:
        # кандидаты по каждой категории (без уже взятых в другие разделы и без дублей)
        avail, seen = [], set(used)
        for cat, label, flt in cats:
            lst = []
            for it in cache.setdefault(cat, load(cat)):
                if it["sku"] in seen or (flt and not flt(it["name"])):
                    continue
                seen.add(it["sku"])
                lst.append(it)
            avail.append((label, lst))
        # делим лимит поровну, остаток от маленьких категорий отдаём большим
        caps, left = [0] * len(avail), LIMIT
        order = sorted(range(len(avail)), key=lambda i: len(avail[i][1]))
        for n, k in enumerate(order):
            caps[k] = min(len(avail[k][1]), left // (len(order) - n))
            left -= caps[k]
        cnt = 0
        for (label, lst), cap in zip(avail, caps):
            for it in lst[:cap]:
                used.add(it["sku"])
                out.append({"name": it["name"], "price": it["price"], "old_price": it["old_price"],
                            "amount": it["amount"], "unit": it["unit"], "card_price": it["card_price"],
                            "category": label, "section": section, "url": it["url"]})
            cnt += cap
        print(f"{section}\t{cnt}")
    data = {"store": "ozon_fresh", "collected_at": collected, "items": out}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print("total", len(out), "card_price:", sum(i["card_price"] for i in out),
          "no amount:", sum(1 for i in out if i["amount"] is None))


if __name__ == "__main__":
    main()
