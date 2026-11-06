// Правки пользователя поверх базы рецептов (страница «Мои рецепты», manage.html).
// Хранятся в браузере (localStorage), ключ рецепта — ссылка на eda.ru (не номер: номера меняются при пересборке базы).
//   wtc:hidden — [ключ…]           скрытые: не предлагаются в подборе и в плане
//   wtc:edits  — {ключ: {t, course, n, i, s}}  изменённые поля
// Подключается сразу после data/recipes.js — app.js и planner.js видят уже исправленные рецепты.
(() => {
  "use strict";
  const D = window.RECIPE_DATA;
  const get = (k, d) => { try { return JSON.parse(localStorage.getItem("wtc:" + k)) ?? d; } catch { return d; } };
  const key = (r) => r.u || r.t;
  window.RECIPE_KEY = key;
  window.RECIPE_EDITS = {
    key,
    hidden: () => new Set(get("hidden", [])),
    edits: () => get("edits", {}),
    setHidden(k, on) {
      const h = new Set(get("hidden", []));
      if (on) h.add(k); else h.delete(k);
      localStorage.setItem("wtc:hidden", JSON.stringify([...h]));
    },
    setEdit(k, e) {
      const all = get("edits", {});
      if (e) all[k] = e; else delete all[k];
      localStorage.setItem("wtc:edits", JSON.stringify(all));
    },
  };
  if (!D || D.__edited) return;
  D.__edited = true;
  const hidden = new Set(get("hidden", []));
  const edits = get("edits", {});
  for (const r of D.recipes) {
    const k = key(r);
    if (hidden.has(k)) r.h = 1;
    const e = edits[k];
    if (!e) continue;
    r.e = 1;
    if (e.t) r.t = e.t;
    if (e.course) r.c = [e.course, ...r.c.slice(1)];
    if (e.n) r.n = e.n;
    if (e.i) r.i = e.i;
    if (e.s) { r.s = e.s; r.sl = e.s.reduce((n, x) => n + x.length, 0); }
  }
})();
