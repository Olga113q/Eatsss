"""Готовит данные для недельного плана: цены магазинов и количества из рецептов.

Читает:
    data/recipes.js          — база рецептов (tools/build_data.py)
    data/prices/<магазин>.json — цены, собранные со страниц магазинов
Пишет:
    data/plan.js  — window.PLAN_DATA = {
        stores:  {id: {name, address, date}},
        offers:  {продукт: {u: "g"|"pcs", o: [[магазин, название, цена, кол-во в u, ссылка, по_карте]]}},
        qty:     [[[id продукта, кол-во в u]...] для каждого рецепта, в порядке recipes.js],
    }

Запуск: python3 tools/build_prices.py
"""
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from normalize import OTHER, canonical  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
STORE_NAMES = {"magnit": "Магнит", "ozon_fresh": "Ozon Fresh", "pyaterochka": "Пятёрочка",
               "perekrestok": "Перекрёсток", "lenta": "Лента"}

# Продукты, которые считаются в штуках (остальное — в граммах; мл ≈ г).
PCS = {"Яйца", "Перепелиные яйца"}

# Вес одной штуки/головки/пучка и т. п., граммы.
PIECE = {
    "Лук репчатый": 100, "Чеснок": 50, "Морковь": 100, "Картофель": 120, "Помидоры": 120, "Огурцы": 120,
    "Болгарский перец": 150, "Лимон": 100, "Лайм": 60, "Апельсины": 200, "Мандарины": 80, "Яблоки": 160,
    "Бананы": 150, "Груши": 170, "Баклажаны": 300, "Кабачки / цукини": 300, "Капуста": 1500,
    "Пекинская капуста": 800, "Цветная капуста": 700, "Брокколи": 400, "Свекла": 200, "Авокадо": 200,
    "Перец чили": 15, "Сельдерей": 50, "Лук-порей": 200, "Редис": 20, "Тыква": 2000, "Батат": 300,
    "Петрушка": 40, "Укроп": 40, "Кинза": 40, "Зеленый лук": 40, "Базилик": 30, "Мята": 20, "Зелень": 40,
    "Тимьян": 10, "Розмарин": 10, "Шпинат": 100, "Руккола": 100, "Салатные листья": 150, "Имбирь": 40,
    "Хлеб": 400, "Лаваш / тортильи": 150, "Сосиски": 50, "Колбаса": 400, "Сыр твердый": 200,
    "Моцарелла": 125, "Фета / брынза": 200, "Сливочный сыр": 180, "Плавленый сыр": 90, "Курица": 1500,
    "Креветки": 15, "Лосось / семга": 200, "Белая рыба": 400, "Шампиньоны": 20, "Грибы": 30,
    "Апельсиновый сок": 200, "Ананас": 1500, "Манго": 300, "Киви": 80, "Гранат": 300, "Персики / нектарины": 150,
    "Слоеное тесто": 500, "Тесто (готовое)": 500, "Сливочное масло": 180, "Бекон": 15, "Ветчина": 30,
}
SMALL = {  # «зубчик», «ломтик» и т. п.
    "зубчик": 5, "ломтик": 25, "ломтика": 25, "ломтиков": 25, "кусочек": 25, "веточка": 3, "веточки": 3,
    "веточек": 3, "лист": 1, "листа": 1, "листьев": 1, "стебель": 50, "стебля": 50, "стеблей": 50,
}
SPOON = {"ст": 15, "ч": 5}
GLASS = {"Мука пшеничная": 130, "Сахар": 180, "Рис": 185, "Сахарная пудра": 120, "Манная крупа": 160,
         "Гречка": 170, "Овсяные хлопья": 90, "Крахмал": 150}
PACK = {"банка": 400, "банки": 400, "упаковка": 200, "упаковки": 200, "пачка": 200, "пачки": 200,
        "пакетик": 10, "пакетика": 10, "пакет": 500, "бутылка": 500, "бутылки": 500, "кусок": 200, "кусочка": 25}
