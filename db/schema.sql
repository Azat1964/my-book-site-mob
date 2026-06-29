-- ============================================================
-- Схема базы данных для my-book-site
-- Запуск: psql -U postgres -d your_db_name -f db/schema.sql
-- ============================================================

-- Пользователи (используется в /api/register, /api/login, /api/bookmark)
-- IF NOT EXISTS — на случай, если таблица уже создана вручную ранее
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  nickname VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  zakladka INTEGER,                 -- старое поле: номер страницы (используется /api/bookmark)
  created_at TIMESTAMP DEFAULT NOW()
);

-- Книги
CREATE TABLE IF NOT EXISTS books (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(255) UNIQUE NOT NULL,     -- "temny-voskhod" — для красивого URL
  title VARCHAR(255) NOT NULL,
  author VARCHAR(255) NOT NULL,
  description TEXT,                       -- аннотация
  cover_image VARCHAR(255),               -- путь к обложке, напр. /img/covers/temny-voskhod.jpg
  genre VARCHAR(255),
  status VARCHAR(50) DEFAULT 'ongoing',   -- ongoing / finished
  free_chapters_limit INTEGER,            -- сколько глав читать без регистрации; NULL = вся книга бесплатно, 0 = вся книга только по регистрации
  created_at TIMESTAMP DEFAULT NOW()
);

-- Если таблица books была создана РАНЬШЕ — добавляем колонку отдельно:
ALTER TABLE books ADD COLUMN IF NOT EXISTS free_chapters_limit INTEGER;

-- Главы
CREATE TABLE IF NOT EXISTS chapters (
  id SERIAL PRIMARY KEY,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_number INTEGER NOT NULL,
  title VARCHAR(255),
  content TEXT NOT NULL,                  -- текст главы
  epigraph TEXT,                          -- эпиграф главы (необязательно)
  illustration VARCHAR(255),              -- путь к рисунку главы (необязательно), заменяет рыбку по умолчанию
  published_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(book_id, chapter_number)
);

-- Если таблица chapters была создана РАНЬШЕ — добавляем колонки отдельно:
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS epigraph TEXT;
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS illustration VARCHAR(255);

-- Прогресс чтения по книгам — закладка привязана к конкретному читателю,
-- хранит главу и позицию ПО СЛОВАМ в тексте главы (не номер страницы!) —
-- это не зависит от размера окна/шрифта читателя, в отличие от номера страницы,
-- который каждый раз пересчитывается по-разному.
CREATE TABLE IF NOT EXISTS reading_progress (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  last_chapter_id INTEGER REFERENCES chapters(id),
  word_offset INTEGER DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, book_id)
);

-- Если таблица была создана раньше без word_offset:
ALTER TABLE reading_progress ADD COLUMN IF NOT EXISTS word_offset INTEGER DEFAULT 0;

-- ============================================================
-- Таблицу "session" для connect-pg-simple обычно НЕ нужно создавать
-- руками — модуль делает это сам при первом запуске сервера.
-- Если по какой-то причине автосоздание не сработало, раскомментируйте:
-- ============================================================
-- CREATE TABLE "session" (
--   "sid" varchar NOT NULL COLLATE "default",
--   "sess" json NOT NULL,
--   "expire" timestamp(6) NOT NULL
-- ) WITH (OIDS=FALSE);
-- ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;

-- ============================================================
-- Пример: добавление первой книги (замените на свои данные)
-- ============================================================
-- INSERT INTO books (slug, title, author, description, genre, status)
-- VALUES (
--   'temny-voskhod',
--   'Тёмный Восход',
--   'Азат Туктаров',
--   'Среди русской зимы на террасе заброшенной профессорской дачи хозяйничает ковбой...',
--   'Городское фэнтези, мистика, юмор',
--   'finished'
-- );
