"""Выносит шаги приготовления из data/recipes.js в отдельный data/steps.js.

recipes.js нужен сразу при запуске (подбор рецептов), а шаги — только в окне рецепта, и это ~2/3 объёма.
Без шагов приложение стартует в ~3,7 раза быстрее; steps.js догружается в фоне (app.js → loadSteps).

    python3 tools/split_steps.py          # из уже собранного data/recipes.js (если в нём ещё есть шаги)

build_data.py пишет файлы сразу в разделённом виде (функция write_split).
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(HERE), "data")


def write_split(data, data_dir=DATA):
    """data — словарь RECIPE_DATA, где у рецептов есть "s" (список шагов). Пишет recipes.js и steps.js."""
    steps = []
    for r in data["recipes"]:
        s = r.pop("s", None) or []
        r["sl"] = sum(len(x) for x in s)  # длина текста шагов — нужна для сортировки «сначала настоящие блюда»
        steps.append(s)
    with open(os.path.join(data_dir, "recipes.js"), "w", encoding="utf-8") as f:
        f.write("window.RECIPE_DATA=")
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    with open(os.path.join(data_dir, "steps.js"), "w", encoding="utf-8") as f:
        f.write("window.RECIPE_STEPS=")
        json.dump(steps, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    for name in ("recipes.js", "steps.js"):
        print(f"{name}: {os.path.getsize(os.path.join(data_dir, name)) / 1e6:.1f} МБ")


def main():
    path = os.path.join(DATA, "recipes.js")
    text = open(path, encoding="utf-8").read()
    data = json.loads(text[text.index("{"): text.rindex("}") + 1])
    if not any("s" in r for r in data["recipes"]):
        sys.exit("в data/recipes.js уже нет шагов — разделять нечего")
    write_split(data)


if __name__ == "__main__":
    main()
