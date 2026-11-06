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
  const offersFor = (pid) => {
    const x = OFFERS.get(pid);
    if (!x) return [];
    return settings.store === "best" ? x.o : x.o.filter((o) => o[0] === settings.store);
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
    for (const r of pool) {
      if (used.has(r.id) || r.id === opts.exclude) continue;
      const trial = chosen.concat([{ rid: r.id }]);
      const marginal = basketOf(trial).total - base;
      const perServing = marginal / settings.people;
      let score = perServing;
      if (!opts.cheapest) {
        score = Math.max(0, perServing - target) * 3 + Math.max(0, target * 0.6 - perServing) + target * 0.1;
        const pr = proteinOf(r);
        if (pr && (proteins.get(pr) || 0) >= 2) score += 200;
        if ((groups.get(groupOf(r)) || 0) >= 1) score += 60;
        score *= 0.8 + Math.random() * 0.5; // немного случайности, чтобы меню было разным
      }
      if (!best || score < best.score) best = { rid: r.id, score };
    }
    return best ? best.rid : undefined;
  }

  function makePlan() {
    const slots = [];
    for (let d = 0; d < settings.days; d++) for (const m of settings.meals) slots.push({ day: d, meal: m });
    const candByMeal = Object.fromEntries(settings.meals.map((m) => [m, candidates(m)]));
    for (let i = 0; i < slots.length; i++) slots[i].rid = pick(slots, i, slots[i].meal, candByMeal[slots[i].meal]);
    // не влезли в бюджет — заменяем самые дорогие блюда на самые дешёвые варианты
    for (let iter = 0; iter < slots.length * 2 && basketOf(slots).total > settings.budget; iter++) {
      let worst = -1, worstSave = 0;
      const total = basketOf(slots).total;
      slots.forEach((s, i) => {
        const save = total - basketOf(slots.filter((_, j) => j !== i)).total;
        if (save > worstSave) { worstSave = save; worst = i; }
      });
      if (worst < 0) break;
      const old = slots[worst].rid;
      slots[worst].rid = pick(slots, worst, slots[worst].meal, candByMeal[slots[worst].meal], { cheapest: true, exclude: old });
      if (basketOf(slots).total >= total) { slots[worst].rid = old; break; }
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
    const storeOpts = [["best", "Где дешевле"]].concat(Object.entries(STORES).map(([id, s]) => [id, s.name]));
    const sdates = Object.values(STORES).map((s) => `${s.name}: ${s.address || "—"}, цены от ${s.date}`).join("<br>");
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
      html += `<div class="plan-total ${over ? "over" : ""}">
        Итого корзина: <b>${rub(b.total)}</b> из ${rub(settings.budget)}
        · ~${rub(per)} на порцию
        ${over ? "<br>Не влезает в бюджет даже с самыми дешёвыми блюдами — уменьшите число дней/приёмов пищи или увеличьте бюджет." : ""}
        ${b.unpriced.size ? `<br><span class="muted">Без цены (не посчитано): ${[...b.unpriced].map((p) => esc(PRODUCTS[p].name)).join(", ")}</span>` : ""}
      </div>`;
      html += `<h3>Меню</h3><table class="plan-menu">`;
      plan.slots.forEach((s, i) => {
        const r = RECIPES[s.rid];
        const without = basketOf(plan.slots.filter((_, j) => j !== i)).total;
        html += `<tr>
          <td class="muted">${DAY_NAMES[s.day % 7]}${settings.meals.length > 1 ? " · " + MEAL_NAMES[s.meal] : ""}</td>
          <td><a href="#" data-open="${r.id}">${esc(r.t)}</a> <span class="muted">${esc(r.tm || "")}</span></td>
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
    const unit = (pid) => (OFFERS.get(pid) || {}).u || "g";
    let html = `<h3>Корзина</h3>`;
    if (Object.keys(byStore).length > 1) {
      html += `<p class="muted">${Object.entries(byStore).map(([s, c]) => `${esc(STORES[s].name)}: ${rub(c)}`).join(" · ")}</p>`;
    }
    html += `<table class="plan-cart">` + buyLines.map((l) => `<tr>
        <td><b>${esc(PRODUCTS[l.pid].name)}</b><br><span class="muted">нужно ~${fmtQty(l.need, unit(l.pid))}</span></td>
        <td>${l.offer[4] ? `<a href="${esc(l.offer[4])}" target="_blank" rel="noopener">${esc(l.offer[1])}</a>` : esc(l.offer[1])}
          <br><span class="muted">${esc(STORES[l.offer[0]].name)}${l.offer[5] ? " · по карте" : ""}</span></td>
        <td class="num">${l.packs} × ${rub(l.offer[2])}</td>
        <td class="num"><b>${rub(l.cost)}</b></td>
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
      const rid = pick(plan.slots, i, s.meal, candidates(s.meal), { exclude: s.rid });
      if (rid !== undefined) { s.rid = rid; A.store.set("plan", plan); render(); }
      return;
    }
    const op = e.target.closest("[data-open]");
    if (op) { e.preventDefault(); A.openRecipe(+op.dataset.open); return; }
    if (e.target.id === "pl-toshop") {
      const b = basketOf(plan.slots);
      const unit = (pid) => (OFFERS.get(pid) || {}).u || "g";
      A.addToShop(b.lines.filter((l) => l.offer).map((l) => ({
        name: `${PRODUCTS[l.pid].name}: ${l.offer[1]} × ${l.packs}`,
        product: PRODUCTS[l.pid].name,
        from: `план, ~${fmtQty(l.need, unit(l.pid))}, ${STORES[l.offer[0]].name}`,
      })));
      e.target.textContent = "✓ Добавлено";
      e.target.disabled = true;
    }
  });

  $("btn-plan").addEventListener("click", () => { render(); dlg.showModal(); });
})();
