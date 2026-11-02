#!/usr/bin/env python3
"""
Патч для аналитики:
  1. Кнопка на analytics.html «Не считать мои просмотры в этом браузере».
     Нажатие ставит в браузере cookie no_track=1 (на 2 года); пока она есть,
     сервер не записывает просмотры глав из этого браузера в page_views.
     Включить/выключить можно в любой момент той же кнопкой. Кнопка работает
     через админский токен (как весь раздел), токен в адрес не попадает.
     Прошлые просмотры не пересчитываются — только новые.
  2. Подписи на analytics.html: какие карточки и графики считают ВСЁ время,
     а какие — выбранный период.

Файлы: server.js, public/analytics.html.
После применения server.js изменён — на сервере нужен перезапуск.

Запуск из корня проекта:
    python3 patch_analytics_exclude_admin.py
"""
import pathlib
import sys

SERVER = pathlib.Path("server.js")
PAGE = pathlib.Path("public/analytics.html")

# ---------- server.js ----------
S_LOG_OLD = """      try {
        const crypto = require('crypto');
        const rawIp = req.headers['x-forwarded-for']"""
S_LOG_NEW = """      try {
        // Администратор отключил учёт своих просмотров (кнопка на analytics.html)
        if (/(?:^|;\\s*)no_track=1(?:;|$)/.test(req.headers.cookie || '')) return;
        const crypto = require('crypto');
        const rawIp = req.headers['x-forwarded-for']"""

S_ROUTES_ANCHOR = "app.get('/api/admin/analytics/summary', requireAdmin, async (req, res) => {"
S_ROUTES_MARK = "/api/admin/no-track"
S_ROUTES_NEW = """// Включить/выключить учёт собственных просмотров администратора в этом браузере.
// Работает через cookie no_track=1: пока она есть, просмотры глав не пишутся в page_views.
app.get('/api/admin/no-track', requireAdmin, (req, res) => {
  res.json({ enabled: /(?:^|;\\s*)no_track=1(?:;|$)/.test(req.headers.cookie || '') });
});
app.post('/api/admin/no-track', requireAdmin, (req, res) => {
  res.cookie('no_track', '1', { maxAge: 2 * 365 * 24 * 3600 * 1000, httpOnly: true, sameSite: 'lax', path: '/' });
  res.json({ enabled: true });
});
app.delete('/api/admin/no-track', requireAdmin, (req, res) => {
  res.clearCookie('no_track', { path: '/' });
  res.json({ enabled: false });
});

"""

# ---------- analytics.html ----------
BTN_OLD = '<button id="analytics-refresh-btn">Обновить</button>'
BTN_NEW = (BTN_OLD + '\n        <button id="no-track-btn" type="button">Не считать мои просмотры в этом браузере</button>')

JS_ANCHOR = "const analyticsHeaders = () => ({ 'x-admin-token': ADMIN_TOKEN });"
JS_MARK = "no-track-btn"
JS_NEW = JS_ANCHOR + """

    // Кнопка «Не считать мои просмотры в этом браузере»
    const noTrackBtn = document.getElementById('no-track-btn');
    async function refreshNoTrack() {
      try {
        const r = await fetch('/api/admin/no-track', { headers: analyticsHeaders() });
        if (!r.ok) return;
        const d = await r.json();
        noTrackBtn.dataset.on = d.enabled ? '1' : '0';
        noTrackBtn.textContent = d.enabled
          ? 'Мои просмотры не считаются (нажмите, чтобы включить учёт)'
          : 'Не считать мои просмотры в этом браузере';
      } catch (e) {}
    }
    noTrackBtn.addEventListener('click', async () => {
      const on = noTrackBtn.dataset.on === '1';
      try {
        const r = await fetch('/api/admin/no-track', { method: on ? 'DELETE' : 'POST', headers: analyticsHeaders() });
        if (r.ok) await refreshNoTrack();
      } catch (e) {}
    });
    document.getElementById('analytics-refresh-btn').addEventListener('click', refreshNoTrack);
    refreshNoTrack();"""

