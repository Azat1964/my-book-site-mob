#!/usr/bin/env python3
"""
Патч: расширяет определение поисковых роботов в public/book.html, чтобы
редирект на book_mob.html не срабатывал и для инструмента проверки URL
Google Search Console.

Причина: тест "Проверить опубликованную страницу" в GSC ходит с User-Agent
"...(compatible; Google-InspectionTool/1.0)" — слова "bot" там нет, прежний
фильтр /bot|crawl|spider|slurp|mediapartners/ его не узнавал, и страница
уходила на book_mob.html (в GSC видно: канонический адрес = book_mob.html,
статус "Ложная ошибка 404"). Теперь фильтр узнаёт Google (любые его
инструменты: Googlebot, InspectionTool, Google-Read-Aloud, Storebot...),
Lighthouse/PageSpeed и бота Яндекса/Bing.

Требует, чтобы был применён patch_skip_mobile_redirect_for_bots.py.

Запуск из корня проекта:
    python3 patch_bot_regex_google_inspection.py
"""
import pathlib
import sys

TARGET = pathlib.Path("public/book.html")
OLD = "/bot|crawl|spider|slurp|mediapartners/i.test(navigator.userAgent)"
NEW = "/bot|crawl|spider|slurp|mediapartners|google|inspection|lighthouse|yandex|bing/i.test(navigator.userAgent)"


def main() -> int:
    if not TARGET.exists():
        print(f"Не найден файл: {TARGET.resolve()}\nЗапустите скрипт из корня проекта.")
        return 1
    text = TARGET.read_text(encoding="utf-8")
    if NEW in text:
        print(f"Похоже, патч уже применён: {TARGET}")
        return 0
    if OLD not in text:
        print("Не нашёл isCrawlerBot в book.html. Сначала примените "
              "patch_skip_mobile_redirect_for_bots.py. Ничего не изменено.")
        return 1
    TARGET.write_text(text.replace(OLD, NEW, 1), encoding="utf-8")
    print(f"Готово: {TARGET} — список роботов расширен")
    return 0


if __name__ == "__main__":
    sys.exit(main())
