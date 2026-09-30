#!/usr/bin/env python3
"""
Патч для public/analytics.html: график по конкретной главе/книге (кнопки
"📈 график" в таблице и кнопки по книгам) теперь открывается во всплывающем
окне поверх страницы, а не в блоке под таблицей — не нужно прокручивать
вниз, чтобы его увидеть.

Закрывается:
  - крестиком в углу окна
  - кликом на затемнённую область вокруг окна
  - клавишей Esc

Требует, чтобы был уже применён patch_per_chapter_book_charts.py — этот
патч меняет тот же файл дальше, беря за основу его результат.

Запуск из корня проекта:
    python3 patch_chart_modal_popup.py
"""

import pathlib
import sys

TARGET = pathlib.Path("public/analytics.html")

CSS_OLD = """    .back-link:hover { text-decoration: underline; }
    #analytics-wrap { display: none; }
  </style>"""

CSS_NEW = """    .back-link:hover { text-decoration: underline; }
    #analytics-wrap { display: none; }

    .chart-modal-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.65);
      z-index: 1000;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .chart-modal-overlay.show { display: flex; }
    .chart-modal-box {
      position: relative;
      background: #1f1b29;
      border-radius: 10px;
      padding: 24px;
      width: 100%;
      max-width: 720px;
      max-height: 85vh;
      overflow-y: auto;
    }
    .chart-modal-close {
      position: absolute;
      top: 10px;
      right: 10px;
      background: transparent;
      color: #e8e8ec;
      border: none;
      font-size: 18px;
      line-height: 1;
      padding: 6px 10px;
      border-radius: 6px;
      cursor: pointer;
    }
    .chart-modal-close:hover { background: rgba(255,255,255,0.08); opacity: 1; }
  </style>"""

HTML_REMOVE_INLINE_OLD = """      <!-- График по выбранной главе или книге — открывается кнопкой "График"
           из таблицы выше или кнопкой по книге целиком ниже. -->
      <div class="chart-box" style="margin-bottom:18px;">
        <p class="chart-title" id="chapterChartTitle">Просмотры по дням — выберите главу в таблице или книгу ниже</p>
        <canvas id="chartChapterDetail"></canvas>
      </div>

      <!-- Кнопки: тот же график, но по книге целиком -->
      <div class="chart-box" style="margin-bottom:18px;">
        <p class="chart-title">График по книге целиком</p>
        <div id="bookChartButtons" style="display:flex;flex-wrap:wrap;gap:8px;"></div>
      </div>"""

HTML_REMOVE_INLINE_NEW = """      <!-- Кнопки: график по книге целиком — сам график открывается
           всплывающим окном (см. #chartModalOverlay в конце файла), не
           требует прокрутки вниз. -->
      <div class="chart-box" style="margin-bottom:18px;">
        <p class="chart-title">График по книге целиком</p>
        <div id="bookChartButtons" style="display:flex;flex-wrap:wrap;gap:8px;"></div>
      </div>"""

HTML_ADD_MODAL_OLD = """    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>"""

HTML_ADD_MODAL_NEW = """    </div>
  </div>

  <!-- Всплывающее окно с графиком по конкретной главе/книге. Открывается
       кнопками из таблицы "Топ глав" и кнопками по книгам. Закрывается
       крестиком, кликом вне окна или Esc (см. JS ниже). -->
  <div id="chartModalOverlay" class="chart-modal-overlay">
    <div class="chart-modal-box">
      <button id="chartModalClose" class="chart-modal-close" aria-label="Закрыть">✕</button>
      <p class="chart-title" id="chapterChartTitle">Просмотры по дням</p>
      <canvas id="chartChapterDetail"></canvas>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>"""

