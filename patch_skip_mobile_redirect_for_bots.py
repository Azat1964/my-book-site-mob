#!/usr/bin/env python3
"""
Патч: Google Search Console помечал страницы book.html (те самые, что
указаны в sitemap.xml) как "Ложная ошибка 404". Причина — собственный
JS-редирект на мобильную версию.

Как это ломалось:
  book.html при узком экране (<=768px) делает window.location.replace()
  на book_mob.html — это удобно для живых читателей, но Googlebot для
  смартфонов тоже симулирует узкий экран, выполняет тот же JS и в итоге
  вместо адреса из sitemap.xml (book.html) оказывается на book_mob.html —
  странице, которой нет ни в sitemap, ни в ссылках сайта. Google расценивает
  это как подозрительный увод с заявленного URL и помечает исходную
  страницу как "не найдена", хотя на самом деле контент на месте.

Что делает патч:
  Редирект на book_mob.html теперь пропускается для известных поисковых
  роботов (определяются по navigator.userAgent: Googlebot, YandexBot,
  Bingbot и т.п.) — они остаются на book.html и корректно индексируют его
  содержимое (сама книга при этом прекрасно открывается и читается на
  book.html, страница полностью рабочая — редирект был нужен только ради
  более удобного мобильного UI для живых людей, а не для того, чтобы
  контент вообще открывался). Живые посетители с мобильных устройств
  продолжают уходить на book_mob.html как раньше — для них ничего не
  меняется.

Запуск из корня проекта:
    python3 patch_skip_mobile_redirect_for_bots.py
"""

import pathlib
import sys

TARGET = pathlib.Path("public/book.html")

OLD = """      <script>
        // Узкий экран — у нас для него отдельная страница (book_mob.html)
        // с однострочным чтением и свайпом, а не разворотом на две страницы.
        if (window.innerWidth <= 768) {
          window.location.replace('./book_mob.html' + window.location.search);
        }
        // При изменении размера окна — переключаем версию если пересекли порог 768px
        window.addEventListener('resize', (function() {
          let wasMobile = window.innerWidth <= 768;
          return function() {
            const isMobile = window.innerWidth <= 768;
            if (isMobile && !wasMobile) {
              // Окно сузили — уходим на мобильную версию
              window.location.replace('./book_mob.html' + window.location.search);
            }
            wasMobile = isMobile;
          };
        })());"""

NEW = """      <script>
        // Узкий экран — у нас для него отдельная страница (book_mob.html)
        // с однострочным чтением и свайпом, а не разворотом на две страницы.
        // ВАЖНО: поисковых роботов (Googlebot для смартфонов и т.п.) сюда
        // не пускаем — они тоже симулируют узкий экран, и редирект уводил
        // их на book_mob.html, которого нет в sitemap.xml. Google расценивал
        // это как увод с заявленного адреса и помечал book.html как
        // "Ложная ошибка 404", хотя книга прекрасно читается и на book.html —
        // для ботов редирект просто не нужен, страница и так рабочая.
        var isCrawlerBot = /bot|crawl|spider|slurp|mediapartners/i.test(navigator.userAgent);
        if (!isCrawlerBot && window.innerWidth <= 768) {
          window.location.replace('./book_mob.html' + window.location.search);
        }
        // При изменении размера окна — переключаем версию если пересекли порог 768px
        if (!isCrawlerBot) {
          window.addEventListener('resize', (function() {
            let wasMobile = window.innerWidth <= 768;
            return function() {
              const isMobile = window.innerWidth <= 768;
              if (isMobile && !wasMobile) {
                // Окно сузили — уходим на мобильную версию
                window.location.replace('./book_mob.html' + window.location.search);
              }
              wasMobile = isMobile;
            };
          })());
        }"""


def main() -> int:
    if not TARGET.exists():
        print(f"Не найден файл: {TARGET.resolve()}")
        print("Запустите скрипт из корня проекта (там, где лежит папка public/).")
        return 1

    text = TARGET.read_text(encoding="utf-8")

    if NEW in text and OLD not in text:
        print(f"Похоже, патч уже применён: {TARGET}")
        return 0

    if OLD not in text:
        print(f"Не нашёл ожидаемый фрагмент в {TARGET}.")
        print("Возможно, файл уже менялся. Патч не применён, ничего не тронуто.")
        return 1

    text = text.replace(OLD, NEW, 1)
    TARGET.write_text(text, encoding="utf-8")
    print(f"Готово: {TARGET} — редирект на book_mob.html пропускается для поисковых роботов")
    return 0


if __name__ == "__main__":
    sys.exit(main())
