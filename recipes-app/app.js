(() => {
  "use strict";

  const D = window.RECIPE_DATA;
  if (!D) {
    document.getElementById("list").innerHTML =
      '<p class="empty">Не найден файл data/recipes.js. Соберите его: <code>python3 tools/build_data.py recipes.sql</code></p>';
    return;
  }

  // ---------- данные ----------
  const PRODUCTS = D.products.map(([name, cat, count], id) => ({ id, name, cat, count, lc: name.toLowerCase().replace(/ё/g, "е") }));
  const BY_NAME = new Map(PRODUCTS.map((p) => [p.name, p]));
  const IGNORE = new Set(D.ignore.map((n) => BY_NAME.get(n)?.id).filter((x) => x !== undefined));
  const SPICE_CATS = new Set(["Специи", "Зелень"]);
  const IMAGES = window.RECIPE_IMAGES || {};
  const COURSE_ICON = {
    "Выпечка и десерты": "🍰", "Основные блюда": "🍲", "Закуски": "🥟", "Супы": "🍜", "Салаты": "🥗",
    "Завтраки": "🍳", "Паста и пицца": "🍝", "Напитки": "🍹", "Соусы и маринады": "🥫", "Сэндвичи": "🥪",
    "Ризотто": "🍚", "Заготовки": "🫙", "Бульоны": "🍵",
  };
  const COURSE_BG = {
    "Выпечка и десерты": "#fde2e4", "Основные блюда": "#ffe8cc", "Закуски": "#fff3bf", "Супы": "#ffd8a8",
    "Салаты": "#d3f9d8", "Завтраки": "#fff9db", "Паста и пицца": "#ffe3e3", "Напитки": "#d0ebff",
  };
  const pic = (r, cls) => {
    const icon = `<div class="${cls} ph noimg" style="background:${COURSE_BG[r.course] || "#f1ebe3"}"><span>${COURSE_ICON[r.course] || "🍽️"}</span></div>`;
    const url = IMAGES[r.u];
    if (!url) return icon;
    return `<div class="${cls} ph" style="background:${COURSE_BG[r.course] || "#f1ebe3"}"><span>${COURSE_ICON[r.course] || "🍽️"}</span>
      <img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"></div>`;
  };

  const MIN_INGREDIENTS = 4;
  const BASE_COURSES = new Set(["Напитки", "Соусы и маринады", "Заготовки", "Бульоны"]);
  const BASE_TITLE = /^(тесто|крем|глазурь|соус|маринад|заправка|сироп|бульон|начинка|карамель|ганаш|майонез|кетчуп|песто|паста из|масло|сливочный крем|основа|корж|бисквит для|пропитка|подлива|подливка)\b/;

  // приём пищи → разделы eda.ru (в исходных данных деления на обед/ужин нет, собираем из разделов)
  const MEALS = {
    breakfast: (r) => r.course === "Завтраки" || r.tags.some((t) => /^(Каши|Омлет|Яичница|Сырники|Оладьи|Блины)$/.test(t)),
    lunch: (r) => ["Супы", "Основные блюда", "Салаты", "Паста и пицца", "Ризотто"].includes(r.course),
    dinner: (r) => ["Основные блюда", "Салаты", "Паста и пицца", "Ризотто"].includes(r.course) ||
      (r.course === "Закуски" && r.tags.includes("Горячие закуски")),
    snack: (r) => ["Закуски", "Сэндвичи"].includes(r.course) ||
      (r.course === "Выпечка и десерты" && r.tags.some((t) => /Пирожки|Булочки|Печенье|Маффины|Кексы|Пироги/.test(t))),
    dessert: (r) => (r.course === "Выпечка и десерты" || r.tags.some((t) => /десерт|Торт|Пирожн|Мороженое|Пудинг/i.test(t))) && r.sweet,
    party: (r) => r.tags.some((t) => /Праздничн|Новогодн|Фуршет/.test(t)),
  };

  const SWEET_IDS = new Set(["Сахар", "Сахарная пудра", "Мед", "Шоколад", "Сгущенное молоко", "Варенье / джем", "Сироп", "Какао", "Ваниль / ванилин"]
    .map((n) => BY_NAME.get(n)?.id).filter((x) => x !== undefined));
  const SAVORY_CATS = new Set(["Мясо и птица", "Рыба и морепродукты", "Грибы", "Специи"]);
  const SAVORY_NAMES = new Set(["Картофель", "Лук репчатый", "Чеснок", "Зеленый лук", "Сыр твердый", "Пармезан", "Моцарелла",
    "Сулугуни", "Фета / брынза", "Помидоры", "Болгарский перец", "Капуста", "Укроп", "Петрушка", "Майонез"]);
  const isSavory = (pid) => SAVORY_NAMES.has(PRODUCTS[pid].name) ||
    (SAVORY_CATS.has(PRODUCTS[pid].cat) && !/Корица|Ваниль|Кардамон|Гвоздика|Бадьян|Мускат/.test(PRODUCTS[pid].name));
  const sweetIdx = (r) => r.i.reduce((n, [pid, , qty]) => {
    if (!SWEET_IDS.has(pid)) return n;
    // щепотка сахара в тесте для пирожков — не десерт
    return /щепот|по вкусу|кончике/.test(qty) ? n : n + 1;
  }, 0);

  const RECIPES = D.recipes.map((r, id) => {
    const course = r.c[0] || "";
    const cuisine = r.c.find((c) => c.endsWith("кухня")) || "";
    const req = [];
    const opt = [];
    for (const [pid, , , optional] of r.i) {
      if (IGNORE.has(pid)) continue;
      (optional ? opt : req).push(pid);
    }
    const reqU = [...new Set(req)];
    const lc = r.t.toLowerCase().replace(/ё/g, "е");
    // «не блюдо»: напитки, соусы, заготовки, основы (тесто, крем, глазурь…) и совсем простые рецепты
    const isBase = BASE_COURSES.has(course) || BASE_TITLE.test(lc);
    const isSimple = reqU.length < MIN_INGREDIENTS;
    const textLen = r.s.reduce((n, st) => n + st.length, 0);
    return { ...r, id, course, cuisine, tags: r.c.slice(1), sweet: sweetIdx(r) > 0 && !r.i.some(([pid, , , o]) => !o && isSavory(pid)), req: reqU, opt, lc, minor: isBase || isSimple, textLen };
  });

  // ---------- состояние (сохраняется в браузере) ----------
  const store = {
    get(key, def) {
      try { return JSON.parse(localStorage.getItem("wtc:" + key)) ?? def; } catch { return def; }
    },
    set(key, val) { localStorage.setItem("wtc:" + key, JSON.stringify(val)); },
  };

  const defaultHave = D.pantry.map((n) => BY_NAME.get(n)?.id).filter((x) => x !== undefined);
  const have = new Set(store.get("have", null)?.map((n) => BY_NAME.get(n)?.id).filter((x) => x !== undefined) ?? defaultHave);
  const favs = new Set(store.get("favs", []));
  let shop = store.get("shop", []); // [{name, done}]
  const settings = store.get("settings", { ignoreSpices: false, missing: "1" });

  const saveHave = () => store.set("have", [...have].map((id) => PRODUCTS[id].name));
  const saveFavs = () => store.set("favs", [...favs]);
  const saveShop = () => store.set("shop", shop);
  const saveSettings = () => store.set("settings", settings);

  // ---------- утилиты ----------
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  };
  const isSkipped = (pid) => settings.ignoreSpices && SPICE_CATS.has(PRODUCTS[pid].cat);

  // ---------- панель продуктов ----------
  const CHIPS_PER_CAT = 18;
  const openCats = new Set(store.get("openCats", ["Базовое", "Овощи", "Мясо и птица", "Молочное и яйца"]));

  function renderSelected() {
    const list = [...have].filter((id) => !IGNORE.has(id)).map((id) => PRODUCTS[id]).sort((a, b) => a.name.localeCompare(b.name, "ru"));
    $("have-count").textContent = list.length || "";
    $("selected").innerHTML = list.length
      ? list.map((p) => `<button class="chip on" data-pid="${p.id}" title="Убрать">${esc(p.name)} ✕</button>`).join("")
      : '<p class="hint">Отметьте продукты, которые есть дома.</p>';
  }

  function renderCategories() {
    const html = [];
    for (const cat of D.categories) {
      if (cat === "Другое") continue;
      const items = PRODUCTS.filter((p) => p.cat === cat && !IGNORE.has(p.id)).sort((a, b) => b.count - a.count);
      if (!items.length) continue;
      const open = openCats.has(cat);
      const showAll = openCats.has(cat + ":all");
      const shown = showAll ? items : items.slice(0, CHIPS_PER_CAT);
      const selectedN = items.filter((p) => have.has(p.id)).length;
      html.push(`<section class="cat ${open ? "open" : ""}">
        <button class="cat-head" data-cat="${esc(cat)}">${open ? "▾" : "▸"} ${esc(cat)}
          <span class="muted">${selectedN ? selectedN + " / " : ""}${items.length}</span></button>
        ${open ? `<div class="chips">${shown.map((p) =>
          `<button class="chip ${have.has(p.id) ? "on" : ""}" data-pid="${p.id}">${esc(p.name)}</button>`).join("")}
          ${items.length > shown.length ? `<button class="link" data-all="${esc(cat)}">ещё ${items.length - shown.length}…</button>` : ""}
        </div>` : ""}
      </section>`);
    }
    $("categories").innerHTML = html.join("");
  }

  function toggleProduct(pid) {
    if (have.has(pid)) have.delete(pid); else have.add(pid);
    saveHave();
    renderPantry();
    update();
  }

  function renderPantry() {
    renderSelected();
    renderCategories();
  }

  // поиск продукта с подсказками
  const search = $("product-search");
  const suggest = $("suggest");
  let suggestIdx = 0;
  let suggestItems = [];

  function renderSuggest() {
    const q = search.value.trim().toLowerCase().replace(/ё/g, "е");
    if (!q) { suggest.hidden = true; return; }
    suggestItems = PRODUCTS
      .filter((p) => !IGNORE.has(p.id) && p.lc.includes(q))
      .sort((a, b) => (b.lc.startsWith(q) - a.lc.startsWith(q)) || (b.count - a.count))
      .slice(0, 12);
    suggestIdx = 0;
    suggest.hidden = !suggestItems.length;
    suggest.innerHTML = suggestItems.map((p, i) =>
      `<li class="${i === 0 ? "active" : ""} ${have.has(p.id) ? "have" : ""}" data-pid="${p.id}">
        ${have.has(p.id) ? "✓ " : ""}${esc(p.name)} <span class="muted">${esc(p.cat)} · ${p.count}</span></li>`).join("");
  }

  search.addEventListener("input", renderSuggest);
  search.addEventListener("keydown", (e) => {
    if (suggest.hidden) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      suggestIdx = (suggestIdx + (e.key === "ArrowDown" ? 1 : -1) + suggestItems.length) % suggestItems.length;
      [...suggest.children].forEach((li, i) => li.classList.toggle("active", i === suggestIdx));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const p = suggestItems[suggestIdx];
      if (p) { toggleProduct(p.id); search.value = ""; suggest.hidden = true; }
    } else if (e.key === "Escape") {
      suggest.hidden = true;
    }
  });
  suggest.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    e.preventDefault();
    toggleProduct(+li.dataset.pid);
    search.value = "";
    suggest.hidden = true;
  });
  search.addEventListener("blur", () => setTimeout(() => (suggest.hidden = true), 150));

  $("pantry-body").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-pid]");
    if (chip && !chip.closest("#suggest")) { toggleProduct(+chip.dataset.pid); return; }
    const head = e.target.closest("[data-cat]");
    if (head) {
      const c = head.dataset.cat;
      if (openCats.has(c)) openCats.delete(c); else openCats.add(c);
      store.set("openCats", [...openCats]);
      renderCategories();
      return;
    }
    const all = e.target.closest("[data-all]");
    if (all) { openCats.add(all.dataset.all + ":all"); renderCategories(); }
  });

  $("clear-all").addEventListener("click", () => {
    if (!confirm("Убрать все отмеченные продукты? Базовые (соль, сахар, масло…) останутся.")) return;
    have.clear();
    defaultHave.forEach((id) => have.add(id));
    saveHave();
    renderPantry();
    update();
  });

  $("opt-spices").checked = settings.ignoreSpices;
  $("opt-spices").addEventListener("change", (e) => {
    settings.ignoreSpices = e.target.checked;
    saveSettings();
    update();
  });

  $("toggle-pantry").addEventListener("click", () => {
    const p = $("pantry");
    p.classList.toggle("collapsed");
    $("toggle-pantry").textContent = p.classList.contains("collapsed") ? "Развернуть" : "Свернуть";
  });

  // ---------- фильтры ----------
  const count = (arr) => arr.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
  const fill = (sel, map) => {
    [...map].sort((a, b) => b[1] - a[1]).forEach(([v, n]) => {
      if (v) sel.insertAdjacentHTML("beforeend", `<option value="${esc(v)}">${esc(v)} (${n})</option>`);
    });
  };
  fill($("f-course"), count(RECIPES.map((r) => r.course)));
  fill($("f-cuisine"), count(RECIPES.map((r) => r.cuisine)));
  $("f-missing").value = settings.missing;

  $("f-meals").checked = settings.mealsOnly !== false;
  $("f-meals").addEventListener("change", (e) => { settings.mealsOnly = e.target.checked; saveSettings(); });

  for (const id of ["title-search", "f-meal", "f-diet", "f-course", "f-cuisine", "f-time", "f-missing", "f-fav", "f-meals"]) {
    $(id).addEventListener(id === "title-search" ? "input" : "change", () => {
      if (id === "f-missing") { settings.missing = $(id).value; saveSettings(); }
      update();
    });
  }

  // ---------- подбор рецептов ----------
  const PAGE = 40;
  let shownN = PAGE;
  let results = [];

  function evaluate(r) {
    const missing = [];
    let matched = 0;
    let mine = 0; // сколько «небазовых» продуктов пользователя использует рецепт
    for (const pid of r.req) {
      if (isSkipped(pid)) continue;
      if (have.has(pid)) {
        matched++;
        if (!defaultHave.includes(pid)) mine++;
      } else missing.push(pid);
    }
    return { r, missing, matched, mine, total: matched + missing.length };
  }

  function update() {
    shownN = PAGE;
    const q = $("title-search").value.trim().toLowerCase().replace(/ё/g, "е");
    const course = $("f-course").value;
    const cuisine = $("f-cuisine").value;
    const meal = MEALS[$("f-meal").value];
    const diet = $("f-diet").value;
    const maxTime = +$("f-time").value || Infinity;
    const maxMissing = +$("f-missing").value;
    const favOnly = $("f-fav").checked;
    const mealsOnly = $("f-meals").checked && !q && !favOnly;

    results = [];
    for (const r of RECIPES) {
      if (course && r.course !== course) continue;
      if (mealsOnly && r.minor && !(course && BASE_COURSES.has(course))) continue;
      if (cuisine && r.cuisine !== cuisine) continue;
      if (meal && !meal(r)) continue;
      if (diet && !r.tags.some((t) => t.startsWith(diet))) continue;
      if (r.m && r.m > maxTime) continue;
      if (maxTime !== Infinity && !r.m) continue;
      if (q && !r.lc.includes(q)) continue;
      if (favOnly && !favs.has(r.id)) continue;
      const ev = evaluate(r);
      if (ev.missing.length > maxMissing) continue;
      if (maxMissing < 99 && ev.mine === 0 && !q && !favOnly) continue; // рецепт не использует ничего из ваших продуктов
      results.push(ev);
    }
    // сначала то, где всего хватает; затем — где задействовано больше ваших продуктов;
    // затем более «полноценные» рецепты (больше ингредиентов и подробнее описание)
    results.sort((a, b) =>
      a.missing.length - b.missing.length ||
      b.mine - a.mine ||
      Math.min(b.total, 10) - Math.min(a.total, 10) ||
      b.r.textLen - a.r.textLen);
    render();
  }

  function render() {
    const nonBasic = [...have].filter((id) => !defaultHave.includes(id)).length;
    const n = results.length;
    let summary = `Найдено ${n} ${plural(n, "рецепт", "рецепта", "рецептов")}`;
    if (!nonBasic) summary = "Отметьте слева продукты, которые есть дома, и здесь появятся рецепты. " + (n ? summary : "");
    else if (n < 20 && +$("f-missing").value < 3) summary += ". Мало? Отметьте больше продуктов или разрешите больше недостающих";
    $("summary").textContent = summary;

    $("list").innerHTML = results.slice(0, shownN).map(card).join("") ||
      (nonBasic ? '<p class="empty">Ничего не нашлось. Попробуйте разрешить больше недостающих продуктов или убрать фильтры.</p>' : "");
    $("more").hidden = shownN >= n;
    $("more").textContent = `Показать ещё (${n - shownN})`;
    $("to-results").textContent = `Показать рецепты (${n})`;
  }

  function card({ r, missing, matched, total }) {
    const pct = total ? Math.round((matched / total) * 100) : 100;
    const miss = missing.map((pid) => esc(PRODUCTS[pid].name)).join(", ");
    return `<article class="card" data-rid="${r.id}">
      ${pic(r, "thumb")}
      <div class="card-body">
      <div class="card-top">
        <h3>${esc(r.t)}</h3>
        <button class="star ${favs.has(r.id) ? "on" : ""}" data-fav="${r.id}" title="В избранное">★</button>
      </div>
      <div class="meta">${[r.course, r.cuisine, r.tm && "⏱ " + r.tm, r.k && r.k + " ккал/порц."].filter(Boolean).map(esc).join(" · ")}</div>
      <div class="bar"><span style="width:${pct}%"></span></div>
      <div class="have-line">Есть ${matched} из ${total}</div>
      ${missing.length ? `<div class="miss">Не хватает: ${miss}</div>` : '<div class="ok">✓ Всё есть</div>'}
      </div>
    </article>`;
  }

  $("more").addEventListener("click", () => { shownN += PAGE; render(); });

  $("list").addEventListener("click", (e) => {
    const star = e.target.closest("[data-fav]");
    if (star) {
      e.stopPropagation();
      toggleFav(+star.dataset.fav);
      star.classList.toggle("on", favs.has(+star.dataset.fav));
      return;
    }
    const c = e.target.closest(".card");
    if (c) openRecipe(+c.dataset.rid);
  });

  function toggleFav(id) {
    if (favs.has(id)) favs.delete(id); else favs.add(id);
    saveFavs();
    updateCounters();
  }

  // ---------- окно рецепта ----------
  const modal = $("modal");
  let openRid = null;

  function openRecipe(id) {
    openRid = id;
    const r = RECIPES[id];
    const rows = r.i.map(([pid, raw, qty, optional]) => {
      const ignored = IGNORE.has(pid) || isSkipped(pid);
      const ok = have.has(pid);
      const cls = ignored ? "ign" : ok ? "yes" : optional ? "opt" : "no";
      const mark = ignored ? "·" : ok ? "✓" : "✗";
      return `<li class="${cls}">
        <span class="mark">${mark}</span>
        <span class="iname">${esc(raw)}${PRODUCTS[pid].name.toLowerCase() !== raw.toLowerCase() ? ` <span class="muted">(${esc(PRODUCTS[pid].name)})</span>` : ""}</span>
        <span class="qty">${esc(qty)}</span>
        ${ignored ? "" : `<button class="link small" data-toggle="${pid}">${ok ? "нет дома" : "есть дома"}</button>`}
      </li>`;
    }).join("");
    const missing = evaluate(r).missing;
    $("modal-body").innerHTML = `
      ${IMAGES[r.u] ? pic(r, "hero") : ""}
      <h2>${esc(r.t)}</h2>
      <div class="meta">${[r.course, r.cuisine, r.tm && "⏱ " + r.tm, r.n && r.n + " " + plural(r.n, "порция", "порции", "порций"), r.k && r.k + " ккал/порц."].filter(Boolean).map(esc).join(" · ")}</div>
      <div class="modal-actions">
        <button class="star-btn ${favs.has(r.id) ? "on" : ""}" data-mfav="${r.id}">★ ${favs.has(r.id) ? "В избранном" : "В избранное"}</button>
        ${missing.length ? `<button data-addshop="${r.id}">🛒 Недостающее в покупки (${missing.length})</button>` : ""}
        ${r.u ? `<a href="${esc(r.u)}" target="_blank" rel="noopener">Открыть на eda.ru ↗</a>` : ""}
      </div>
      <h3>Ингредиенты</h3>
      <ul class="ings">${rows}</ul>
      <h3>Приготовление</h3>
      <ol class="steps">${r.s.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`;
    if (!modal.open) modal.showModal();
  }

  $("modal-body").addEventListener("click", (e) => {
    const t = e.target.closest("[data-toggle]");
    if (t) {
      const pid = +t.dataset.toggle;
      if (have.has(pid)) have.delete(pid); else have.add(pid);
      saveHave();
      renderPantry();
      update();
      openRecipe(openRid);
      return;
    }
    const f = e.target.closest("[data-mfav]");
    if (f) { toggleFav(+f.dataset.mfav); openRecipe(openRid); render(); return; }
    const s = e.target.closest("[data-addshop]");
    if (s) {
      const r = RECIPES[+s.dataset.addshop];
      for (const pid of evaluate(r).missing) {
        const name = PRODUCTS[pid].name;
        if (!shop.some((x) => x.name === name)) shop.push({ name, done: false, from: r.t });
      }
      saveShop();
      updateCounters();
      s.textContent = "✓ Добавлено в покупки";
      s.disabled = true;
    }
  });

  $("modal-close").addEventListener("click", () => modal.close());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.close(); });

  // ---------- избранное и покупки ----------
  function updateCounters() {
    $("fav-count").textContent = favs.size ? `(${favs.size})` : "";
    const left = shop.filter((x) => !x.done).length;
    $("shop-count").textContent = left ? `(${left})` : "";
  }

  $("btn-fav").addEventListener("click", () => {
    $("f-fav").checked = !$("f-fav").checked;
    if ($("f-fav").checked) $("f-missing").value = "99";
    update();
  });

  function renderShop() {
    openRid = null;
    $("modal-body").innerHTML = `
      <h2>🛒 Список покупок</h2>
      ${shop.length ? `<ul class="shop">${shop.map((x, i) => `
        <li class="${x.done ? "done" : ""}">
          <label><input type="checkbox" data-shop="${i}" ${x.done ? "checked" : ""}> ${esc(x.name)}</label>
          ${x.from ? `<span class="muted">для «${esc(x.from)}»</span>` : ""}
          <button class="link small" data-del="${i}">удалить</button>
        </li>`).join("")}</ul>
        <div class="modal-actions">
          <button id="shop-bought">Купленное → в мои продукты</button>
          <button id="shop-copy">Скопировать список</button>
          <button id="shop-clear" class="ghost">Очистить</button>
        </div>` : '<p class="hint">Список пуст. Откройте рецепт и нажмите «Недостающее в покупки».</p>'}`;
  }

  $("btn-shop").addEventListener("click", () => { renderShop(); modal.showModal(); });

  modal.addEventListener("change", (e) => {
    const c = e.target.closest("[data-shop]");
    if (c) { shop[+c.dataset.shop].done = c.checked; saveShop(); updateCounters(); renderShop(); }
  });
  modal.addEventListener("click", (e) => {
    const d = e.target.closest("[data-del]");
    if (d) { shop.splice(+d.dataset.del, 1); saveShop(); updateCounters(); renderShop(); return; }
    if (e.target.id === "shop-clear") { shop = []; saveShop(); updateCounters(); renderShop(); }
    if (e.target.id === "shop-bought") {
      for (const x of shop.filter((x) => x.done)) {
        const p = BY_NAME.get(x.name);
        if (p) have.add(p.id);
      }
      shop = shop.filter((x) => !x.done);
      saveHave(); saveShop(); updateCounters(); renderPantry(); update(); renderShop();
    }
    if (e.target.id === "shop-copy") {
      const text = shop.filter((x) => !x.done).map((x) => "• " + x.name).join("\n");
      navigator.clipboard?.writeText(text).then(() => (e.target.textContent = "✓ Скопировано"));
    }
  });

  // кнопка «к рецептам» на телефоне: видна, пока список рецептов за экраном
  $("to-results").addEventListener("click", () => $("results").scrollIntoView({ behavior: "smooth" }));
  new IntersectionObserver(([e]) => $("to-results").classList.toggle("hidden", e.isIntersecting))
    .observe($("summary"));

  // ---------- старт ----------
  renderPantry();
  updateCounters();
  update();
})();
