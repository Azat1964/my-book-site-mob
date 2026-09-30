#!/usr/bin/env python3
"""
Патч: на графиках в public/analytics.html подписи дат по оси X показывали
не "09-17", а "09-17T00:00:00.000Z".

Причина: Postgres возвращает колонку DATE как объект даты, а node-postgres
+ res.json() сериализуют её в полную ISO-строку с временем
("2026-09-17T00:00:00.000Z"), а не просто "2026-09-17". Код на фронтенде
брал `r.day?.slice(5)` — "с 5-го символа и до конца строки", что для
короткой даты давало "09-17", а для полной ISO-строки — "09-17T00:00:00.000Z".

Исправление: `.slice(5, 10)` вместо `.slice(5)` — берёт РОВНО 5 символов
(индексы 5–9), что даёт "09-17" в обоих случаях, независимо от того,
короткая это дата или полная ISO-строка с временем.

Правит все три места, где строится подпись даты для графика (общий график
просмотров, график регистраций, график по конкретной главе/книге).

Запуск из корня проекта:
    python3 patch_fix_chart_date_labels.py
"""

import pathlib
import sys

TARGET = pathlib.Path("public/analytics.html")

OLD = "r.day?.slice(5)"
NEW = "r.day?.slice(5, 10)"


def main() -> int:
    if not TARGET.exists():
        print(f"Не найден файл: {TARGET.resolve()}")
        print("Запустите скрипт из корня проекта (там, где лежит папка public/).")
        return 1

    text = TARGET.read_text(encoding="utf-8")

    count_old = text.count(OLD)
    count_new_already = text.count(NEW)

    if count_old == 0:
        if count_new_already > 0:
            print(f"Похоже, патч уже применён: {TARGET}")
            return 0
        print(f"Не нашёл ожидаемый фрагмент '{OLD}' в {TARGET}.")
        print("Возможно, файл уже менялся. Патч не применён, ничего не тронуто.")
        return 1

    text = text.replace(OLD, NEW)
    TARGET.write_text(text, encoding="utf-8")
    print(f"Готово: {TARGET} — исправлено мест: {count_old} (даты теперь вида «09-17»)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
