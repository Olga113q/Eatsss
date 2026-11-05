"""Находит фото для рецептов: открывает страницу каждого рецепта на eda.ru
и берёт оттуда главную картинку (тег og:image).

Результат: data/images.js (сайт подхватывает его автоматически).
Можно прерывать (Ctrl+C) и запускать снова: уже найденное сохраняется
и повторно не скачивается.

Запуск (нужен только Python 3, без дополнительных библиотек):
    python3 tools/fetch_images.py
"""
import concurrent.futures
import html
import json
import os
import re
import sys
import threading
import time
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DATA = os.path.join(ROOT, "data", "recipes.js")
OUT = os.path.join(ROOT, "data", "images.js")
CACHE = os.path.join(ROOT, "data", "images-cache.json")

WORKERS = int(os.environ.get("WORKERS", 4))   # одновременных запросов: не больше, чтобы не нагружать сайт
MAX_MINUTES = float(os.environ.get("MAX_MINUTES", 0))  # 0 — без ограничения; иначе остановиться и сохранить
PAUSE = 0.3          # пауза после каждого запроса, секунд
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept-Language": "ru-RU,ru;q=0.9",
}
OG = [
    re.compile(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)', re.I),
    re.compile(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']', re.I),
    re.compile(r'"image"\s*:\s*\[?\s*"(https?://[^"]+)"', re.I),
]


def load_urls():
    text = open(DATA, encoding="utf-8").read()
    data = json.loads(text[text.index("=") + 1:].rstrip().rstrip(";"))
    return [r["u"] for r in data["recipes"] if r.get("u")]


def find_image(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=12) as resp:
        page = resp.read(600_000).decode("utf-8", "replace")
    for rx in OG:
        m = rx.search(page)
        if m:
            return html.unescape(m.group(1))
    return ""


def save(cache):
    tmp = CACHE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False)
    os.replace(tmp, CACHE)
    images = {u: img for u, img in cache.items() if img}
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("window.RECIPE_IMAGES=")
        json.dump(images, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")


def main():
    urls = load_urls()
    cache = json.load(open(CACHE, encoding="utf-8")) if os.path.exists(CACHE) else {}
    todo = [u for u in urls if u not in cache]
    print(f"Рецептов со ссылкой: {len(urls)}, уже обработано: {len(urls) - len(todo)}, осталось: {len(todo)}")
    if not todo:
        save(cache)
        print("Готово.")
        return

    lock = threading.Lock()
    done = 0
    errors = 0
    started = time.time()

    deadline = started + MAX_MINUTES * 60 if MAX_MINUTES else None

    def work(u):
        nonlocal done, errors
        if deadline and time.time() > deadline:
            return
        try:
            img = find_image(u)
        except urllib.error.HTTPError as e:
            img = "" if e.code in (404, 410) else None   # None — попробовать в следующий раз
            err = f"HTTP {e.code}"
        except Exception as e:
            img = None
            err = f"{type(e).__name__}: {e}"
        else:
            err = None
        time.sleep(PAUSE)
        with lock:
            done += 1
            if img is None:
                errors += 1
                if errors <= 5:
                    print(f"  ошибка {u}: {err}")
            else:
                cache[u] = img
            if done <= 3:
                print(f"  {u} -> {img!r}")
            if done % 50 == 0 or done == len(todo):
                save(cache)
                speed = done / (time.time() - started)
                left = (len(todo) - done) / speed / 60 if speed else 0
                found = sum(1 for v in cache.values() if v)
                print(f"  {done}/{len(todo)}  фото найдено всего: {found}  ошибок: {errors}  осталось ~{left:.0f} мин")

    try:
        with concurrent.futures.ThreadPoolExecutor(WORKERS) as ex:
            list(ex.map(work, todo))
    except KeyboardInterrupt:
        print("\nОстановлено, прогресс сохранён.")
    with lock:
        save(cache)
    found = sum(1 for v in cache.values() if v)
    left = sum(1 for u in urls if u not in cache)
    print(f"Готово: фото есть у {found} рецептов, не обработано: {left}. Файл: {OUT}")
    if errors:
        print(f"{errors} страниц не открылись — запустите скрипт ещё раз, он попробует только их.")


if __name__ == "__main__":
    sys.exit(main())
