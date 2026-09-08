#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Исправление сворачивания плашки отзыва:
- разворачивание вешаем ТОЛЬКО на свёрнутую полоску (.collapsed-bar),
  а не на весь контейнер (раньше клик по ✕ всплывал и разворачивал обратно);
- кнопка ✕ сворачивает и гасит всплытие клика (stopPropagation).

Запуск из корня проекта:
    python3 patch_collapse_fix.py
"""
import sys, os

PATH = sys.argv[1] if len(sys.argv) > 1 else os.path.join('public', 'book.html')

OLD_JS = '''        function hideChapterEndPrompt() {
          // Не прячем полностью, а сворачиваем в узкую полоску,
          // чтобы плашка не загораживала текст, но оставалась доступной.
          chapterEndPrompt.classList.add('collapsed');
        }
        // Клик по свёрнутой полоске — разворачивает плашку обратно.
        chapterEndPrompt.addEventListener('click', function (e) {
          if (chapterEndPrompt.classList.contains('collapsed')) {
            chapterEndPrompt.classList.remove('collapsed');
          }
        });'''

NEW_JS = '''        function hideChapterEndPrompt(e) {
          if (e) { e.stopPropagation(); }
          // Не прячем полностью, а сворачиваем в узкую полоску,
          // чтобы плашка не загораживала текст, но оставалась доступной.
          chapterEndPrompt.classList.add('collapsed');
        }
        // Разворачивание — только по клику на саму свёрнутую полоску.
        var chapterEndCollapsedBar = chapterEndPrompt.querySelector('.collapsed-bar');
        if (chapterEndCollapsedBar) {
          chapterEndCollapsedBar.addEventListener('click', function (e) {
            e.stopPropagation();
            chapterEndPrompt.classList.remove('collapsed');
          });
        }'''

def main():
    if not os.path.isfile(PATH):
        print(f'❌ Файл не найден: {PATH}'); sys.exit(1)
    with open(PATH, 'r', encoding='utf-8') as f:
        c = f.read()

    if 'chapterEndCollapsedBar' in c:
        print('ℹ Исправление уже применено — пропуск.'); return
    if OLD_JS not in c:
        print('⚠ Не найден блок для замены. Сначала примените patch_collapse.py.'); sys.exit(1)

    c = c.replace(OLD_JS, NEW_JS, 1)
    with open(PATH, 'w', encoding='utf-8') as f:
        f.write(c)
    print('✅ Готово. Сворачивание/разворачивание исправлено.')
    print('   Обновите страницу главы (Cmd+Shift+R).')

if __name__ == '__main__':
    main()
