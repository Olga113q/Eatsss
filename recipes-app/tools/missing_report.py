"""Список продуктов без цен магазинов → prices/missing.md (после tools/build_prices.py).

    python3 tools/missing_report.py
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
OUT = os.path.join(os.path.dirname(APP), "prices", "missing.md")
MEALS = {"Основные блюда", "Паста и пицца", "Ризотто", "Супы"}


def load_js(name):
    t = open(os.path.join(APP, "data", name), encoding="utf-8").read()
    return json.loads(t[t.index("=") + 1:].rstrip().rstrip(";"))


def main():
    data, plan = load_js("recipes.js"), load_js("plan.js")
    products = data["products"]
    cnt, meal = [0] * len(products), [0] * len(products)
    for r in data["recipes"]:
        for pid in {i[0] for i in r["i"] if not i[3]}:
            cnt[pid] += 1
            if r["c"] and r["c"][0] in MEALS:
                meal[pid] += 1
    approx, none = [], []
    for pid, (name, cat, *_rest) in enumerate(products):
        if cat in ("Базовое", "Другое") and name in ("Вода", "Соль"):
            continue
        o = plan["offers"].get(name)
        if o and any(x[0] != "approx" for x in o["o"]):
            continue
        (approx if o else none).append((cnt[pid], meal[pid], name, cat))
    approx.sort(reverse=True)
    none = sorted((x for x in none if x[0] >= 5), reverse=True)
    lines = [
        "# Чего нет в собранных ценах магазинов",
        "",
        "Число — в скольких рецептах продукт обязателен (в скобках — среди основных блюд, пасты, ризотто и супов).",
        "Алкоголь Ozon Fresh онлайн не продаёт. Пересобрать: `python3 recipes-app/tools/missing_report.py`.",
        "",
        f"## С примерной ценой ({len(approx)})",
        "",
        "| Продукт | Раздел | Рецептов |",
        "|---|---|---|",
        *[f"| {n} | {c} | {a} ({m}) |" for a, m, n, c in approx],
        "",
        f"## Без цены совсем — встречаются в 5+ рецептах ({len(none)})",
        "",
        "| Продукт | Раздел | Рецептов |",
        "|---|---|---|",
        *[f"| {n} | {c} | {a} ({m}) |" for a, m, n, c in none],
        "",
    ]
    open(OUT, "w", encoding="utf-8").write("\n".join(lines))
    print(f"примерная цена: {len(approx)}, без цены (5+ рецептов): {len(none)} -> {OUT}")


if __name__ == "__main__":
    main()