JS_OLD = """    async function loadDetailChart(filterParams, label) {
      const days = document.getElementById('analytics-days').value;
      const qs = new URLSearchParams({ days, ...filterParams }).toString();
      try {
        const data = await fetch(`/api/admin/analytics/views-by-day?${qs}`, { headers: analyticsHeaders() }).then(r => r.json());
        const titleEl = document.getElementById('chapterChartTitle');
        if (titleEl) titleEl.textContent = `Просмотры по дням — ${label}`;
        makeChart('chartChapterDetail', {
          type: 'line',
          data: {
            labels: data.map(r => r.day?.slice(5)),
            datasets: [
              { label: 'Просмотры', data: data.map(r => r.views), borderColor: CHART_COLORS.primaryBorder, backgroundColor: 'rgba(201,162,39,0.15)', tension: 0.35, fill: true },
              { label: 'Уникальные', data: data.map(r => r.unique_readers), borderColor: CHART_COLORS.unique, backgroundColor: 'rgba(100,180,220,0.1)', tension: 0.35, fill: true },
            ],
          },
          options: { ...CHART_DEFAULTS },
        });
      } catch (e) { console.error('detail chart', e); }
    }"""

JS_NEW = """    const chartModalOverlay = document.getElementById('chartModalOverlay');
    function openChartModal() { chartModalOverlay?.classList.add('show'); }
    function closeChartModal() { chartModalOverlay?.classList.remove('show'); }
    document.getElementById('chartModalClose')?.addEventListener('click', closeChartModal);
    // Клик именно по затемнённому фону (не по самому окну с графиком внутри) — закрывает.
    chartModalOverlay?.addEventListener('click', (e) => {
      if (e.target === chartModalOverlay) closeChartModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeChartModal();
    });

    async function loadDetailChart(filterParams, label) {
      const days = document.getElementById('analytics-days').value;
      const qs = new URLSearchParams({ days, ...filterParams }).toString();
      openChartModal();
      try {
        const data = await fetch(`/api/admin/analytics/views-by-day?${qs}`, { headers: analyticsHeaders() }).then(r => r.json());
        const titleEl = document.getElementById('chapterChartTitle');
        if (titleEl) titleEl.textContent = `Просмотры по дням — ${label}`;
        makeChart('chartChapterDetail', {
          type: 'line',
          data: {
            labels: data.map(r => r.day?.slice(5)),
            datasets: [
              { label: 'Просмотры', data: data.map(r => r.views), borderColor: CHART_COLORS.primaryBorder, backgroundColor: 'rgba(201,162,39,0.15)', tension: 0.35, fill: true },
              { label: 'Уникальные', data: data.map(r => r.unique_readers), borderColor: CHART_COLORS.unique, backgroundColor: 'rgba(100,180,220,0.1)', tension: 0.35, fill: true },
            ],
          },
          options: { ...CHART_DEFAULTS },
        });
      } catch (e) { console.error('detail chart', e); }
    }"""

EDITS = [
    (CSS_OLD, CSS_NEW),
    (HTML_REMOVE_INLINE_OLD, HTML_REMOVE_INLINE_NEW),
    (HTML_ADD_MODAL_OLD, HTML_ADD_MODAL_NEW),
    (JS_OLD, JS_NEW),
]

MARKER = "chart-modal-overlay"


def main() -> int:
    if not TARGET.exists():
        print(f"Не найден файл: {TARGET.resolve()}")
        print("Запустите скрипт из корня проекта (там, где лежит папка public/).")
        return 1

    text = TARGET.read_text(encoding="utf-8")

    if MARKER in text:
        print(f"Похоже, патч уже применён: {TARGET}")
        return 0

    for old, new in EDITS:
        if old not in text:
            print("Не нашёл ожидаемый фрагмент в файле:")
            print(old[:200])
            print()
            print("Скорее всего, ещё не применён patch_per_chapter_book_charts.py —")
            print("сначала запустите его, потом этот патч.")
            return 1
        text = text.replace(old, new, 1)

    TARGET.write_text(text, encoding="utf-8")
    print(f"Готово: {TARGET} — график теперь открывается всплывающим окном")
    return 0


if __name__ == "__main__":
    sys.exit(main())
