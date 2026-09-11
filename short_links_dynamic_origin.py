#!/usr/bin/env python3
"""
short_links_dynamic_origin.py — заменяет захардкоженный домен "booklo.ru"
в разделе "Короткие ссылки" (public/js/admin.js) на текущий адрес страницы
(window.location). Без этого при тестировании на localhost:3000 таблица
показывала ссылки вида booklo.ru/код, клик по которым уводил на настоящий
боевой сайт вместо localhost — отсюда была ошибка "Cannot GET /код".

Правит три места: ссылку в таблице, сообщение об успешном создании и
текст подтверждения перед удалением.

Использование:
    python3 short_links_dynamic_origin.py /path/to/my-book-site-mob

Если путь не передан, скрипт ищет папку public/ в текущей директории.
Идемпотентен — повторный запуск ничего не ломает.
"""

import sys
import pathlib


OLD_TABLE_LINK = '<a href="https://booklo.ru/${escapeHtml(link.code)}" target="_blank" style="color:#c9a227;">\n            booklo.ru/${escapeHtml(link.code)}\n          </a>'
NEW_TABLE_LINK = '<a href="${window.location.origin}/${escapeHtml(link.code)}" target="_blank" style="color:#c9a227;">\n            ${window.location.host}/${escapeHtml(link.code)}\n          </a>'
OLD_SUCCESS_MSG = 'statusMsg.textContent = `Готово: booklo.ru/${data.code} → ${data.target_url}`;'
NEW_SUCCESS_MSG = 'statusMsg.textContent = `Готово: ${window.location.host}/${data.code} → ${data.target_url}`;'
OLD_CONFIRM_MSG = 'if (!window.confirm(`Удалить короткую ссылку booklo.ru/${code}?`)) return;'
NEW_CONFIRM_MSG = 'if (!window.confirm(`Удалить короткую ссылку ${window.location.host}/${code}?`)) return;'


def patch_admin_js(public_dir: pathlib.Path) -> bool:
    path = public_dir / "js" / "admin.js"
    if not path.exists():
        print(f"[FAIL] не найден файл {path}")
        return False

    text = path.read_text(encoding="utf-8")

    if NEW_TABLE_LINK in text and NEW_SUCCESS_MSG in text and NEW_CONFIRM_MSG in text:
        print("  [skip] admin.js: короткие ссылки уже используют текущий адрес — патч уже применён")
        return True

    missing = []
    if OLD_TABLE_LINK not in text:
        missing.append("ссылку в таблице")
    if OLD_SUCCESS_MSG not in text:
        missing.append("сообщение об успехе")
    if OLD_CONFIRM_MSG not in text:
        missing.append("подтверждение удаления")

    if missing:
        print(f"  [FAIL] admin.js: не нашёл в файле: {', '.join(missing)} — "
              f"структура файла отличается сильнее ожидаемого, нужна ручная правка")
        return False

    text = text.replace(OLD_TABLE_LINK, NEW_TABLE_LINK, 1)
    text = text.replace(OLD_SUCCESS_MSG, NEW_SUCCESS_MSG, 1)
    text = text.replace(OLD_CONFIRM_MSG, NEW_CONFIRM_MSG, 1)

    path.write_text(text, encoding="utf-8")
    print("  [ok]   admin.js: короткие ссылки теперь используют текущий адрес "
          "(localhost при тестировании, booklo.ru на боевом сайте)")
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
    ok = patch_admin_js(public_dir)

    print()
    if ok:
        print("Готово: изменения применены успешно.")
        return 0
    else:
        print("Есть ошибки выше — часть изменений не применена.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
