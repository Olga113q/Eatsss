// Страница «Мои рецепты»: все рецепты по разделам, скрыть из предложений, изменить.
// Правки хранит recipe-edits.js (localStorage), подбор и план их учитывают.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const D = window.RECIPE_DATA;
  const E = window.RECIPE_EDITS;
  if (!D || !E) {
    $("m-grid").innerHTML = '<p class="empty">Не удалось загрузить рецепты — проверьте интернет и обновите страницу.</p>';
    return;
  }
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // в названиях eda.ru встречаются неразрывные пробелы — приводим к обычным, иначе поиск «из картофельного» не находит
  const lc = (s) => String(s).toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
  const PRODUCTS = D.products.map((p) => p[0]);
  const PID = new Map(PRODUCTS.map((n, i) => [lc(n), i]));
  const IGNORE = new Set(D.ignore);
  const IMAGES = window.RECIPE_IMAGES || {};
  const ICON = { "Выпечка и десерты": "🍰", "Основные блюда": "🍲", "Закуски": "🥟", "Супы": "🍜", "Салаты": "🥗",
    "Завтраки": "🍳", "Паста и пицца": "🍝", "Напитки": "🍹", "Соусы и маринады": "🥫", "Сэндвичи": "🥪",
    "Ризотто": "🍚", "Заготовки": "🫙", "Бульоны": "🍵" };
  const BG = { "Выпечка и десерты": "#fde2e4", "Основные блюда": "#ffe8cc", "Закуски": "#fff3bf", "Супы": "#ffd8a8",
    "Салаты": "#d3f9d8", "Завтраки": "#fff9db", "Паста и пицца": "#ffe3e3", "Напитки": "#d0ebff" };

  const ALL = D.recipes.map((r, id) => ({ r, id, key: E.key(r) }));
  const courseOf = (r) => r.c[0] || "Другое";
  let hidden = E.hidden();
  let edits = E.edits();

  const COURSES = (() => {
    const n = new Map();
    for (const x of ALL) n.set(courseOf(x.r), (n.get(courseOf(x.r)) || 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  })();

  // основные ингредиенты: обязательные, без соли/воды/перца и т. п. (как в подборе)
  const mainIngs = (r) => [...new Set(r.i.filter(([pid, , , opt]) => !opt && !IGNORE.has(PRODUCTS[pid])).map(([pid]) => PRODUCTS[pid]))];

  const pic = (r) => {
    const bg = BG[courseOf(r)] || "#f1ebe3", icon = ICON[courseOf(r)] || "🍽️", url = IMAGES[r.u];
    return `<div class="mthumb ph" style="background:${bg}"><span>${icon}</span>${url
      ? `<img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}</div>`;
  };

  // ---------- список ----------
  const PAGE = 48;
  let tab = "all", shown = PAGE, items = [];

  function filterItems() {
    const q = lc($("m-search").value.trim());
    items = ALL.filter(({ r, key }) => {
      const isHidden = hidden.has(key);
      if (tab === "hidden") { if (!isHidden) return false; }
      else if (tab === "edited") { if (!edits[key]) return false; }
      else if (tab === "nofit") { if (!r.d || isHidden) return false; }
      else if (isHidden || r.d) return false;
      else if (tab !== "all" && courseOf(r) !== tab) return false;
      if (!q) return true;
      return lc(r.t).includes(q) || mainIngs(r).some((n) => lc(n).includes(q));
    });
    // сначала рецепты с фото и с большим числом ингредиентов — «настоящие» блюда
    items.sort((a, b) => (!!IMAGES[b.r.u] - !!IMAGES[a.r.u]) || (b.r.i.length > 3) - (a.r.i.length > 3));
  }

  function renderTabs() {
    const count = new Map();
    let shownAll = 0, nofit = 0;
    for (const { r, key } of ALL) {
      if (hidden.has(key)) continue;
      if (r.d) { nofit++; continue; }
      shownAll++;
      count.set(courseOf(r), (count.get(courseOf(r)) || 0) + 1);
    }
    const nEdited = Object.keys(edits).length;
    const tabs = [["all", "Все", shownAll], ...COURSES.map((c) => [c, `${ICON[c] || "🍽️"} ${c}`, count.get(c) || 0]),
      ["nofit", "🚫 Не подходят", nofit], ["hidden", "🙈 Скрытые", hidden.size], ["edited", "✏️ Изменённые", nEdited]];
    $("m-tabs").innerHTML = tabs.filter(([id, , n]) => n || id === tab || id === "all")
      .map(([id, name, n]) => `<button class="m-tab ${id === tab ? "on" : ""}" data-tab="${esc(id)}">${esc(name)} <span>${n}</span></button>`).join("");
  }

  function card({ r, id, key }) {
    const ings = mainIngs(r);
    const isHidden = hidden.has(key);
    return `<article class="mcard ${isHidden ? "is-hidden" : ""}" data-id="${id}">
      ${pic(r)}
      <div class="mbody">
        <h3>${esc(r.t)}${edits[key] ? ' <span class="badge-ed">изменён</span>' : ""}</h3>
        <div class="meta">${[courseOf(r), r.tm && "⏱ " + r.tm, r.n && r.n + " порц."].filter(Boolean).map(esc).join(" · ")}${
          window.recipeCost && window.recipeCost(id) ? ` · <span class="cost">${window.fmtCost(window.recipeCost(id))}</span>` : ""}</div>
        ${r.d ? `<div class="nofit">🚫 ${esc(r.d)}</div>` : ""}
        <div class="m-ings">${ings.slice(0, 8).map((n) => `<span>${esc(n)}</span>`).join("")}${ings.length > 8 ? `<span class="more-ings">+${ings.length - 8}</span>` : ""}</div>
        <div class="m-actions">
          <button data-act="edit">✏️ Изменить</button>
          ${r.d && !isHidden ? '<button data-act="allow">✅ Всё равно показывать</button>'
            : `<button data-act="hide">${isHidden ? "👁 Вернуть" : "🙈 Скрыть"}</button>`}
        </div>
      </div>
    </article>`;
  }

  function render() {
    renderTabs();
    const n = items.length;
    $("m-summary").textContent = `${n} ${n % 10 === 1 && n % 100 !== 11 ? "рецепт" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "рецепта" : "рецептов"}`;
    $("m-grid").innerHTML = items.slice(0, shown).map(card).join("") || '<p class="empty">Ничего не нашлось.</p>';
    $("m-more").hidden = shown >= n;
    $("m-more").textContent = `Показать ещё (${n - shown})`;
  }

  const refresh = () => { shown = PAGE; filterItems(); render(); };


  $("m-search").addEventListener("input", refresh);
  $("m-tabs").addEventListener("click", (e) => {
    const t = e.target.closest("[data-tab]");
    if (!t) return;
    tab = t.dataset.tab;
    refresh();
  });
  $("m-more").addEventListener("click", () => { shown += PAGE; render(); });

  function toggleHidden(x) {
    const on = !hidden.has(x.key);
    E.setHidden(x.key, on);
    hidden = E.hidden();
  }

  $("m-grid").addEventListener("click", (e) => {
    const el = e.target.closest("[data-id]");
    if (!el) return;
    const x = ALL[+el.dataset.id];
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "allow") {
      window.RECIPE_PREFS.allow(x.key, true);
      delete x.r.d; // правила больше не скрывают этот рецепт
      filterItems();
      render();
      return;
    }
    if (act === "hide") {
      toggleHidden(x);
      // в обычной вкладке скрытый рецепт пропадает из списка (вкладка «Скрытые» — чтобы вернуть)
      filterItems();
      render();
      return;
    }
    openEditor(x);
  });

  // ---------- редактор ----------
  const dlg = $("editor");
  $("products").innerHTML = PRODUCTS.map((n) => `<option value="${esc(n)}">`).join("");
  let cur = null, stepsBefore = "";

  function loadSteps() {
    if (window.RECIPE_STEPS) return Promise.resolve();
    return new Promise((ok, bad) => {
      const s = document.createElement("script");
      s.src = "data/steps.js";
      s.onload = ok;
      s.onerror = bad;
      document.body.appendChild(s);
    });
  }

  const ingRow = ([pid, raw, qty, opt]) => `<tr>
      <td><input class="i-prod" list="products" value="${esc(pid === null ? "" : PRODUCTS[pid])}" placeholder="продукт из списка"></td>
      <td><input class="i-raw" value="${esc(raw)}" placeholder="как в рецепте"></td>
      <td><input class="i-qty" value="${esc(qty)}" placeholder="200 г"></td>
      <td class="c"><input class="i-opt" type="checkbox" ${opt ? "checked" : ""} title="необязательный"></td>
      <td class="c"><button class="link i-del" type="button" title="Убрать">✕</button></td>
    </tr>`;

  function openEditor(x) {
    cur = x;
    const r = x.r;
    const isHidden = hidden.has(x.key);
    $("ed-body").innerHTML = `
      <h2>Изменить рецепт</h2>
      ${IMAGES[r.u] ? `<div class="ed-pic">${pic(r)}</div>` : ""}
      <label class="ed-field">Название <input id="ed-title" value="${esc(r.t)}"></label>
      <div class="ed-row">
        <label class="ed-field">Раздел <select id="ed-course">${COURSES.map((c) => `<option ${c === courseOf(r) ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
        <label class="ed-field">Порций <input id="ed-n" type="number" min="1" max="30" value="${r.n || 4}"></label>
      </div>
      <h3>Ингредиенты</h3>
      <p class="muted">Продукт — из списка (по нему идёт подбор и корзина), «как в рецепте» — название для чтения.
        Галочка — необязательный ингредиент.</p>
      <table class="ed-ings"><thead><tr><th>Продукт</th><th>Как в рецепте</th><th>Сколько</th><th title="необязательный">необ.</th><th></th></tr></thead>
        <tbody id="ed-ings">${r.i.map(ingRow).join("")}</tbody></table>
      <button class="link" id="ed-add" type="button">+ ингредиент</button>
      <h3>Шаги приготовления</h3>
      <p class="muted">Каждый шаг — с новой строки.</p>
      <textarea id="ed-steps" rows="8" placeholder="Загружаю шаги…" disabled></textarea>
      <p id="ed-err" class="bad"></p>
      <div class="modal-actions">
        <button id="ed-save" class="primary-btn">Сохранить</button>
        <button id="ed-hide">${isHidden ? "👁 Вернуть в предложения" : "🙈 Скрыть из предложений"}</button>
        ${edits[x.key] ? '<button id="ed-reset">↩ Вернуть исходный рецепт</button>' : ""}
        ${r.u ? `<a href="${esc(r.u)}" target="_blank" rel="noopener">Открыть на eda.ru ↗</a>` : ""}
      </div>`;
    const steps = r.s ? Promise.resolve(r.s) : loadSteps().then(() => window.RECIPE_STEPS[x.id] || []);
    steps.then((s) => {
      if (cur !== x) return;
      const ta = $("ed-steps");
      ta.value = stepsBefore = s.join("\n");
      ta.disabled = false;
      ta.placeholder = "";
    }, () => { $("ed-steps").placeholder = "Не удалось загрузить шаги — проверьте интернет"; });
    if (!dlg.open) {
      dlg.showModal();
      history.pushState({ editor: 1 }, "");
    }
  }

  function closeEditor() {
    if (!dlg.open) return;
    dlg.close();
    if (history.state && history.state.editor) history.back();
  }
  $("ed-close").addEventListener("click", closeEditor);
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); closeEditor(); });
  window.addEventListener("popstate", () => { if (dlg.open) dlg.close(); }); // «назад» сначала закрывает редактор

  $("ed-body").addEventListener("click", (e) => {
    if (e.target.closest(".i-del")) { e.target.closest("tr").remove(); return; }
    if (e.target.id === "ed-add") {
      $("ed-ings").insertAdjacentHTML("beforeend", ingRow([null, "", "", 0]));
      $("ed-ings").lastElementChild.querySelector(".i-prod").focus();
      return;
    }
    if (e.target.id === "ed-hide") {
      toggleHidden(cur);
      closeEditor();
      filterItems();
      render();
      return;
    }
    if (e.target.id === "ed-reset") {
      if (!confirm("Вернуть исходный рецепт? Ваши изменения в нём удалятся.")) return;
      E.setEdit(cur.key, null);
      location.reload(); // исходные данные — заново из базы
      return;
    }
    if (e.target.id === "ed-save") save();
  });

  // название продукта при вводе подставляем и в «как в рецепте», если там пусто
  $("ed-body").addEventListener("change", (e) => {
    if (!e.target.classList.contains("i-prod")) return;
    const raw = e.target.closest("tr").querySelector(".i-raw");
    if (!raw.value.trim()) raw.value = e.target.value;
  });

  function save() {
    const r = cur.r;
    const err = [];
    const i = [];
    for (const tr of $("ed-ings").querySelectorAll("tr")) {
      const name = tr.querySelector(".i-prod").value.trim();
      const raw = tr.querySelector(".i-raw").value.trim();
      const qty = tr.querySelector(".i-qty").value.trim();
      if (!name && !raw) continue; // пустая строка
      const pid = PID.get(lc(name));
      if (pid === undefined) { err.push(`«${name || raw}» — выберите продукт из списка`); tr.classList.add("err"); continue; }
      tr.classList.remove("err");
      i.push([pid, raw || PRODUCTS[pid], qty, tr.querySelector(".i-opt").checked ? 1 : 0]);
    }
    const t = $("ed-title").value.trim();
    if (!t) err.push("Название не может быть пустым");
    if (!i.length) err.push("Нужен хотя бы один ингредиент");
    if (err.length) { $("ed-err").textContent = err.join("; "); return; }
    const e = { ...(edits[cur.key] || {}), t, course: $("ed-course").value, n: Math.max(1, +$("ed-n").value || 4), i };
    const ta = $("ed-steps");
    if (!ta.disabled && ta.value !== stepsBefore) e.s = ta.value.split("\n").map((s) => s.trim()).filter(Boolean);
    E.setEdit(cur.key, e);
    edits = E.edits();
    // применяем к рецепту на странице сразу
    r.t = e.t; r.c = [e.course, ...r.c.slice(1)]; r.n = e.n; r.i = e.i; if (e.s) r.s = e.s; r.e = 1;
    closeEditor();
    render();
  }

  refresh();
})();
