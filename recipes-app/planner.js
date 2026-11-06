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
    { people: 2, days: 7, meals: ["dinner"], budget: 5000, store: "best", usePantry: true, maxTime: "", diet: "", wholeChicken: false, fullRecipe: true },
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

  // Курица: можно купить тушку и разделать (≈22% филе, 32% ножки, 10% крылья, остальное — на бульон)
  // или брать части отдельно. Перебираем число тушек и берём самый дешёвый вариант.
  const CH = { whole: null, fillet: null, legs: null, wings: null };
  const YIELD = { fillet: 0.22, legs: 0.32, wings: 0.10 };
  function buyChicken(need) {
    if (CH.whole === null) {
      CH.whole = (A.BY_NAME.get("Курица") || {}).id; CH.fillet = (A.BY_NAME.get("Куриное филе") || {}).id;
      CH.legs = (A.BY_NAME.get("Куриные ножки") || {}).id; CH.wings = (A.BY_NAME.get("Куриные крылья") || {}).id;
    }
    const parts = ["fillet", "legs", "wings"];
    const q = { whole: 0, fillet: 0, legs: 0, wings: 0 };
    let any = false;
    for (const k of ["whole", ...parts]) {
      const pid = CH[k];
      if (pid === undefined || !need.has(pid) || inPantry(pid)) continue;
      q[k] = need.get(pid);
      any = true;
    }
    if (!any) return null;
    const carcass = offersFor(CH.whole).slice().sort((a, b) => a[2] / a[3] - b[2] / b[3])[0];
    let best = null;
    const nMin = carcass ? Math.ceil(q.whole / carcass[3] - 0.08) : 0;
    const nMax = carcass ? nMin + Math.ceil((q.fillet + q.legs + q.wings) / (carcass[3] * 0.2)) + 1 : 0;
    for (let n = nMin; n <= Math.min(nMax, nMin + 8); n++) {
      const rest = carcass ? Math.max(0, n * carcass[3] - q.whole) : 0; // то, что остаётся на разделку
      let cost = carcass ? n * carcass[2] : 0;
      const buys = [];
      let ok = true;
      for (const k of parts) {
        const lack = q[k] - rest * YIELD[k];
        if (lack <= 30) continue;
        if (settings.wholeChicken && carcass) { ok = false; break; } // только тушками — берём ещё одну
        const b = buy(CH[k], lack);
        if (!b) { ok = false; break; }
        cost += b.cost;
        buys.push({ pid: CH[k], need: q[k], fromCarcass: rest * YIELD[k], ...b });
      }
      if (!ok) continue;
      if (!best || cost < best.cost) best = { n, rest, cost, buys };
    }
    if (!best) return null; // нет цен — пусть обычная логика пометит «без цены»
    const lines = [];
    if (best.n > 0) {
      lines.push({
        pid: CH.whole, need: q.whole, offer: carcass, packs: best.n, cost: best.n * carcass[2],
        cut: parts.map((k) => ({ name: PRODUCTS[CH[k]].name, get: best.rest * YIELD[k], need: q[k] })),
      });
    }
    lines.push(...best.buys);
    return { lines, total: best.cost, pids: ["whole", ...parts].map((k) => CH[k]).filter((p) => p !== undefined && need.has(p) && !inPantry(p)) };
  }

  const inPantry = (pid) => settings.usePantry && A.have.has(pid);

  // на сколько порций готовим блюдо: «на ужин и обед» — вдвое больше людей (2 человека → 4 порции),
  // рецепт пересчитывается под это число; иначе — ровно по числу людей
  function servingsOf(rid) {
    return settings.fullRecipe ? settings.people * 2 : settings.people;
  }

  function basketOf(slots) {
    const need = new Map();
    const unpriced = new Set();
    for (const s of slots) {
      const r = RECIPES[s.rid];
      const serv = servingsOf(s.rid);
      const k = serv / (r.n || 4);
      for (const pid of r.req) {
        if (A.IGNORE.has(pid)) continue;
        const q = QTY[s.rid].get(pid);
        if (q === undefined) continue;
        need.set(pid, (need.get(pid) || 0) + q * k);
      }
      for (const a of s.add || []) {
        for (const [pid, g] of ADDON.get(a) || []) need.set(pid, (need.get(pid) || 0) + g * serv);
      }
    }
    const lines = [];
    let total = 0;
    const ch = buyChicken(need);
    if (ch) { lines.push(...ch.lines); total += ch.total; ch.pids.forEach((p) => need.delete(p)); }
    for (const [pid, q] of need) {
      if (inPantry(pid)) { lines.push({ pid, need: q, pantry: true }); continue; }
      const b = buy(pid, q);
      if (!b) { unpriced.add(pid); lines.push({ pid, need: q, nop: true }); continue; }
      total += b.cost;
      lines.push({ pid, need: q, ...b });
    }
    // «пропадёт»: оплаченная, но не использованная часть скоропортящихся продуктов
    let waste = 0;
    for (const l of lines) {
      if (!l.offer || l.offer[0] === "approx" || isDurable(l.pid)) continue;
      const lo = leftOf(l);
      waste += (lo.left / lo.bought) * l.cost;
    }
    return { lines, total, unpriced, waste };
  }

  // Сколько реально останется от купленного (одно правило для корзины, остатков и выбора блюд):
  // - мясо, птицу, рыбу готовят всей упаковкой: лишнее до 40% просто уходит в блюдо (500 г нужно, 700 куплено — готовим 700);
  // - тушку разделывают и готовят целиком (грудка отдельно, ножки/крылья/бёдра вместе, каркас на бульон) —
  //   ненужные рецептам части тоже не остаток, пока их не больше 40% тушки;
  // - прочее скоропортящееся: остаток меньше 25% упаковки не считаем (горсть зелени, ложка сметаны).
  // Крупы, специи, масло и др. (isDurable) остаются как есть — они хранятся.
  const MEATY = new Set(["Мясо и птица", "Рыба и морепродукты"]);
  function leftOf(l) {
    const bought = l.packs * l.offer[3];
    const raw = l.cut
      ? l.cut.reduce((n, c) => n + Math.max(0, c.get - c.need), 0)
      : Math.max(0, bought - l.need - (l.fromCarcass || 0));
    const share = raw / bought;
    let left = raw;
    if (l.cut || MEATY.has(PRODUCTS[l.pid].cat)) left = share <= 0.4 ? 0 : raw;
    else if (!isDurable(l.pid) && share < 0.25) left = 0;
    return { left, share, bought };
  }
  // то, что спокойно хранится (крупы, специи, масло, консервы…) — остатки не считаем потерей
  const DURABLE = new Set(["Специи", "Крупы, мука, макароны", "Масла", "Соусы и консервы", "Для выпечки и сладкое",
    "Напитки и алкоголь", "Сухофрукты и орехи", "Бобовые", "Базовое", "Другое"]);
  // овощи и продукты, которые спокойно лежат неделями
  const KEEPS = new Set(["Лук репчатый", "Чеснок", "Картофель", "Морковь", "Свекла", "Капуста", "Яйца", "Сливочное масло",
    "Твердый сыр", "Сыр твердый", "Пармезан", "Тыква", "Яблоки", "Лимон", "Имбирь"]);
  const isDurable = (pid) => DURABLE.has(PRODUCTS[pid].cat) || KEEPS.has(PRODUCTS[pid].name);

  // ---------- состав ужина: белок + гарнир ----------
  const pidOf = (n) => (A.BY_NAME.get(n) || {}).id;
  const ids = (names) => new Set(names.map(pidOf).filter((x) => x !== undefined));
  const PROT = ids(["Курица", "Куриное филе", "Куриные ножки", "Куриные крылья", "Говядина", "Свинина", "Фарш", "Индейка", "Баранина", "Утка", "Кролик", "Белая рыба",
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
      /пирог|пицц|хачапури|чебурек|пельмен|вареник|манты|хинкали|кесадиль|буррито|шаурм|лазань|киш(?![а-яё])|галет/.test(r.lc);
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
    ["Куриное филе на сковороде", [["Куриное филе", 150], ["Растительное масло", 10]]],
    ["Котлеты из фарша", [["Фарш", 130], ["Лук репчатый", 20], ["Яйца", 0.2]]],
  ];
  const VEG_PROTEINS = [["Яичница", [["Яйца", 2], ["Сливочное масло", 5]]]];
  const ADDON = new Map([...SIDES, ...PROTEINS, ...VEG_PROTEINS].map(([n, items]) =>
    [n, items.map(([p, g]) => [pidOf(p), g]).filter(([p]) => p !== undefined)]));

  // какие добавки подходят к блюду на этом приёме пищи
  function addonOptions(rid, meal) {
    if (meal === "breakfast") return [[]];
    const r = RECIPES[rid];
    if (r.course === "Супы") return [[]];
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
    return false; // салаты — не ужин
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
  const PROTEIN = /^(Курица|Куриное филе|Куриные ножки|Куриные крылья|Говядина|Свинина|Фарш|Индейка|Баранина|Утка|Белая рыба|Лосось \/ семга|Креветки|Куриная печень|Колбаса|Сосиски|Бекон|Ветчина)$/;
  const proteinOf = (r) => (r.req.map((p) => PRODUCTS[p].name).find((n) => PROTEIN.test(n)) || "").replace(/^Кур.*/, "Курица");
  const groupOf = (r) => r.tags.find((t) => !/кухня|Пошаговые|еда$|меню$|Горячие закуски/.test(t)) || r.course;
  // вид блюда по названию — чтобы не было двух пловов (или двух борщей, двух лазаний) за неделю
  const FAMILY = /плов|борщ|(?<![а-яё])щи(?![а-яё])|солянк|харчо|рассольник|окрошк|уха(?![а-яё])|котлет|тефтел|фрикадел|биточк|зраз|пельмен|вареник|манты|хинкали|голубц|лазан|паст[аы](?![а-яё])|спагетти|макарон|тальятелле|феттучин|пенне|фузилли|фарфалле|ригатони|лингвини|ризотто|пицц|пирог|киш(?![а-яё])|запеканк|омлет|фриттат|шакшук|гуляш|рагу|жаркое|азу(?![а-яё])|бефстроганов|отбивн|шницел|стейк|шашлык|чахохбили|карри|чили(?![а-яё])|бургер|шаурм|буррито|тако(?![а-яё])|кесадиль|хачапури|чебурек|блин|оладь|сырник|драник|фаршированн/;
  const familyCache = new Map();
  const familyOf = (r) => {
    if (!familyCache.has(r.id)) {
      const m = r.lc.match(FAMILY);
      familyCache.set(r.id, m ? m[0].replace(/[ыи]$/, "").replace(/^паст.*/, "паста").replace(/^(спагетт|макарон|тальятелле|феттучин|пенне|фузилл|фарфалле|ригатон|лингвин).*/, "паста") : "");
    }
    return familyCache.get(r.id);
  };

  const WASTE_W = 0.8; // насколько «дорого» выбрасывать продукты при выборе блюд
  function pick(slots, idx, meal, cands, opts = {}) {
    const chosen = slots.filter((s, i) => i !== idx && s.rid !== undefined);
    const used = new Set(chosen.map((s) => s.rid));
    const baseB = basketOf(chosen);
    const proteins = new Map();
    const groups = new Map();
    const families = new Set();
    for (const s of chosen) {
      const r = RECIPES[s.rid];
      proteins.set(proteinOf(r), (proteins.get(proteinOf(r)) || 0) + 1);
      groups.set(groupOf(r), (groups.get(groupOf(r)) || 0) + 1);
      if (familyOf(r)) families.add(familyOf(r));
    }
    // ориентир — бюджет на порцию: не тратить больше, но и не кормить «пустым» ради экономии
    // ориентир на порцию: бюджет делим на все порции недели (с целым рецептом — это ужин и обед на всех)
    const servPerSlot = settings.fullRecipe ? settings.people * 2 : settings.people;
    const target = settings.budget > 0 ? settings.budget / Math.max(1, slots.length * servPerSlot) : 150;
    let best = null;
    // для скорости — случайная выборка из подходящих
    let pool = cands.length > 400 ? cands.filter(() => Math.random() < 400 / cands.length) : cands;
    if (opts.include !== undefined && !pool.some((r) => r.id === opts.include)) pool = pool.concat([RECIPES[opts.include]]);
    // обязательно смотрим блюда, которые доедают уже купленное (ножки и крылья от тушки, полкочана капусты…)
    const leftPids = new Set();
    for (const l of baseB.lines) {
      if (!l.offer || l.offer[0] === "approx" || isDurable(l.pid)) continue;
      if (leftOf(l).left < 150) continue; // то, что доготовят вместе или мелочь, «доедать» не нужно
      if (l.cut) {
        for (const c of l.cut) if (c.get - c.need > 150) leftPids.add((A.BY_NAME.get(c.name) || {}).id);
      } else leftPids.add(l.pid);
    }
    if (leftPids.size) {
      const inPool = new Set(pool.map((r) => r.id));
      pool = pool.concat(cands.filter((r) => !inPool.has(r.id) && r.req.some((p) => leftPids.has(p))).slice(0, 300));
    }
    const addUsed = new Map();
    for (const s2 of chosen) for (const a of s2.add || []) addUsed.set(a, (addUsed.get(a) || 0) + 1);
    for (const r of pool) {
      if (used.has(r.id) || r.id === opts.exclude || (opts.skip && opts.skip.has(r.id))) continue;
      // к блюду подбираем добавку (гарнир или белок), которая выгоднее всего с учётом уже купленного
      const P_ = servingsOf(r.id);
      let bestAdd = null;
      for (const add of addonOptions(r.id, meal)) {
        const tb = basketOf(chosen.concat([{ rid: r.id, add }]));
        const cash = tb.total - baseB.total;              // сколько реально докупить
        const dWaste = tb.waste - baseB.waste;            // < 0, если блюдо доедает остатки
        const value = Math.max(cash - dWaste, cash);      // стоимость продуктов блюда вместе с доеденными остатками
        const spend = cash + dWaste * WASTE_W;            // деньги + то, что не пропадёт
        const repeat = add.reduce((n, a) => n + (addUsed.get(a) || 0), 0);
        let sc;
        if (opts.cheapest) sc = spend / P_;
        else {
          // «полноценность» — по стоимости всего блюда (с остатками), экономия — по реальным тратам;
          // повтор одной и той же добавки и вообще «блюдо + добавка» (готовить два блюда) — чуть хуже
          sc = Math.max(0, value / P_ - target) * 2 + Math.max(0, target * 0.7 - value / P_) * 1.5 + (spend / P_) * 0.3 +
            repeat * 60 + (add.length ? 20 : 0) + (opts.stable ? 0 : Math.random() * 15);
        }
        if (!bestAdd || sc < bestAdd.sc) bestAdd = { add, sc };
      }
      let score = bestAdd.sc;
      if (!opts.cheapest) {
        const pr = proteinOf(r);
        const usesLeft = r.req.some((p) => leftPids.has(p)); // доедает купленное — повтор курицы не страшен
        if (pr && !usesLeft && (proteins.get(pr) || 0) >= 2) score += 200;
        if ((groups.get(groupOf(r)) || 0) >= 1) score += 60;
        // второй плов/борщ за неделю — нежелательно, но можно (не понравится — «заменить»)
        if (familyOf(r) && families.has(familyOf(r))) score += 150;
        if (!opts.stable) score *= 0.8 + Math.random() * 0.5; // немного случайности, чтобы меню было разным
      }
      if (!best || score < best.score) best = { rid: r.id, add: bestAdd.add, score };
    }
    return best ? { rid: best.rid, add: best.add } : undefined;
  }

  // «Заменить» блюдо: если в корзине целая тушка, а заменяемое блюдо было на её часть (грудку, ножки, крылья
  // или курицу целиком), новое блюдо подбираем на ту же часть — иначе купленная курица останется лежать.
  function replaceCandidates(i) {
    const s = plan.slots[i];
    const all = candidates(s.meal);
    if (CH.whole === null) buyChicken(new Map()); // заполнить CH (id частей курицы)
    const b = basketOf(plan.slots);
    if (!b.lines.some((l) => l.cut)) return all; // тушку не покупаем — обычная замена
    const parts = ["whole", "fillet", "legs", "wings"].map((k) => CH[k]).filter((p) => p !== undefined);
    const used = RECIPES[s.rid].req.filter((p) => parts.includes(p));
    if (!used.length) return all;
    const same = all.filter((r) => used.every((p) => r.req.includes(p)));
    if (same.length) return same;
    const some = all.filter((r) => used.some((p) => r.req.includes(p)));
    return some.length ? some : all;
  }

  function makePlan() {
    const slots = [];
    for (let d = 0; d < settings.days; d++) for (const m of settings.meals) slots.push({ day: d, meal: m });
    const candByMeal = Object.fromEntries(settings.meals.map((m) => [m, candidates(m)]));
    // «курицу — целой тушкой»: сразу ставим два блюда из одной тушки — на филе и на ножки/крылья
    if (settings.wholeChicken && slots.length >= 2) {
      const fil = (A.BY_NAME.get("Куриное филе") || {}).id;
      const legsWings = [(A.BY_NAME.get("Куриные ножки") || {}).id, (A.BY_NAME.get("Куриные крылья") || {}).id];
      const fillets = candByMeal[slots[0].meal].filter((r) => r.req.includes(fil));
      const legs = candByMeal[slots[0].meal].filter((r) => r.req.some((p) => legsWings.includes(p)));
      const a = Math.floor(Math.random() * Math.ceil(slots.length / 2));
      const b = a + Math.max(2, Math.floor(slots.length / 2)) < slots.length ? a + Math.max(2, Math.floor(slots.length / 2)) : slots.length - 1;
      if (fillets.length && legs.length && a !== b) {
        Object.assign(slots[a], pick(slots, a, slots[a].meal, fillets) || {});
        Object.assign(slots[b], pick(slots, b, slots[b].meal, legs) || {});
        slots[a].fixed = slots[b].fixed = true;
      }
    }
    for (let i = 0; i < slots.length; i++) {
      if (!slots[i].fixed) Object.assign(slots[i], pick(slots, i, slots[i].meal, candByMeal[slots[i].meal]) || {});
    }
    // второй и третий проход: переподбираем каждое блюдо при уже известных остальных —
    // так подтягиваются блюда на остатки (вторая половина тушки, капуста, сметана…)
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < slots.length; i++) {
        if (slots[i].fixed) continue;
        const p = pick(slots, i, slots[i].meal, candByMeal[slots[i].meal], { include: slots[i].rid, stable: true });
        if (p) Object.assign(slots[i], p);
      }
    }
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
    const sdates = real.map(([, s]) => s).map((s) => `${s.name}: цены от ${s.date}`).join("<br>") +
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
          <label title="Каждое блюдо готовится на ужин и обед на следующий день: порций вдвое больше, чем людей (2 человека → 4 порции). Рецепт пересчитывается под это число"><input type="checkbox" id="pl-full" ${settings.fullRecipe ? "checked" : ""}> готовить с запасом на обед (порций = 2 × людей)</label>
          <label title="Курицу покупать только целыми тушками и разделывать: филе, ножки и крылья пойдут в разные блюда, каркас — на бульон"><input type="checkbox" id="pl-whole" ${settings.wholeChicken ? "checked" : ""}> курицу — целой тушкой и разделывать</label>
        </div>
        <button id="pl-make" class="primary">Составить меню</button>
      </div>
      <p class="muted">${sdates}</p>`;
  }

  function render() {
    let html = form();
    if (plan && plan.slots.length) {
      const b = basketOf(plan.slots);
      const servTotal = plan.slots.reduce((n, sl) => n + servingsOf(sl.rid), 0);
      const per = b.total / Math.max(1, servTotal);
      const over = b.total > settings.budget;
      const approx = b.lines.filter((l) => l.offer && l.offer[0] === "approx").reduce((n, l) => n + l.cost, 0);
      html += `<div class="plan-total ${over ? "over" : ""}">
        Итого корзина: <b>${rub(b.total)}</b> из ${rub(settings.budget)}
        · ~${rub(per)} на порцию
        ${b.waste > 30 ? `<br><span class="muted">останется неиспользованным примерно на ${rub(b.waste)} (скоропортящееся)</span>` : ""}
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
          <td><a href="#" data-open="${r.id}">${esc(r.t)}</a> <span class="muted">${esc(r.tm || "")} · на ${servingsOf(r.id)} ${plural(servingsOf(r.id), "порцию", "порции", "порций")}</span>
            ${(s.add || []).length ? `<br><span class="addon">+ ${esc(s.add.join(", "))}</span>
              <button class="link small" data-addon="${i}">другое</button>` : ""}</td>
          <td class="num">+${rub(b.total - without)}</td>
          <td><button class="link small" data-reroll="${i}">заменить</button></td>
        </tr>`;
      });
      html += `</table>`;
      html += shoppingList(b);
      html += leftoversList(b);
      html += `<div class="modal-actions">
        <button id="pl-again">🔄 Другое меню</button>
        <button id="pl-toshop">🛒 Добавить в список покупок</button>
      </div>`;
    } else if (plan) {
      html += `<p class="hint">Не нашлось подходящих рецептов с ценами — попробуйте другие настройки.</p>`;
    }
    $("plan-body").innerHTML = html;
  }

  // сколько останется от купленных упаковок (если заметно)
  function leftover(l, u) {
    if (!l.offer || l.offer[0] === "approx") return "";
    const { left, share } = leftOf(l);
    if (left <= (u === "pcs" ? 1 : 60)) {
      // мясо/рыба: небольшой «перебор» упаковки просто готовим целиком
      return MEATY.has(PRODUCTS[l.pid].cat) && share > 0.05 ? ", готовим всю упаковку" : "";
    }
    return `, останется ~${fmtQty(left, u)}`;
  }

  // что останется от купленного после всей недели
  function leftoversList(b) {
    const unit = (pid) => (OFFERS.get(pid) || {}).u || "g";
    const rows = [];
    for (const l of b.lines) {
      if (!l.offer) continue;
      const durable = isDurable(l.pid);
      const { left, share, bought } = leftOf(l);
      const u = l.cut ? "g" : unit(l.pid);
      if (left <= (u === "pcs" ? 0.5 : 10)) continue;
      rows.push({ name: l.cut ? "Курица" : PRODUCTS[l.pid].name, from: l.cut ? "части тушки" : "", left, u,
        value: (left / bought) * l.cost, durable, approx: l.offer[0] === "approx", share: l.cut ? 0 : share });
    }
    if (!rows.length) return `<h3>Остатки</h3><p class="hint">Всё купленное уходит в блюда.</p>`;
    rows.sort((a, c) => (a.durable - c.durable) || (c.value - a.value));
    const sum = (f) => rows.filter(f).reduce((n, r) => n + r.value, 0);
    const per = sum((r) => !r.durable), dur = sum((r) => r.durable);
    const spent = b.lines.reduce((n, l) => n + (l.cost || 0), 0);
    return `<h3>Остатки после недели</h3>
      <p class="muted">Скоропортящееся: ~${rub(per)} · хранится долго (крупы, специи, масло, консервы, лук, картошка…): ~${rub(dur)}.
        В блюда этой недели уходит ~${Math.round((1 - (per + dur) / Math.max(1, spent)) * 100)}% стоимости корзины, остальное — в основном запасы на потом.</p>
      <p class="muted">Не показываем: мясо и рыбу, если лишнего не больше 40% упаковки (готовим всю), и скоропортящееся меньше 25% упаковки.</p>
      <table class="plan-cart leftovers">` + rows.map((r) => `<tr class="${r.durable ? "keeps" : "spoils"}">
        <td><b>${esc(r.name)}</b>${r.from ? ` <span class="muted">${r.from}</span>` : ""}
          <br>${r.durable ? '<span class="muted">хранится</span>' : '<span class="bad">испортится</span>'}</td>
        <td class="num">~${fmtQty(r.left, r.u)}${r.share ? `<br><span class="muted">${Math.round(r.share * 100)}% упаковки</span>` : ""}</td>
        <td class="num">${r.approx ? "≈" : "~"}${rub(r.value)}</td>
      </tr>`).join("") + `</table>`;
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
        <td><b>${esc(PRODUCTS[l.pid].name)}</b><br><span class="muted">${l.cut
          ? (l.need > 30 ? `целиком ~${fmtQty(l.need, "g")}; ` : "") + "разделать: " + l.cut.map((c) =>
              `${c.name.replace("Куриное ", "").replace("Куриные ", "")} ~${fmtQty(c.get, "g")}${c.need > 30 ? ` (нужно ${fmtQty(c.need, "g")})` : ""}`).join(", ") + "; каркас" +
              (l.cut.some((c) => c.get - c.need > 100) ? " и остальное" : "") + " — на бульон"
          : `нужно ~${fmtQty(l.need, unit(l.pid))}${l.fromCarcass > 30 ? ` (ещё ~${fmtQty(l.fromCarcass, "g")} из тушки)` : ""}${leftover(l, unit(l.pid))}`}</span></td>
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
    settings.wholeChicken = $("pl-whole").checked;
    settings.fullRecipe = $("pl-full").checked;
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
      // уже показанные на этом месте блюда не предлагаем снова (последние 15), чтобы замены не ходили по кругу
      s.skip = (s.skip || []).concat([s.rid]).slice(-15);
      let p = pick(plan.slots, i, s.meal, replaceCandidates(i), { exclude: s.rid, skip: new Set(s.skip) });
      if (!p) { s.skip = [s.rid]; p = pick(plan.slots, i, s.meal, replaceCandidates(i), { exclude: s.rid }); } // всё перебрали — по новой
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
    if (op) { e.preventDefault(); A.openRecipe(+op.dataset.open, servingsOf(+op.dataset.open)); return; }
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
