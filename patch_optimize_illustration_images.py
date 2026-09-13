#!/usr/bin/env python3
"""
Патч: сжимает иллюстрации глав (public/img/illustrations/**) до реального
размера показа на странице.

Почему это ускоряет загрузку в 10 секунд на мобильной версии:
  В book_mob.html картинки главы вставляются как <img class="chapter-illustration">
  с CSS max-width: 190px (мобильная версия) / 220px (десктоп). Но реальные
  файлы на диске — фотографии в разрешении вплоть до 4898×3265 (см. пример
  ниже). Перед показом ПЕРВОЙ страницы главы код (buildMobilePages →
  preloadImages) намеренно ждёт img.decode() для ВСЕХ иллюстраций главы срузу —
  это нужно, чтобы верно посчитать разбивку на страницы (иначе картинка без
  декодированных размеров "плывёт", и текст съезжает). На слабом мобильном
  процессоре декодирование нескольких многомегапиксельных фото — и есть
  основной источник тех самых 10 секунд ожидания.

  Сами файлы физически показываются на экране максимум в ~190-220px — то есть
  99% пикселей в оригинале декодируются и тут же выбрасываются. Уменьшение
  файла до реального размера показа (с запасом на Retina-экраны) сохраняет
  внешний вид один в один, но сокращает время decode() и вес самого файла
  на порядок.

  Пример из этого проекта:
    img/illustrations/Tyumny_voshod/glava20.webp: 4898×3265, 415 КБ
    после сжатия:                                  700×467,   ~11 КБ

Что делает скрипт:
  Проходит по public/img/illustrations/**/*.{webp,png,jpg,jpeg}, и для каждого
  файла, у которого большая сторона больше MAX_DIM пикселей, уменьшает его
  с сохранением пропорций до MAX_DIM и пересохраняет В ТОМ ЖЕ формате и по
  тому же пути (с разумным качеством сжатия). Файлы, которые уже меньше
  MAX_DIM, не трогает — повторный запуск ничего не ломает и не пережимает.

  MAX_DIM = 700px выбран с запасом (более чем 3x от 220px максимального
  показа) — под Retina/2x-3x экраны, чтобы иллюстрации не потеряли резкость.

ВАЖНО:
  - Скрипт перезаписывает файлы на диске. Если проект под git — совершенно
    нормально закоммитить "до" перед запуском, чтобы при желании откатить.
  - Требуется Pillow: pip install pillow (если ещё не установлен — скрипт
    подскажет команду и остановится, ничего не тронув).

Запуск из корня проекта:
    python3 patch_optimize_illustration_images.py
"""

import pathlib
import sys

MAX_DIM = 700  # px, по длинной стороне — см. обоснование выше
EXTS = {".webp", ".png", ".jpg", ".jpeg"}
ROOT = pathlib.Path("public/img/illustrations")


def main() -> int:
    try:
        from PIL import Image
    except ImportError:
        print("Нужна библиотека Pillow. Установите и запустите снова:")
        print("    pip install pillow")
        return 1

    if not ROOT.exists():
        print(f"Не найдена папка: {ROOT.resolve()}")
        print("Запустите скрипт из корня проекта (там, где лежит папка public/).")
        return 1

    files = [p for p in ROOT.rglob("*") if p.suffix.lower() in EXTS]
    if not files:
        print(f"В {ROOT} не нашлось изображений — нечего делать.")
        return 0

    total_before = 0
    total_after = 0
    changed = 0
    skipped = 0
    failed = []

    for path in sorted(files):
        size_before = path.stat().st_size
        total_before += size_before
        try:
            with Image.open(path) as im:
                w, h = im.size
                if max(w, h) <= MAX_DIM:
                    skipped += 1
                    total_after += size_before
                    continue

                scale = MAX_DIM / max(w, h)
                new_size = (max(1, round(w * scale)), max(1, round(h * scale)))

                fmt = im.format  # сохраняем оригинальный формат (WEBP/PNG/JPEG)
                original_mode = im.mode
                resized = im.convert("RGBA") if im.mode in ("P", "LA") else im.copy()
                resized = resized.resize(new_size, Image.LANCZOS)

                save_kwargs = {}
                if fmt == "WEBP":
                    save_kwargs = {"quality": 82, "method": 6}
                elif fmt == "JPEG":
                    if resized.mode == "RGBA":
                        resized = resized.convert("RGB")
                    save_kwargs = {"quality": 85, "optimize": True}
                elif fmt == "PNG":
                    # Палитровые PNG (mode "P", часто простые иллюстрации/иконки
                    # с прозрачностью) после resize() в RGBA становятся полноцветным
                    # PNG без палитры — файл может ВЫРАСТИ в несколько раз, хотя
                    # пикселей стало меньше. Возвращаем в палитровый режим —
                    # это восстанавливает компактность оригинала.
                    if original_mode == "P":
                        resized = resized.quantize(colors=256, method=Image.FASTOCTREE)
                    save_kwargs = {"optimize": True}

                resized.save(path, format=fmt, **save_kwargs)

            size_after = path.stat().st_size
            total_after += size_after
            changed += 1
            print(
                f"{path}: {w}x{h} ({size_before/1024:.0f} КБ) "
                f"-> {new_size[0]}x{new_size[1]} ({size_after/1024:.0f} КБ)"
            )
        except Exception as err:
            failed.append((path, err))
            total_after += size_before

    print()
    print(f"Изменено файлов: {changed}, пропущено (уже маленькие): {skipped}")
    if failed:
        print(f"Не удалось обработать: {len(failed)}")
        for path, err in failed:
            print(f"  {path}: {err}")
    print(
        f"Общий вес иллюстраций: {total_before/1024/1024:.2f} МБ "
        f"-> {total_after/1024/1024:.2f} МБ "
        f"(экономия {(1 - total_after/total_before)*100:.0f}%)"
        if total_before else "Нечего сравнивать."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
