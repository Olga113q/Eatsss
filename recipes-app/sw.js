// Офлайн-режим: файлы сайта и базы рецептов сохраняются в телефоне.
// Пока есть сеть — берём свежие версии (так обновления приходят сами), без сети — сохранённые.
const VERSION = "v3";
const APP = "app-" + VERSION;
const IMG = "img-" + VERSION;
const SHELL = ["./", "index.html", "app.js", "planner.js", "app-update.js", "style.css", "manifest.webmanifest",
  "manage.html", "manage.js", "recipe-edits.js", "recipe-prefs.js",
  "data/recipes.js", "data/steps.js", "data/plan.js", "data/not-for-me.js", "data/images.js", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== APP && k !== IMG).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // свои файлы: сначала сеть, при неудаче — сохранённая копия.
    // cache: "no-cache" — всегда сверяемся с сервером (если файл не менялся, ответ 304 — это быстро),
    // иначе браузер до 10 минут отдаёт старую копию и обновления сайта «не видно»
    const fresh = req.mode === "navigate" ? new Request(req.url, { cache: "no-cache", credentials: "same-origin" })
      : new Request(req, { cache: "no-cache" });
    e.respondWith(fetch(fresh).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(APP).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match("index.html"))));
  } else if (req.destination === "image") {
    // фото блюд: из кеша, если уже скачивали; кеш ограничен ~400 картинками
    e.respondWith(caches.open(IMG).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      c.put(req, res.clone());
      const keys = await c.keys();
      if (keys.length > 400) await c.delete(keys[0]);
      return res;
    }).catch(() => fetch(req)));
  }
});
