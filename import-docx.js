// Скрипт для разовой загрузки текста главы из .docx прямо в базу данных,
// минуя ручной ввод через admin.html. Полезно, когда у вас уже готовый .docx-файл романа.
//
// УСТАНОВКА (если ещё не установлено):
//   npm install
//
// ИСПОЛЬЗОВАНИЕ:
//   node import-docx.js <slug-книги> <номер-главы> <путь-к-файлу.docx> ["Заголовок главы"]
//
// ПРИМЕР:
//   node import-docx.js temny-voskhod 1 ./romans/glava1.docx "Глава первая. Толян и курица гриль"
//
// Перед использованием убедитесь, что книга с таким slug уже создана через admin.html
// (или вручную через INSERT INTO books ... — см. db/schema.sql)

require('dotenv').config();
const fs = require('fs');
const mammoth = require('mammoth');
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'your_db_name',
  password: process.env.DB_PASSWORD || 'your_db_password',
  port: process.env.DB_PORT || 5432,
});

async function main() {
  const [slug, chapterNumberRaw, docxPath, titleArg] = process.argv.slice(2);

  if (!slug || !chapterNumberRaw || !docxPath) {
    console.error('Использование: node import-docx.js <slug-книги> <номер-главы> <путь-к-файлу.docx> ["Заголовок"]');
    process.exit(1);
  }

  const chapterNumber = parseInt(chapterNumberRaw, 10);
  if (isNaN(chapterNumber)) {
    console.error('Номер главы должен быть числом.');
    process.exit(1);
  }

  if (!fs.existsSync(docxPath)) {
    console.error(`Файл не найден: ${docxPath}`);
    process.exit(1);
  }

  console.log(`Читаю файл ${docxPath}...`);

  // Извлекаем чистый текст из .docx (без сложного форматирования Word)
  const result = await mammoth.extractRawText({ path: docxPath });
  const content = result.value.trim();

  if (result.messages.length > 0) {
    console.log('Предупреждения mammoth при конвертации:', result.messages);
  }

  if (!content) {
    console.error('Не удалось извлечь текст из файла — он пустой?');
    process.exit(1);
  }

  console.log(`Текст извлечён: ${content.length} символов.`);

  try {
    const bookResult = await pool.query('SELECT id, title FROM books WHERE slug = $1', [slug]);
    if (bookResult.rows.length === 0) {
      console.error(`Книга со slug "${slug}" не найдена. Сначала создайте её через admin.html.`);
      process.exit(1);
    }
    const bookId = bookResult.rows[0].id;
    const bookTitle = bookResult.rows[0].title;

    await pool.query(
      `INSERT INTO chapters (book_id, chapter_number, title, content)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (book_id, chapter_number)
       DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content, published_at = NOW()`,
      [bookId, chapterNumber, titleArg || null, content]
    );

    console.log(`✅ Глава ${chapterNumber} книги «${bookTitle}» успешно загружена в базу.`);
  } catch (error) {
    console.error('Ошибка записи в базу данных:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
