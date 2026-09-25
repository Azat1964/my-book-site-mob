#!/usr/bin/env python3
"""
Патч: меняет текст плашки в конце главы (Telegram-подписка) с "Дочитали?
Новые книги выходят в Telegram первыми" на "Дочитали? Следующая глава
выходит в Telegram первой".

Почему это важно:
  Читатель только что закончил главу и хочет знать одно: когда выйдет
  СЛЕДУЮЩАЯ ГЛАВА этой же книги. Прежний текст говорил про "новые книги" —
  то есть будущие произведения автора вообще, а не продолжение того, что
  человек только что читал. Формально это не ложь (продолжение тоже придёт
  через тот же канал), но с точки зрения читателя это не отвечает на его
  вопрос в моменте — отсюда, вероятно, и почти нулевая конверсия в
  подписку (аналитика показывает 7136 просмотров глав и 0 переходов из
  Telegram за месяц).

Меняет текст в обоих файлах — desktop (book.html) и мобильном
(book_mob.html) читалках, там, где он идентичен.

Запуск из корня проекта:
    python3 patch_chapter_end_cta_wording.py
"""

import pathlib
import sys

TARGETS = [
    pathlib.Path("public/book.html"),
    pathlib.Path("public/book_mob.html"),
]

OLD = 'Дочитали? Новые книги выходят в Telegram первыми'
NEW = 'Дочитали? Следующая глава выходит в Telegram первой'


def main() -> int:
    any_missing = False
    already_all = True

    for target in TARGETS:
        if not target.exists():
            print(f"Не найден файл: {target.resolve()}")
            any_missing = True
            continue

        text = target.read_text(encoding="utf-8")
        if OLD in text:
            already_all = False

    if any_missing:
        print("Запустите скрипт из корня проекта (там, где лежит папка public/).")
        return 1

    if already_all:
        print("Похоже, патч уже применён во всех файлах.")
        return 0

    for target in TARGETS:
        text = target.read_text(encoding="utf-8")
        if OLD not in text:
            if NEW in text:
                print(f"Уже применено: {target}")
                continue
            print(f"Не нашёл ожидаемый текст в {target} — возможно, файл менялся. Пропускаю.")
            continue
        text = text.replace(OLD, NEW)
        target.write_text(text, encoding="utf-8")
        print(f"Готово: {target}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
