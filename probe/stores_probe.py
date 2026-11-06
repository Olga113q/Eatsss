"""Временная проверка: что отдаёт magnit.ru обычным запросом (без браузера)."""
import json, os, time, urllib.request

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
URLS = {
    "robots": "https://magnit.ru/robots.txt",
    "catalog": "https://magnit.ru/catalog/",
    "search": "https://magnit.ru/search?term=%D0%BC%D0%BE%D0%BB%D0%BE%D0%BA%D0%BE",
}
os.makedirs("probe/out", exist_ok=True)
res = {}
for name, u in URLS.items():
    try:
        req = urllib.request.Request(u, headers={"User-Agent": UA, "Accept-Language": "ru-RU,ru;q=0.9"})
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read().decode("utf-8", "replace")
        open(f"probe/out/magnit_{name}.txt", "w").write(body)
        res[name] = {"status": r.status, "len": len(body)}
    except Exception as e:
        res[name] = {"error": f"{type(e).__name__}: {e}"}
    print(name, res[name])
    time.sleep(2)
json.dump(res, open("probe/stores_result.json", "w"), ensure_ascii=False, indent=1)
