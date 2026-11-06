// «Мне не подходит» и цена блюда. Подключается после data/recipes.js, recipe-edits.js и data/plan.js.
//
// Предпочтения (переключатели на странице «Мои рецепты», localStorage wtc:prefs) помечают рецепт r.d = причина —
// такой рецепт не предлагается ни в подборе, ни в плане. wtc:allow — рецепты, которые пользователь вернул вручную.
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

  // ---------- предпочтения ----------
  const RULES = [
    ["fish", "Без рыбы", "рыба"],
    ["pepper", "Без блюд, где основа — жареный/тушёный болгарский перец", "много перца"],
    ["onion", "Без блюд, где основа — жареный/варёный лук", "много лука"],
    ["tofu", "Без тофу", "тофу"],
    ["nomeat", "Основные блюда и супы — только с мясом", "нет мяса"],
  ];
  const DEFAULTS = { fish: true, pepper: true, onion: true, tofu: true, nomeat: true };
  const prefs = Object.assign({}, DEFAULTS, get("prefs", {}));
  const allow = new Set(get("allow", []));

  const SEAFOOD = new Set(["Креветки", "Кальмары", "Мидии / морепродукты", "Крабовые палочки"]); // это не «рыба»
  const FISH = new Set(names.map((n, i) => (cats[i] === "Рыба и морепродукты" && !SEAFOOD.has(n) ? i : -1)).filter((i) => i >= 0));
  const MEAT = new Set(cats.map((c, i) => (c === "Мясо и птица" ? i : -1)).filter((i) => i >= 0));
  const PEP = pid("Болгарский перец"), ONION = pid("Лук репчатый"), TOFU = pid("Тофу");
  const MAINC = new Set(["Основные блюда", "Паста и пицца", "Ризотто", "Супы"]);

  function reasonOf(rid) {
    const r = D.recipes[rid];
    const course = r.c[0] || "";
    const req = new Set(r.i.filter((i) => !i[3]).map((i) => i[0]));
    const q = new Map(P ? P.qty[rid] : []);
    let total = 0;
    for (const v of q.values()) total += v;
    total = total || 1;
    const t = r.t.toLowerCase().replace(/\s+/g, " ");
    const out = [];
    if (prefs.fish && [...req].some((p) => FISH.has(p))) out.push("fish");
    // перец/лук — основа приготовленного блюда: в названии или ≥15–20% веса продуктов (в салатах — свежие, не трогаем)
    if (prefs.pepper && course !== "Салаты" && req.has(PEP) &&
        ((/перц|перец/.test(t) && !/черн\w* перц|перцем черн|перец черн/.test(t)) || (q.get(PEP) || 0) / total >= 0.15)) out.push("pepper");
    if (prefs.onion && course !== "Салаты" && req.has(ONION) &&
        (/(?<![а-яё])лук(?!-порей)|луков/.test(t) || (q.get(ONION) || 0) / total >= 0.2)) out.push("onion");
    if (prefs.tofu && req.has(TOFU)) out.push("tofu");
    if (prefs.nomeat && MAINC.has(course) && ![...req].some((p) => MEAT.has(p))) out.push("nomeat");
    return out;
  }

  const LABEL = Object.fromEntries(RULES.map(([id, , short]) => [id, short]));
  D.recipes.forEach((r, rid) => {
    if (allow.has(key(r))) return;
    const why = reasonOf(rid);
    if (why.length) r.d = why.map((w) => LABEL[w]).join(", ");
  });

  window.RECIPE_PREFS = {
    RULES, prefs: () => Object.assign({}, prefs),
    setPref(id, on) { const p = Object.assign({}, DEFAULTS, get("prefs", {})); p[id] = on; set("prefs", p); },
    allow(k, on) { const a = new Set(get("allow", [])); if (on) a.add(k); else a.delete(k); set("allow", [...a]); },
    allowed: () => new Set(get("allow", [])),
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
