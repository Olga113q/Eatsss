// «Не подходит» и цена блюда. Подключается после data/recipes.js, recipe-edits.js, data/plan.js, data/not-for-me.js.
//
// Рецепты из data/not-for-me.js помечаются r.d = причина — не предлагаются ни в подборе, ни в плане.
// wtc:allow — рецепты, которые пользователь вернул вручную («Всё равно показывать»).
// window.recipeCost(id) — примерная стоимость рецепта по самой дешёвой цене каждого продукта (data/plan.js).
(() => {
  "use strict";
  const D = window.RECIPE_DATA, P = window.PLAN_DATA;
  if (!D) return;
  const get = (k, d) => { try { return JSON.parse(localStorage.getItem("wtc:" + k)) ?? d; } catch { return d; } };
  const set = (k, v) => localStorage.setItem("wtc:" + k, JSON.stringify(v));
  const names = D.products.map((p) => p[0]);
  const cats = D.products.map((p) => p[1]);
  const pid = (n) => names.indexOf(n);
  const IGNORE = new Set(D.ignore.map(pid));
  const key = window.RECIPE_KEY || ((r) => r.u || r.t);

  // ---------- «не подходит»: список, составленный вручную (data/not-for-me.js) ----------
  // рыба, блюда на жареном/тушёном болгарском перце или луке, тофу. Блюда без мяса не скрываем —
  // в плане к ним добавляется мясная добавка (planner.js).
  const NFM = window.NOT_FOR_ME || {};
  const allow = new Set(get("allow", []));
  for (const r of D.recipes) {
    const k = key(r);
    if (NFM[k] && !allow.has(k)) r.d = NFM[k];
  }

  window.RECIPE_PREFS = {
    allow(k, on) { const a = new Set(get("allow", [])); if (on) a.add(k); else a.delete(k); set("allow", [...a]); },
    allowed: () => new Set(get("allow", [])),
    count: () => Object.keys(NFM).length,
  };

  // ---------- цена блюда ----------
  if (!P) return;
  const best = new Map(); // продукт → минимальная цена за г/шт
  for (const [name, x] of Object.entries(P.offers)) {
    const id = pid(name);
    if (id < 0) continue;
    let m = Infinity;
    for (const o of x.o) m = Math.min(m, o[2] / o[3]);
    if (m < Infinity) best.set(id, m);
  }
  // {total, per, n, partial} или null, если цен не хватает (меньше 70% основных продуктов)
  window.recipeCost = (rid) => {
    const r = D.recipes[rid];
    const q = new Map(P.qty[rid] || []);
    const req = [...new Set(r.i.filter((i) => !i[3] && !IGNORE.has(i[0])).map((i) => i[0]))];
    if (!req.length) return null;
    let total = 0, known = 0;
    for (const p of req) {
      const g = q.get(p), price = best.get(p);
      if (g === undefined || price === undefined) continue;
      total += g * price;
      known++;
    }
    if (known / req.length < 0.7) return null;
    const n = (!r.e && P.nfix && P.nfix[rid]) || r.n || 4;
    return { total, per: total / n, n, partial: known < req.length };
  };
  window.fmtCost = (c) => c ? `≈${Math.round(c.per / 10) * 10} ₽/порц.` : "";
})();
