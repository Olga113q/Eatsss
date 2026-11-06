// Проверка обновлений Android-приложения.
// Приложение добавляет в User-Agent «ChtoPrigotovitApp/<номер сборки>» (см. android-app/capacitor.config.json).
// Сайт сравнивает его с номером последней сборки в релизе «android» на GitHub и, если вышла новая,
// показывает плашку со ссылкой на APK. Ссылка на github.com открывается в браузере телефона — там APK
// скачивается и ставится поверх (данные сохраняются). Без интернета проверка молча пропускается.
(() => {
  "use strict";
  const APK = "https://github.com/Olga113q/Eatsss/releases/download/android/chto-prigotovit.apk";
  const RELEASE = "https://api.github.com/repos/Olga113q/Eatsss/releases/tags/android";
  const SKIP_KEY = "wtc:skip-update";

  function show(latest) {
    if (document.getElementById("app-update")) return;
    const bar = document.createElement("div");
    bar.id = "app-update";
    bar.className = "app-update";
    bar.innerHTML =
      `<span>Вышла новая версия приложения (сборка ${latest}).</span>` +
      `<a class="app-update-get" href="${APK}" target="_blank" rel="noopener">Скачать</a>` +
      `<button class="app-update-later" type="button">Позже</button>`;
    bar.querySelector(".app-update-later").addEventListener("click", () => {
      localStorage.setItem(SKIP_KEY, String(latest));
      bar.remove();
    });
    document.body.appendChild(bar);
  }

  async function check(current) {
    const r = await fetch(RELEASE, { cache: "no-store" });
    if (!r.ok) return null;
    const rel = await r.json();
    const latest = Number((String(rel.name).match(/сборка\s*(\d+)/) || [])[1]);
    if (latest && latest > current && localStorage.getItem(SKIP_KEY) !== String(latest)) show(latest);
    return latest || null;
  }

  // для отладки: window.__checkAppUpdate(1) — как будто запущена сборка 1
  window.__checkAppUpdate = check;

  const m = navigator.userAgent.match(/ChtoPrigotovitApp\/(\d+)/);
  const current = m ? Number(m[1]) : 0;

  // Кнопка «назад» Android. Приложение передаёт её на страницу как window.Capacitor.triggerEvent("backbutton"),
  // но на сайте кода Capacitor нет — событие терялось, и со страницы «Мои рецепты» нельзя было вернуться.
  // Окна (рецепт, план, редактор) закрывает сам браузер, здесь — только переход назад между страницами.
  if (current > 0) {
    window.Capacitor = window.Capacitor || {};
    if (!window.Capacitor.triggerEvent) {
      window.Capacitor.triggerEvent = (name) => {
        if (name !== "backbutton" || document.querySelector("dialog[open]")) return true;
        if (!/manage\.html/.test(location.pathname)) return true; // на главной — как раньше
        const here = location.href;
        setTimeout(() => {
          if (location.href !== here) return; // приложение уже перешло само
          if (history.length > 1) history.back(); else location.replace("index.html");
        }, 250);
        return true;
      };
    }
  }
  if (current > 0 && navigator.onLine) setTimeout(() => check(current).catch(() => {}), 3000);

  // ---------- версия сайта ----------
  // GitHub Pages ставит всем файлам дату публикации (Last-Modified) — это и есть версия загруженного сайта.
  // При возвращении в приложение (Android держит его в памяти и страницу не перезагружает) сверяем её с сервером
  // и, если вышла новая, перезагружаем страницу; все выбранные продукты и план хранятся в браузере и не теряются.
  const loaded = new Date(document.lastModified);
  const fmt = (d) => d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  async function latestSite() {
    const r = await fetch("index.html?v=" + Date.now(), { method: "HEAD", cache: "no-store" });
    const lm = r.headers.get("last-modified");
    return lm ? new Date(lm) : null;
  }

  function footer(note) {
    let f = document.getElementById("version-line");
    if (!f) {
      f = document.createElement("footer");
      f.id = "version-line";
      f.className = "version-line";
      document.body.appendChild(f);
      f.addEventListener("click", (e) => { if (e.target.id === "check-site") checkSite(true); });
    }
    f.innerHTML = `Версия сайта от ${fmt(loaded)}` + (current ? ` · приложение: сборка ${current}` : "") +
      ` · <button class="link" id="check-site" type="button">проверить обновления</button>` + (note ? ` <span class="muted">${note}</span>` : "");
  }

  async function checkSite(manual) {
    if (!navigator.onLine) { if (manual) footer("— нет интернета"); return; }
    let latest;
    try { latest = await latestSite(); } catch (e) { if (manual) footer("— не удалось проверить"); return; }
    if (!latest || latest - loaded < 1000) { if (manual) footer("— это последняя версия"); return; }
    // новее: перезагружаем, но не чаще раза в минуту (на случай, если сервер ещё отдаёт старое)
    const last = +sessionStorage.getItem("wtc:reloaded") || 0;
    if (Date.now() - last < 60000) { footer(`— на сервере есть версия от ${fmt(latest)}, обновится при следующем открытии`); return; }
    if (!manual && document.querySelector("dialog[open]")) { footer(`— вышла версия от ${fmt(latest)}, нажмите «проверить обновления»`); return; }
    sessionStorage.setItem("wtc:reloaded", String(Date.now()));
    location.reload();
  }

  footer("");
  setTimeout(() => checkSite(false), 5000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkSite(false); });
})();
