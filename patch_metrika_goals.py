#!/usr/bin/env python3
"""
Патч: цели Яндекс.Метрики — клики по Telegram и открытие глав 1-5.

Что делает:
  1. Создаёт public/js/goals.js:
       - клик по любой ссылке на https://t.me/otets_tuk  -> цель  tg_click
         (в параметрах визита: на какой странице и какая именно кнопка);
       - открытие главы N (N = 1..5) в читалке -> цель  ch_open_N
         (в параметрах: slug книги). Работает и в book.html (переход по
         стрелкам без перезагрузки), и в book_mob.html. Один раз на главу
         за загрузку страницы.
       - заодно шлёт событие telegram_click в Google Analytics, если там
         подключён gtag.
  2. Подключает <script src="./js/goals.js" defer></script> перед </head>
     в index, chistoriya, book, book_mob, blog, blog-post, about.

После деплоя в Метрике (Цели -> Добавить цель -> "JavaScript-событие")
создайте цели с идентификаторами: tg_click, ch_open_1, ch_open_2, ch_open_3.

Запуск из корня проекта:
    python3 patch_metrika_goals.py
Повторный запуск безопасен.
"""
import pathlib
import sys

PUBLIC = pathlib.Path("public")
JS = PUBLIC / "js" / "goals.js"
PAGES = ["index.html", "chistoriya.html", "book.html", "book_mob.html",
         "blog.html", "blog-post.html", "about.html"]
TAG = '<script src="./js/goals.js" defer></script>'

JS_CODE = r"""/* Цели Яндекс.Метрики (счётчик 110915454): клики по Telegram и открытие глав. */
(function () {
  var COUNTER = 110915454;
  var TG_RE = /t\.me\/otets_tuk/i;

  function goal(name, params) {
    try {
      if (typeof ym === 'function') ym(COUNTER, 'reachGoal', name, params || {});
    } catch (e) {}
  }

  // ---- Клики по Telegram ----
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || !TG_RE.test(a.getAttribute('href') || '')) return;
    var where = a.id || a.className || 'link';
    goal('tg_click', { page: location.pathname, button: String(where).slice(0, 60) });
    try { if (typeof gtag === 'function') gtag('event', 'telegram_click', { page_path: location.pathname }); } catch (err) {}
  }, true);

  // ---- Открытие глав (только страницы читалки) ----
  if (!/book(_mob)?\.html$/.test(location.pathname)) return;

  var sent = {};
  function checkChapter() {
    var p = new URLSearchParams(location.search);
    var n = parseInt(p.get('chapter'), 10);
    if (!n || n > 5 || sent[n]) return;
    sent[n] = true;
    goal('ch_open_' + n, { book: p.get('book') || '' });
  }

  ['pushState', 'replaceState'].forEach(function (m) {
    var orig = history[m];
    history[m] = function () {
      var r = orig.apply(this, arguments);
      setTimeout(checkChapter, 0);
      return r;
    };
  });
  window.addEventListener('popstate', checkChapter);
  checkChapter();
})();
"""


def main() -> int:
    if not PUBLIC.exists():
        print("Не найдена папка public/. Запустите скрипт из корня проекта.")
        return 1

    JS.parent.mkdir(parents=True, exist_ok=True)
    if JS.exists() and JS.read_text(encoding="utf-8") == JS_CODE:
        print(f"{JS}: уже актуален")
    else:
        JS.write_text(JS_CODE, encoding="utf-8")
        print(f"{JS}: записан")

    for name in PAGES:
        f = PUBLIC / name
        if not f.exists():
            print(f"{f}: не найден, пропускаю")
            continue
        text = f.read_text(encoding="utf-8")
        if "js/goals.js" in text:
            print(f"{f}: уже подключено")
            continue
        if text.count("</head>") != 1:
            print(f"{f}: не нашёл единственный </head>, пропускаю")
            continue
        text = text.replace("</head>", f"  {TAG}\n</head>", 1)
        f.write_text(text, encoding="utf-8")
        print(f"{f}: подключено")
    return 0


if __name__ == "__main__":
    sys.exit(main())
