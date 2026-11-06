"""Разбор сохранённых страниц каталога Магнита в recipes-app/data/prices/magnit.json.

Страницы лежат в prices/pages/magnit/<id_категории>_p<N>.html (исходный HTML,
который сайт отдаёт для выбранного магазина). Запуск из корня проекта:

    python prices/scripts/parse_magnit.py [YYYY-MM-DD]
"""
import json
import os
import re
import sys
from datetime import date

from bs4 import BeautifulSoup

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # корень репозитория
PAGES = os.path.join(ROOT, "prices", "pages", "magnit")
OUT = os.path.join(ROOT, "recipes-app", "data", "prices", "magnit.json")
LIMIT = 100  # товаров на раздел


# раздел планировщика -> [(id категории сайта, название на сайте)]
SECTIONS = [
    ("Мясо и птица", [("64317", "Свинина"), ("64315", "Говядина"), ("64321", "Фарш мясной"),
                      ("64291", "Курица"), ("64295", "Индейка"), ("64299", "Фарш из птицы")]),
    ("Рыба", [("38559", "Дары моря"), ("26739", "Рыба")]),
    ("Овощи", [("63921", "Овощи, грибы, зелень")]),
    ("Фрукты", [("63929", "Фрукты и ягоды")]),
    ("Молочные продукты и яйца", [("63983", "Молоко, масло, яйца"), ("63987", "Кефир, сметана, творог")]),
    ("Сыр", [("63991", "Сыры")]),
    ("Крупы и макароны", [("64123", "Крупы и сухие завтраки"), ("114259", "Макароны")]),
    ("Мука и выпечка", [("64133", "Всё для выпечки")]),
    ("Масло", [("64127", "Растительные масла")]),
    ("Консервы и соусы", [("64205", "Консервы: овощи и грибы"), ("64203", "Консервы: рыба"),
                          ("64201", "Консервы: мясо и птица"), ("64131", "Соусы")]),
    ("Хлеб", [("65003", "Хлеб")]),
    ("Замороженные полуфабрикаты", [("64469", "Пельмени и вареники"), ("64471", "Почти готово"),
                                    ("107230", "Заморозка: мясо и птица")]),
    ("Специи", [("64129", "Сахар, соль и специи")]),
]

PRICE_RE = re.compile(r"(\d[\d\s  ]*(?:,\d{1,2})?)\s*₽")
QTY_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(кг|г|мл|л|шт)(?![а-яё])", re.I)
PACK_RE = re.compile(r"отзыв[а-яё]*\s*(\d+(?:[.,]\d+)?)\s*(кг|г|мл|л|шт)", re.I)


def to_num(s):
    return float(re.sub(r"[\s  ]", "", s).replace(",", "."))


def norm_qty(value, unit):
    v, u = float(value.replace(",", ".")), unit.lower()
    if u == "кг":
        v, u = v * 1000, "г"
    elif u == "л":
        v, u = v * 1000, "мл"
    v = round(v, 1)
    return (int(v) if v == int(v) else v), u


def parse_amount(name, tail):
    found = QTY_RE.findall(name)
    mass = [f for f in found if f[1].lower() != "шт"]
    if mass:  # «Авокадо 2шт 350г» -> 350 г
        return norm_qty(*mass[-1])
    m = PACK_RE.search(tail)  # весовой товар: фасовка указана под названием
    if m:
        return norm_qty(m.group(1), m.group(2))
    if found:
        return norm_qty(*found[-1])
    return None, None


def parse_page(path):
    with open(path, encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "html.parser")
    for a in soup.select('a.pl-hover-base[href*="/product/"]'):
        m = re.search(r"/product/(\d+)", a["href"])
        name = (a.get("title") or "").strip()
        if not m or not name:
            continue
        text = re.sub(r"\s+", " ", a.get_text(" ")).strip()
        i = text.find(name)
        head, tail = (text[:i], text[i + len(name):]) if i >= 0 else (text, "")
        prices = [to_num(p) for p in PRICE_RE.findall(head)]
        if not prices:
            continue
        amount, unit = parse_amount(name, tail)
        yield {
            "id": m.group(1),
            "name": name,
            "price": prices[0],
            "old_price": prices[1] if len(prices) > 1 and prices[1] > prices[0] else None,
            "amount": amount,
            "unit": unit,
            "card_price": False,  # у Магнита на карточках нет отдельной цены по карте
            "url": "https://magnit.ru" + a["href"].split("?")[0],
        }


def pages_for(cat):
    files = [f for f in os.listdir(PAGES) if re.fullmatch(rf"{cat}_p(\d+)\.html", f)]
    return [os.path.join(PAGES, f) for f in sorted(files, key=lambda f: int(re.search(r"_p(\d+)", f).group(1)))]


def main():
    collected = sys.argv[1] if len(sys.argv) > 1 else date.today().isoformat()
    items, report = [], []
    for section, cats in SECTIONS:
        seen, cnt = set(), 0
        for k, (cat, label) in enumerate(cats):
            cap = (LIMIT - cnt) // (len(cats) - k)  # делим лимит раздела между подкатегориями
            taken = 0
            files = pages_for(cat)
            for path in files:
                for it in parse_page(path):
                    if taken >= cap or it["id"] in seen:
                        continue
                    seen.add(it["id"])
                    taken += 1
                    it.pop("id")
                    items.append({**{k2: it[k2] for k2 in ("name", "price", "old_price", "amount", "unit")},
                                  "card_price": it["card_price"], "category": label,
                                  "section": section, "url": it["url"]})
            cnt += taken
            report.append((section, cat, label, len(files), taken))
    data = {"store": "magnit", "collected_at": collected, "items": items}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    for r in report:
        print("\t".join(map(str, r)))
    print("total", len(items), "no amount:", sum(1 for i in items if i["amount"] is None))


if __name__ == "__main__":
    main()