FRAC = {"½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3}

# Примерные цены (₽ за упаковку, размер упаковки в г/шт) для продуктов, которых нет в
# собранных ценах магазинов. Это ориентировочные розничные цены по СПб, а не данные
# магазина — на сайте они помечаются как «примерная цена».
APPROX = {
    "Вино": (450, 750), "Базилик": (90, 30), "Какао": (150, 100), "Тимьян": (90, 10), "Кумин (зира)": (80, 30),
    "Грецкие орехи": (250, 200), "Томаты консервированные": (150, 400), "Миндаль": (280, 150),
    "Панировочные сухари": (60, 200), "Изюм": (110, 200), "Лук-порей": (120, 300), "Кориандр молотый": (60, 30),
    "Коньяк / бренди": (900, 500), "Печенье": (90, 250), "Сироп": (250, 250), "Кедровые орехи": (350, 100),
    "Кофе": (450, 250), "Куркума": (60, 30), "Шафран": (250, 1), "Каперсы": (200, 100), "Кокосовое молоко": (180, 400),
    "Имбирь молотый": (60, 20), "Орехи": (250, 200), "Кардамон": (120, 20), "Варенье / джем": (180, 350),
    "Стручковая фасоль": (150, 400), "Чернослив": (160, 200), "Белые грибы": (250, 50), "Эстрагон": (90, 30),
    "Бадьян": (90, 15), "Ликер": (900, 500), "Куриная печень": (130, 500), "Ром": (900, 500), "Фундук": (280, 150),
    "Тофу": (180, 300), "Сало": (250, 300), "Вустерширский соус": (300, 150), "Смородина": (200, 300),
    "Перепелиные яйца": (120, 20), "Курага": (180, 200), "Ростки": (150, 200), "Арахис": (120, 200),
    "Водоросли нори": (150, 10), "Кешью": (300, 150), "Фисташки": (350, 150), "Ягоды": (250, 300),
    "Лимонная трава": (120, 50), "Сосиски": (250, 400), "Горох": (60, 800), "Шалфей": (90, 10), "Козий сыр": (350, 150),
    "Финики": (200, 250), "Фенхель": (150, 300), "Томатный сок": (130, 1000), "Водка": (550, 500), "Пиво": (100, 500),
    "Брюссельская капуста": (180, 400), "Арахисовая паста": (250, 340), "Кролик": (800, 1200), "Цукаты": (120, 200),
    "Инжир": (250, 200), "Абрикосы": (250, 500), "Ежевика": (250, 250), "Сухофрукты": (200, 300), "Репа": (80, 500),
    "Черный перец": (70, 50), "Лавровый лист": (40, 10), "Хлеб": (55, 400), "Мед": (350, 500), "Разрыхлитель": (25, 15),
    "Ваниль / ванилин": (25, 2), "Корица": (60, 30), "Паприка": (60, 50), "Мускатный орех": (80, 15), "Гвоздика": (60, 15),
    "Сушеные травы": (70, 15), "Желатин": (40, 20), "Дрожжи": (25, 11), "Крахмал": (60, 250), "Сода": (40, 500),
}

# Готовые продукты и смеси, которые нельзя считать ингредиентом.
READY = re.compile(
    r"пельмен|варени(?!е)|лапша (быстр|доширак|big ?bon|роллтон|wok)|доширак|роллтон|big ?bon|\bсмесь\b|"
    r"для приготовления|на второе|суп сухой|основа для|наггетс|котлет|блинчик|пицц|хлебц|со вкусом|паштет|"
    r"чипс|сырник|фрикадел|бургер|лазанья|вафли|полуфабрикат|чебурек|голубцы|манты|хинкали|шаурм|"
    r"сэндвич|салат (оливье|цезарь)|маринад|приправа для|спред|сухари|крутон|снек|батончик|кукурузные палочки|"
    r"растительн\w* (котлет|фарш)|набор овощей|набор для|корм|с начинкой|глазированн|^каша|готов\w* (блюд|завтрак)|"
    r"в соусе|в томатном|дамплинг|рамен|панировк|корочк|тушен|в масле|в собственном соку|по-корейски|рагу|плов|жаркое|гуляш в|соус для|мюсли|хлопья для завтрака", re.I)


def store_canonical(name):
    t = name.lower().replace("ё", "е").replace("cо ", "со ").replace("c ", "с ")
    if READY.search(t) or re.match(r"(суповой набор|лепешк|борщ|суп|щи|солянк|окрошк|творожное зерно|сырок)", t):
        return None
    # «Масло подсолнечное», «Капуста цветная» → «подсолнечное масло», «цветная капуста»
    # (в рецептах прилагательное обычно стоит первым, правила рассчитаны на такой порядок)
    t = re.sub(r"^([а-я-]+) ([а-я-]+(ая|ое|ый|ий|ой|ые|ие))\b", r"\2 \1", t)
    t = re.sub(r"^(яйцо|яйца) ", "яйца куриные ", t)
    # добавки после «с/в/из …» описывают вкус, начинку или сырьё, а не сам продукт:
    # «Макароны … с натуральным томатом», «Сыр плавленый … с ветчиной»
    full = t
    t = re.sub(r"\s(с|со|в|во|из|на|для|\+)\s.*$", "", t)
    if re.match(r"(хлеб|батон|багет|чиабатт)", t):   # «Хлеб Геркулес…» — это хлеб, а не хлопья
        return "Ржаной хлеб" if re.search(r"ржан|бородин", t) else "Хлеб"
    prod, cat = canonical(t)
    if prod == "Говядина" and re.search(r"свин|индейк|кур|цыпл|рыб|лосос|баран", full):
        return None   # «Стейк … из свиной шеи» и т. п.
    if cat == OTHER:
        return None
    if t.startswith("приправа") and cat != "Специи":
        return None
    if t.startswith("соус") and cat != "Соусы и консервы":
        return None   # «Соус перечный для стейка» — это соус, а не говядина
    if prod in ("Помидоры", "Огурцы", "Капуста", "Грибы", "Шампиньоны", "Белые грибы", "Болгарский перец") and re.search(r"маринов|солен|консерв|в собственном|кисло", t):
        return None
    return prod


def per_unit(item, prod):
    """Количество товара в единицах продукта (г или шт)."""
    amount, unit = item.get("amount"), (item.get("unit") or "").lower()
    if prod in PCS:
        if unit == "шт" and amount:
            return float(amount)
        m = re.search(r"(\d+)\s*шт", item["name"])
        return float(m.group(1)) if m else None
    if not amount:
        return None
    if unit in ("г", "мл"):
        return float(amount)
    if unit == "шт":
        w = PIECE.get(prod)
        return float(amount) * w if w else None
    return None


def parse_number(s):
    s = s.strip()
    for k, v in FRAC.items():
        if k in s:
            whole = re.sub(r"[^\d]", "", s.replace(k, ""))
            return (float(whole) if whole else 0) + v
    m = re.match(r"(\d+(?:[.,]\d+)?)(?:\s*[-–]\s*(\d+(?:[.,]\d+)?))?", s)
    if not m:
        return None
    a = float(m.group(1).replace(",", "."))
    if m.group(2):
        a = (a + float(m.group(2).replace(",", "."))) / 2
    return a


def chicken_piece(raw):
    r = raw.lower()
    if re.search(r"филе|грудк", r):
        return 250
    if re.search(r"бедр|голен|ножк|крыл|окороч", r):
        return 150
    return 1500


def recipe_qty(prod, raw, qty):
    """Сколько продукта нужно по строке рецепта: (кол-во, единица 'g'|'pcs') или None."""
    q = qty.lower().replace("ё", "е").strip()
    if not q or re.search(r"по вкусу|для подачи|для смазыв|для жарки|для украш", q):
        return None
    num = parse_number(q)
    if num is None:
        if re.search(r"щепот|кончике", q):
            return (1.0, "g") if prod not in PCS else None
        return None
    rest = re.sub(r"^[\d\s.,½¼¾⅓⅔–-]+", "", q)
    if prod in PCS:
        if re.match(r"шт", rest) or not rest:
            return num, "pcs"
        if re.match(r"г\b", rest):
            return num / 55, "pcs"
        return None
    if re.match(r"кг\b", rest):
        return num * 1000, "g"
    if re.match(r"(г|мл)\b", rest):
        return num, "g"
    if re.match(r"л\b", rest):
        return num * 1000, "g"
    if re.match(r"стол", rest):
        return num * SPOON["ст"], "g"
    if re.match(r"чайн", rest):
        return num * SPOON["ч"], "g"
    if re.match(r"стакан", rest):
        return num * GLASS.get(prod, 200), "g"
    if re.match(r"(шт|головк|пучк|пучок|клубн|плод|тушк)", rest):
        w = chicken_piece(raw) if prod == "Курица" else PIECE.get(prod)
        if w is None:
            return None
        return num * w, "g"
    for k, w in SMALL.items():
        if rest.startswith(k):
            return num * w, "g"
    for k, w in PACK.items():
        if rest.startswith(k):
            return num * PIECE.get(prod, w), "g"
    return None


def main():
    text = open(os.path.join(ROOT, "data", "recipes.js"), encoding="utf-8").read()
    data = json.loads(text[text.index("=") + 1:].rstrip().rstrip(";"))
    products = data["products"]
    name2id = {p[0]: i for i, p in enumerate(products)}

    stores, offers = {}, {}
    for path in sorted(glob.glob(os.path.join(ROOT, "data", "prices", "*.json"))):
        d = json.load(open(path, encoding="utf-8"))
        sid = d.get("store") or os.path.basename(path)[:-5]
        stores[sid] = {"name": STORE_NAMES.get(sid, sid), "address": d.get("address", ""), "date": d.get("collected_at", "")}
        matched = 0
        for it in d["items"]:
            prod = store_canonical(it["name"])
            if not prod or prod not in name2id or not it.get("price"):
                continue
            n = per_unit(it, prod)
            if not n:
                continue
            matched += 1
            o = offers.setdefault(prod, {"u": "pcs" if prod in PCS else "g", "o": []})
            o["o"].append([sid, it["name"], round(float(it["price"]), 2), round(n, 1), it.get("url", ""), 1 if it.get("card_price") else 0])
        print(f"{sid}: товаров {len(d['items'])}, сопоставлено {matched}")
    approx_n = 0
    for prod, (price, amount) in APPROX.items():
        if prod not in name2id or prod in offers:
            continue
        offers[prod] = {"u": "pcs" if prod in PCS else "g", "o": [["approx", f"{prod} (примерно)", price, amount, "", 0]]}
        approx_n += 1
    stores["approx"] = {"name": "примерная цена", "address": "", "date": ""}
    print(f"примерных цен добавлено: {approx_n}")
    for o in offers.values():
        o["o"].sort(key=lambda x: x[2] / x[3])
        # по 6 самых выгодных предложений каждого магазина
        keep, cnt = [], {}
        for x in o["o"]:
            if cnt.get(x[0], 0) < 6:
                keep.append(x)
                cnt[x[0]] = cnt.get(x[0], 0) + 1
        o["o"] = keep

    qty, total, parsed = [], 0, 0
    for r in data["recipes"]:
        row = {}
        for pid, raw, q, optional in r["i"]:
            if optional:
                continue
            total += 1
            prod = products[pid][0]
            res = recipe_qty(prod, raw, q)
            if res:
                parsed += 1
                row[pid] = round(row.get(pid, 0) + res[0], 1)
        qty.append([[pid, v] for pid, v in row.items()])
    print(f"количества распознаны: {parsed} из {total} обязательных ингредиентов ({parsed / total:.0%})")
    print(f"продуктов с ценами: {len(offers)}")

    out = os.path.join(ROOT, "data", "plan.js")
    with open(out, "w", encoding="utf-8") as f:
        f.write("window.PLAN_DATA=")
        json.dump({"stores": stores, "offers": offers, "qty": qty}, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print(f"файл: {out} ({os.path.getsize(out) / 1e6:.1f} МБ)")


if __name__ == "__main__":
    main()
