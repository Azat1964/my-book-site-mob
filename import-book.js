// Универсальный скрипт массовой загрузки целой книги в базу данных.
// Поддерживает ДВА режима — выбирайте тот, что подходит конкретной книге.
//
// (Логика разбивки на главы вынесена в lib/chapterSplitter.js — её же использует
// форма массовой загрузки в admin.html, чтобы оба способа работали одинаково.)
//
// ──────────────────────────────────────────────────────────────────
// РЕЖИМ 1: отдельный файл .docx на каждую главу (самый надёжный способ)
// ──────────────────────────────────────────────────────────────────
//   node import-book.js <slug> --folder <путь-к-папке>
//
// Номер главы script берёт из ЦИФР в названии файла:
//   глава-1.docx, глава-2.docx ...      → главы 1, 2 ...
//   ch01.docx, ch02.docx ...            → главы 1, 2 ...
//   01.docx, 02.docx ...                → главы 1, 2 ...
// Файлы без цифр в названии — пропускаются с предупреждением.
//
// Сначала проверьте разбивку без записи в базу:
//   node import-book.js <slug> --folder <путь-к-папке> --preview
//
// ──────────────────────────────────────────────────────────────────
// РЕЖИМ 2: один .docx файл со всей книгой — авто-разбивка по заголовкам глав
// ──────────────────────────────────────────────────────────────────
//   node import-book.js <slug> --file <путь-к-файлу.docx> --preview
//
// ──────────────────────────────────────────────────────────────────
// РЕЖИМ 3 (САМЫЙ НАДЁЖНЫЙ): один файл с романом + список заголовков глав
// ──────────────────────────────────────────────────────────────────
//   node import-book.js <slug> --file <роман.docx> --toc <содержание.txt> [--preview]
//
// Подготовьте файл toc.txt — список заголовков глав, по одному на строку, точно
// как они написаны в самом романе. Скрипт находит каждый заголовок в тексте и
// берёт всё, что между ними, как текст главы.
//
// 💡 Совет: то же самое (включая режим "по списку заголовков") теперь можно
// делать прямо в браузере — откройте /admin.html, раздел «Загрузить книгу
// целиком», без необходимости работать в терминале.
//
// ПРИМЕРЫ:
//   node import-book.js temny-voskhod --folder ./romans/temny-voskhod --preview
//   node import-book.js temny-voskhod --folder ./romans/temny-voskhod
//   node import-book.js nemaya-rybka --file ./romans/nemaya-rybka.docx --preview
//   node import-book.js nemaya-rybka --file ./romans/nemaya-rybka.docx

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const { Pool } = require('pg');
const { splitByAutoHeadings, splitByToc } = require('./lib/chapterSplitter');

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'your_db_name',
  password: process.env.DB_PASSWORD || 'your_db_password',
  port: process.env.DB_PORT || 5432,
});

