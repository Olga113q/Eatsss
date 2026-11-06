// Недельный план: меню на N человек + корзина с ценами из магазинов (data/plan.js).
(() => {
  "use strict";

  const A = window.APP;
  const P = window.PLAN_DATA;
  const $ = (id) => document.getElementById(id);
  if (!A) return;
  if (!P) {
    $("btn-plan").addEventListener("click", () =>
      alert("Нет файла data/plan.js с ценами. Соберите его: python3 tools/build_prices.py"));
    return;
  }
  const { PRODUCTS, RECIPES, MEALS, esc, plural } = A;

  const STORES = P.stores;
  const OFFERS = new Map(); // id продукта → {u, o:[[store, name, price, amount, url, card]]}
  for (const [name, x] of Object.entries(P.offers)) {
    const p = A.BY_NAME.get(name);
    if (p) OFFERS.set(p.id, x);
  }
  const QTY = P.qty.map((row) => new Map(row));
  const MEAL_NAMES = { breakfast: "Завтрак", lunch: "Обед", dinner: "Ужин" };
  const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

  const settings = Object.assign(
    { people: 2, days: 7, meals: ["dinner"], budget: 5000, store: "best", usePantry: true, maxTime: "", diet: "" },
    A.store.get("plan-settings", {}),
  );
  let plan = A.store.get("plan", null); // {slots:[{day, meal, rid}], settings}

  // ---------- цены и корзина ----------
  // реальные цены выбранного магазина; если их нет — примерная цена (store = "approx")
  const offersFor = (pid) => {
    const x = OFFERS.get(pid);
    if (!x) return [];
    const real = x.o.filter((o) => o[0] !== "approx" && (settings.store === "best" || o[0] === settings.store));
    return real.length ? real : x.o.filter((o) => o[0] === "approx");
  };

  // как купить need единиц продукта дешевле всего: одним видом упаковки
  function buy(pid, need) {
    let best = null;
    for (const o of offersFor(pid)) {
      const packs = Math.max(1, Math.ceil(need / o[3] - 0.08)); // 8% «недобора» допускаем, чтобы не брать лишнюю пачку
      const cost = packs * o[2];
      if (!best || cost < best.cost) best = { offer: o, packs, cost };
    }
    return best;
  }

  const inPantry = (pid) => settings.usePantry && A.have.has(pid);

  function basketOf(slots) {
    const need = new Map();
    const unpriced = new Set();
    for (const s of slots) {
      const r = RECIPES[s.rid];
      const k = settings.people / (r.n || 4);
      for (const pid of r.req) {
        if (A.IGNORE.has(pid)) continue;
        const q = QTY[s.rid].get(pid);
        if (q === undefined) continue;
        need.set(pid, (need.get(pid) || 0) + q * k);
      }
      for (const a of s.add || []) {
        for (const [pid, g] of ADDON.get(a) || []) need.set(pid, (need.get(pid) || 0) + g * settings.people);
      }
    }
    const lines = [];
    let total = 0;
    for (const [pid, q] of need) {
      if (inPantry(pid)) { lines.push({ pid, need: q, pantry: true }); continue; }
      const b = buy(pid, q);
      if (!b) { unpriced.add(pid); lines.push({ pid, need: q, nop: true }); continue; }
      total += b.cost;
      lines.push({ pid, need: q, ...b });
    }
    return { lines, total, unpriced };
  }

  // ---------- состав ужина: белок + гарнир ----------
  const pidOf = (n) => (A.BY_NAME.get(n) || {}).id;
  const ids = (names) => new Set(names.map(pidOf).filter((x) => x !== undefined));
  const PROT = ids(["Курица", "Говядина", "Свинина", "Фарш", "Индейка", "Баранина", "Утка", "Кролик", "Белая рыба",
    "Лосось / семга", "Креветки", "Кальмары", "Мидии / морепродукты", "Куриная печень", "Говяжья печень",
    "Куриные сердечки", "Колбаса", "Сосиски", "Бекон", "Ветчина", "Тунец (консервы)", "Соленая / копченая рыба",
    "Крабовые палочки", "Тофу", "Сало", "Рыбные консервы"]);
  const LEGUMES = ids(["Фасоль", "Нут", "Чечевица", "Горох"]);
  const SIDE_DRY = ids(["Рис", "Гречка", "Макароны", "Лапша", "Булгур / кускус", "Перловка", "Пшено", "Киноа"]);
  const SIDE_BULK = ids(["Картофель", "Батат", "Капуста", "Кабачки / цукини", "Баклажаны", "Цветная капуста", "Брокколи",
    "Тыква", "Стручковая фасоль", "Зеленый горошек", "Морковь", "Болгарский перец", "Помидоры", "Свекла",
    "Пекинская капуста", "Шампиньоны", "Грибы", "Кукуруза", "Квашеная капуста", "Брюссельская капуста"]);
  const DOUGH = ids(["Мука пшеничная", "Слоеное тесто", "Тесто (готовое)", "Лаваш / тортильи", "Хлеб"]);
  const EGGS = pidOf("Яйца");
  const CURED = ids(["Бекон", "Колбаса", "Ветчина", "Сало", "Сосиски"]); // сытные — достаточно меньшего веса

  // есть ли в блюде «мясная» часть и гарнир (по граммам на одну порцию)
  const compCache = new Map();
  function composition(rid) {
    if (compCache.has(rid)) return compCache.get(rid);
    const r = RECIPES[rid];
    const per = 1 / (r.n || 4);
    let prot = 0, dry = 0, bulk = 0, dough = 0, eggs = 0, leg = 0;
    // тесто — гарнир только в пиццах, пирогах, пельменях и т. п.
    const doughIsSide = r.course === "Паста и пицца" ||
      r.tags.some((t) => /Пирог|Пицц|Хачапури|Чебурек|Пельмен|Вареник|Манты|Хинкали|Кесадиль|Буррито|Шаурм|Лазань/.test(t)) ||
      /пирог|пицц|хачапури|чебурек|пельмен|вареник|манты|хинкали|кесадиль|буррито|шаурм|лазань|киш\b|галет/.test(r.lc);
    for (const [pid, q] of QTY[rid]) {
      const g = q * per;
      if (PROT.has(pid)) prot += CURED.has(pid) ? g * 3 : g;
      else if (LEGUMES.has(pid)) leg += g;
      else if (SIDE_DRY.has(pid)) dry += g;
      else if (SIDE_BULK.has(pid)) bulk += g;
      else if (DOUGH.has(pid)) dough += doughIsSide ? g : 0; // хлеб/мука в котлетах — не гарнир
      else if (pid === EGGS) eggs += g;
    }
    const c = {
      protein: prot >= 40 || eggs >= 1.5 || leg >= 60,
      side: dry * 3 + bulk + dough * 2 + leg * 3 >= 100,
    };
    compCache.set(rid, c);
    return c;
  }

  // что докупить к блюду: [название, [[продукт, г или шт на человека]…]]
  const SIDES = [
    ["Макароны отварные", [["Макароны", 80], ["Сливочное масло", 10]]],
    ["Гречка отварная", [["Гречка", 70], ["Сливочное масло", 10]]],
    ["Рис отварной", [["Рис", 70], ["Сливочное масло", 5]]],
    ["Картофельное пюре", [["Картофель", 250], ["Молоко", 50], ["Сливочное масло", 15]]],
    ["Салат из огурцов и помидоров", [["Огурцы", 100], ["Помидоры", 100], ["Растительное масло", 10]]],
  ];
  const PROTEINS = [
    ["Сосиски", [["Сосиски", 120]]],
    ["Куриное филе на сковороде", [["Курица", 150], ["Растительное масло", 10]]],
    ["Котлеты из фарша", [["Фарш", 130], ["Лук репчатый", 20], ["Яйца", 0.2]]],
  ];
  const VEG_PROTEINS = [["Яичница", [["Яйца", 2], ["Сливочное масло", 5]]]];
  const ADDON = new Map([...SIDES, ...PROTEINS, ...VEG_PROTEINS].map(([n, items]) =>
    [n, items.map(([p, g]) => [pidOf(p), g]).filter(([p]) => p !== undefined)]));

  // какие добавки подходят к блюду на этом приёме пищи
  function addonOptions(rid, meal) {
    if (meal === "breakfast") return [[]];
    const r = RECIPES[rid];
    if (r.course === "Супы" || r.course === "Салаты") return [[]];
    const c = composition(rid);
    if (c.protein && c.side) return [[]];
    if (c.protein) return SIDES.map(([n]) => [n]);
    if (c.side) {
      if (settings.diet === "Постн" || settings.diet === "Вегетарианск") {
        return settings.diet === "Постн" ? [[]] : VEG_PROTEINS.map(([n]) => [n]);
      }
      return PROTEINS.map(([n]) => [n]);
    }
    return [[]];
  }

  // ---------- выбор рецептов ----------
  const DIETS = { "": null, "Постн": "Постн", "Вегетарианск": "Вегетарианск", "Низкокалорийн": "Низкокалорийн" };

  const MAIN_COURSES = new Set(["Основные блюда", "Паста и пицца", "Ризотто"]);
  const isMeal = (meal, r) => {
    // обед и ужин — полноценное блюдо: основное, паста, ризотто; суп — на обед; салат — только сытный (с мясом/рыбой)
    if (meal === "breakfast") return true;
    if (MAIN_COURSES.has(r.course)) return true;
    if (meal === "lunch" && r.course === "Супы") return true;
    return r.course === "Салаты" && !!proteinOf(r);
  };

  function candidates(meal) {
    const f = MEALS[meal];
    const maxT = +settings.maxTime || Infinity;
    const diet = DIETS[settings.diet];
    return RECIPES.filter((r) => {
      if (r.minor || !f(r) || !isMeal(meal, r)) return false;
      if (meal !== "breakfast" && r.k && r.k < 200) return false; // слишком лёгкое для обеда/ужина
      if (meal !== "breakfast" && r.course !== "Супы") {
        const c = composition(r.id);
        if (!c.protein && !c.side) return false; // ни мяса, ни гарнира (жульен, лёгкие закуски) — не ужин
      }
      if (maxT !== Infinity && (!r.m || r.m > maxT)) return false;
      if (diet && !r.tags.some((t) => t.startsWith(diet))) return false;
      const req = r.req.filter((p) => !A.IGNORE.has(p));
      if (req.length < 3) return false;
      const q = QTY[r.id];
      const known = req.filter((p) => q.has(p) && (inPantry(p) || offersFor(p).length)).length;
      return known / req.length >= 0.85; // почти всё посчитано — цене можно верить
    });
  }

  // главный «белок» рецепта — чтобы не было курицы семь дней подряд
  const PROTEIN = /^(Курица|Говядина|Свинина|Фарш|Индейка|Баранина|Утка|Белая рыба|Лосось \/ семга|Креветки|Куриная печень|Колбаса|Сосиски|Бекон|Ветчина)$/;
  const proteinOf = (r) => r.req.map((p) => PRODUCTS[p].name).find((n) => PROTEIN.test(n)) || "";
  const groupOf = (r) => r.tags.find((t) => !/кухня|Пошаговые|еда$|меню$|Горячие закуски/.test(t)) || r.course;

  function pick(slots, idx, meal, cands, opts = {}) {
    const chosen = slots.filter((s, i) => i !== idx && s.rid !== undefined);
    const used = new Set(chosen.map((s) => s.rid));
    const base = basketOf(chosen).total;
    const proteins = new Map();
    const groups = new Map();
    for (const s of chosen) {
      const r = RECIPES[s.rid];
      proteins.set(proteinOf(r), (proteins.get(proteinOf(r)) || 0) + 1);
      groups.set(groupOf(r), (groups.get(groupOf(r)) || 0) + 1);
    }
    // ориентир — бюджет на порцию: не тратить больше, но и не кормить «пустым» ради экономии
    const target = settings.budget > 0 ? settings.budget / Math.max(1, slots.length * settings.people) : 150;
    let best = null;
    // для скорости — случайная выборка из подходящих
    const pool = cands.length > 400 ? cands.filter(() => Math.random() < 400 / cands.length) : cands;
    const addUsed = new Map();
    for (const s2 of chosen) for (const a of s2.add || []) addUsed.set(a, (addUsed.get(a) || 0) + 1);
    for (const r of pool) {
      if (used.has(r.id) || r.id === opts.exclude) continue;
      // к блюду подбираем добавку (гарнир или белок), которая выгоднее всего с учётом уже купленного
      let bestAdd = null;
      for (const add of addonOptions(r.id, meal)) {
        const m = basketOf(chosen.concat([{ rid: r.id, add }])).total - base;
        const repeat = add.reduce((n, a) => n + (addUsed.get(a) || 0), 0);
        const sc = m / settings.people + (opts.cheapest ? 0 : repeat * 25 + Math.random() * 15);
        if (!bestAdd || sc < bestAdd.sc) bestAdd = { add, m, sc };
      }
      const marginal = bestAdd.m;
      const perServing = marginal / settings.people;
      let score = perServing;
      if (!opts.cheapest) {
        score = Math.max(0, perServing - target) * 3 + Math.max(0, target * 0.6 - perServing) + target * 0.1;
        const pr = proteinOf(r);
        if (pr && (proteins.get(pr) || 0) >= 2) score += 200;
        if ((groups.get(groupOf(r)) || 0) >= 1) score += 60;
        score *= 0.8 + Math.random() * 0.5; // немного случайности, чтобы меню было разным
      }
      if (!best || score < best.score) best = { rid: r.id, add: bestAdd.add, score };
    }
    return best ? { rid: best.rid, add: best.add } : undefined;
  }

  function makePlan() {
    const slots = [];
    for (let d = 0; d < settings.days; d++) for (const m of settings.meals) slots.push({ day: d, meal: m });
    const candByMeal = Object.fromEntries(settings.meals.map((m) => [m, candidates(m)]));
    for (let i = 0; i < slots.length; i++) Object.assign(slots[i], pick(slots, i, slots[i].meal, candByMeal[slots[i].meal]) || {});
    // не влезли в бюджет — заменяем самые дорогие блюда на самые дешёвые варианты
    for (let iter = 0; iter < slots.length * 2 && basketOf(slots).total > settings.budget; iter++) {
      let worst = -1, worstSave = 0;
      const total = basketOf(slots).total;
      slots.forEach((s, i) => {
        const save = total - basketOf(slots.filter((_, j) => j !== i)).total;
        if (save > worstSave) { worstSave = save; worst = i; }
      });
      if (worst < 0) break;
      const old = { rid: slots[worst].rid, add: slots[worst].add };
      const p = pick(slots, worst, slots[worst].meal, candByMeal[slots[worst].meal], { cheapest: true, exclude: old.rid });
      if (p) Object.assign(slots[worst], p);
      if (!p || basketOf(slots).total >= total) { Object.assign(slots[worst], old); break; }
    }
    plan = { slots: slots.filter((s) => s.rid !== undefined) };
    A.store.set("plan", plan);
  }

  // ---------- отображение ----------
  const fmtQty = (q, u) => {
    if (u === "pcs") return `${Math.ceil(q)} шт`;
    if (q >= 1000) return `${(q / 1000).toFixed(q >= 10000 ? 0 : 1).replace(".", ",")} кг`;
    return `${Math.max(5, Math.round(q / 10) * 10)} г`;
  };
  const rub = (x) => `${Math.round(x).toLocaleString("ru-RU")} ₽`;

  const dlg = document.createElement("dialog");
  dlg.id = "planner";
  dlg.innerHTML = `<div class="modal-inner"><button class="close" id="plan-close" aria-label="Закрыть">✕</button><div id="plan-body"></div></div>`;
  document.body.appendChild(dlg);
  $("plan-close").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });

  function form() {
    const real = Object.entries(STORES).filter(([id]) => id !== "approx");
    const storeOpts = [["best", "Где дешевле"]].concat(real.map(([id, s]) => [id, s.name]));
    const sdates = real.map(([, s]) => s).map((s) => `${s.name}: ${s.address || "—"}, цены от ${s.date}`).join("<br>") +
      "<br>≈ — примерная цена: продукта нет в собранных ценах магазинов, взята ориентировочная цена по СПб.";
    return `
      <h2>📅 План на неделю</h2>
      <div class="plan-form">
        <label>Человек <input type="number" id="pl-people" min="1" max="12" value="${settings.people}"></label>
        <label>Дней <input type="number" id="pl-days" min="1" max="7" value="${settings.days}"></label>
        <label>Бюджет, ₽ <input type="number" id="pl-budget" min="0" step="100" value="${settings.budget}"></label>
        <label>Магазин <select id="pl-store">${storeOpts.map(([v, n]) => `<option value="${v}" ${settings.store === v ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label>
        <label>Время <select id="pl-time">
          ${[["", "любое"], ["30", "до 30 мин"], ["60", "до 1 часа"], ["90", "до 1,5 часа"]].map(([v, n]) => `<option value="${v}" ${settings.maxTime === v ? "selected" : ""}>${n}</option>`).join("")}
        </select></label>
        <label>Питание <select id="pl-diet">
          ${[["", "обычное"], ["Постн", "постное"], ["Вегетарианск", "вегетарианское"], ["Низкокалорийн", "низкокалорийное"]].map(([v, n]) => `<option value="${v}" ${settings.diet === v ? "selected" : ""}>${n}</option>`).join("")}
        </select></label>
        <div class="plan-meals">
          ${Object.entries(MEAL_NAMES).map(([m, n]) => `<label><input type="checkbox" class="pl-meal" value="${m}" ${settings.meals.includes(m) ? "checked" : ""}> ${n}</label>`).join("")}
          <label title="Продукты, отмеченные «есть дома», не покупать"><input type="checkbox" id="pl-pantry" ${settings.usePantry ? "checked" : ""}> учесть то, что есть дома</label>
        </div>
        <button id="pl-make" class="primary">Составить меню</button>
      </div>
      <p class="muted">${sdates}</p>`;
  }

  function render() {
    let html = form();
    if (plan && plan.slots.length) {
      const b = basketOf(plan.slots);
      const per = b.total / Math.max(1, plan.slots.length * settings.people);
      const over = b.total > settings.budget;
      const approx = b.lines.filter((l) => l.offer && l.offer[0] === "approx").reduce((n, l) => n + l.cost, 0);
      html += `<div class="plan-total ${over ? "over" : ""}">
        Итого корзина: <b>${rub(b.total)}</b> из ${rub(settings.budget)}
        · ~${rub(per)} на порцию
        ${approx ? `<br><span class="muted">из них ≈${rub(approx)} — по примерным ценам (этих продуктов нет в собранных ценах магазинов)</span>` : ""}
        ${over ? "<br>Не влезает в бюджет даже с самыми дешёвыми блюдами — уменьшите число дней/приёмов пищи или увеличьте бюджет." : ""}
        ${b.unpriced.size ? `<br><span class="muted">Без цены (не посчитано): ${[...b.unpriced].map((p) => esc(PRODUCTS[p].name)).join(", ")}</span>` : ""}
      </div>`;
      html += `<h3>Меню</h3><table class="plan-menu">`;
      plan.slots.forEach((s, i) => {
        const r = RECIPES[s.rid];
        const without = basketOf(plan.slots.filter((_, j) => j !== i)).total;
        html += `<tr>
          <td class="muted">${DAY_NAMES[s.day % 7]}${settings.meals.length > 1 ? " · " + MEAL_NAMES[s.meal] : ""}</td>
          <td><a href="#" data-open="${r.id}">${esc(r.t)}</a> <span class="muted">${esc(r.tm || "")}</span>
            ${(s.add || []).length ? `<br><span class="addon">+ ${esc(s.add.join(", "))}</span>
              <button class="link small" data-addon="${i}">другое</button>` : ""}</td>
          <td class="num">+${rub(b.total - without)}</td>
          <td><button class="link small" data-reroll="${i}">заменить</button></td>
        </tr>`;
      });
      html += `</table>`;
      html += shoppingList(b);
      html += `<div class="modal-actions">
        <button id="pl-again">🔄 Другое меню</button>
        <button id="pl-toshop">🛒 Добавить в список покупок</button>
      </div>`;
    } else if (plan) {
      html += `<p class="hint">Не нашлось подходящих рецептов с ценами — попробуйте другие настройки.</p>`;
    }
    $("plan-body").innerHTML = html;
  }

  function shoppingList(b) {
    const buyLines = b.lines.filter((l) => l.offer).sort((a, c) => c.cost - a.cost);
    const byStore = {};
    for (const l of buyLines) byStore[l.offer[0]] = (byStore[l.offer[0]] || 0) + l.cost;
    if (byStore.approx) { byStore["≈ примерно"] = byStore.approx; delete byStore.approx; }
    const unit = (pid) => (OFFERS.get(pid) || {}).u || "g";
    let html = `<h3>Корзина</h3>`;
    if (Object.keys(byStore).length > 1) {
      html += `<p class="muted">${Object.entries(byStore).map(([s, c]) => `${esc(STORES[s] ? STORES[s].name : s)}: ${rub(c)}`).join(" · ")}</p>`;
    }
    html += `<table class="plan-cart">` + buyLines.map((l) => `<tr>
        <td><b>${esc(PRODUCTS[l.pid].name)}</b><br><span class="muted">нужно ~${fmtQty(l.need, unit(l.pid))}</span></td>
        ${l.offer[0] === "approx"
          ? `<td><span class="approx">≈ примерная цена</span><br><span class="muted">упаковка ~${fmtQty(l.offer[3], unit(l.pid))}, в собранных ценах магазинов нет</span></td>
             <td class="num">${l.packs} × ≈${rub(l.offer[2])}</td>
             <td class="num"><b>≈${rub(l.cost)}</b></td>`
          : `<td>${l.offer[4] ? `<a href="${esc(l.offer[4])}" target="_blank" rel="noopener">${esc(l.offer[1])}</a>` : esc(l.offer[1])}
          <br><span class="muted">${esc(STORES[l.offer[0]].name)}${l.offer[5] ? " · по карте" : ""}</span></td>
        <td class="num">${l.packs} × ${rub(l.offer[2])}</td>
        <td class="num"><b>${rub(l.cost)}</b></td>`}
      </tr>`).join("") + `</table>`;
    const pantry = b.lines.filter((l) => l.pantry);
    if (pantry.length) html += `<p class="muted">Есть дома (не покупаем): ${pantry.map((l) => `${esc(PRODUCTS[l.pid].name)} ~${fmtQty(l.need, unit(l.pid))}`).join(", ")}</p>`;
    return html;
  }

  function readForm() {
    settings.people = Math.max(1, Math.min(12, +$("pl-people").value || 2));
    settings.days = Math.max(1, Math.min(7, +$("pl-days").value || 7));
    settings.budget = Math.max(0, +$("pl-budget").value || 0);
    settings.store = $("pl-store").value;
    settings.maxTime = $("pl-time").value;
    settings.diet = $("pl-diet").value;
    settings.usePantry = $("pl-pantry").checked;
    const meals = [...document.querySelectorAll(".pl-meal:checked")].map((x) => x.value);
    settings.meals = meals.length ? meals : ["dinner"];
    A.store.set("plan-settings", settings);
  }

  $("plan-body").addEventListener("click", (e) => {
    if (e.target.id === "pl-make" || e.target.id === "pl-again") {
      if (e.target.id === "pl-make") readForm();
      e.target.textContent = "Считаю…";
      setTimeout(() => { makePlan(); render(); }, 20);
      return;
    }
    const rr = e.target.closest("[data-reroll]");
    if (rr) {
      const i = +rr.dataset.reroll;
      const s = plan.slots[i];
      const p = pick(plan.slots, i, s.meal, candidates(s.meal), { exclude: s.rid });
      if (p) { Object.assign(s, p); A.store.set("plan", plan); render(); }
      return;
    }
    const ad = e.target.closest("[data-addon]");
    if (ad) {   // следующий вариант гарнира/белка для этого блюда
      const s = plan.slots[+ad.dataset.addon];
      const opts = addonOptions(s.rid, s.meal);
      const k = opts.findIndex((o) => o.join() === (s.add || []).join());
      s.add = opts[(k + 1) % opts.length];
      A.store.set("plan", plan);
      render();
      return;
    }
    const op = e.target.closest("[data-open]");
    if (op) { e.preventDefault(); A.openRecipe(+op.dataset.open); return; }
    if (e.target.id === "pl-toshop") {
      const b = basketOf(plan.slots);
      const unit = (pid) => (OFFERS.get(pid) || {}).u || "g";
      A.addToShop(b.lines.filter((l) => l.offer).map((l) => ({
        name: l.offer[0] === "approx" ? `${PRODUCTS[l.pid].name} ~${fmtQty(l.need, unit(l.pid))}` : `${PRODUCTS[l.pid].name}: ${l.offer[1]} × ${l.packs}`,
        product: PRODUCTS[l.pid].name,
        from: `план, ~${fmtQty(l.need, unit(l.pid))}, ${l.offer[0] === "approx" ? "цена примерная" : STORES[l.offer[0]].name}`,
      })));
      e.target.textContent = "✓ Добавлено";
      e.target.disabled = true;
    }
  });

  $("btn-plan").addEventListener("click", () => { render(); dlg.showModal(); });
})();
