"""Временная проверка: отвечают ли сайты магазинов серверу GitHub Actions."""
import json, urllib.request, ssl, time

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
URLS = [
    "https://ipinfo.io/json",
    "https://5ka.ru/",
    "https://5ka.ru/catalog/",
    "https://5d.5ka.ru/api/catalog/v2/stores/",
    "https://magnit.ru/",
    "https://magnit.ru/catalog/",
    "https://www.perekrestok.ru/",
    "https://www.perekrestok.ru/cat/",
    "https://lenta.com/",
    "https://lenta.com/catalog/",
]
out = []
for u in URLS:
    t = time.time()
    try:
        req = urllib.request.Request(u, headers={"User-Agent": UA, "Accept-Language": "ru-RU,ru;q=0.9", "Accept": "text/html,application/json;q=0.9,*/*;q=0.8"})
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read(400_000)
            out.append({"url": u, "status": r.status, "final": r.geturl(), "len": len(body),
                        "server": r.headers.get("server"), "ctype": r.headers.get("content-type"),
                        "head": body[:300].decode("utf-8", "replace")})
    except urllib.error.HTTPError as e:
        body = e.read(2000)
        out.append({"url": u, "status": e.code, "server": e.headers.get("server"), "head": body[:300].decode("utf-8", "replace")})
    except Exception as e:
        out.append({"url": u, "error": f"{type(e).__name__}: {e}"})
    out[-1]["sec"] = round(time.time() - t, 1)
    print(json.dumps(out[-1], ensure_ascii=False)[:400])
json.dump(out, open("probe/stores_result.json", "w"), ensure_ascii=False, indent=1)