function extractChapterNumberFromFilename(filename) {
  const match = filename.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

async function getBookId(slug) {
  const result = await pool.query('SELECT id, title FROM books WHERE slug = $1', [slug]);
  if (result.rows.length === 0) {
    console.error(`❌ Книга со slug "${slug}" не найдена. Сначала создайте её через /admin.html.`);
    process.exit(1);
  }
  return result.rows[0];
}

async function saveChapter(bookId, number, title, content) {
  await pool.query(
    `INSERT INTO chapters (book_id, chapter_number, title, content)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (book_id, chapter_number)
     DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content, published_at = NOW()`,
    [bookId, number, title, content]
  );
}

// ──────────────────────────────────────────────────────────────────
// РЕЖИМ 1: папка с отдельными файлами-главами
// ──────────────────────────────────────────────────────────────────
async function runFolderMode(slug, folderPath, preview) {
  const files = fs.readdirSync(folderPath).filter(f => f.toLowerCase().endsWith('.docx'));
  if (files.length === 0) {
    console.error(`В папке "${folderPath}" не найдено файлов .docx`);
    process.exit(1);
  }

  const items = [];
  for (const file of files) {
    const num = extractChapterNumberFromFilename(file);
    if (num === null) {
      console.warn(`⚠️  Пропущен (нет цифры в названии): ${file}`);
      continue;
    }
    items.push({ file, num });
  }

  items.sort((a, b) => a.num - b.num);

  console.log(`\nНайдено глав: ${items.length}\n`);
  items.forEach(({ file, num }) => console.log(`  Глава ${num}  ←  ${file}`));

  if (preview) {
    console.log('\n👀 Это режим предпросмотра — в базу ничего не записано.');
    console.log('Если разбивка верна, запустите ту же команду без --preview.\n');
    return;
  }

  const book = await getBookId(slug);
  console.log(`\nЗагружаю в книгу «${book.title}»...\n`);

  for (const { file, num } of items) {
    const fullPath = path.join(folderPath, file);
    const result = await mammoth.extractRawText({ path: fullPath });
    const content = result.value.trim();
    if (!content) {
      console.warn(`⚠️  Глава ${num} (${file}) — пустой текст, пропущена.`);
      continue;
    }
    await saveChapter(book.id, num, null, content);
    console.log(`✅ Глава ${num} сохранена (${content.length} символов)`);
  }

  console.log(`\n🎉 Готово! Все главы загружены.`);
  console.log(`Содержание книги: http://localhost:3000/contents.html?book=${slug}`);
}

// ──────────────────────────────────────────────────────────────────
// РЕЖИМ 2: один файл — авто-разбивка по заголовкам (через общий модуль)
// ──────────────────────────────────────────────────────────────────
async function runFileMode(slug, filePath, preview) {
  if (!fs.existsSync(filePath)) {
    console.error(`Файл не найден: ${filePath}`);
    process.exit(1);
  }

  const result = await mammoth.extractRawText({ path: filePath });
  const chapters = splitByAutoHeadings(result.value);

  if (chapters.length === 0) {
    console.error('\n❌ Не удалось найти ни одного заголовка главы в этом файле.');
    console.error('Похоже, главы помечены не стандартным образом ("Глава 1", "Глава первая" и т.п.).');
    console.error('Решение: используйте режим --toc (список заголовков) или --folder.\n');
    process.exit(1);
  }

  console.log(`\nНайдено глав: ${chapters.length}\n`);
  chapters.forEach(ch => {
    const previewText = ch.content.slice(0, 60).replace(/\n/g, ' ');
    console.log(`  Глава ${ch.number}${ch.title ? ' — ' + ch.title : ''}  (${ch.content.length} симв.)  "${previewText}..."`);
  });

  if (preview) {
    console.log('\n👀 Это режим предпросмотра — в базу ничего не записано.');
    console.log('Проверьте, что номера глав и объём текста выглядят правильно.');
    console.log('Если всё верно — запустите ту же команду без --preview.\n');
    return;
  }

  const book = await getBookId(slug);
  console.log(`\nЗагружаю в книгу «${book.title}»...\n`);

  for (const ch of chapters) {
    await saveChapter(book.id, ch.number, ch.title, ch.content);
    console.log(`✅ Глава ${ch.number} сохранена (${ch.content.length} символов)`);
  }

  console.log(`\n🎉 Готово! Все главы загружены.`);
  console.log(`Содержание книги: http://localhost:3000/contents.html?book=${slug}`);
}

// ──────────────────────────────────────────────────────────────────
// РЕЖИМ 3 (САМЫЙ НАДЁЖНЫЙ): один файл с романом + список заголовков (через общий модуль)
// ──────────────────────────────────────────────────────────────────
async function runFileWithTocMode(slug, filePath, tocPath, preview) {
  if (!fs.existsSync(filePath)) {
    console.error(`Файл романа не найден: ${filePath}`);
    process.exit(1);
  }
  if (!fs.existsSync(tocPath)) {
    console.error(`Файл содержания не найден: ${tocPath}`);
    process.exit(1);
  }

  const tocText = fs.readFileSync(tocPath, 'utf-8');
  const result = await mammoth.extractRawText({ path: filePath });

  let chapters;
  try {
    chapters = splitByToc(result.value, tocText);
  } catch (err) {
    console.error(`\n❌ ${err.message}\n`);
    process.exit(1);
  }

  console.log(`\nНайдено и сопоставлено глав: ${chapters.length}\n`);
  chapters.forEach(ch => {
    const previewText = ch.content.slice(0, 60).replace(/\n/g, ' ');
    console.log(`  Глава ${ch.number} — ${ch.title}  (${ch.content.length} симв.)  "${previewText}..."`);
  });

  if (preview) {
    console.log('\n👀 Это режим предпросмотра — в базу ничего не записано.');
    console.log('Проверьте объём текста каждой главы. Если всё верно — запустите без --preview.\n');
    return;
  }

  const book = await getBookId(slug);
  console.log(`\nЗагружаю в книгу «${book.title}»...\n`);

  for (const ch of chapters) {
    await saveChapter(book.id, ch.number, ch.title, ch.content);
    console.log(`✅ Глава ${ch.number} сохранена (${ch.content.length} символов)`);
  }

  console.log(`\n🎉 Готово! Все главы загружены.`);
  console.log(`Содержание книги: http://localhost:3000/contents.html?book=${slug}`);
}

// ──────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const slug = args[0];
  const preview = args.includes('--preview');
  const folderIdx = args.indexOf('--folder');
  const fileIdx = args.indexOf('--file');
  const tocIdx = args.indexOf('--toc');

  if (!slug || (folderIdx === -1 && fileIdx === -1)) {
    console.log(`
Использование:
  node import-book.js <slug> --folder <папка>                        [--preview]
  node import-book.js <slug> --file <файл.docx> --toc <содержание.txt> [--preview]   ← надёжнее всего
  node import-book.js <slug> --file <файл.docx>                      [--preview]   ← авто-угадывание заголовков

См. подробные примеры в комментариях в начале файла import-book.js
`);
    process.exit(1);
  }

  try {
    if (folderIdx !== -1) {
      await runFolderMode(slug, args[folderIdx + 1], preview);
    } else if (tocIdx !== -1) {
      await runFileWithTocMode(slug, args[fileIdx + 1], args[tocIdx + 1], preview);
    } else {
      await runFileMode(slug, args[fileIdx + 1], preview);
    }
  } finally {
    await pool.end();
  }
}

main();
