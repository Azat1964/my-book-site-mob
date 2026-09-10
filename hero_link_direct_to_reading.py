#!/usr/bin/env python3
"""
hero_link_direct_to_reading.py — упрощает ссылку с главного квадрата на
index.html: клик теперь всегда ведёт прямо на страницу чтения романа
"Чистория" (./contents.html?book=chistoriya), без прежней развилки
"до/после премьеры".

Использование:
    python3 hero_link_direct_to_reading.py /path/to/my-book-site-mob

Если путь не передан, скрипт ищет папку public/ в текущей директории.
Идемпотентен — повторный запуск ничего не ломает.
"""

import re
import sys
import pathlib


NEW_FUNC = '''(function initHeroLink() {
      const heroMain = document.querySelector('.hero-main');
      if (!heroMain) return;

      function goToBook() {
        window.location.href = './contents.html?book=chistoriya';
      }

      heroMain.addEventListener('click', goToBook);
      heroMain.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          goToBook();
        }
      });
    })();'''

# Ловим саму IIFE initHeroLink от "(function initHeroLink() {" до первого
# "})();" после неё — этого достаточно, потому что все вложенные колбэки
# внутри неё закрываются на "});", а не "})();". Работает независимо от
# того, какая версия функции сейчас в файле (старая "Тёмный Восход",
# промежуточная с проверкой времени премьеры, или уже новая).
FUNC_RE = re.compile(r"\(function initHeroLink\(\) \{.*?\n {4}\}\)\(\);", re.DOTALL)


def patch_index_html(public_dir: pathlib.Path) -> bool:
    path = public_dir / "index.html"
    if not path.exists():
        print(f"[FAIL] не найден файл {path}")
        return False

    text = path.read_text(encoding="utf-8")

    if NEW_FUNC in text:
        print("  [skip] index.html: клик по карточке — похоже, патч уже применён")
        return True

    match = FUNC_RE.search(text)
    if not match:
        print("  [FAIL] index.html: не нашёл функцию initHeroLink() — "
              "структура файла отличается сильнее ожидаемого, нужна ручная правка")
        return False

    text = text[:match.start()] + NEW_FUNC + text[match.end():]
    path.write_text(text, encoding="utf-8")
    print("  [ok]   index.html: клик по карточке ведёт напрямую на contents.html?book=chistoriya")
    return True


def find_public_dir(start: pathlib.Path) -> pathlib.Path:
    if (start / "index.html").exists():
        return start
    if (start / "public" / "index.html").exists():
        return start / "public"
    return start


def main() -> int:
    root = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path.cwd()
    public_dir = find_public_dir(root)

    print(f"Применяю патч к: {public_dir}\n")
    ok = patch_index_html(public_dir)

    print()
    if ok:
        print("Готово: изменения применены успешно.")
        return 0
    else:
        print("Есть ошибки выше — часть изменений не применена.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