LABELS = [
    ('<div class="stat-label">Просмотров глав</div>', '<div class="stat-label">Просмотров глав (всё время)</div>'),
    ('<div class="stat-label">Читателей зарег.</div>', '<div class="stat-label">Читателей зарег. (всего)</div>'),
    ('<div class="stat-label">Переходов из Telegram</div>', '<div class="stat-label">Заходов с utm_source=telegram (всё время)</div>'),
    ('<div class="stat-label">Сохранено закладок</div>', '<div class="stat-label">Сохранено закладок (всего)</div>'),
    ('<p class="chart-title">Просмотры по дням</p>', '<p class="chart-title">Просмотры по дням (за выбранный период)</p>'),
    ('<p class="chart-title">Регистрации по дням</p>', '<p class="chart-title">Регистрации по дням (за выбранный период)</p>'),
    ('<p class="chart-title">Популярность книг</p>', '<p class="chart-title">Популярность книг (всё время)</p>'),
    ('<p class="chart-title">Устройства читателей</p>', '<p class="chart-title">Устройства читателей (всё время)</p>'),
    ('<p class="chart-title">Топ глав по просмотрам</p>', '<p class="chart-title">Топ глав по просмотрам (всё время)</p>'),
]


def main() -> int:
    for f in (SERVER, PAGE):
        if not f.exists():
            print(f"Не найден файл: {f.resolve()}\nЗапустите скрипт из корня проекта.")
            return 1

    # --- server.js ---
    s = SERVER.read_text(encoding="utf-8")
    changed = False
    if "no_track=1(?:;|$)/.test(req.headers.cookie || '')) return;" in s:
        print("server.js: пропуск логирования уже есть")
    elif S_LOG_OLD in s:
        s = s.replace(S_LOG_OLD, S_LOG_NEW, 1); changed = True
        print("server.js: добавлен пропуск логирования для no_track")
    else:
        print("server.js: не нашёл блок логирования просмотров. Ничего не изменено.")
        return 1
    if S_ROUTES_MARK in s:
        print("server.js: маршруты no-track уже есть")
    elif S_ROUTES_ANCHOR in s:
        s = s.replace(S_ROUTES_ANCHOR, S_ROUTES_NEW + S_ROUTES_ANCHOR, 1); changed = True
        print("server.js: добавлены маршруты /api/admin/no-track")
    else:
        print("server.js: не нашёл место для маршрутов. Ничего не изменено.")
        return 1
    if changed:
        SERVER.write_text(s, encoding="utf-8")

    # --- analytics.html ---
    p = PAGE.read_text(encoding="utf-8")
    pchanged = False
    if 'id="no-track-btn"' in p:
        print("analytics.html: кнопка уже есть")
    elif BTN_OLD in p:
        p = p.replace(BTN_OLD, BTN_NEW, 1); pchanged = True
        print("analytics.html: добавлена кнопка")
    else:
        print("analytics.html: не нашёл кнопку «Обновить». Страница не изменена.")
        return 1
    if JS_MARK + "'" in p or "getElementById('no-track-btn')" in p:
        print("analytics.html: скрипт кнопки уже есть")
    elif JS_ANCHOR in p:
        p = p.replace(JS_ANCHOR, JS_NEW, 1); pchanged = True
        print("analytics.html: добавлен скрипт кнопки")
    else:
        print("analytics.html: не нашёл analyticsHeaders. Страница не изменена.")
        return 1
    for old, new in LABELS:
        if new in p:
            continue
        if old in p:
            p = p.replace(old, new, 1); pchanged = True
        else:
            print(f"  (подпись не найдена, пропущена: {old[:55]}…)")
    if pchanged:
        PAGE.write_text(p, encoding="utf-8")
    print("Готово. Перезапустите сервер (server.js изменён).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
