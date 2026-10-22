/* Цели Яндекс.Метрики (счётчик 110915454): клики по Telegram и открытие глав. */
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
