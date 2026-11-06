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
  if (!m || !navigator.onLine) return;
  const current = Number(m[1]);
  if (current > 0) setTimeout(() => check(current).catch(() => {}), 3000);
})();
